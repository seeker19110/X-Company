// Khung chạy bản build production cục bộ cho DAST (T-047) và đo tải (T-049): migrate + seed vào Postgres do
// scripts/with-test-db.sh dựng, rồi `next start` ở cổng RIÊNG (không đụng cổng 3100 của e2e/lighthouse).
// Mọi tiến trình con (next start) bị dừng khi xong — kể cả khi lỗi hoặc nhận SIGINT/SIGTERM.
// Nhãn bằng chứng: máy dev, Postgres tạm, dữ liệu seed — KHÔNG phải production hay thực địa (faithful-fixture).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Khoá chung cho mọi lần khởi động lại trong một lần chạy (dữ liệu đã mã hoá phải đọc được sau khi khởi động lại).
const DATA_KEY = randomBytes(32).toString("base64");
const DATA_INDEX_KEY = randomBytes(32).toString("base64");
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
export const out = (s) => process.stdout.write(`${s}\n`);
export const err = (s) => process.stderr.write(`${s}\n`);

const children = new Set();
const tmpDirs = [];
let hooked = false;

function stopAll() {
  for (const c of children) {
    try {
      process.kill(-c.pid, "SIGTERM"); // cả nhóm tiến trình (next start sinh tiến trình con)
    } catch {
      /* đã thoát */
    }
  }
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on("exit", stopAll);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      stopAll();
      process.exit(130);
    });
  }
}

function run(cmd, args, env, label) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(
      `${label} lỗi (exit ${r.status}):\n${(r.stderr ?? "").slice(-1500)}${(r.stdout ?? "").slice(-500)}`,
    );
  }
  return r.stdout;
}

/** git commit hiện tại; thêm "+dirty" khi cây làm việc có thay đổi chưa commit (trung thực về bản được đo). */
export function gitCommit() {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (head.status !== 0) return "unknown";
  const st = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  return head.stdout.trim() + (st.stdout.trim() !== "" ? "+dirty" : "");
}

export function readSeed() {
  return JSON.parse(readFileSync(path.join(ROOT, "e2e", ".seed.json"), "utf8"));
}

/**
 * Chuẩn bị DB + build một lần. `adminUrl` = DATABASE_URL superuser (with-test-db.sh). Trả về hàm `start(port, extraEnv)`
 * khởi động một instance `next start` và `appDbUrl` (role không superuser như production).
 */
export function prepare({ prefix, extraSeeds = [], build = true }) {
  hook();
  const adminUrl = process.env.DATABASE_URL;
  if (adminUrl === undefined || adminUrl === "")
    throw new Error("cần DATABASE_URL (chạy qua scripts/with-test-db.sh)");
  const base = { ...process.env, MIGRATE_DATABASE_URL: adminUrl, NEXT_TELEMETRY_DISABLED: "1" };
  run("npx", ["--no-install", "tsx", "scripts/migrate.ts"], base, "migrate");
  run("npx", ["--no-install", "tsx", "scripts/seed-e2e.ts"], base, "seed-e2e");
  for (const s of extraSeeds) run("npx", ["--no-install", "tsx", s], base, s);
  const appDbUrl = run("npx", ["--no-install", "tsx", "scripts/e2e-role.ts"], base, "e2e-role").trim();
  if (build && process.env[`${prefix}_SKIP_BUILD`] !== "1") {
    run("npm", ["run", "-s", "build"], base, "build");
  }
  const seed = readSeed();
  const storage = mkdtempSync(path.join(tmpdir(), `${prefix.toLowerCase()}-files-`));
  tmpDirs.push(storage);

  async function start(port, extraEnv = {}, origin = `http://localhost:${port}`) {
    const env = {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: appDbUrl,
      SITE_COMPANY_ID: seed.companyId,
      APP_ORIGIN: origin,
      SESSION_SECRET: `${prefix.toLowerCase()}-session-secret-0123456789abcdef-xyz`,
      QR_SIGNING_KEYS: `k1:${prefix.toLowerCase()}-qr-key-0123456789abcdef0123456789abcdef`,
      // Khoá mã hoá dữ liệu lúc lưu (T-048) bắt buộc ở production: sinh ngẫu nhiên mỗi lần chạy (CSDL của harness là tạm).
      DATA_ENCRYPTION_KEYS: `h1:${DATA_KEY}`,
      DATA_INDEX_KEY,
      FILE_STORAGE_DIR: storage,
      NODE_ENV: "production",
      ...extraEnv,
    };
    delete env.MIGRATE_DATABASE_URL;
    const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    let log = "";
    child.stdout.on("data", (d) => (log = (log + d).slice(-4000)));
    child.stderr.on("data", (d) => (log = (log + d).slice(-4000)));
    let exited = false;
    child.on("exit", () => (exited = true));
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 240; i++) {
      if (exited) throw new Error(`next start thoát sớm:\n${log}`);
      try {
        const r = await fetch(`${baseUrl}/api/readyz`);
        if (r.status === 200) break;
      } catch {
        /* chưa lắng nghe */
      }
      await sleep(500);
      if (i === 239) throw new Error(`next start không sẵn sàng sau 120 s:\n${log}`);
    }
    return {
      baseUrl,
      origin,
      port,
      pid: child.pid,
      logTail: () => log,
      stop() {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* đã thoát */
        }
        children.delete(child);
      },
    };
  }

  return { adminUrl, appDbUrl, seed, start };
}

/** Phiên bản các thành phần (cho báo cáo; không bí mật). */
export function environmentInfo() {
  const require = createRequire(import.meta.url);
  const os = require("node:os");
  const pgv = spawnSync("psql", ["--version"], { encoding: "utf8" });
  return {
    node: process.version,
    next: JSON.parse(readFileSync(path.join(ROOT, "node_modules", "next", "package.json"), "utf8")).version,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpus: `${os.cpus().length} x ${os.cpus()[0]?.model ?? "?"}`.replace(/\s+/g, " "),
    memGiB: Math.round(os.totalmem() / 2 ** 30),
    psql: pgv.status === 0 ? pgv.stdout.trim() : null,
  };
}

/**
 * Đường dẫn tuyệt đối để ghi báo cáo `rel` (vd `docs/ops/ops-stack-drill.md`). Mặc định ra thư mục tạm ngẫu nhiên: lệnh Gate/kiểm KHÔNG được ghi vào
 * repo (`xt.py loop verify` đỏ khi cây đổi sau Gate, LOOP-DESIGN-022). Muốn cập nhật báo cáo đã commit: `XC_REPORT_DIR=.` (đặt sẵn ở
 * job CI để giữ artifact; `npm run -s reports:refresh` cho người). Thư mục cha được tạo.
 */
export function reportFile(rel) {
  const abs = path.join(reportBase(), rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  return abs;
}

let tmpReportBase = null;
/** `XC_REPORT_DIR` (rỗng coi như chưa đặt) hoặc MỘT thư mục tạm ngẫu nhiên 0700 mỗi tiến trình (không dùng tên cố định ở /tmp chung: tránh symlink/ghi đè). */
function reportBase() {
  const dir = process.env.XC_REPORT_DIR;
  if (dir !== undefined && dir !== "") return path.resolve(ROOT, dir);
  tmpReportBase ??= mkdtempSync(path.join(tmpdir(), "xc-reports-"));
  return tmpReportBase;
}

/** Định dạng tệp sinh ra bằng prettier của dự án (cổng `format:check` kiểm cả báo cáo sinh tự động). Tệp ngoài repo (thư mục tạm) bỏ qua. */
export function formatFiles(files) {
  const inRepo = files.filter((f) => {
    const rel = path.relative(ROOT, path.resolve(ROOT, f));
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  });
  if (inRepo.length === 0) return;
  const r = spawnSync(path.join(ROOT, "node_modules", ".bin", "prettier"), ["--write", ...inRepo], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`prettier lỗi: ${r.stderr}`);
}
