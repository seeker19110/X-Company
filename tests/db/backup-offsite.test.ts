// Sao lưu off-site bằng restic (T-053; OPS-DR-003/004/007, DB-BACKUP-004; D-040). Postgres THẬT + restic THẬT (.tools/bin/restic ghim sha256):
// backup.sh → backup-offsite.sh (kho ở thư mục tạm KHÁC thư mục sao lưu) → xoá bản cục bộ → restore-offsite-drill.sh khôi phục từ kho.
// Thiếu restic → test ĐỎ có thông báo rõ (không skip). Nhãn: faithful-fixture (kho cục bộ; KHÔNG chứng minh đích khác nhà cung cấp/khu vực).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { createHash, randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import pg from "pg";
import { s3Transport } from "../../adapters/s3-http.ts";
import { withTx } from "../../lib/db/index.ts";
import { objectStorage } from "../../lib/files/storage.ts";
import { enqueue } from "../../lib/outbox/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";
import { startS3, type S3Fixture } from "../helpers/s3-fixture.ts";

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
      chmodSync(big, 0o600); // restic tạo khối dữ liệu 0400; người chạy thường (CI) không ghi được nếu không đổi quyền
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
// T-126: kho TỆP trên S3 (FILE_STORAGE=s3) → restic off-site → diễn tập khôi phục (scripts/backup-files.sh, restore-files-drill.sh,
// scripts/files-s3.ts restore). S3 thật tự host (rclone serve s3) + restic thật; không skip.
describe("sao lưu kho tệp S3 → restic + diễn tập khôi phục (T-126)", () => {
  let src: S3Fixture;
  let dst: S3Fixture;
  let work: string;
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const dir = (n: string) => {
    const d = path.join(work, n);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const run = (cmd: string[], env: Record<string, string | undefined>): Run => {
    const e: Record<string, string | undefined> = { ...process.env, ...env };
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    const r = spawnSync(cmd[0]!, cmd.slice(1), {
      cwd: ROOT,
      env: e as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 120_000,
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const backupFiles = (bdir: string, repo: string, env: Record<string, string | undefined> = {}) =>
    run([path.join(ROOT, "scripts", "backup-files.sh")], {
      ...src.env,
      BACKUP_DIR: bdir,
      RESTIC_REPOSITORY: repo,
      RESTIC_PASSWORD: PW,
      ...env,
    });
  const drillFiles = (bdir: string, repo: string, env: Record<string, string | undefined> = {}) =>
    run([path.join(ROOT, "scripts", "restore-files-drill.sh")], {
      BACKUP_DIR: bdir,
      RESTIC_REPOSITORY: repo,
      RESTIC_PASSWORD: PW,
      ...env,
    });
  const clear = async (t: ReturnType<typeof s3Transport>) => {
    const keys: string[] = [];
    for await (const k of t.listKeys()) keys.push(k);
    for (const k of keys) await t.deleteObject(k);
  };

  before(async () => {
    if (!existsSync(RESTIC))
      assert.fail("thiếu restic: chạy `node scripts/tools/install-tool.mjs install restic`");
    work = mkdtempSync(path.join(tmpdir(), "xc-files-offsite-"));
    src = await startS3();
    dst = await startS3();
  });
  after(async () => {
    await src?.stop();
    await dst?.stop();
    rmSync(work, { recursive: true, force: true });
  });

  test("Given kho S3 có tệp đã mã hoá When sao lưu off-site rồi diễn tập khôi phục Then đọc lại qua đường giải mã, sha256 khớp; khôi phục thật vào bucket mới khớp", async () => {
    const t = s3Transport(() => src);
    await clear(t);
    const want = new Map<string, string>();
    for (const d of [Buffer.alloc(0), Buffer.from("Hợp đồng — Nguyễn Thị Ánh ✓"), randomBytes(150 * 1024)])
      want.set(await objectStorage(t).put(d), sha(d));
    const b = dir("fb1");
    const repo = path.join(dir("fr1"), "kho");
    const o = backupFiles(b, repo);
    assert.equal(o.status, 0, o.err);
    assert.match(o.out, /backup-files: xong .*objects=3/);
    const st = JSON.parse(readFileSync(path.join(b, "files-offsite-status.json"), "utf8"));
    assert.equal(st.objects, 3);
    assert.equal(st.snapshots, 1);
    assert.equal(
      readdirSync(b).filter((f) => f.startsWith(".files-work")).length,
      0,
      "thư mục tạm phải bị xoá",
    );
    const d = drillFiles(b, repo);
    assert.equal(d.status, 0, d.err);
    const rep = JSON.parse(d.out);
    assert.equal(rep.ok, true);
    assert.equal(rep.verify.checked, 3);
    assert.deepEqual(rep.verify.problems, []);
    assert.ok(rep.seconds.total_rto > 0);
    assert.ok(existsSync(path.join(b, "files-offsite-drill.json")));
    // khôi phục THẬT: restic restore → files-s3.ts restore vào bucket trống của máy chủ S3 khác → đọc qua objectStorage
    const target = dir("fr1-restore");
    const rr = run([RESTIC, "restore", "latest", "--tag", "xc-files", "--target", target, "--quiet"], {
      RESTIC_REPOSITORY: repo,
      RESTIC_PASSWORD: PW,
    });
    assert.equal(rr.status, 0, rr.err);
    const man = spawnSync("find", [target, "-name", "files-manifest.json"], {
      encoding: "utf8",
    }).stdout.trim();
    const tdst = s3Transport(() => dst);
    await clear(tdst);
    const restore = run(["npx", "--no-install", "tsx", "scripts/files-s3.ts", "restore", path.dirname(man)], {
      ...dst.env,
    });
    assert.equal(restore.status, 0, restore.err);
    assert.equal(JSON.parse(restore.out).restored, 3);
    for (const [k, s] of want) assert.equal(sha(await objectStorage(tdst).get(k)), s);
    for (const text of [o.out, o.err, d.out, d.err, restore.out, restore.err]) {
      assert.equal(text.includes(PW), false, "lộ mật khẩu kho");
      assert.equal(text.includes(src.secretAccessKey), false, "lộ khoá S3");
    }
  });

  test("ca biên: kho S3 rỗng → sao lưu 0 đối tượng, diễn tập đạt", async () => {
    await clear(s3Transport(() => src));
    const b = dir("fb2");
    const repo = path.join(dir("fr2"), "kho");
    const o = backupFiles(b, repo);
    assert.equal(o.status, 0, o.err);
    assert.match(o.out, /objects=0/);
    const d = drillFiles(b, repo);
    assert.equal(d.status, 0, d.err);
    assert.equal(JSON.parse(d.out).verify.checked, 0);
  });

  test("ca biên: đối tượng không phải của ứng dụng (thiếu đầu mã hoá) → exit 1 nêu khoá, không đẩy, không ghi trạng thái", async () => {
    const t = s3Transport(() => src);
    await clear(t);
    await objectStorage(t).put(Buffer.from("tệp thật"));
    const plainKey = `ab/${"c".repeat(40)}`;
    await t.putObject(plainKey, Buffer.from("%PDF-1.7 bản rõ"));
    const b = dir("fb3");
    const repo = path.join(dir("fr3"), "kho");
    const o = backupFiles(b, repo);
    assert.equal(o.status, 1, o.err);
    assert.match(o.err, /1 đối tượng không phải của ứng dụng/);
    assert.match(o.err, new RegExp(plainKey));
    assert.equal(existsSync(path.join(b, "files-offsite-status.json")), false);
    assert.equal(existsSync(path.join(repo, "config")), false, "không tạo/đẩy kho khi chụp lỗi");
  });

  test("cấu hình: FILE_STORAGE khác s3 / thiếu mật khẩu kho → exit 2; drill trên kho chưa có bản tệp → exit 3", () => {
    const b = dir("fb4");
    const repo = path.join(dir("fr4"), "kho");
    const disk = backupFiles(b, repo, { FILE_STORAGE: "disk" });
    assert.equal(disk.status, 2);
    assert.match(disk.err, /chỉ dùng khi FILE_STORAGE=s3/);
    assert.equal(backupFiles(b, repo, { RESTIC_PASSWORD: undefined }).status, 2);
    assert.equal(drillFiles(b, repo, { RESTIC_PASSWORD: undefined }).status, 2);
    assert.equal(drillFiles(b, path.join(dir("fr4b"), "khong-co")).status, 3);
  });
});
