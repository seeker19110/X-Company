// Mật khẩu Argon2id (D-003, BE-AUTH-001): m=19456 KiB, t=2, p=1; chuỗi PHC lưu tham số để nâng cấp dần.
import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { AppError } from "../nen/app-error.ts";
import { COMMON_PASSWORDS } from "./common-passwords.ts";
import { t } from "../i18n/index.ts";

const ARGON2ID = 2 as Algorithm;
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

// Băm giả để so sánh khi email không tồn tại — thời gian phản hồi không lộ tài khoản có hay không.
let dummyHash: Promise<string> | undefined;

export function validateNewPassword(password: string, context: { email?: string } = {}): void {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new AppError(
      "WEAK_PASSWORD",
      422,
      t("err.identity.passwordTooShort", { min: MIN_PASSWORD_LENGTH }),
    );
  if (password.length > MAX_PASSWORD_LENGTH)
    throw new AppError("WEAK_PASSWORD", 422, t("err.identity.matKhauQuaDai"));
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower))
    throw new AppError("WEAK_PASSWORD", 422, t("err.identity.matKhauQuaPhoBien"));
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local))
    throw new AppError("WEAK_PASSWORD", 422, t("err.identity.matKhauKhongDuocChuaTen"));
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** So mật khẩu; `stored` null (không có tài khoản/chưa đặt) vẫn tốn thời gian như thường rồi trả false. */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  if (!stored) {
    dummyHash ??= hashPassword("xc-dummy-password-for-timing");
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
