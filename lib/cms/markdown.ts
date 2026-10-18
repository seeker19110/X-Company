// Markdown → HTML an toàn (SPEC-website-cms, THREAT-MODEL T8): html:false nên mọi thẻ HTML thô bị escape;
// validateLink của markdown-it chặn javascript:/vbscript:/data: (trừ ảnh). Thêm rel cho link ngoài.
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx]!.attrGet("href") ?? "";
  if (/^https?:\/\//i.test(href)) {
    tokens[idx]!.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
  return md.render(source);
}

export interface ContentWarning {
  code: "IMAGE_MISSING_ALT";
  message: string;
}

/** Cảnh báo khi duyệt (không chặn): ảnh thiếu văn bản thay thế (WCAG 1.1.1). */
export function lintMarkdown(source: string): ContentWarning[] {
  const warnings: ContentWarning[] = [];
  const walk = (tokens: ReturnType<typeof md.parse>) => {
    for (const t of tokens) {
      if (t.type === "image" && t.content.trim() === "") {
        warnings.push({
          code: "IMAGE_MISSING_ALT",
          message: `Ảnh ${t.attrGet("src") ?? ""} thiếu văn bản thay thế`,
        });
      }
      if (t.children) walk(t.children);
    }
  };
  walk(md.parse(source, {}));
  return warnings;
}
