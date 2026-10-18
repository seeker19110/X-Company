// Bộ dịch cho client của website công khai: lõi + `messages/vi.site.json` (xem client.ts).
import core from "../../messages/vi.json";
import site from "../../messages/vi.site.json";
import { createTranslator, mergeMessages } from "./core.ts";

export const t = createTranslator(mergeMessages(core, site) as typeof core & typeof site);
