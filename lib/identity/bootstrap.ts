// Khởi tạo quản trị viên ĐẦU TIÊN (BASE-SEC-005): không có tài khoản/mật khẩu mặc định — người vận hành tự đặt mật khẩu
// qua `npm run admin:create`. Từ chối khi đã có sysadmin còn hiệu lực. Mật khẩu theo chính sách lib/identity/password.
import type pg from "pg";
import { appendAudit } from "../audit/index.ts";
import { grantRole } from "../authz/grants.ts";
import { withTx } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { createCompany } from "../org/index.ts";
import { normalizeEmail } from "./auth.ts";
import { hashPassword, validateNewPassword } from "./password.ts";
import { t } from "../i18n/index.ts";

export interface FirstAdminInput {
  email: string;
  displayName: string;
  password: string;
  /** Tên công ty tạo mới khi CSDL chưa có công ty nào. */
  companyName?: string;
  /** Bắt buộc khi có nhiều công ty. */
  companyId?: string;
}

const BOOTSTRAP_LOCK = "bootstrap-admin";

/** Tạo công ty (nếu chưa có) + tài khoản + grant sysadmin phạm vi công ty trong MỘT giao dịch. Trả id tài khoản. */
export async function createFirstAdmin(
  input: FirstAdminInput,
  pool?: pg.Pool,
): Promise<{ userId: string; companyId: string }> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new AppError("INVALID_EMAIL", 422, t("err.identity.emailKhongHopLe"));
  const displayName = input.displayName.trim();
  if (displayName === "") throw new AppError("INVALID_NAME", 422, t("err.identity.thieuTenHienThi"));
  validateNewPassword(input.password, { email });
  const hash = await hashPassword(input.password); // băm ngoài giao dịch (không giữ kết nối trong lúc Argon2)

  return withTx(async (tx) => {
    // Hai lần chạy song song không cùng tạo được admin.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [BOOTSTRAP_LOCK]);
    const existing = await tx.query(
      `SELECT 1 FROM role_grant WHERE role = 'sysadmin' AND revoked_at IS NULL
         AND (valid_to IS NULL OR valid_to > now()) LIMIT 1`,
    );
    if ((existing.rowCount ?? 0) > 0)
      throw new AppError("ADMIN_EXISTS", 409, t("err.identity.daCoQuanTriVienTu"));

    const companies = await tx.query<{ id: string }>(
      "SELECT id FROM company ORDER BY created_at, id LIMIT 2",
    );
    let companyId = input.companyId;
    if (companyId) {
      const found = await tx.query("SELECT 1 FROM company WHERE id = $1", [companyId]);
      if ((found.rowCount ?? 0) === 0)
        throw new AppError("NOT_FOUND", 404, t("err.identity.khongTimThayCongTy"));
    } else if (companies.rows.length > 1) {
      throw new AppError("COMPANY_REQUIRED", 422, t("err.identity.coNhieuCongTyChiDinh"));
    } else {
      companyId =
        companies.rows[0]?.id ??
        (await createCompany(tx, { userId: null }, { name: companyNameOrDefault(input.companyName) }));
    }

    const dup = await tx.query("SELECT 1 FROM app_user WHERE email = $1", [email]);
    if ((dup.rowCount ?? 0) > 0) throw new AppError("DUPLICATE", 409, t("err.identity.emailDaDuocDung"));
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO app_user (email, display_name, password_hash, company_id) VALUES ($1,$2,$3,$4) RETURNING id",
      [email, displayName, hash, companyId],
    );
    const userId = rows[0]!.id;
    await grantRole(tx, { userId: null }, companyId, { userId, role: "sysadmin", scopeType: "company" });
    await appendAudit(tx, {
      actorUserId: null,
      companyId,
      action: "admin.bootstrap",
      objectType: "app_user",
      objectId: userId,
      reason: t("msg.identity.bootstrapReason"),
    });
    return { userId, companyId };
  }, pool);
}

function companyNameOrDefault(name: string | undefined): string {
  const v = (name ?? "").trim();
  return v === "" ? "X-Company" : v;
}
