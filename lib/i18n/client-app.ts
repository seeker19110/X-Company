// Bộ dịch cho client của khu nội bộ: lõi + `messages/vi.app.json` (xem client.ts).
import core from "../../messages/vi.json";
import app from "../../messages/vi.app.json";
import { createTranslator, mergeMessages } from "./core.ts";

export const t = createTranslator(mergeMessages(core, app) as typeof core & typeof app);
