// Sao lưu + diễn tập khôi phục cục bộ (T-045; DB-BACKUP-003, OPS-DR-*). Postgres THẬT: tạo dữ liệu → scripts/backup.sh →
// huỷ dòng → scripts/restore-drill.sh phát hiện/khôi phục đúng. Nhãn bằng chứng: faithful-fixture (cụm tạm trên máy phát triển).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { withTx } from "../../lib/db/index.ts";
import { listMigrations } from "../../lib/db/migrate.ts";
import { enqueue } from "../../lib/outbox/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();

const ROOT = new URL("../..", import.meta.url).pathname;
const PASSPHRASE = "mat-khau-sao-luu-rat-dai-0123456789";
const UNICODE_NAME = "Đặng Thị Ánh — Hà Nội ✓";

interface Manifest {
  file: string;
  sha256: string;
  created_at_utc: string;
  encrypted: boolean;
  format: number;
  tables: Record<string, number>;
  audit: { rows: number; heads: Record<string, string> };
  migration: { applied: number; latest: string };
}
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
interface Report {
  ok: boolean;
  backup: { tables: number; rows: number; encrypted: boolean };
  rpo_seconds: number;
  rto_seconds: { decrypt: number; restore: number; verify: number; total: number };
  audit_chain: { ok: boolean; message: string };
  live_drift: { table: string; manifest: number; live: number | null }[];
  problems: string[];
  kept_db: string | null;
}

describe("sao lưu và diễn tập khôi phục (Postgres thật)", () => {
  let db: TestDb;
  let url: string;
  let work: string;
  const dbs: string[] = [];

  const dir = (name: string) => {
    const d = path.join(work, name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const run = (script: string, args: string[], env: Record<string, string | undefined>): Run => {
    const e: Record<string, string | undefined> = { ...process.env, DATABASE_URL: url, ...env };
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    const r = spawnSync(path.join(ROOT, "scripts", script), args, {
      env: e as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const backup = (backupDir: string, env: Record<string, string | undefined> = {}) =>
    run("backup.sh", [], { BACKUP_DIR: backupDir, BACKUP_PASSPHRASE: undefined, ...env });
  const drill = (backupDir: string, args: string[] = [], env: Record<string, string | undefined> = {}) =>
    run("restore-drill.sh", args, { BACKUP_DIR: backupDir, BACKUP_PASSPHRASE: undefined, ...env });
  const manifests = (d: string) =>
    readdirSync(d)
      .filter((f) => f.endsWith(".manifest.json"))
      .sort();
  const readManifest = (d: string, f: string) =>
    JSON.parse(readFileSync(path.join(d, f), "utf8")) as Manifest;
  const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
  const count = async (table: string, pool: pg.Pool = db.admin) =>
    Number((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

  before(async () => {
    work = mkdtempSync(path.join(tmpdir(), "xc-backup-test-"));
    db = await freshDb();
    const u = new URL(process.env.DATABASE_URL!);
    u.pathname = `/${db.name}`;
    url = u.toString();
    const { companyId } = await seedCompany();
    await seedUser(companyId);
    await withTx(async (tx) => {
      for (let i = 0; i < 6; i++)
        await enqueue(tx, companyId, "probe.backup", { i, name: UNICODE_NAME }, `backup-probe-${i}`);
    });
  });
  after(async () => {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    for (const name of dbs) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
    await db.close();
    rmSync(work, { recursive: true, force: true });
  });

  const driftDatabases = async () =>
    (await db.admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'xc_drill_%'")).rows;

  test("backup: tệp + checksum + manifest đầy đủ, không lộ URL/mật khẩu; drill khớp và dọn DB tạm", async () => {
    const d = dir("basic");
    const b = backup(d);
    assert.equal(b.status, 0, b.stderr);
    const [m] = manifests(d);
    assert.ok(m);
    const man = readManifest(d, m);
    const file = path.join(d, man.file);
    assert.match(man.file, /^xc-\d{8}T\d{9}Z\.dump$/);
    assert.equal(man.format, 1);
    assert.equal(man.encrypted, false);
    assert.equal(man.sha256, sha(file));
    assert.equal(
      readFileSync(path.join(d, m.replace(".manifest.json", ".sha256")), "utf8").split(" ")[0],
      man.sha256,
    );
    assert.ok(Math.abs(Date.now() - Date.parse(man.created_at_utc)) < 120_000, "thời điểm UTC gần hiện tại");
    assert.ok(man.created_at_utc.endsWith("Z"));
    assert.equal(man.tables.audit_event, await count("audit_event"));
    assert.ok(man.tables.audit_event > 0, "có dữ liệu audit để kiểm chuỗi");
    assert.equal(man.tables.outbox_event, 6);
    assert.equal(man.audit.rows, man.tables.audit_event);
    assert.ok(Object.keys(man.audit.heads).length >= 1);
    assert.equal(man.migration.applied, listMigrations().length);
    assert.equal(man.migration.latest, listMigrations().at(-1)!.name);
    const secrets = new URL(url).password;
    assert.ok(secrets.length > 0);
    for (const out of [b.stdout, b.stderr, JSON.stringify(man)]) assert.equal(out.includes(secrets), false);

    const r = drill(d);
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(r.stdout) as Report;
    assert.equal(rep.ok, true);
    assert.deepEqual(rep.problems, []);
    assert.equal(rep.audit_chain.ok, true);
    assert.equal(
      rep.backup.rows,
      Object.values<number>(man.tables).reduce((a, n) => a + n, 0),
    );
    assert.ok(rep.rto_seconds.total > 0 && rep.rpo_seconds >= 0 && rep.rpo_seconds < 120);
    assert.deepEqual(rep.live_drift, []);
    assert.equal(rep.kept_db, null);
    assert.equal((await driftDatabases()).length, 0, "DB tạm đã bị xoá");
    assert.equal(r.stdout.includes(secrets) || r.stderr.includes(secrets), false);
  });

  test("huỷ dòng ở DB đang chạy: drill báo chênh lệch, bản khôi phục vẫn đủ dòng (kể cả Unicode)", async () => {
    const d = dir("loss");
    assert.equal(backup(d).status, 0);
    await db.admin.query("DELETE FROM outbox_event WHERE job_key IN ('backup-probe-0', 'backup-probe-1')");
    assert.equal(await count("outbox_event"), 4);

    const r = drill(d, ["--compare-live", "--keep-db"]);
    assert.equal(r.status, 0, r.stderr);
    const rep = JSON.parse(r.stdout) as Report;
    assert.equal(rep.ok, true, "bản sao lưu vẫn nguyên dù DB đang chạy đã mất dòng");
    assert.deepEqual(rep.live_drift, [{ table: "outbox_event", manifest: 6, live: 4 }]);
    assert.ok(rep.kept_db?.startsWith("xc_drill_"));
    dbs.push(rep.kept_db!);

    const kept = new pg.Pool({ connectionString: url.replace(`/${db.name}`, `/${rep.kept_db}`), max: 1 });
    try {
      const rows = await kept.query(
        "SELECT payload->>'name' AS n FROM outbox_event WHERE topic = 'probe.backup'",
      );
      assert.equal(rows.rowCount, 6, "khôi phục lại đủ 6 dòng đã bị huỷ");
      assert.ok(rows.rows.every((x) => x.n === UNICODE_NAME));
    } finally {
      await kept.end();
    }
  });

  test("bản hỏng checksum → exit 3, không khôi phục gì", () => {
    const d = dir("corrupt");
    assert.equal(backup(d).status, 0);
    const man = readManifest(d, manifests(d)[0]!);
    const f = path.join(d, man.file);
    const buf = readFileSync(f);
    const mid = Math.floor(buf.length / 2);
    buf[mid] = (buf[mid] ?? 0) ^ 0xff;
    const bad = dir("corrupt-bad");
    for (const n of readdirSync(d)) if (!n.startsWith(".")) copyFileSync(path.join(d, n), path.join(bad, n));
    writeFileSync(path.join(bad, man.file), buf); // bản lật 1 byte
    assert.notEqual(sha(path.join(bad, man.file)), man.sha256);
    const r = drill(bad);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /checksum KHÔNG khớp/);
    assert.equal(r.stdout, "");
    // tệp .sha256 bị sửa (manifest nguyên) cũng đỏ
    const bad2 = dir("corrupt-sidecar");
    for (const n of readdirSync(d)) if (!n.startsWith(".")) copyFileSync(path.join(d, n), path.join(bad2, n));
    writeFileSync(
      path.join(bad2, manifests(d)[0]!.replace(".manifest.json", ".sha256")),
      `${"0".repeat(64)}  x\n`,
    );
    assert.equal(drill(bad2).status, 3);
    // thiếu tệp dữ liệu
    const bad3 = dir("corrupt-missing");
    copyFileSync(path.join(d, manifests(d)[0]!), path.join(bad3, manifests(d)[0]!));
    assert.equal(drill(bad3).status, 3);
  });

  test("manifest khai số dòng khác thực tế → exit 1 và nêu bảng lệch", async () => {
    const d = dir("manifest");
    const live = await count("outbox_event");
    assert.equal(backup(d).status, 0);
    const m = path.join(d, manifests(d)[0]!);
    const man = JSON.parse(readFileSync(m, "utf8")) as { tables: Record<string, number> };
    man.tables.outbox_event = 99;
    writeFileSync(m, JSON.stringify(man));
    const r = drill(d);
    assert.equal(r.status, 1);
    const rep = JSON.parse(r.stdout) as Report;
    assert.equal(rep.ok, false);
    assert.ok(
      rep.problems.some((p) => p.includes(`outbox_event: manifest 99, khôi phục ${live}`)),
      rep.problems.join("|"),
    );
    assert.deepEqual(
      (await driftDatabases()).filter((x) => !dbs.includes(x.datname)),
      [],
      "DB tạm đã dọn cả khi đỏ",
    );
  });

  test("giữ N bản gần nhất; BACKUP_KEEP sai → exit 2", () => {
    const d = dir("keep");
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      const b = backup(d, { BACKUP_KEEP: "2" });
      assert.equal(b.status, 0, b.stderr);
      names.push(manifests(d).at(-1)!);
    }
    const left = manifests(d);
    assert.deepEqual(left, names.slice(2), "chỉ còn 2 bản mới nhất");
    for (const old of names.slice(0, 2)) {
      const base = old.replace(".manifest.json", "");
      assert.equal(
        readdirSync(d).some((f) => f.startsWith(base)),
        false,
        `${base} đã bị xoá sạch`,
      );
    }
    assert.equal(readdirSync(d).filter((f) => f.endsWith(".dump")).length, 2);
    const bad = backup(dir("keep-bad"), { BACKUP_KEEP: "0" });
    assert.equal(bad.status, 2);
    assert.equal(backup(dir("keep-bad2"), { BACKUP_KEEP: "abc" }).status, 2);
    assert.equal(manifests(d).length, 2, "lần lỗi cấu hình không xoá thêm bản nào");
  });

  test("mã hoá: bản mã không chứa dữ liệu thô; thiếu/sai/ngắn khoá → exit 2; đúng khoá → khôi phục khớp", () => {
    const d = dir("enc");
    const b = backup(d, { BACKUP_PASSPHRASE: PASSPHRASE });
    assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout.includes(PASSPHRASE) || b.stderr.includes(PASSPHRASE), false);
    const man = readManifest(d, manifests(d)[0]!);
    assert.equal(man.encrypted, true);
    assert.match(man.file, /\.dump\.enc$/);
    assert.equal(
      readdirSync(d).some((f) => f.endsWith(".dump")),
      false,
      "không còn bản rõ",
    );
    const raw = readFileSync(path.join(d, man.file));
    assert.equal(raw.subarray(0, 8).toString("latin1"), "Salted__");
    assert.equal(raw.includes(Buffer.from("PGDMP")), false);
    assert.equal(raw.includes(Buffer.from("probe.backup")), false);

    const noKey = drill(d);
    assert.equal(noKey.status, 2);
    assert.match(noKey.stderr, /thiếu BACKUP_PASSPHRASE/);
    const wrong = drill(d, [], { BACKUP_PASSPHRASE: "khoa-sai-khoa-sai-khoa-sai-1234" });
    assert.equal(wrong.status, 2);
    assert.match(wrong.stderr, /giải mã thất bại|không đọc được/);
    assert.equal(wrong.stderr.includes("khoa-sai"), false);
    const ok = drill(d, [], { BACKUP_PASSPHRASE: PASSPHRASE });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal((JSON.parse(ok.stdout) as Report).backup.encrypted, true);

    const dReq = dir("enc-required");
    const miss = backup(dReq, { BACKUP_REQUIRE_ENCRYPTION: "1" });
    assert.equal(miss.status, 2);
    assert.match(miss.stderr, /thiếu BACKUP_PASSPHRASE/);
    assert.equal(
      readdirSync(dReq).filter((f) => f.startsWith("xc-")).length,
      0,
      "không ghi bản rõ khi bắt buộc mã hoá",
    );
    const short = backup(dir("enc-short"), { BACKUP_PASSPHRASE: "ngan" });
    assert.equal(short.status, 2);
    assert.equal(short.stderr.includes("ngan\n"), false);
  });

  test("cấu hình sai: thiếu/URL lạ/không có bản sao lưu/ngưỡng RTO → mã thoát đúng", () => {
    assert.equal(backup(dir("cfg1"), { DATABASE_URL: "" }).status, 2);
    const badUrl = backup(dir("cfg2"), { DATABASE_URL: "mysql://u:pw-bi-mat@h/db" });
    assert.equal(badUrl.status, 2);
    assert.equal(badUrl.stderr.includes("pw-bi-mat"), false);
    const empty = drill(dir("cfg3"));
    assert.equal(empty.status, 2);
    assert.match(empty.stderr, /không tìm thấy bản sao lưu/);
    assert.equal(drill(dir("cfg4"), [], { DATABASE_URL: "" }).status, 2);
    assert.equal(drill(dir("cfg5"), ["--lạ"]).status, 2);
    const d = dir("cfg6");
    assert.equal(backup(d).status, 0);
    const rto = drill(d, [], { DRILL_RTO_SECONDS: "0" });
    assert.equal(rto.status, 1, "vượt RTO mục tiêu → đỏ");
    assert.ok((JSON.parse(rto.stdout) as Report).problems.some((p) => p.includes("vượt RTO")));
    assert.equal(drill(d, [], { DRILL_RPO_SECONDS: "x" }).status, 2);
    assert.equal(existsSync(path.join(d, ".lock")), true);
  });

  test("chuỗi audit bị sửa TRƯỚC khi sao lưu → drill đỏ ở bước kiểm chuỗi (chạy cuối: làm hỏng DB của file này)", async () => {
    await db.admin.query("ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update");
    await db.admin.query(
      "UPDATE audit_event SET reason = 'giả mạo' WHERE seq = (SELECT min(seq) FROM audit_event)",
    );
    await db.admin.query("ALTER TABLE audit_event ENABLE TRIGGER audit_event_no_update");
    const d = dir("tamper");
    assert.equal(backup(d).status, 0, "sao lưu vẫn chạy (không kiểm chuỗi) — drill mới là nơi phát hiện");
    const r = drill(d);
    assert.equal(r.status, 1);
    const rep = JSON.parse(r.stdout) as Report;
    assert.equal(rep.audit_chain.ok, false);
    assert.ok(rep.problems.includes("chuỗi audit của bản khôi phục không hợp lệ"));
    assert.match(rep.audit_chain.message, /Chuỗi audit sai/);
  });
});
