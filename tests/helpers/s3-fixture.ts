// Máy chủ S3-compatible TỰ HOST cho test (T-116, D-073): `rclone serve s3` (MIT, ghim sha256 qua scripts/tools/install-tool.mjs) trên
// thư mục tạm, chỉ nghe 127.0.0.1, khoá truy cập ngẫu nhiên mỗi lần chạy, kiểm chữ ký V4. Khoá đi qua biến môi trường của tiến trình
// con (RCLONE_AUTH_KEY), không nằm trong argv. Thiếu rclone → ném lỗi có cách cài (test DB không skip).
// Dùng chung cho tests/db/files-contract.test.ts và e2e/replicas.spec.ts. Nhãn: faithful-fixture (rclone `serve s3` là tính năng
// Experimental của rclone; KHÔNG phải nhà cung cấp production — chọn ở G7, D-005).
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const RCLONE = path.join(ROOT, ".tools/bin/rclone");
export const S3_BUCKET = "xc-files";

export interface S3Fixture {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Thư mục rclone phục vụ; đối tượng nằm ở `<dataDir>/<bucket>/<khoá>`. */
  dataDir: string;
  /** Biến môi trường để chạy app với FILE_STORAGE=s3 trỏ vào máy chủ này. */
  env: Record<string, string>;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      s.close(() =>
        a !== null && typeof a === "object" ? resolve(a.port) : reject(new Error("không lấy được cổng")),
      );
    });
  });
}

async function waitUp(url: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`rclone serve s3 thoát sớm (mã ${child.exitCode}): ${log()}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`rclone serve s3 không lên sau 15 giây: ${log()}`);
}

export async function startS3(): Promise<S3Fixture> {
  if (!existsSync(RCLONE))
    throw new Error(
      "thiếu rclone: chạy `node scripts/tools/install-tool.mjs install rclone` (máy chủ S3 tự host cho test kho tệp; không skip)",
    );
  const base = mkdtempSync(path.join(tmpdir(), "xc-s3-"));
  const dataDir = path.join(base, "data");
  mkdirSync(path.join(dataDir, S3_BUCKET), { recursive: true });
  const conf = path.join(base, "rclone.conf");
  writeFileSync(conf, "", { mode: 0o600 });
  const accessKeyId = `xc${randomBytes(8).toString("hex")}`;
  const secretAccessKey = randomBytes(24).toString("hex");
  const port = await freePort();
  let out = "";
  const child = spawn(
    RCLONE,
    ["serve", "s3", "--addr", `127.0.0.1:${port}`, "--config", conf, "--log-level", "NOTICE", dataDir],
    {
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        HOME: base,
        RCLONE_AUTH_KEY: `"${accessKeyId},${secretAccessKey}"`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-2_000)));
  child.stderr?.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-2_000)));
  const endpoint = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const done = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await done;
    }
    rmSync(base, { recursive: true, force: true });
  };
  try {
    await waitUp(endpoint, child, () => out);
  } catch (err) {
    await stop();
    throw err;
  }
  const region = "us-east-1";
  return {
    endpoint,
    bucket: S3_BUCKET,
    region,
    accessKeyId,
    secretAccessKey,
    dataDir,
    env: {
      FILE_STORAGE: "s3",
      S3_ENDPOINT: endpoint,
      S3_BUCKET,
      S3_REGION: region,
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
    },
    stop,
  };
}
