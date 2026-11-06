// Contract test CHUNG cho mọi backend kho tệp (T-116, D-073; ARC-RES-005, BASE-SEC-013): CÙNG một bộ ca chạy với `diskStorage` và
// `objectStorage(s3Transport)` trên máy chủ S3 THẬT tự host (rclone serve s3, ghim sha256 — tests/helpers/s3-fixture.ts; kiểm chữ ký
// SigV4). Thiếu rclone → ĐỎ có cách cài (không skip): `node scripts/tools/install-tool.mjs install rclone`.
// Ca: put→get đúng byte · khoá đúng STORAGE_KEY_RE, không trùng · backend chỉ giữ BẢN MÃ (đầu XCFILE, không chứa bản rõ) · sửa/tráo
// bản mã → lỗi xác thực · Unicode/rỗng/~5 MB (nhiều khối) · khoá lạ/không tồn tại → lỗi rõ · remove idempotent · ghi đồng thời ·
// hai thể hiện (mô phỏng 2 bản sao) đọc chéo · đi qua lib/files (Postgres thật). Nhãn: faithful-fixture (rclone cục bộ, không phải
// nhà cung cấp production — G7, D-005).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { s3ConfigFromEnv, registerStorage } from "../../adapters/register-storage.ts";
import { S3Error, s3Transport } from "../../adapters/s3-http.ts";
import { loadActor } from "../../lib/authz/load.ts";
import type { ActorContext } from "../../lib/authz/index.ts";
import { withTx } from "../../lib/db/index.ts";
import { FILE_MAGIC } from "../../lib/crypto/file.ts";
import { downloadFile, uploadFile } from "../../lib/files/index.ts";
import {
  diskStorage,
  getStorage,
  objectStorage,
  setStorage,
  STORAGE_KEY_RE,
  StorageNotFoundError,
  type ObjectTransport,
  type Storage,
} from "../../lib/files/storage.ts";
import { EnvError, loadEnv } from "../../lib/nen/env.ts";
import { createProject } from "../../lib/work/tasks.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";
import { startS3, type S3Fixture } from "../helpers/s3-fixture.ts";

setTestEnv();

/** Một backend dưới test: tạo thể hiện mới (như một bản sao) + đọc/ghi THÔ đúng thứ backend đang giữ. */
interface Backend {
  name: string;
  make(): Storage;
  raw(key: string): Promise<Buffer | null>;
  rawPut(key: string, body: Buffer): Promise<void>;
}

let s3: S3Fixture;
let diskDir: string;
const backends: Backend[] = [];

before(async () => {
  diskDir = mkdtempSync(path.join(tmpdir(), "xc-contract-disk-"));
  s3 = await startS3();
  const t = s3Transport(() => s3);
  backends.push(
    {
      name: "disk",
      make: () => diskStorage(diskDir),
      raw: async (k) => {
        try {
          return readFileSync(path.join(diskDir, k));
        } catch {
          return null;
        }
      },
      rawPut: async (k, b) => writeFileSync(path.join(diskDir, k), b),
    },
    {
      name: "s3",
      make: () => objectStorage(s3Transport(() => s3)),
      raw: (k) => t.getObject(k),
      rawPut: (k, b) => t.putObject(k, b),
    },
  );
});
after(async () => {
  await s3?.stop();
  rmSync(diskDir, { recursive: true, force: true });
});

const PDF = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const MISSING = `ab/${"0".repeat(40)}`;
const BAD_KEYS = [
  "",
  "../../etc/passwd",
  "ab/../../x",
  `AB/${"A".repeat(40)}`,
  `ab/${"0".repeat(39)}`,
  "ab/x/y",
];

// Mỗi backend chạy CÙNG danh sách ca (contract). `before` của tầng ngoài đã điền `backends` trước khi các ca chạy.
for (const name of ["disk", "s3"] as const) {
  describe(`kho tệp — contract (${name})`, () => {
    const b = () => backends.find((x) => x.name === name)!;

    test("put → get trả đúng byte; khoá đúng STORAGE_KEY_RE; cùng nội dung → hai khoá khác nhau", async () => {
      const st = b().make();
      const data = Buffer.from("biên bản nghiệm thu — lần 1");
      const k1 = await st.put(data);
      const k2 = await st.put(data);
      assert.match(k1, STORAGE_KEY_RE);
      assert.match(k2, STORAGE_KEY_RE);
      assert.notEqual(k1, k2);
      assert.deepEqual(await st.get(k1), data);
      assert.deepEqual(await st.get(k2), data);
    });

    test("backend chỉ giữ BẢN MÃ: đầu XCFILE, không chứa bản rõ, hai lần ghi cùng nội dung → bản mã khác nhau", async () => {
      const st = b().make();
      const marker = `BAN-RO-${randomBytes(8).toString("hex")}`;
      const data = Buffer.from(`${marker} số CCCD 001099012345 — ${marker}`);
      const k1 = await st.put(data);
      const k2 = await st.put(data);
      const r1 = await b().raw(k1);
      const r2 = await b().raw(k2);
      assert.ok(r1 && r2, "backend phải có đối tượng");
      assert.deepEqual(r1.subarray(0, FILE_MAGIC.length - 1), FILE_MAGIC.subarray(0, FILE_MAGIC.length - 1));
      assert.equal(r1.includes(Buffer.from(marker)), false, "bản rõ lọt vào backend");
      assert.equal(r1.includes(Buffer.from("001099012345")), false);
      assert.notDeepEqual(r1, r2);
      assert.ok(r1.length > data.length);
    });

    test("Unicode (tiếng Việt, emoji, NUL), rỗng, ~5 MB ngẫu nhiên (nhiều khối 64 KiB) → khứ hồi đúng", async () => {
      const st = b().make();
      const cases = [
        Buffer.from("Nguyễn Thị Ánh — Đắk Lắk ✓ 🧾 \u0000 ký tự NUL\n", "utf8"),
        Buffer.alloc(0),
        randomBytes(5 * 1024 * 1024 + 123),
      ];
      for (const data of cases) {
        const k = await st.put(data);
        const got = await st.get(k);
        assert.equal(got.length, data.length);
        assert.equal(
          createHash("sha256").update(got).digest("hex"),
          createHash("sha256").update(data).digest("hex"),
        );
      }
    });

    test("get khoá đúng dạng nhưng không tồn tại → StorageNotFoundError (code ENOENT)", async () => {
      const st = b().make();
      await assert.rejects(st.get(MISSING), (e: Error) => {
        assert.ok(e instanceof StorageNotFoundError);
        assert.equal((e as StorageNotFoundError).code, "ENOENT");
        return true;
      });
    });

    test("khoá lạ (thoát thư mục, chữ hoa, sai độ dài, rỗng) → 'Khoá tệp không hợp lệ' ở get và remove, không chạm backend", async () => {
      const st = b().make();
      for (const k of BAD_KEYS) {
        await assert.rejects(st.get(k), /Khoá tệp không hợp lệ/, `get(${JSON.stringify(k)})`);
        await assert.rejects(st.remove(k), /Khoá tệp không hợp lệ/, `remove(${JSON.stringify(k)})`);
      }
    });

    test("remove idempotent: xoá 2 lần, xoá khoá chưa từng có → không lỗi; sau xoá get → không tồn tại", async () => {
      const st = b().make();
      const k = await st.put(PDF);
      await st.remove(k);
      await st.remove(k);
      await st.remove(MISSING);
      assert.equal(await b().raw(k), null);
      await assert.rejects(st.get(k), StorageNotFoundError);
    });

    test("bản mã bị sửa một byte, hoặc bị tráo sang khoá khác → lỗi xác thực (không trả dữ liệu sai)", async () => {
      const st = b().make();
      const k = await st.put(Buffer.from("nội dung gốc ".repeat(100)));
      const raw = (await b().raw(k))!;
      const flipped = Buffer.from(raw);
      const at = flipped.length - 20;
      flipped[at] = (flipped[at] ?? 0) ^ 0x01;
      await b().rawPut(k, flipped);
      await assert.rejects(st.get(k), { name: "CryptoError", code: "AUTH_FAILED" });
      const k2 = await st.put(Buffer.from("tệp khác"));
      await b().rawPut(k2, raw); // tráo bản mã hợp lệ của k sang k2
      await assert.rejects(st.get(k2), { name: "CryptoError", code: "AUTH_FAILED" });
    });

    test("đồng thời: 12 lần put song song → 12 khoá khác nhau, đọc lại đúng từng tệp", async () => {
      const st = b().make();
      const datas = Array.from({ length: 12 }, (_, i) =>
        Buffer.from(`tệp song song #${i} ${randomBytes(16).toString("hex")}`),
      );
      const keys = await Promise.all(datas.map((d) => st.put(d)));
      assert.equal(new Set(keys).size, keys.length);
      const back = await Promise.all(keys.map((k) => st.get(k)));
      back.forEach((g, i) => assert.deepEqual(g, datas[i]));
    });

    test("hai thể hiện độc lập (mô phỏng 2 bản sao) trên cùng backend: ghi ở A, đọc + xoá ở B", async () => {
      const a = b().make();
      const bb = b().make();
      const k = await a.put(PDF);
      assert.deepEqual(await bb.get(k), PDF);
      await bb.remove(k);
      await assert.rejects(a.get(k), StorageNotFoundError);
    });
  });
}

describe("kho tệp qua lib/files (Postgres thật): uploadFile → downloadFile với từng backend", () => {
  let db: TestDb;
  let pm: ActorContext;
  let projectId: string;
  before(async () => {
    db = await freshDb();
    const org = await seedCompany("Công ty Kho tệp");
    const exec = await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] });
    const p = await seedUser(org.companyId);
    const execA = (await loadActor(db.app, exec.userId))!;
    pm = (await loadActor(db.app, p.userId))!;
    projectId = await withTx((tx) =>
      createProject(tx, execA, { code: "KT", name: "Kho tệp", managerEmployeeId: p.employeeId! }),
    );
  });
  after(async () => {
    setStorage(undefined);
    await db.close();
  });

  test("crypto:rotate với FILE_STORAGE=s3 → exit 1 + cảnh báo không bỏ khoá cũ (chưa bọc lại khoá tệp trên S3); disk → exit 0", () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${db.name}`;
    const run = (extra: Record<string, string>) =>
      spawnSync("npx", ["--no-install", "tsx", "scripts/crypto-rotate.ts"], {
        env: { ...process.env, DATABASE_URL: url.toString(), ...extra },
        encoding: "utf8",
      });
    const s3run = run({ ...s3.env });
    assert.equal(s3run.status, 1, s3run.stderr);
    assert.match(
      s3run.stderr,
      /FILE_STORAGE=s3: chưa hỗ trợ bọc lại khoá tệp trên kho S3 — KHÔNG bỏ khoá cũ/,
    );
    // Thư mục riêng: diskDir có tệp bị sửa cố ý ở ca contract phía trên.
    const empty = mkdtempSync(path.join(tmpdir(), "xc-contract-rotate-"));
    try {
      const disk = run({ FILE_STORAGE: "disk", FILE_STORAGE_DIR: empty });
      assert.equal(disk.status, 0, disk.stderr);
      assert.match(disk.stdout, /\[crypto:rotate\] tệp: bọc lại/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  for (const name of ["disk", "s3"] as const)
    test(`${name}: tải lên rồi tải về đúng nội dung + sha256; backend giữ bản mã`, async () => {
      const be = backends.find((x) => x.name === name)!;
      setStorage(be.make());
      const r = await uploadFile(db.app, pm, {
        objectType: "project",
        objectId: projectId,
        originalName: "bien-ban-nghiem-thu.pdf",
        data: PDF,
      });
      setStorage(be.make()); // thể hiện khác (bản sao khác) tải về
      const d = await downloadFile(db.app, pm, r.fileId);
      assert.deepEqual(d.data, PDF);
      assert.equal(d.sha256, createHash("sha256").update(PDF).digest("hex"));
      const { rows } = await db.admin.query<{ storage_key: string }>(
        "SELECT storage_key FROM file_object WHERE id = $1",
        [r.fileId],
      );
      const raw = await be.raw(rows[0]!.storage_key);
      assert.ok(raw && !raw.includes(PDF.subarray(0, 8)), "backend phải giữ bản mã");
    });
});

describe("kho S3: riêng phần mạng/cấu hình", () => {
  const ENV_KEYS = [
    "FILE_STORAGE",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ];
  const saved: Record<string, string | undefined> = {};
  before(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  after(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    setStorage(undefined);
  });

  test("khoá bí mật sai → S3Error 403 SignatureDoesNotMatch (từ chối, không coi là 'không có tệp'); lỗi không lộ khoá", async () => {
    const wrong = objectStorage(s3Transport(() => ({ ...s3, secretAccessKey: "sai-sai-sai-sai-sai-sai" })));
    const k = await objectStorage(s3Transport(() => s3)).put(PDF);
    await assert.rejects(wrong.get(k), (e: Error) => {
      assert.ok(e instanceof S3Error);
      assert.equal(e.status, 403);
      assert.equal(e.s3Code, "SignatureDoesNotMatch");
      assert.doesNotMatch(e.message, new RegExp(s3.secretAccessKey));
      return true;
    });
    await assert.rejects(wrong.put(PDF), { name: "S3Error", status: 403 });
  });

  test("máy chủ không chạy → lỗi kết nối (không trả null/không coi là thiếu tệp)", async () => {
    const down = objectStorage(s3Transport(() => ({ ...s3, endpoint: "http://127.0.0.1:9" })));
    await assert.rejects(down.get(MISSING), /GetObject không kết nối được/);
    await assert.rejects(down.put(PDF), /PutObject không kết nối được/);
  });

  test("đối tượng bản rõ (không có đầu mã hoá) trên S3 → bị từ chối (S3 không có 'tệp cũ bản rõ' như đĩa)", async () => {
    const t = s3Transport(() => s3);
    await t.putObject(MISSING, PDF);
    await assert.rejects(objectStorage(t).get(MISSING), { name: "CryptoError" });
    await t.deleteObject(MISSING);
  });

  test("put lỗi giữa chừng (PUT ném) → xoá bù khoá vừa thử, lỗi gốc ném lại", async () => {
    const deleted: string[] = [];
    const t: ObjectTransport = {
      putObject: async () => {
        throw new Error("hết thời gian chờ giả");
      },
      getObject: async () => null,
      deleteObject: async (k) => {
        deleted.push(k);
      },
    };
    await assert.rejects(objectStorage(t).put(PDF), /hết thời gian chờ giả/);
    assert.equal(deleted.length, 1);
    assert.match(deleted[0]!, STORAGE_KEY_RE);
  });

  test("registerStorage: FILE_STORAGE=s3 → getStorage() ghi vào S3; disk → giữ mặc định", async () => {
    setStorage(undefined);
    Object.assign(process.env, s3.env);
    registerStorage();
    const k = await getStorage().put(PDF);
    assert.ok(await s3Transport(() => s3).getObject(k), "đối tượng phải nằm trên S3");
    assert.deepEqual(s3ConfigFromEnv().bucket, s3.bucket);
    setStorage(undefined);
    process.env.FILE_STORAGE = "disk";
    const dir = mkdtempSync(path.join(tmpdir(), "xc-contract-default-"));
    const savedDir = process.env.FILE_STORAGE_DIR;
    process.env.FILE_STORAGE_DIR = dir;
    try {
      registerStorage();
      const k2 = await getStorage().put(PDF); // mặc định lười = đĩa ở FILE_STORAGE_DIR
      assert.ok(readFileSync(path.join(dir, k2)).length > 0);
      assert.equal(await s3Transport(() => s3).getObject(k2), null, "disk không được ghi lên S3");
    } finally {
      if (savedDir === undefined) delete process.env.FILE_STORAGE_DIR;
      else process.env.FILE_STORAGE_DIR = savedDir;
      setStorage(undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("đăng ký ở một bản sao module (như instrumentation) → bản sao module khác (như route) dùng đúng kho đó", async () => {
    // Next đóng gói instrumentation và route thành bản module riêng; mô phỏng bằng URL import khác nhau (mỗi URL = một thể hiện).
    const copy = (await import(`../../lib/files/storage.ts?ban-sao=${randomBytes(4).toString("hex")}`)) as {
      getStorage(): Storage;
      setStorage(s: Storage | undefined): void;
    };
    assert.notEqual(copy.setStorage, setStorage, "phải là một thể hiện module khác");
    const mine = objectStorage(s3Transport(() => s3));
    copy.setStorage(mine);
    try {
      assert.equal(getStorage(), mine);
    } finally {
      copy.setStorage(undefined);
    }
  });

  test("cấu hình env: FILE_STORAGE=s3 thiếu S3_* → lỗi nêu TÊN biến; production http ngoài loopback → lỗi; không in giá trị", () => {
    const baseEnv = {
      NODE_ENV: "production",
      APP_ORIGIN: "https://xc.example",
      DATABASE_URL: "postgres://u:p@db/x",
      SESSION_SECRET: "s".repeat(40),
      QR_SIGNING_KEYS: `k1:${"q".repeat(40)}`,
      DATA_ENCRYPTION_KEYS: `k1:${randomBytes(32).toString("base64")}`,
      DATA_INDEX_KEY: randomBytes(32).toString("base64"),
      TRUST_PROXY: "1",
    };
    const issues = (src: Record<string, string>) => {
      try {
        loadEnv(src);
        return [];
      } catch (e) {
        assert.ok(e instanceof EnvError);
        return e.issues.map((i) => `${i.name}: ${i.message}`);
      }
    };
    const missing = issues({ ...baseEnv, FILE_STORAGE: "s3" });
    for (const k of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"])
      assert.ok(
        missing.some((m) => m.startsWith(`${k}:`)),
        `thiếu báo lỗi ${k}`,
      );
    const secret = "bi-mat-khong-duoc-in-ra-0123456789";
    const full = {
      ...baseEnv,
      FILE_STORAGE: "s3",
      S3_BUCKET: "xc-files",
      S3_ACCESS_KEY_ID: "AKXC",
      S3_SECRET_ACCESS_KEY: secret,
    };
    const insecure = issues({ ...full, S3_ENDPOINT: "http://s3.example:9000" });
    assert.deepEqual(insecure, [
      "S3_ENDPOINT: phải là https ở production (http chỉ cho localhost/127.0.0.1/[::1])",
    ]);
    assert.deepEqual(issues({ ...full, S3_ENDPOINT: "https://s3.example" }), []);
    assert.deepEqual(issues({ ...full, S3_ENDPOINT: "http://127.0.0.1:9000" }), []);
    assert.equal(issues({ ...full, S3_ENDPOINT: "https://s3.example/duong-dan" }).length, 1);
    assert.equal(issues({ ...full, S3_ENDPOINT: "https://u:p@s3.example" }).length, 1);
    assert.equal(issues({ ...full, S3_ENDPOINT: "https://s3.example", S3_BUCKET: "Bucket_Sai" }).length, 1);
    assert.doesNotMatch(JSON.stringify(insecure), new RegExp(secret));
    assert.deepEqual(issues({ ...baseEnv }), [], "mặc định FILE_STORAGE=disk không đòi S3_*");
  });
});
