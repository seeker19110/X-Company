import { RumBeacon } from "@/app/components/rum-beacon";
import { env } from "@/lib/nen/env";

/** Beacon RUM chỉ khi RUM_ENABLED (T-056). Gắn ở layout khu công khai, layout khu nội bộ và trang đăng nhập (không ở root layout: tiết kiệm JS tải đầu). */
export function RumIfEnabled() {
  return env("RUM_ENABLED") ? <RumBeacon /> : null;
}
