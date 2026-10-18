// Bộ dịch cho mã chạy ở trình duyệt (FE-PERF-004): chỉ `messages/vi.json` (chuỗi lõi dùng chung: lỗi, API, đăng nhập).
// Chuỗi theo nhóm màn hình nằm ở tệp riêng để JS tải xuống không kèm chuỗi của màn hình khác:
// `vi.app.json` (khu nội bộ → client-app.ts), `vi.site.json` (website công khai → client-site.ts), `vi.server.json` (chỉ-server).
// Khoá đặt vào tệp theo nơi dùng; dùng khoá của tệp khác trong client = lỗi tsc.
import core from "../../messages/vi.json";
import { createTranslator } from "./core.ts";

export const t = createTranslator(core);
