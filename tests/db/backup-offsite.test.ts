// Sao lưu off-site bằng restic (T-053; OPS-DR-003/004/007, DB-BACKUP-004; D-040). Postgres THẬT + restic THẬT (.tools/bin/restic ghim sha256):
// backup.sh → backup-offsite.sh (kho ở thư mục tạm KHÁC thư mục sao lưu) → xoá bản cục bộ → restore-offsite-drill.sh khôi phục từ kho.
// Thiếu restic → test ĐỎ có thông báo rõ (không skip). Nhãn: faithful-fixture (kho cục bộ; KHÔNG chứng minh đích khác nhà cung cấp/khu vực).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { withTx } from "../../lib/db/index.ts";
import { enqueue } from "../../lib/outbox/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const ROOT = new URL("../..", import.meta.url).pathname;
const RESTIC = path.join(ROOT, ".tools/bin/restic");
const PASS_DB = ["mat-khau-sao-luu", "rat-dai-0123456789"].join("-");
const PW = ["kho", "restic", Math.random().toString(36).slice(2), "0123456789"].join("-");

interface Run {
  status: number | null;
  out: string;
  err: string;
}

describe("sao lưu off-site restic + diễn tập khôi phục từ kho (Postgres thật)", () => {
  let db: TestDb;
  let url: string;
  let work: string;
  const dbs: string[] = [];

  const dir = (n: string) => {
    const d = path.join(work, n);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const sh = (script: string, args: string[], env: Record<string, string | undefined>): Run => {
    const e: Record<string, string | undefined> = { ...process.env, DATABASE_URL: url, ...env };
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    const r = spawnSync(path.join(ROOT, "scripts", script), args, {
      env: e as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 120_000,
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const backup = (bdir: string) => sh("backup.sh", [], { BACKUP_DIR: bdir, BACKUP_PASSPHRASE: PASS_DB });
  const offsite = (bdir: string, repo: string, env: Record<string, string | undefined> = {}) =>
    sh("backup-offsite.sh", [], {
      BACKUP_DIR: bdir,
      RESTIC_REPOSITORY: repo,
      RESTIC_PASSWORD: PW,
      RESTIC_PASSWORD_FILE: undefined,
      ...env,
    });
  const drill = (bdir: string, repo: string, env: Record<string, string | undefined> = {}) =>
    sh("restore-offsite-drill.sh", [], {
      BACKUP_DIR: bdir,
      RESTIC_REPOSITORY: repo,
      RESTIC_PASSWORD: PW,
      BACKUP_PASSPHRASE: PASS_DB,
      ...env,
    });
  const files = (d: string) => readdirSync(d).filter((f) => f.startsWith("xc-"));
  const status = (bdir: string) => JSON.parse(readFileSync(path.join(bdir, "offsite-status.json"), "utf8"));

  before(async () => {
    if (!existsSync(RESTIC))
      assert.fail(
        "thiếu restic: chạy `node scripts/tools/install-tool.mjs install restic` (test off-site không skip)",
      );
    work = mkdtempSync(path.join(tmpdir(), "xc-offsite-test-"));
    db = await freshDb();
    const u = new URL(process.env.DATABASE_URL!);
    u.pathname = `/${db.name}`;
    url = u.toString();
    const { companyId } = await seedCompany();
    await seedUser(companyId);
    await withTx(async (tx) => {
      for (let i = 0; i < 4; i++)
        await enqueue(tx, companyId, "probe.offsite", { i, name: "Đặng Thị Ánh ✓" }, `off-probe-${i}`);
    });
  });
  after(async () => {
    const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    for (const n of dbs) await admin.query(`DROP DATABASE IF EXISTS "${n}" WITH (FORCE)`);
    await admin.query("DROP DATABASE IF EXISTS xc_drill_x WITH (FORCE)");
    await admin.end();
    await db.close();
    rmSync(work, { recursive: true, force: true });
  });

  test("backup → off-site → XOÁ bản cục bộ → khôi phục từ kho khớp (checksum, số dòng, chuỗi audit); không lộ mật khẩu", () => {
    const b = dir("b1");
    const repo = path.join(dir("r1"), "kho");
    assert.equal(backup(b).status, 0);
    const o = offsite(b, repo);
    assert.equal(o.status, 0, o.err);
    const st = status(b);
    assert.equal(st.snapshots, 1);
    assert.equal(st.repo_kind, "local");
    assert.equal(st.three_two_one.offsite_location, "local-path");
    assert.equal(st.three_two_one.meets_321, false, "đích cục bộ không được tuyên bố đạt 3-2-1");
    assert.ok(st.seconds.total >= 0);
    // dữ liệu trong kho được mã hoá: không thấy chuỗi manifest rõ trong tệp kho
    const blob = spawnSync("grep", ["-rl", "created_at_utc", path.join(repo, "data")], { encoding: "utf8" });
    assert.equal(blob.stdout.trim(), "");
    const orig = files(b).filter((f) => !f.startsWith(".")).length;
    assert.ok(orig >= 3);
    for (const f of files(b)) rmSync(path.join(b, f)); // mất bản cục bộ
    const d = drill(b, repo);
    assert.equal(d.status, 0, d.err);
    const rep = JSON.parse(d.out);
    assert.equal(rep.ok, true);
    assert.equal(rep.drill.audit_chain.ok, true);
    assert.deepEqual(rep.drill.problems, []);
    assert.ok(rep.seconds.total_rto > 0);
    assert.equal(rep.matches_local_copy, null);
    assert.ok(existsSync(path.join(b, "offsite-drill.json")));
    for (const text of [o.out, o.err, d.out, d.err])
      assert.equal(text.includes(PW), false, "lộ mật khẩu kho");
    for (const text of [o.out, o.err, d.out, d.err])
      assert.equal(text.includes(PASS_DB), false, "lộ mật khẩu sao lưu");
  });

  test("bản khôi phục khớp bản cục bộ khi còn bản cục bộ (matches_local_copy)", () => {
    const b = dir("b2");
    const repo = path.join(dir("r2"), "kho");
    assert.equal(backup(b).status, 0);
    assert.equal(offsite(b, repo).status, 0);
    const d = drill(b, repo);
    assert.equal(d.status, 0, d.err);
    assert.equal(JSON.parse(d.out).matches_local_copy, true);
  });

  test("kho bị phá (sửa một khối dữ liệu / cắt cụt) → restic check ĐỎ → drill ĐỎ exit 3, không khôi phục", () => {
    for (const mode of ["flip", "truncate"] as const) {
      const b = dir(`b3-${mode}`);
      const repo = path.join(dir(`r3-${mode}`), "kho");
      assert.equal(backup(b).status, 0);
      assert.equal(offsite(b, repo).status, 0);
      const packs = spawnSync("find", [path.join(repo, "data"), "-type", "f"], { encoding: "utf8" })
        .stdout.trim()
        .split("\n");
      const big = packs.sort((x, y) => statSync(y).size - statSync(x).size)[0]!;
      if (mode === "truncate") truncateSync(big, Math.floor(statSync(big).size / 2));
      else {
        const fd = openSync(big, "r+");
        writeSync(fd, Buffer.from([0xde, 0xad, 0xbe, 0xef]), 0, 4, 100);
        closeSync(fd);
      }
      rmSync(path.join(b, "offsite-drill.json"), { force: true });
      const d = drill(b, repo);
      assert.equal(d.status, 3, `${mode}: ${d.err}`);
      assert.match(d.err, /restic check ĐỎ/);
      assert.equal(existsSync(path.join(b, "offsite-drill.json")), false);
      const o = offsite(b, repo, { BACKUP_OFFSITE_CHECK_SUBSET: "all" });
      assert.notEqual(o.status, 0, "backup-offsite phải đỏ khi kho hỏng");
    }
  });

  test("thiếu mật khẩu → exit 2 rõ (không treo hỏi tương tác); sai mật khẩu → không mở được kho", () => {
    const b = dir("b4");
    const repo = path.join(dir("r4"), "kho");
    assert.equal(backup(b).status, 0);
    assert.equal(offsite(b, repo).status, 0);
    const none = offsite(b, repo, { RESTIC_PASSWORD: undefined });
    assert.equal(none.status, 2);
    assert.match(none.err, /mật khẩu kho/);
    assert.equal(drill(b, repo, { RESTIC_PASSWORD: undefined }).status, 2);
    const wrong = ["sai", "mat", "khau", "0123456789"].join("-");
    const w1 = offsite(b, repo, { RESTIC_PASSWORD: wrong });
    assert.equal(w1.status, 1);
    assert.equal(drill(b, repo, { RESTIC_PASSWORD: wrong }).status, 3);
    for (const t of [w1.out, w1.err]) assert.equal(t.includes(wrong), false);
    // mật khẩu từ tệp
    const pwf = path.join(dir("pw"), "pw");
    writeFileSync(pwf, PW, { mode: 0o600 });
    assert.equal(offsite(b, repo, { RESTIC_PASSWORD: undefined, RESTIC_PASSWORD_FILE: pwf }).status, 0);
  });

  test("giữ N bản: BACKUP_OFFSITE_KEEP_LAST=2 sau 4 lần đẩy còn đúng 2 snapshot", () => {
    const b = dir("b5");
    const repo = path.join(dir("r5"), "kho");
    for (let i = 0; i < 4; i++) {
      assert.equal(backup(b).status, 0);
      const o = offsite(b, repo, {
        BACKUP_OFFSITE_KEEP_LAST: "2",
        BACKUP_OFFSITE_KEEP_DAILY: "0",
        BACKUP_OFFSITE_KEEP_WEEKLY: "0",
        BACKUP_OFFSITE_KEEP_MONTHLY: "0",
      });
      assert.equal(o.status, 0, o.err);
    }
    const st = status(b);
    assert.equal(st.snapshots, 2);
    assert.equal(st.three_two_one.local_backups, 4);
    assert.equal(st.three_two_one.copies_distinct_stores, 2);
    const bad = offsite(b, repo, {
      BACKUP_OFFSITE_KEEP_LAST: "0",
      BACKUP_OFFSITE_KEEP_DAILY: "0",
      BACKUP_OFFSITE_KEEP_WEEKLY: "0",
      BACKUP_OFFSITE_KEEP_MONTHLY: "0",
    });
    assert.equal(bad.status, 2, "chính sách toàn 0 sẽ xoá hết → từ chối");
  });

  test("cấu hình đích: kho trong thư mục sao lưu bị từ chối; URL nhúng khoá bị từ chối và KHÔNG lộ khoá; dạng sftp/s3 cần khoá qua env", () => {
    const b = dir("b6");
    assert.equal(backup(b).status, 0);
    const inside = offsite(b, path.join(b, "kho"));
    assert.equal(inside.status, 2);
    assert.match(inside.err, /TRONG thư mục sao lưu/);
    const secret = ["khoa", "bi", "mat", "98765"].join("-");
    for (const repo of [
      `rest:https://user:${secret}@host.example.test/repo`,
      `s3:https://AKIA:${secret}@s3.example.test/bucket`,
    ]) {
      const r = offsite(b, repo);
      assert.equal(r.status, 2);
      assert.equal((r.out + r.err).includes(secret), false);
      assert.match(r.err, /nhúng mật khẩu\/khoá/);
    }
    assert.equal(offsite(b, "").status, 2);
  });

  test("chưa có bản sao lưu → exit 2; bản cục bộ hỏng checksum → không đẩy lên off-site", () => {
    const empty = dir("b7");
    assert.equal(offsite(empty, path.join(dir("r7"), "kho")).status, 2);
    const b = dir("b8");
    assert.equal(backup(b).status, 0);
    const dump = files(b).find((f) => f.endsWith(".enc"))!;
    const fd = openSync(path.join(b, dump), "r+");
    writeSync(fd, Buffer.from([1, 2, 3, 4]), 0, 4, 40);
    closeSync(fd);
    const o = offsite(b, path.join(dir("r8"), "kho"));
    assert.equal(o.status, 1);
    assert.match(o.err, /hỏng checksum/);
    assert.equal(existsSync(path.join(b, "offsite-status.json")), false);
  });
});
