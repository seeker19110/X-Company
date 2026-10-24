// npm run -s mfa:reset -- <email> — đặt lại xác thực hai bước TOTP khi người dùng mất thiết bị (AUD-SEC-002, D-058).
// Xoá bí mật + thử thách đang chờ, huỷ mọi phiên, ghi audit `auth.mfa_reset` (actor hệ thống tường minh); lần đăng nhập kế
// người dùng đăng ký lại. Chỉ sysadmin/vận hành có DATABASE_URL chạy được — không có route HTTP. Không in bí mật.
// Mã thoát: 0 đã đặt lại · 1 từ chối/lỗi (không tìm thấy tài khoản…) · 2 thiếu tham số.
import pg from "pg";
import { SYSTEM_ACTOR } from "../lib/authz/index.ts";
import { setPool, withTx } from "../lib/db/index.ts";
import { resetMfa } from "../lib/identity/mfa.ts";
import { AppError } from "../lib/nen/app-error.ts";
import { env } from "../lib/nen/env.ts";
import { logSecurityEvent } from "../lib/nen/security-event.ts";
import { comparisonKey } from "../lib/nen/text.ts";

const raw = process.argv[2]?.trim();
if (!raw) {
  console.error("Thiếu email: npm run -s mfa:reset -- <email>");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: env("DATABASE_URL"), max: 2 });
setPool(pool);
let code = 0;
try {
  const r = await withTx((tx) =>
    resetMfa(tx, SYSTEM_ACTOR, comparisonKey(raw) /* cùng chuẩn hoá với normalizeEmail của login */),
  );
  logSecurityEvent({
    event: "auth.mfa_reset",
    outcome: "success",
    actorId: null,
    target: { type: "app_user", id: r.userId },
  });
  console.log(
    `Đã đặt lại TOTP cho user ${r.userId}${r.hadSecret ? "" : " (chưa từng bật)"}; mọi phiên đã huỷ, lần đăng nhập kế sẽ đăng ký lại.`,
  );
} catch (err) {
  console.error(
    err instanceof AppError ? `Từ chối: ${err.message} (${err.code})` : `Lỗi: ${(err as Error).name}`,
  );
  code = 1;
} finally {
  await pool.end();
}
process.exit(code);
