import { ErrorReporter } from "@/app/components/error-reporter";
import { currentRelease } from "@/lib/errors";

/**
 * Kho lỗi tự host (T-122): gắn release của bản build cho beacon lỗi phía trình duyệt. Gắn cùng chỗ với RumIfEnabled (layout khu
 * công khai, layout khu nội bộ, trang đăng nhập) — không ở root layout: tách thêm một ranh giới client ở root làm phình JS tải đầu.
 */
export function ErrorReporting() {
  return <ErrorReporter release={currentRelease()} />;
}
