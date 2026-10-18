// Chính sách chấm công có hiệu lực tại thời điểm (D-007). Không có bản ghi → mặc định ⚙ của SPEC.
import type { Queryable } from "../db/index.ts";

export interface AttendancePolicy {
  id: string | null;
  clockSkewMaxSec: number;
  offlineMaxAgeSec: number;
  futureToleranceSec: number;
  qrTtlSec: number;
  qrClockLeewaySec: number;
  duplicateWindowSec: number;
}

export const DEFAULT_POLICY: AttendancePolicy = {
  id: null,
  clockSkewMaxSec: 300,
  offlineMaxAgeSec: 72 * 3600,
  futureToleranceSec: 300,
  qrTtlSec: 60,
  qrClockLeewaySec: 10,
  duplicateWindowSec: 120,
};

export async function policyAt(db: Queryable, companyId: string, at: Date): Promise<AttendancePolicy> {
  const { rows } = await db.query<{
    id: string;
    clock_skew_max_sec: number;
    offline_max_age_sec: number;
    future_tolerance_sec: number;
    qr_ttl_sec: number;
    qr_clock_leeway_sec: number;
    duplicate_window_sec: number;
  }>(
    "SELECT * FROM attendance_policy WHERE company_id = $1 AND valid_from <= $2 ORDER BY valid_from DESC LIMIT 1",
    [companyId, at],
  );
  const r = rows[0];
  if (!r) return DEFAULT_POLICY;
  return {
    id: r.id,
    clockSkewMaxSec: r.clock_skew_max_sec,
    offlineMaxAgeSec: r.offline_max_age_sec,
    futureToleranceSec: r.future_tolerance_sec,
    qrTtlSec: r.qr_ttl_sec,
    qrClockLeewaySec: r.qr_clock_leeway_sec,
    duplicateWindowSec: r.duplicate_window_sec,
  };
}
