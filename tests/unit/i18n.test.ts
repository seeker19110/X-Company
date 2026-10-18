// XC-I18N-001/003/005, BASE-DATA-001/002, UX-CONTENT-002: tài nguyên chuỗi + t(), kiểm check:i18n / check:encoding,
// định dạng Intl, khoá so sánh/tìm kiếm không dấu.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { normalizeEmail } from "../../lib/identity/auth.ts";
import {
  createTranslator,
  flattenMessages,
  mergeMessages,
  t,
  type MessageKey,
} from "../../lib/i18n/index.ts";
import {
  EMPTY,
  formatDate,
  formatDateTime,
  formatList,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  formatVnd,
} from "../../lib/i18n/format.ts";
import { comparisonKey, searchKey } from "../../lib/nen/text.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as i18nScript from "../../scripts/check-i18n.mjs";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as encodingScript from "../../scripts/check-encoding.mjs";

const { badLeaves, check: checkI18n, checkKeys, flattenKeys, loadMessages } = i18nScript;
interface Scan {
  violations: string[];
  keys: { key: string; line: number }[];
}
const scanSource = i18nScript.scanSource as (file: string, src: string, opts?: object) => Scan;
const { check: checkEncoding, checkBuffer, isBinaryName } = encodingScript;
const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
/** Intl dùng NBSP/NNBSP giữa số và ký hiệu tiền: so sánh sau khi đổi thành khoảng trắng thường. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("t() — XC-I18N-001", () => {
  const tr = createTranslator({ a: { hello: "Xin chào {ten}", n: "{a}/{b}", plain: "Chữ thường" } });

  test("nội suy {ten}, số, nhiều tham số; tham số thừa bị bỏ qua", () => {
    assert.equal(tr("a.hello", { ten: "Việt" }), "Xin chào Việt");
    assert.equal(tr("a.n", { a: 0, b: 12 }), "0/12");
    assert.equal(tr("a.plain", { khong_dung: 1 }), "Chữ thường");
    assert.equal(tr("a.plain"), "Chữ thường");
  });

  test("khoá thiếu → ném lỗi; tham số thiếu → ném lỗi (không để {ten} lọt lên giao diện)", () => {
    assert.throws(() => (tr as (k: string) => string)("a.khong_co"), /thiếu khoá "a\.khong_co"/);
    assert.throws(() => (tr as (k: string) => string)(""), /thiếu khoá/);
    assert.throws(() => (tr as (k: string) => string)("a"), /thiếu khoá "a"/); // nhánh, không phải lá
    assert.throws(() => tr("a.hello"), /thiếu tham số "ten"/);
    assert.throws(() => tr("a.hello", {}), /thiếu tham số "ten"/);
  });

  test("giá trị 0 và chuỗi rỗng là tham số hợp lệ (khác thiếu)", () => {
    assert.equal(tr("a.hello", { ten: "" }), "Xin chào ");
    assert.equal(tr("a.n", { a: 0, b: 0 }), "0/0");
  });

  test("t thật: chuỗi tiếng Việt có dấu nguyên vẹn; khoá có kiểu (sai khoá = lỗi tsc)", () => {
    assert.equal(t("nav.today"), "Hôm nay");
    assert.equal(t("dashboard.title"), "Bảng điều hành"); // khoá chỉ-server vẫn có ở t đầy đủ
    assert.equal(
      t("clock.result", { kind: "Vào ca", state: "Đã được xác nhận" }),
      "Vào ca: Đã được xác nhận",
    );
    assert.throws(() => t("khong.co.khoa" as MessageKey), /thiếu khoá/);
    // @ts-expect-error -- khoá không có trong messages/vi.json phải bị tsc chặn
    const bad: MessageKey = "khong.co.khoa";
    assert.equal(typeof bad, "string");
  });

  test("flattenMessages: khoá lồng → a.b.c", () => {
    assert.deepEqual(
      [...flattenMessages({ a: { b: "1", c: { d: "2" } }, e: "3" }).entries()],
      [
        ["a.b", "1"],
        ["a.c.d", "2"],
        ["e", "3"],
      ],
    );
  });
});

describe("đồng bộ vi.json ↔ vi.context.json (XC-I18N-001)", () => {
  const messages = loadMessages((f: string) => JSON.parse(read(`messages/${f}`)));
  const context = JSON.parse(read("messages/vi.context.json"));

  test("cùng tập khoá, không lá rỗng, mọi chuỗi NFC", () => {
    assert.deepEqual(flattenKeys(messages).sort(), flattenKeys(context).sort());
    assert.deepEqual(badLeaves(messages), []);
    assert.deepEqual(badLeaves(context), []);
    for (const [k, v] of flattenMessages(messages))
      assert.equal(v, v.normalize("NFC"), `${k} không phải NFC`);
  });

  test("loadMessages: vi.json + vi.server.json gộp; trùng nhóm → lỗi", () => {
    const files: Record<string, object | undefined> = {
      "vi.json": { a: { x: "1" } },
      "vi.server.json": { b: { y: "2" } },
    };
    assert.deepEqual(
      loadMessages((f: string) => files[f] ?? {}),
      { a: { x: "1" }, b: { y: "2" } },
    );
    files["vi.server.json"] = { a: { y: "2" }, b: { y: "2" } };
    assert.deepEqual(
      loadMessages((f: string) => files[f] ?? {}),
      { a: { x: "1", y: "2" }, b: { y: "2" } },
    );
    files["vi.server.json"] = { a: { x: "9" } };
    assert.throws(
      () => loadMessages((f: string) => files[f] ?? {}),
      /"a\.x" có ở cả vi\.json và vi\.server\.json/,
    );
    assert.throws(() => mergeMessages({ a: { x: "1" } }, { a: { x: "9" } }), /khoá "a\.x" trùng/);
    assert.deepEqual(mergeMessages({ a: { x: "1" } }, { a: { y: "2" }, b: "3" }), {
      a: { x: "1", y: "2" },
      b: "3",
    });
  });

  test("checkKeys bắt: khoá dùng mà thiếu, khoá thiếu mô tả, mô tả thừa, lá rỗng", () => {
    const errs: string[] = checkKeys({
      messages: { a: "x", b: { c: "y" }, e: "" },
      context: { a: "mô tả", z: "thừa", e: "mô tả" },
      used: [
        { file: "app/p.tsx", key: "a", line: 1 },
        { file: "app/p.tsx", key: "khong.co", line: 7 },
      ],
    });
    assert.ok(errs.some((e) => e.includes('app/p.tsx:7: khoá "khong.co" không có trong messages/vi.json')));
    assert.ok(errs.some((e) => e.includes('thiếu mô tả cho khoá "b.c"')));
    assert.ok(errs.some((e) => e.includes('khoá "z" không có trong messages/vi.json')));
    assert.ok(errs.some((e) => e.includes('"e" rỗng')));
    assert.equal(errs.length, 4);
  });

  test("cây thật: không còn chuỗi cứng, mọi khoá dùng đều có, đồng bộ mô tả", () => {
    const r = checkI18n();
    assert.deepEqual(r.errors, []);
  });
});

describe("check-i18n: scanSource — chuỗi cứng trong JSX", () => {
  const scan = (src: string, file = "app/x.tsx") => scanSource(file, src);
  const wrap = (jsx: string) => `export const A = () => (${jsx});`;

  test("bắt chữ cái trong văn bản JSX, kể cả không dấu", () => {
    assert.equal(scan(wrap("<p>Xin chào</p>")).violations.length, 1);
    assert.equal(scan(wrap("<h1>Email</h1>")).violations.length, 1);
    assert.match(scan(wrap("<b>Save</b>")).violations[0]!, /chữ cứng trong JSX: "Save"/);
  });

  test("bắt aria-label/placeholder/title/alt là literal (chuỗi, {chuỗi}, template không biến)", () => {
    for (const attr of ["aria-label", "placeholder", "title", "alt"]) {
      assert.equal(
        scan(wrap(`<input ${attr}="Tên" />`)).violations.filter((v) => v.includes(attr)).length,
        1,
        attr,
      );
      assert.equal(
        scan(wrap(`<input ${attr}={"Tên"} />`)).violations.filter((v) => v.includes(attr)).length,
        1,
      );
      assert.equal(
        scan(wrap(`<input ${attr}={\`Tên\`} />`)).violations.filter((v) => v.includes(attr)).length,
        1,
      );
    }
  });

  test('bắt {"chữ"} làm con của phần tử', () => {
    assert.match(scan(wrap('<p>{"Tên"}</p>')).violations.join("\n"), /chuỗi cứng trong JSX/);
  });

  test("cho qua: t(), biến, ký hiệu không có chữ, thuộc tính không phải văn bản", () => {
    const ok = wrap(
      '<div className="btn big" id="x" role="status" aria-label={t("nav.label")} title={name}><p>{t("nav.today")} · {n}</p><i>—</i><b>© 2026</b></div>',
    );
    // "© 2026": không có chữ cái → không phải chuỗi người dùng cần dịch.
    assert.deepEqual(scan(ok).violations, []);
  });

  test("i18n-ignore (cùng dòng hoặc dòng trên, có lý do) bỏ qua; thiếu lý do thì không", () => {
    assert.deepEqual(
      scan(wrap("<code>{/* i18n-ignore: mã lệnh, không dịch */}npm ci</code>")).violations,
      [],
    );
    assert.deepEqual(
      scan(
        `export const A = () => (\n  <div>\n    {/* i18n-ignore: tên riêng không dịch */}\n    <b>Acme</b>\n  </div>\n);`,
      ).violations,
      [],
    );
    assert.deepEqual(
      scan(`export const A = () => <input title="Tên" />; // i18n-ignore: giá trị kỹ thuật`).violations,
      [],
    );
    assert.equal(scan(`export const A = () => <input title="Name" />; // i18n-ignore:`).violations.length, 1);
    assert.equal(scan(`export const A = () => <input title="Name" />; // i18n-ignore`).violations.length, 1);
  });

  test("số dòng báo đúng chỗ vi phạm", () => {
    const v = scan("export const A = () => (\n  <div>\n    <p>Tên</p>\n  </div>\n);").violations;
    assert.equal(v.length, 1);
    assert.match(v[0]!, /^app\/x\.tsx:3:/);
  });
});

describe("check-i18n: scanSource — chuỗi tiếng Việt cứng trong .ts và khoá t()", () => {
  const scan = (src: string, file = "app/components/m.ts") => scanSource(file, src);

  test("bắt literal có dấu tiếng Việt (cả NFD) ở tệp .ts; cho qua chuỗi ASCII", () => {
    assert.equal(scan('export const M = "Đã xảy ra lỗi";').violations.length, 1);
    assert.equal(scan(`export const M = "Việt".normalize("NFD");`).violations.length, 1);
    assert.equal(scan("export const M = `Lỗi ${1}`;").violations.length, 1);
    assert.deepEqual(scan('export const M = "content-type";').violations, []);
  });

  test("đối số reportClientError (nhật ký DevTools) được miễn; chỗ khác thì không", () => {
    assert.deepEqual(scan('reportClientError("đồng bộ thất bại", e);').violations, []);
    assert.equal(scan('showToast("đồng bộ thất bại");').violations.length, 1);
    assert.deepEqual(scan('showToast("đồng bộ thất bại"); // i18n-ignore: thử nghiệm').violations, []);
  });

  test('thu khoá t("…") kèm số dòng; khoá động bị báo', () => {
    const r = scan('const a = t("a.b");\nconst b = t(`x.${y}`);\nconst c = t(k);\nconst d = t(`c.d`);');
    assert.deepEqual(
      r.keys.map((k: { key: string; line: number }) => [k.key, k.line]),
      [
        ["a.b", 1],
        ["c.d", 4],
      ],
    );
    assert.equal(r.violations.length, 2);
    assert.ok(r.violations.every((v: string) => v.includes("khoá t() không phải chuỗi cố định")));
  });

  test("lib: áp luật chuỗi cứng — AppError, tóm tắt, mẫu chuỗi đều bị báo", () => {
    const lib = (src: string) => scanSource("lib/x.ts", src, { jsxRules: false });
    assert.equal(lib('throw new AppError("NOT_FOUND", 404, "Không tìm thấy");').violations.length, 1);
    assert.equal(lib("const s = `Quá hạn: ${x}`;").violations.length, 1);
    assert.equal(lib('const s = "Tên " + "Đặng";').violations.length, 2);
    assert.deepEqual(lib('throw new AppError("NOT_FOUND", 404, t("a.b"));').violations, []);
    assert.deepEqual(lib('const code = "NOT_FOUND"; const sql = "SELECT 1";').violations, []);
    assert.equal(lib('const r = /đ/g; const k = t("a.b");').keys.length, 1);
  });

  test("lib: miễn log.*/logger.*, new <X>Error (trừ AppError), comment; i18n-ignore cần lý do", () => {
    const lib = (src: string) => scanSource("lib/x.ts", src, { jsxRules: false }).violations;
    assert.deepEqual(lib('log.warn("kết nối bị ngắt", { err });'), []);
    assert.deepEqual(lib("logger.error(`lỗi ${x} chưa bắt`);"), []);
    assert.deepEqual(lib('logger[level]("sự kiện bảo mật", a);'), []);
    assert.deepEqual(lib('log.info("a " + "đã " + `giao ${x}`);'), []);
    assert.deepEqual(lib('throw new Error("Thiếu cấu hình");'), []);
    assert.deepEqual(lib("throw new RangeError(`số không hợp lệ (${v})`);"), []);
    assert.deepEqual(lib("// chú thích tiếng Việt\n/* khối: ê */ const a = 1;"), []);
    assert.equal(lib('throw new AppError("X", 400, "Lỗi");').length, 1);
    assert.equal(lib('foo("Lỗi", log);').length, 1); // log không phải callee
    assert.deepEqual(lib('const m = "Dấu ẩn"; // i18n-ignore: dữ liệu ổn định'), []);
    assert.deepEqual(lib('// i18n-ignore: dữ liệu ổn định\nconst m = "Dấu ẩn";'), []);
    assert.equal(lib('const m = "Dấu ẩn"; // i18n-ignore:').length, 1); // thiếu lý do
    assert.equal(lib('// i18n-ignore: lý do\n\nconst m = "Dấu ẩn";').length, 1); // cách một dòng trống
  });

  test("lib: i18n-ignore-file (≤ 15 dòng đầu, có lý do) tắt luật literal cho cả tệp; khoá t() vẫn thu", () => {
    const lib = (src: string) => scanSource("lib/x.ts", src, { jsxRules: false });
    assert.deepEqual(lib('// i18n-ignore-file: đầu ra vận hành\nconst m = "Lỗi"; t("a.b");').violations, []);
    assert.equal(lib('// i18n-ignore-file: đầu ra vận hành\nconst m = "Lỗi"; t("a.b");').keys.length, 1);
    assert.equal(lib('// i18n-ignore-file:\nconst m = "Lỗi";').violations.length, 1);
    assert.equal(lib(`${"\n".repeat(16)}// i18n-ignore-file: muộn\nconst m = "Lỗi";`).violations.length, 1);
  });

  test("bí danh import { t as tr } từ i18n được thu khoá; hàm cùng tên từ nơi khác thì không", () => {
    const r = scanSource(
      "lib/x.ts",
      'import { t as tr } from "../i18n/index.ts";\nconst a = tr("a.b"); const b = t("c.d");',
      { jsxRules: false },
    );
    assert.deepEqual(
      r.keys.map((k: { key: string }) => k.key),
      ["a.b", "c.d"],
    );
    const other = scanSource("lib/x.ts", 'import { t as tr } from "./other.ts";\nconst a = tr("a.b");', {
      jsxRules: false,
    });
    assert.deepEqual(other.keys, []);
    const dyn = scanSource("lib/x.ts", 'import { t as tr } from "../i18n/client-app.ts";\ntr(k);', {
      jsxRules: false,
    });
    assert.equal(dyn.violations.length, 1);
  });

  test("cây thật: lib/** và app/** không còn literal tiếng Việt ngoài comment/log/i18n-ignore", () => {
    assert.deepEqual(checkI18n().errors, []);
  });
});

describe("check-i18n: check() trên cây giả", () => {
  function tree(files: Record<string, string>): string {
    const dir = mkdtempSync(path.join(tmpdir(), "xc-i18n-"));
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  }
  const base = {
    "messages/vi.json": JSON.stringify({ a: { b: "Bê" } }),
    "messages/vi.context.json": JSON.stringify({ a: { b: "ngữ cảnh" } }),
  };

  test("đạt: mọi chuỗi qua t(), khoá có đủ", () => {
    const dir = tree({
      ...base,
      "app/p.tsx": 'export const P = () => <p>{t("a.b")}</p>;',
      "lib/m.ts": "export {};",
    });
    try {
      assert.deepEqual(checkI18n(dir).errors, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("đỏ: chữ cứng, khoá không có, lệch mô tả — và báo khoá chưa dùng", () => {
    const dir = tree({
      "messages/vi.json": JSON.stringify({ a: { b: "Bê", dead: "Chết" } }),
      "messages/vi.context.json": JSON.stringify({ a: { b: "x" } }),
      "app/p.tsx": 'export const P = () => <p title="Tên">Xin {t("x.y")}</p>;',
      "lib/m.ts": 'export const k = t("lib.thieu");',
    });
    try {
      const r = checkI18n(dir);
      const all = r.errors.join("\n");
      assert.match(all, /app\/p\.tsx:1: thuộc tính title là chuỗi cứng/);
      assert.match(all, /app\/p\.tsx:1: chữ cứng trong JSX/);
      assert.match(all, /app\/p\.tsx:1: khoá "x\.y" không có trong messages\/vi\.json/);
      assert.match(all, /lib\/m\.ts:1: khoá "lib\.thieu" không có/);
      assert.match(all, /thiếu mô tả cho khoá "a\.dead"/);
      assert.deepEqual(r.unused, ["a.b", "a.dead"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-encoding — BASE-DATA-001", () => {
  const u8 = (s: string) => Buffer.from(s, "utf8");

  test(".editorconfig đặt charset = utf-8", () => {
    assert.match(read(".editorconfig"), /^\s*charset\s*=\s*utf-8\s*$/m);
  });

  test("UTF-8 hợp lệ (có dấu, emoji, rỗng) → đạt", () => {
    assert.equal(checkBuffer("a.ts", u8("Tiếng Việt 🇻🇳")), null);
    assert.equal(checkBuffer("a.ts", u8("Tiếng Việt 🇻🇳".normalize("NFD"))), null);
    assert.equal(checkBuffer("a.ts", Buffer.alloc(0)), null);
  });

  test("bắt BOM UTF-8, UTF-16 có BOM, UTF-16 không BOM (NUL), Latin-1, byte rác", () => {
    assert.match(
      checkBuffer("a.ts", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), u8("x")]))!,
      /BOM UTF-8/,
    );
    assert.match(checkBuffer("a.ts", Buffer.from([0xff, 0xfe, 0x41, 0x00]))!, /UTF-16/);
    assert.match(checkBuffer("a.ts", Buffer.from([0xfe, 0xff, 0x00, 0x41]))!, /UTF-16/);
    assert.match(checkBuffer("a.ts", Buffer.from("Ab", "utf16le"))!, /NUL/);
    assert.match(checkBuffer("a.ts", Buffer.from("café", "latin1"))!, /không phải UTF-8 hợp lệ/);
    assert.match(checkBuffer("a.ts", Buffer.from([0x80, 0x81]))!, /không phải UTF-8 hợp lệ/);
  });

  test("tệp nhị phân theo đuôi được bỏ qua; đuôi hoa/thường đều nhận", () => {
    assert.equal(isBinaryName("x/logo.PNG"), true);
    assert.equal(isBinaryName("f.woff2"), true);
    assert.equal(isBinaryName("a.ts"), false);
    assert.equal(checkBuffer("logo.png", Buffer.from([0xff, 0xfe, 0x00, 0x80])), null);
  });

  test("check(): gom lỗi theo tệp, bỏ tệp đã xoá (ENOENT)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "xc-enc-"));
    try {
      writeFileSync(path.join(dir, "ok.txt"), "Việt");
      writeFileSync(path.join(dir, "bom.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), u8("x")]));
      writeFileSync(path.join(dir, "latin.txt"), Buffer.from("café", "latin1"));
      writeFileSync(path.join(dir, "anh.png"), Buffer.from([0xff, 0xfe, 0x00]));
      const errs: string[] = checkEncoding(["ok.txt", "bom.txt", "latin.txt", "anh.png", "da-xoa.txt"], dir);
      assert.equal(errs.length, 2, errs.join("\n"));
      assert.ok(errs.some((e) => e.startsWith("bom.txt") && e.includes("BOM")));
      assert.ok(errs.some((e) => e.startsWith("latin.txt") && e.includes("UTF-8")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("toàn bộ tệp git theo dõi trong repo là UTF-8 sạch", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 26 })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    assert.ok(files.length > 100);
    assert.deepEqual(checkEncoding(files, root), []);
  });
});

describe("định dạng Intl — XC-I18N-003", () => {
  test("số vi-VN: 1234567.89 → 1.234.567,89; en-US: 1,234,567.89", () => {
    assert.equal(formatNumber(1234567.89), "1.234.567,89");
    assert.equal(formatNumber(1234567.89, {}, "en-US"), "1,234,567.89");
  });

  test("tiền VND (số nguyên): 1234568 → 1.234.568 ₫; 0 và âm; số lẻ/NaN bị từ chối", () => {
    assert.equal(plain(formatVnd(1234568)), "1.234.568 ₫");
    assert.equal(plain(formatVnd(0)), "0 ₫");
    assert.equal(plain(formatVnd(-1234568)), "-1.234.568 ₫");
    assert.throws(() => formatVnd(1234.5), RangeError);
    assert.throws(() => formatVnd(Number.NaN), RangeError);
    assert.throws(() => formatVnd(Number.POSITIVE_INFINITY), RangeError);
    assert.throws(() => formatVnd(2 ** 60), RangeError);
  });

  test("ngày: 2026-10-13 → 13/10/2026 (vi-VN), 10/13/2026 (en-US); không lệch múi giờ", () => {
    assert.equal(formatDate("2026-10-13"), "13/10/2026");
    assert.equal(formatDate("2026-10-13", "en-US"), "10/13/2026");
    assert.equal(formatDate("2026-01-05"), "05/01/2026");
    // ngày thuần không đổi theo múi dù máy chạy ở đâu
    assert.equal(formatDate("2026-10-13", "vi-VN", "America/Los_Angeles"), "13/10/2026");
  });

  test("ngày giờ: thời điểm UTC → giờ Việt Nam (UTC+7), qua nửa đêm đổi ngày", () => {
    assert.equal(formatDateTime("2026-10-13T07:30:00Z"), "14:30 13/10/2026");
    assert.equal(formatDateTime("2026-10-13T18:30:00Z"), "01:30 14/10/2026");
    assert.equal(formatDateTime(new Date("2026-12-31T17:00:00Z")), "00:00 01/01/2027");
    assert.equal(formatTime("2026-10-13T07:05:00Z"), "14:05");
    assert.equal(formatDate("2026-10-13T18:00:00Z"), "14/10/2026"); // thời điểm → ngày theo múi VN
    assert.equal(formatDate(Date.UTC(2026, 9, 13, 7, 0)), "13/10/2026");
  });

  test("danh sách: A, B và C; hai phần tử; rỗng/null → EMPTY", () => {
    assert.equal(formatList(["A", "B", "C"]), "A, B và C");
    assert.equal(formatList(["A", "B"]), "A và B");
    assert.equal(formatList(["A"]), "A");
    assert.equal(formatList([]), EMPTY);
    assert.equal(formatList(null), EMPTY);
  });

  test("thời gian tương đối so với now truyền vào", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    assert.equal(formatRelative("2026-10-13T11:55:00Z", now), "5 phút trước");
    assert.equal(formatRelative("2026-10-13T14:00:00Z", now), "sau 2 giờ nữa");
    assert.match(formatRelative("2026-10-12T12:00:00Z", now), /^[Hh]ôm qua$/);
    assert.equal(formatRelative("2026-10-10T12:00:00Z", now), "3 ngày trước");
    assert.equal(formatRelative(now, now), "bây giờ");
    assert.equal(formatRelative("2026-10-13T12:00:20Z", now), "sau 20 giây nữa");
    assert.equal(formatRelative(null, now), EMPTY);
  });

  test("ca biên: 0, âm, null/undefined — thiếu KHÔNG thành 0", () => {
    assert.equal(formatNumber(0), "0");
    assert.equal(formatNumber(-0.5), "-0,5");
    assert.equal(formatNumber(-1234567.89), "-1.234.567,89");
    assert.equal(formatNumber(null), EMPTY);
    assert.equal(formatNumber(undefined), EMPTY);
    assert.notEqual(formatNumber(null), formatNumber(0));
    assert.equal(formatVnd(null), EMPTY);
    assert.equal(formatVnd(undefined), EMPTY);
    assert.equal(formatDate(null), EMPTY);
    assert.equal(formatDateTime(undefined), EMPTY);
    assert.equal(formatTime(null), EMPTY);
    assert.equal(formatPercent(null), EMPTY);
    assert.equal(formatPercent(0), "0%");
    assert.equal(formatPercent(0.256), "25,6%");
    assert.throws(() => formatNumber(Number.NaN), RangeError);
  });

  test("ngày không hợp lệ ném RangeError (không in 'Invalid Date')", () => {
    assert.throws(() => formatDate("không phải ngày"), RangeError);
    assert.throws(() => formatDateTime(new Date(Number.NaN)), RangeError);
  });

  test("lớp UI không còn định dạng cứng (toFixed, toLocale*, ghép ngày thủ công)", () => {
    const files = [
      "app/(public)/layout.tsx",
      "app/app/(secure)/today/page.tsx",
      "app/app/(secure)/tasks/page.tsx",
      "app/app/(secure)/dashboard/page.tsx",
      "app/app/(secure)/approvals/page.tsx",
      "app/app/(secure)/attendance/page.tsx",
      "app/components/labels.ts",
      "app/components/clock-buttons.tsx",
    ];
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /\.toFixed\(|\.toLocale(Date|Time)?String\(|new Intl\./, f);
      assert.doesNotMatch(src, /\$\{[^}]*\}\/\$\{[^}]*\}/, `${f}: ghép ngày thủ công`);
    }
  });
});

describe("khoá so sánh / tìm kiếm — XC-I18N-005, BASE-DATA-002", () => {
  const NFC = "Việt";
  const NFD = NFC.normalize("NFD");

  test("comparisonKey: NFC + trim + lower — NFD và NFC là một khoá", () => {
    assert.notEqual(NFD, NFC);
    assert.equal(comparisonKey(` ${NFD.toUpperCase()} `), comparisonKey(NFC));
    assert.equal(comparisonKey(" Nguyễn@X.Test "), "nguyễn@x.test");
    assert.equal(comparisonKey(""), "");
  });

  test("normalizeEmail dùng NFC + lower: email tên có dấu gõ tổ hợp = dựng sẵn", () => {
    const nfc = "Việt.Nguyễn@Example.TEST";
    assert.equal(normalizeEmail(nfc.normalize("NFD")), normalizeEmail(nfc));
    assert.equal(normalizeEmail("  A@B.C "), "a@b.c");
  });

  test('searchKey: "viet" tìm ra "Việt" (cả NFD), không phân biệt hoa thường, đ → d', () => {
    assert.equal(searchKey("viet"), searchKey(NFC));
    assert.equal(searchKey("VIET"), searchKey(NFD));
    assert.ok(searchKey("Nguyễn Văn Việt").includes(searchKey("viet")));
    assert.equal(searchKey("Đặng Đức"), "dang duc");
    assert.equal(searchKey(""), "");
    assert.equal(searchKey("123"), "123");
    // chủ ý chỉ dùng để tìm kiếm: hai giá trị khác nhau vẫn khác khoá so sánh duy nhất
    assert.notEqual(comparisonKey("Viet"), comparisonKey(NFC));
  });
});
