// npm run admin:create — tạo quản trị viên đầu tiên (BASE-SEC-005). Không có mật khẩu mặc định: mật khẩu do người
// vận hành nhập, đọc MỘT lần rồi xoá khỏi bộ nhớ biến môi trường, không bao giờ in ra.
//
//   ADMIN_EMAIL=ten@congty.vn ADMIN_NAME="Nguyễn Văn A" [COMPANY_NAME="Tên công ty"] npm run admin:create
//   Mật khẩu: nhập ở dấu nhắc (ẩn ký tự) khi chạy trên terminal; hoặc đẩy qua stdin: `printf '%s' "$MK" | npm run admin:create`;
//   hoặc biến ADMIN_PASSWORD (chỉ nên dùng trong pipeline an toàn — lịch sử shell có thể giữ lại).
// Cần DATABASE_URL (role ứng dụng). Mã thoát: 0 đã tạo · 1 từ chối/lỗi (đã có admin, mật khẩu yếu…) · 2 thiếu tham số.
import pg from "pg";
import { createFirstAdmin } from "../lib/identity/bootstrap.ts";
import { AppError } from "../lib/nen/app-error.ts";
import { env } from "../lib/nen/env.ts";
import { setPool } from "../lib/db/index.ts";

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

/** Nhập ẩn trên TTY (không echo). */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(question);
    let buf = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\u0003") {
          stdin.setRawMode(false);
          stdin.off("data", onData);
          reject(new Error("Đã huỷ"));
          return;
        }
        if (c === "\r" || c === "\n" || c === "\u0004") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          resolve(buf);
          return;
        }
        buf = c === "\u007f" ? buf.slice(0, -1) : buf + c;
      }
    };
    stdin.on("data", onData);
  });
}

/** Mật khẩu đúng như người nhập (chỉ bỏ ký tự xuống dòng cuối khi đọc từ stdin). */
async function readPassword(): Promise<string> {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (fromEnv) {
    delete process.env.ADMIN_PASSWORD; // đọc một lần
    return fromEnv;
  }
  if (process.stdin.isTTY) return promptHidden("Mật khẩu quản trị viên (ẩn): ");
  return (await readStdin()).replace(/\r?\n$/, "");
}

const email = process.env.ADMIN_EMAIL?.trim();
const name = process.env.ADMIN_NAME?.trim();
if (!email || !name) {
  console.error("Thiếu ADMIN_EMAIL hoặc ADMIN_NAME (xem đầu scripts/create-admin.ts).");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: env("DATABASE_URL"), max: 2 });
setPool(pool);
let code = 0;
try {
  const password = await readPassword();
  const r = await createFirstAdmin({
    email,
    displayName: name,
    password,
    companyName: process.env.COMPANY_NAME,
    companyId: process.env.COMPANY_ID,
  });
  console.log(`Đã tạo quản trị viên ${email} (user ${r.userId}, công ty ${r.companyId}).`);
} catch (err) {
  // Chỉ thông điệp nghiệp vụ (không chứa mật khẩu); lỗi lạ in tên lỗi, không in stack/giá trị.
  console.error(
    err instanceof AppError ? `Từ chối: ${err.message} (${err.code})` : `Lỗi: ${(err as Error).name}`,
  );
  code = 1;
} finally {
  await pool.end();
}
process.exit(code);
