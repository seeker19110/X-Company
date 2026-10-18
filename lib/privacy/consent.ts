// Bản ghi đồng ý (CMP-RIGHTS-001, CMP-VN-001): CHỈ THÊM — cấp = dòng 'grant', rút = dòng 'withdraw' mới (không UPDATE).
// Trạng thái hiện hành của (chủ thể, mục đích) = event của dòng mới nhất. File công khai của miền privacy: form công khai
// (lib/inquiry) ghi đồng ý qua đây; worker hỏi `isProcessingBlocked` trước khi gửi sự kiện của chủ thể.
import { createHash } from "node:crypto";
import type { Queryable } from "../db/index.ts";

export type SubjectType = "inquiry" | "job_application" | "employee";
export const CHANNEL_WEB_FORM = "web_form";

/** Mục đích dựa trên đồng ý của từng loại chủ thể (employee: xử lý theo hợp đồng lao động, không dựa trên đồng ý). */
export const CONSENT_PURPOSES: Record<SubjectType, readonly string[]> = {
  inquiry: ["inquiry_contact"],
  job_application: ["job_application"],
  employee: [],
};

/** Văn bản đồng ý hiển thị (tóm tắt) — băm cùng mục đích + phiên bản làm `ui_snapshot_hash`. Đổi chữ → đổi phiên bản. */
const CONSENT_TEXT: Record<string, string> = {
  inquiry_contact: "Tôi đồng ý để X-Company xử lý thông tin trên nhằm phản hồi yêu cầu",
  job_application: "Tôi đồng ý để X-Company xử lý hồ sơ nhằm tuyển dụng",
};

export function consentSnapshotHash(purposeId: string, policyVersion: string): string {
  return createHash("sha256")
    .update(`${purposeId}\n${policyVersion}\n${CONSENT_TEXT[purposeId] ?? ""}`)
    .digest("hex");
}

export interface ConsentInput {
  companyId: string;
  subjectType: SubjectType;
  subjectId: string;
  purposeId: string;
  policyVersion: string;
  channel: string;
  at: Date;
}

/** Ghi sự kiện cấp đồng ý (trong giao dịch của người gọi — cùng commit với bản ghi chủ thể). */
export async function recordConsent(tx: Queryable, c: ConsentInput): Promise<void> {
  await tx.query(
    `INSERT INTO consent_record (company_id, subject_type, subject_id, purpose_id, policy_version, event, granted_at,
       channel, ui_snapshot_hash)
     VALUES ($1, $2, $3, $4, $5, 'grant', $6, $7, $8)`,
    [
      c.companyId,
      c.subjectType,
      c.subjectId,
      c.purposeId,
      c.policyVersion,
      c.at,
      c.channel,
      consentSnapshotHash(c.purposeId, c.policyVersion),
    ],
  );
}

export interface ConsentRow {
  purpose_id: string;
  policy_version: string;
  event: "grant" | "withdraw";
  granted_at: Date;
  channel: string;
  ui_snapshot_hash: string;
  withdrawn_at: Date | null;
}

/** Toàn bộ sự kiện đồng ý của chủ thể theo thứ tự ghi (truy vấn theo người dùng, CMP-RIGHTS-001). */
export async function listConsents(
  db: Queryable,
  subjectType: SubjectType,
  subjectId: string,
): Promise<ConsentRow[]> {
  const { rows } = await db.query<ConsentRow>(
    `SELECT purpose_id, policy_version, event, granted_at, channel, ui_snapshot_hash, withdrawn_at
       FROM consent_record WHERE subject_type = $1 AND subject_id = $2 ORDER BY id`,
    [subjectType, subjectId],
  );
  return rows;
}

interface ActivePurpose {
  purpose_id: string;
  policy_version: string;
  granted_at: Date;
  channel: string;
}

/** Mục đích đang có hiệu lực (sự kiện mới nhất là 'grant'). */
export async function activePurposes(
  db: Queryable,
  subjectType: SubjectType,
  subjectId: string,
): Promise<ActivePurpose[]> {
  const { rows } = await db.query<ActivePurpose & { event: string }>(
    `SELECT DISTINCT ON (purpose_id) purpose_id, policy_version, granted_at, channel, event
       FROM consent_record WHERE subject_type = $1 AND subject_id = $2 ORDER BY purpose_id, id DESC`,
    [subjectType, subjectId],
  );
  return rows.filter((r) => r.event === "grant");
}

/** Rút đồng ý: thêm dòng 'withdraw' MỚI (cùng phiên bản của lần cấp mới nhất). Trả danh sách mục đích đã rút. */
export async function withdrawConsent(
  tx: Queryable,
  companyId: string,
  subjectType: SubjectType,
  subjectId: string,
  now: Date,
  channel = "dsar",
): Promise<string[]> {
  const active = await activePurposes(tx, subjectType, subjectId);
  for (const a of active)
    await tx.query(
      `INSERT INTO consent_record (company_id, subject_type, subject_id, purpose_id, policy_version, event, granted_at,
         channel, ui_snapshot_hash, withdrawn_at)
       VALUES ($1, $2, $3, $4, $5, 'withdraw', $6, $7, $8, $9)`,
      [
        companyId,
        subjectType,
        subjectId,
        a.purpose_id,
        a.policy_version,
        a.granted_at,
        channel,
        consentSnapshotHash(a.purpose_id, a.policy_version),
        now,
      ],
    );
  return active.map((a) => a.purpose_id);
}

/**
 * Chủ thể đã rút đồng ý (cho mục đích này) hoặc đang bị hạn chế xử lý → không được xử lý tiếp. Hàng chưa có bản ghi
 * đồng ý nào KHÔNG bị coi là chặn (dữ liệu dựng ngoài luồng form); form công khai luôn ghi đồng ý cùng giao dịch.
 */
export async function isProcessingBlocked(
  db: Queryable,
  subjectType: SubjectType,
  subjectId: string,
  purposeId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ last_event: string | null; restricted: boolean }>(
    `SELECT (SELECT event FROM consent_record
              WHERE subject_type = $1 AND subject_id = $2 AND purpose_id = $3 ORDER BY id DESC LIMIT 1) AS last_event,
            EXISTS (SELECT 1 FROM processing_restriction
                     WHERE subject_type = $1 AND subject_id = $2 AND kind = 'restrict' AND released_at IS NULL) AS restricted`,
    [subjectType, subjectId, purposeId],
  );
  return rows[0]!.last_event === "withdraw" || rows[0]!.restricted;
}
