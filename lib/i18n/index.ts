// Tài nguyên chuỗi (XC-I18N-001): mọi chuỗi người dùng thấy nằm ở `messages/<locale>.json` (+ `<locale>.server.json` cho chuỗi
// chỉ-server, xem client.ts) (khoá lồng theo màn hình/thành
// phần), mô tả ngữ cảnh cho người dịch ở `messages/<locale>.context.json` (cùng tập khoá). Mô-đun thuần: không next/*,
// không DB — dùng được ở server component, client component và schema dùng chung (`*.pure.ts`).
// Khoá có kiểu suy từ JSON nguồn (sai khoá = lỗi tsc); khoá thiếu lúc chạy = ném lỗi, không bao giờ in khoá ra giao diện.
import vi from "../../messages/vi.json";
import viApp from "../../messages/vi.app.json";
import viServer from "../../messages/vi.server.json";
import viSite from "../../messages/vi.site.json";
import { createTranslator, mergeMessages, type MessageKeys } from "./core.ts";

export { createTranslator, flattenMessages, interpolate, mergeMessages } from "./core.ts";
export type { MessageKeys, MessageParams, MessageTree } from "./core.ts";

export type MessageKey = MessageKeys<typeof vi & typeof viApp & typeof viSite & typeof viServer>;

/** Dịch theo locale mặc định của sản phẩm (`vi`). */
export const t = createTranslator(
  mergeMessages(mergeMessages(mergeMessages(vi, viApp), viSite), viServer) as typeof vi &
    typeof viApp &
    typeof viSite &
    typeof viServer,
);
