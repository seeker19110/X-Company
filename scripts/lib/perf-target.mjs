// Đích của bộ tải (QA-PERF-007): chỉ loopback. `PERF_BASE_URL` từ env được nhận để chạy lại trên một bản build cục bộ khác,
// nhưng mọi host ngoài máy này (kể cả tên miền production) bị từ chối — load test không bao giờ chạm production; game day
// trên hạ tầng thật là quy trình riêng có lịch và cảnh báo (RUNBOOK), không đi qua script này.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** URL http(s) trỏ về chính máy này? Chuỗi rác/không phải http(s) → false. */
export function isLoopbackUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return (u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname) && u.username === "";
}

/** Đích thật của lượt đo: `PERF_BASE_URL` (nếu đặt) phải là loopback, không thì ném; vắng → `fallback` (máy chủ của harness). */
export function resolvePerfTarget(envValue, fallback) {
  if (envValue === undefined || envValue.trim() === "") return fallback;
  if (!isLoopbackUrl(envValue))
    throw new Error(
      `PERF_BASE_URL phải là loopback (localhost/127.0.0.1/[::1]) — từ chối "${envValue}" (QA-PERF-007)`,
    );
  return envValue.replace(/\/+$/, "");
}
