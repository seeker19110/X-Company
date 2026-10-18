// Markdown → HTML cho website: toàn bộ việc sinh HTML/kiểm URL nằm ở lib/web/safe-html.ts (FE-SEC-001/002, T8).
import { parseMarkdown, renderSafeHtml } from "../web/safe-html.ts";
import { t as tr } from "../i18n/index.ts";

export function renderMarkdown(source: string): string {
  return renderSafeHtml(source);
}

export interface ContentWarning {
  code: "IMAGE_MISSING_ALT";
  message: string;
}

/** Cảnh báo khi duyệt (không chặn): ảnh thiếu văn bản thay thế (WCAG 1.1.1). */
export function lintMarkdown(source: string): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  const walk = (tokens: ReturnType<typeof parseMarkdown>) => {
    for (const t of tokens) {
      if (t.type === "image" && t.content.trim() === "") {
        warnings.push({
          code: "IMAGE_MISSING_ALT",
          message: tr("msg.cms.imageMissingAlt", { src: t.attrGet("src") ?? "" }),
        });
      }
      if (t.children) walk(t.children);
    }
  };
  walk(parseMarkdown(source));
  return warnings;
}
