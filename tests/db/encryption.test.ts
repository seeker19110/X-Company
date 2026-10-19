// Mã hoá dữ liệu lúc lưu (T-048; BASE-SEC-013, DB-SEC-001, DB-SEC-009, CMP-PRIV-007). Postgres THẬT + hệ tệp thật.
// Nhãn bằng chứng: faithful-fixture (cụm tạm, khoá sinh lúc chạy, KHÔNG phải KMS/HSM hay production).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  ENCRYPTED_COLUMNS,
  encryptedPlainColumns,
  openText,
  revealText,
  textColumn,
} from "../../lib/crypto/columns.ts";
import { collect, decryptFileStream, encryptFileStream } from "../../lib/crypto/file.ts";
import {
  CryptoError,
  blindIndex,
  decryptField,
  encryptField,
  envelopeKeyId,
  normalizePhone,
} from "../../lib/crypto/index.ts";
import { backfill, rotateFiles, rotateKeys, verifyFiles } from "../../lib/crypto/rotate.ts";
import { withTx } from "../../lib/db/index.ts";
import { diskStorage } from "../../lib/files/storage.ts";
import { createEmployee } from "../../lib/org/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

// Khoá thử sinh lúc chạy (không literal khoá → gitleaks sạch, không trùng khoá thật).
const k = () => randomBytes(32).toString("base64");
const K1 = k();
const K2 = k();
process.env.DATA_ENCRYPTION_KEYS = `k1:${K1}`;
process.env.DATA_INDEX_KEY = k();

const setEnv = (name: string, value: string | undefined) => {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[name];
  else (process.env as Record<string, string | undefined>)[name] = value;
};
const PHONE = "0912 345 678";
const PHONE_PLAIN_MARK = "0912345678";
const ctx = (rowId: string, column = "phone_enc", table = "employee") => ({ table, column, rowId });
const isCode = (code: string) => (e: unknown) => e instanceof CryptoError && e.code === code;

describe("phong bì trường AES-256-GCM", () => {
  test("round-trip Unicode/rỗng; IV ngẫu nhiên; định dạng v1:<keyId>:<iv>:<tag>:<ct>", () => {
    const id = randomUUID();
    for (const v of ["", "Đặng Thị Ánh — 0912 ✓", "x".repeat(10_000)]) {
      const e = encryptField(ctx(id), v);
      assert.match(e, /^v1:k1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$/);
      assert.equal(decryptField(ctx(id), e), v);
    }
    assert.notEqual(encryptField(ctx(id), "a"), encryptField(ctx(id), "a"));
    assert.equal(envelopeKeyId(encryptField(ctx(id), "a")), "k1");
  });

  test("sai AAD (tráo dòng/cột/bảng) và bản mã bị sửa → AUTH_FAILED", () => {
    const a = randomUUID();
    const e = encryptField(ctx(a), "bí mật");
    assert.throws(() => decryptField(ctx(randomUUID()), e), isCode("AUTH_FAILED"));
    assert.throws(() => decryptField(ctx(a, "reason_enc"), e), isCode("AUTH_FAILED"));
    assert.throws(() => decryptField(ctx(a, "phone_enc", "inquiry"), e), isCode("AUTH_FAILED"));
    const parts = e.split(":");
    parts[4] = Buffer.from("khac-han").toString("base64url");
    assert.throws(() => decryptField(ctx(a), parts.join(":")), isCode("AUTH_FAILED"));
  });

  test("phong bì sai định dạng, khoá lạ, ngữ cảnh sai → lỗi rõ, không lộ bản rõ", () => {
    assert.throws(() => decryptField(ctx("x"), "v2:k1:a:b:c"), isCode("BAD_ENVELOPE"));
    assert.throws(() => decryptField(ctx("x"), "rac"), isCode("BAD_ENVELOPE"));
    const e = encryptField(ctx("x"), "bí mật");
    assert.throws(() => decryptField(ctx("x"), e.replace(":k1:", ":zz:")), isCode("KEY_UNKNOWN"));
    assert.throws(() => encryptField({ table: "a b", column: "c", rowId: "x" }, "v"), isCode("BAD_CONTEXT"));
    assert.throws(() => encryptField({ table: "a", column: "c", rowId: "" }, "v"), isCode("BAD_CONTEXT"));
    try {
      decryptField(ctx("x"), e.replace(":k1:", ":zz:"));
    } catch (err) {
      assert.equal(String((err as Error).message).includes("bí mật"), false);
    }
  });

  test("xoay khoá: thêm khoá mới lên đầu vẫn đọc được bản mã cũ; bỏ khoá cũ → KEY_UNKNOWN", () => {
    const old = encryptField(ctx("r"), "giữ được");
    process.env.DATA_ENCRYPTION_KEYS = `k2:${K2},k1:${K1}`;
    try {
      assert.equal(decryptField(ctx("r"), old), "giữ được");
      assert.equal(envelopeKeyId(encryptField(ctx("r"), "mới")), "k2");
      process.env.DATA_ENCRYPTION_KEYS = `k2:${K2}`;
      assert.throws(() => decryptField(ctx("r"), old), isCode("KEY_UNKNOWN"));
    } finally {
      process.env.DATA_ENCRYPTION_KEYS = `k1:${K1}`;
    }
  });

  test("production thiếu khoá → EnvError nêu tên biến (fail-closed); dev có khoá thử", () => {
    const saved = { ...process.env };
    try {
      setEnv("NODE_ENV", "production");
      delete process.env.DATA_ENCRYPTION_KEYS;
      assert.throws(() => encryptField(ctx("x"), "v"), /DATA_ENCRYPTION_KEYS/);
      setEnv("NODE_ENV", "development");
      const e = encryptField(ctx("x"), "v");
      assert.match(e, /^v1:dev:/);
      assert.equal(decryptField(ctx("x"), e), "v");
    } finally {
      setEnv("NODE_ENV", saved.NODE_ENV);
      process.env.DATA_ENCRYPTION_KEYS = saved.DATA_ENCRYPTION_KEYS;
    }
  });
});

describe("chỉ mục mù", () => {
  test("NFC + chữ thường + trim; khác ngữ cảnh → khác; null/rỗng → null", () => {
    const nfd = "É.A@x.test"; // É tách tổ hợp
    const nfc = "É.a@x.test ";
    assert.equal(blindIndex("inquiry.email", nfd), blindIndex("inquiry.email", nfc));
    assert.notEqual(blindIndex("inquiry.email", "a@x.test"), blindIndex("employee.email", "a@x.test"));
    assert.equal(blindIndex("c", null), null);
    assert.equal(blindIndex("c", "   "), null);
    assert.equal(normalizePhone("(+84) 912-345.678"), "+84912345678");
    assert.equal(String(blindIndex("c", "A")).length, 43);
    assert.equal(blindIndex("c", "A"), blindIndex("c", "a"));
  });
});

describe("cột PII mã hoá trong Postgres", () => {
  let db: TestDb;
  let companyId: string;
  const phoneCol = textColumn("employee", "phone");
  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany());
  });
  after(async () => {
    await db.close();
  });

  const mkEmp = (code: string, phone: string | null) =>
    withTx((tx) => createEmployee(tx, { userId: null }, companyId, { code, fullName: `NV ${code}`, phone }));
  const rawRow = async (id: string) =>
    (await db.admin.query("SELECT phone, phone_enc, phone_bidx FROM employee WHERE id = $1", [id])).rows[0]!;

  test("ghi → cột bản rõ NULL, SELECT trực tiếp cột enc không thấy bản rõ, đọc giải mã đúng", async () => {
    const id = await mkEmp("E1", PHONE);
    const r = await rawRow(id);
    assert.equal(r.phone, null);
    assert.match(r.phone_enc, /^v1:k1:/);
    assert.equal(String(r.phone_enc).includes(PHONE_PLAIN_MARK), false);
    assert.equal(openText(phoneCol, id, r), PHONE);
    const [shown] = revealText("employee", "phone", [{ id, ...r }]);
    assert.equal(shown!.phone, PHONE);
    assert.equal("phone_enc" in shown!, false);
    assert.equal("phone_bidx" in shown!, false);
    const none = await rawRow(await mkEmp("E2", null));
    assert.deepEqual([none.phone, none.phone_enc, none.phone_bidx], [null, null, null]);
  });

  test("tráo bản mã sang dòng khác → lỗi (AAD)", async () => {
    const a = await mkEmp("E3", "0900 000 003");
    const b = await mkEmp("E4", "0900 000 004");
    const ra = await rawRow(a);
    assert.throws(() => openText(phoneCol, b, ra), isCode("AUTH_FAILED"));
  });

  test("chỉ mục mù tìm đúng bất kể khoảng trắng/dấu phân cách; không tìm thấy số khác", async () => {
    await mkEmp("E5", "+84 912-345-999");
    const find = async (v: string) =>
      (
        await db.admin.query("SELECT code FROM employee WHERE company_id = $1 AND phone_bidx = $2", [
          companyId,
          blindIndex("employee.phone", normalizePhone(v)),
        ])
      ).rows.map((x) => x.code);
    assert.deepEqual(await find("+84912345999"), ["E5"]);
    assert.deepEqual(await find("(+84) 912.345.999"), ["E5"]);
    assert.deepEqual(await find("+84912345000"), []);
  });

  test("dòng cũ (bản rõ): đọc được; backfill idempotent + kiểm số dòng; scrub chỉ khi khớp", async () => {
    const legacy = await db.admin.query(
      "INSERT INTO employee (company_id, code, full_name, phone) VALUES ($1, 'OLD1', 'Cũ 1', $2), ($1, 'OLD2', 'Cũ 2', $3) RETURNING id",
      [companyId, "0988 111 222", "0988 333 444"],
    );
    const [o1] = legacy.rows;
    assert.equal(openText(phoneCol, o1.id, await rawRow(o1.id)), "0988 111 222"); // đọc rơi về bản rõ
    const r1 = (await backfill(db.app, { batchSize: 1 })).find((x) => x.target === "employee.phone")!;
    assert.equal(r1.encrypted, 2);
    assert.equal(r1.remainingUnencrypted, 0);
    assert.equal(r1.remainingPlain, 2); // chưa scrub → còn đường lùi
    const r2 = (await backfill(db.app)).find((x) => x.target === "employee.phone")!;
    assert.equal(r2.encrypted, 0); // idempotent
    assert.equal(openText(phoneCol, o1.id, await rawRow(o1.id)), "0988 111 222");
    // Bản mã bị tráo thì scrub dừng, KHÔNG xoá bản rõ.
    const other = await rawRow(await mkEmp("E6", "0900 000 006"));
    await db.admin.query("UPDATE employee SET phone_enc = $2 WHERE id = $1", [o1.id, other.phone_enc]);
    await assert.rejects(backfill(db.app, { scrub: true }), /không khớp|AUTH_FAILED|giải mã/);
    assert.equal((await rawRow(o1.id)).phone, "0988 111 222");
    await db.admin.query("UPDATE employee SET phone_enc = NULL, phone_bidx = NULL WHERE id = $1", [o1.id]);
    await backfill(db.app);
    assert.equal(
      (await backfill(db.app, { reindex: true })).find((x) => x.target === "employee.phone")!.reindexed,
      0,
    );
    const s = (await backfill(db.app, { scrub: true })).find((x) => x.target === "employee.phone")!;
    assert.equal(s.remainingUnencrypted, 0);
    assert.equal(s.remainingPlain, 0);
    assert.equal(openText(phoneCol, o1.id, await rawRow(o1.id)), "0988 111 222");
  });

  test("xoay khoá: dòng đọc được trước/sau, idempotent, theo lô, bỏ khoá cũ vẫn đọc được", async () => {
    const ids = [
      await mkEmp("R1", "0911 000 001"),
      await mkEmp("R2", "0911 000 002"),
      await mkEmp("R3", null),
    ];
    process.env.DATA_ENCRYPTION_KEYS = `k2:${K2},k1:${K1}`;
    try {
      const rep = (await rotateKeys(db.app, { batchSize: 2 })).find((x) => x.target === "employee.phone")!;
      assert.ok(rep.rotated >= 2);
      assert.equal(rep.stale, 0);
      const again = (await rotateKeys(db.app)).find((x) => x.target === "employee.phone")!;
      assert.equal(again.rotated, 0);
      const stale = await db.admin.query(
        "SELECT count(*)::int AS n FROM employee WHERE phone_enc IS NOT NULL AND phone_enc NOT LIKE 'v1:k2:%'",
      );
      assert.equal(stale.rows[0].n, 0);
      process.env.DATA_ENCRYPTION_KEYS = `k2:${K2}`; // khoá cũ đã bỏ
      assert.equal(openText(phoneCol, ids[0]!, await rawRow(ids[0]!)), "0911 000 001");
    } finally {
      process.env.DATA_ENCRYPTION_KEYS = `k1:${K1}`;
    }
  });

  test("toạ độ: bản rõ gốc chỉ đổi thành NULL khi đã có bản mã; không xoá bản mã", async () => {
    const { employeeId, ev } = await (async () => {
      const e = await mkEmp("G1", null);
      const r = await db.admin.query(
        `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time, source, status, geo_lat, geo_lng, geo_accuracy_m, geo_captured_at)
         VALUES ($1, $2, 'geo-key-0001', 'h', 'in', now(), 'gps', 'accepted', 10.5, 106.5, 12, now()) RETURNING id`,
        [companyId, e],
      );
      return { employeeId: e, ev: r.rows[0].id as string };
    })();
    assert.notEqual(employeeId, "");
    await assert.rejects(
      db.app.query(
        "UPDATE attendance_event SET geo_lat = NULL, geo_lng = NULL, geo_accuracy_m = NULL, geo_captured_at = NULL WHERE id = $1",
        [ev],
      ),
      /chỉ được xoá bản rõ khi đã có bản mã/,
    );
    await assert.rejects(
      db.app.query("UPDATE attendance_event SET geo_lat = 1 WHERE id = $1", [ev]),
      /bằng chứng gốc|bản mã/,
    );
    const rep = (await backfill(db.app, { scrub: true })).find((x) => x.target === "attendance_event.geo")!;
    assert.equal(rep.remainingPlain, 0);
    const row = (await db.admin.query("SELECT geo_lat, geo_enc FROM attendance_event WHERE id = $1", [ev]))
      .rows[0];
    assert.equal(row.geo_lat, null);
    assert.equal(String(row.geo_enc).includes("10.5"), false);
    await assert.rejects(
      db.app.query("UPDATE attendance_event SET geo_enc = NULL WHERE id = $1", [ev]),
      /không xoá bản mã/,
    );
  });

  test("pg_dump không chứa chuỗi PII mẫu (SĐT/toạ độ đã mã hoá)", async () => {
    const e = await mkEmp("D1", "0977 654 321");
    const inq = await db.admin.query(
      `INSERT INTO inquiry (id, company_id, code, submission_id, name, email, phone_enc, message, status, consent_at, consent_notice_version, due_at)
       VALUES ($1, $2, 'YC-DUMP', $3, 'Khách', 'dump@x.test', $4, 'hi', 'new', now(), 'v1', now()) RETURNING id`,
      [
        randomUUID(),
        companyId,
        randomUUID(),
        encryptField(ctx("tmp", "phone_enc", "inquiry"), "0966 111 000"),
      ],
    );
    assert.notEqual(e, "");
    assert.equal(inq.rowCount, 1);
    await db.admin.query(
      `INSERT INTO attendance_event (id, company_id, employee_id, idempotency_key, request_hash, kind, device_time, source, status, geo_enc)
       VALUES ($1, $2, $3, 'geo-dump-0001', 'h', 'in', now(), 'gps', 'accepted', $4)`,
      [
        "11111111-1111-4111-8111-111111111111",
        companyId,
        e,
        encryptField(
          { table: "attendance_event", column: "geo_enc", rowId: "11111111-1111-4111-8111-111111111111" },
          JSON.stringify({ lat: 21.028511, lng: 105.804817 }),
        ),
      ],
    );
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${db.name}`;
    const dump = spawnSync("pg_dump", ["--no-owner", "-d", url.toString()], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    assert.equal(dump.status, 0, dump.stderr);
    for (const secret of ["0977 654 321", "0977654321", "0966 111 000", "21.028511", "105.804817"])
      assert.equal(dump.stdout.includes(secret), false, `dump lộ ${secret}`);
    assert.ok(dump.stdout.includes("v1:k1:"));
  });

  test("COMMENT PII khớp hai chiều với data-map.yaml; enc=yes khớp sổ đăng ký mã hoá; cột planned chưa tồn tại", async () => {
    const yaml = readFileSync(new URL("../../docs/privacy/data-map.yaml", import.meta.url), "utf8");
    const piiPart = yaml.split("\nreviewed_non_pii")[0]!;
    const map = piiPart
      .split("\n  - table: ")
      .slice(1)
      .map((b) => ({
        key: `${b.split("\n")[0]}.${/column: (\w+)/.exec(b)![1]}`,
        cls: /class: (\w+)/.exec(b)![1]!,
        status: /status: (\w+)/.exec(b)![1]!,
      }));
    assert.equal(map.length, 44);
    const { rows } = await db.admin.query(
      `SELECT c.relname || '.' || a.attname AS key, d.description
         FROM pg_description d JOIN pg_class c ON c.oid = d.objoid JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid
        WHERE n.nspname = 'public' AND d.description LIKE 'PII:%'`,
    );
    const inDb = new Map(rows.map((r) => [r.key as string, r.description as string]));
    const implemented = map.filter((m) => m.status === "implemented");
    assert.equal(implemented.length, 42);
    assert.deepEqual(
      [...inDb.keys()].sort(),
      implemented.map((m) => m.key).sort(),
      "COMMENT ≠ data-map (hai chiều)",
    );
    const CLASS = { thuong: "PII", nhay_cam: "SENSITIVE", bi_mat: "SECRET" } as Record<string, string>;
    const encYes = new Set(encryptedPlainColumns());
    for (const m of implemented) {
      const d = inDb.get(m.key)!;
      assert.match(d, /^PII: .+; class=(PII|SENSITIVE|SECRET); enc=(yes|no)$/);
      assert.ok(d.includes(`class=${CLASS[m.cls]};`), `${m.key}: phân loại lệch data-map`);
      assert.equal(d.endsWith("enc=yes"), encYes.has(m.key), `${m.key}: enc lệch sổ đăng ký mã hoá`);
    }
    for (const key of encYes) assert.ok(inDb.has(key), `${key} chưa có COMMENT`);
    for (const m of map.filter((x) => x.status === "planned")) {
      const [t, c] = m.key.split(".");
      const ex = await db.admin.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
        [t, c],
      );
      assert.equal(ex.rowCount, 0, `${m.key} đã tồn tại nhưng data-map còn 'planned'`);
    }
    // Mọi cột bản mã/chỉ mục của sổ đăng ký tồn tại và cho phép NULL.
    for (const c of ENCRYPTED_COLUMNS) {
      const cols = c.kind === "geo" ? [c.enc] : [c.enc, ...(c.bidx ? [c.bidx] : [])];
      for (const col of cols) {
        const r = await db.admin.query(
          "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
          [c.table, col],
        );
        assert.equal(r.rows[0]?.is_nullable, "YES", `${c.table}.${col}`);
      }
    }
  });

  test("DB-SEC-001: cột có tên gợi PII đều có COMMENT hoặc nằm trong reviewed_non_pii", async () => {
    const yaml = readFileSync(new URL("../../docs/privacy/data-map.yaml", import.meta.url), "utf8");
    const reviewed = new Set(
      [
        ...yaml
          .split("\nreviewed_non_pii")[1]!
          .split("\nlinked_tables")[0]!
          .matchAll(/table: (\w+)\n\s+column: (\w+)/g),
      ].map((m) => `${m[1]}.${m[2]}`),
    );
    const { rows } = await db.admin.query(
      `SELECT c.table_name || '.' || c.column_name AS key, pgd.description
         FROM information_schema.columns c
         LEFT JOIN pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = 'public'::regnamespace
         LEFT JOIN pg_description pgd ON pgd.objoid = pc.oid AND pgd.objsubid = c.ordinal_position
        WHERE c.table_schema = 'public'
          AND c.column_name ~ '(^|_)(email|phone|mobile|birth|dob|address|cccd|cmnd|passport|ip|user_agent|geo_[a-z_]+|full_name)(_|$)'`,
    );
    const missing = rows
      .filter((r) => !/^(PII|ENC|BIDX):/.test(String(r.description ?? "")) && !reviewed.has(r.key))
      .map((r) => r.key);
    assert.deepEqual(missing, []);
  });
});

describe("tệp tải lên mã hoá (envelope encryption)", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "enc-files-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  const onDisk = (key: string) => path.join(dir, key);

  test("round-trip nhiều kích cỡ (rỗng, 1 byte, đúng 64 KiB, > 3 khối); đĩa không chứa bản rõ", async () => {
    const st = diskStorage(dir);
    for (const n of [0, 1, 65_536, 65_537, 200_000]) {
      const data = Buffer.concat([Buffer.from("TAI-LIEU-MAT-"), randomBytes(n)]).subarray(0, Math.max(n, 0));
      const key = await st.put(data);
      assert.deepEqual(await st.get(key), data, `n=${n}`);
      if (n > 20) assert.equal(readFileSync(onDisk(key)).includes(data.subarray(0, 16)), false);
    }
    const secret = Buffer.from("NOI-DUNG-CV-RIENG-TU");
    const key = await st.put(secret);
    assert.equal(readFileSync(onDisk(key)).includes(secret), false);
  });

  test("tệp cũ (bản rõ, không có đầu phiên bản) vẫn đọc được", async () => {
    const st = diskStorage(dir);
    const key = await st.put(Buffer.from("x"));
    const legacyKey = `${key.slice(0, 2)}/${"a".repeat(40)}`;
    writeFileSync(onDisk(legacyKey), "tệp cũ bản rõ");
    assert.equal((await st.get(legacyKey)).toString("utf8"), "tệp cũ bản rõ");
    writeFileSync(onDisk(`${key.slice(0, 2)}/${"b".repeat(40)}`), "");
    assert.equal((await st.get(`${key.slice(0, 2)}/${"b".repeat(40)}`)).length, 0);
  });

  test("tráo bản mã sang khoá lưu khác, sửa 1 byte, cắt cụt, thừa dữ liệu → bị phát hiện", async () => {
    const st = diskStorage(dir);
    const a = await st.put(Buffer.from("tệp A ".repeat(50_000)));
    const b = await st.put(Buffer.from("tệp B"));
    writeFileSync(onDisk(b), readFileSync(onDisk(a))); // tráo
    await assert.rejects(st.get(b), isCode("AUTH_FAILED"));
    const raw = readFileSync(onDisk(a));
    const flipped = Buffer.from(raw);
    flipped[flipped.length - 20] = flipped[flipped.length - 20]! ^ 1;
    writeFileSync(onDisk(a), flipped);
    await assert.rejects(st.get(a), isCode("AUTH_FAILED"));
    const c = await st.put(Buffer.from("c".repeat(150_000)));
    const rc = readFileSync(onDisk(c));
    writeFileSync(onDisk(c), rc.subarray(0, rc.length - 30));
    await assert.rejects(st.get(c), isCode("AUTH_FAILED"));
    const d = await st.put(Buffer.from("d".repeat(150_000)));
    const rd = readFileSync(onDisk(d));
    writeFileSync(onDisk(d), rd.subarray(0, 8 + 1 + 2 + 60 + 5 + 65_536 + 16)); // cụt đúng ranh giới khối đầu
    await assert.rejects(st.get(d), isCode("AUTH_FAILED"));
    const e = await st.put(Buffer.from("e"));
    writeFileSync(onDisk(e), Buffer.concat([readFileSync(onDisk(e)), Buffer.from("thua")]));
    await assert.rejects(st.get(e), isCode("AUTH_FAILED"));
  });

  test("thiếu khoá ở production / khoá cũ bị bỏ → lỗi rõ, không để lại tệp dở dang", async () => {
    const st = diskStorage(dir);
    const key = await st.put(Buffer.from("cần khoá k1"));
    const saved = { ...process.env };
    try {
      process.env.DATA_ENCRYPTION_KEYS = `k9:${K2}`;
      await assert.rejects(st.get(key), isCode("KEY_UNKNOWN"));
      setEnv("NODE_ENV", "production");
      delete process.env.DATA_ENCRYPTION_KEYS;
      const before = readdirSync(dir).length;
      await assert.rejects(st.put(Buffer.from("x")), /DATA_ENCRYPTION_KEYS/);
      const leftovers = readdirSync(dir).flatMap((d) => readdirSync(path.join(dir, d)));
      assert.ok(leftovers.every((f) => /^[0-9a-f]{40}$/.test(f)));
      assert.ok(readdirSync(dir).length >= before);
    } finally {
      setEnv("NODE_ENV", saved.NODE_ENV);
      process.env.DATA_ENCRYPTION_KEYS = saved.DATA_ENCRYPTION_KEYS;
    }
  });

  test("xoay khoá tệp: bọc lại khoá tệp, nội dung giữ nguyên, idempotent, mã hoá luôn tệp cũ", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "enc-rot-"));
    try {
      const st = diskStorage(root);
      const big = randomBytes(150_000);
      const key = await st.put(big);
      const legacy = `${key.slice(0, 2)}/${"c".repeat(40)}`;
      writeFileSync(path.join(root, legacy), "cũ rõ");
      process.env.DATA_ENCRYPTION_KEYS = `k2:${K2},k1:${K1}`;
      const r1 = await rotateFiles(root);
      assert.equal(r1.rewrapped, 1);
      assert.equal(r1.encryptedLegacy, 1);
      assert.deepEqual((await rotateFiles(root)).rewrapped, 0);
      process.env.DATA_ENCRYPTION_KEYS = `k2:${K2}`; // bỏ khoá cũ
      assert.deepEqual(await st.get(key), big);
      assert.equal((await st.get(legacy)).toString("utf8"), "cũ rõ");
      assert.equal(await verifyFiles(root), 2);
    } finally {
      process.env.DATA_ENCRYPTION_KEYS = `k1:${K1}`;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("luồng: khối rỗng hợp lệ và giải mã từng khối", async () => {
    const ctxF = { storageKey: "ab/" + "d".repeat(40) };
    const enc = await collect(encryptFileStream([Buffer.alloc(0)], ctxF));
    assert.equal((await collect(decryptFileStream([enc], ctxF))).length, 0);
  });
});
