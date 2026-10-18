// Website công khai (F-003): phân giải đường dẫn → trang đã xuất bản | chuyển hướng 301 | không có; sitemap; robots.
// Công ty sở hữu website: SITE_COMPANY_ID. Chỉ đọc bản published tới hạn (lib/cms) — bản nháp không bao giờ lộ.
import type { Queryable } from "../db/index.ts";
import {
  findRedirect,
  getPublished,
  listPublished,
  pathFor,
  type PageType,
  type PublishedPage,
} from "../cms/index.ts";
import { renderMarkdown } from "../cms/markdown.ts";
import { appOrigin } from "../nen/config.ts";

export function siteCompanyId(): string {
  const id = process.env.SITE_COMPANY_ID?.trim();
  if (!id) throw new Error("Thiếu SITE_COMPANY_ID");
  return id;
}

const SECTION_BY_PREFIX: Record<string, PageType> = {
  "dich-vu": "service",
  "du-an": "project",
  "nang-luc": "capability",
  "tin-tuc": "news",
  "tuyen-dung": "job",
};

export type Resolved =
  | { kind: "page"; page: PublishedPage; html: string }
  | { kind: "redirect"; to: string }
  | { kind: "not_found" };

/** `segments`: đường dẫn sau tên miền, vd ["dich-vu", "tu-van"]. */
export async function resolvePublicPath(
  db: Queryable,
  segments: string[],
  now: Date = new Date(),
): Promise<Resolved> {
  const companyId = siteCompanyId();
  const path = "/" + segments.join("/");
  let type: PageType | null = null;
  let slug = "";
  if (segments.length === 0) type = "home";
  else if (segments.length === 1 && segments[0] === "gioi-thieu") type = "about";
  else if (segments.length === 1 && segments[0] === "lien-he") type = "contact";
  else if (segments.length === 2 && SECTION_BY_PREFIX[segments[0]!]) {
    type = SECTION_BY_PREFIX[segments[0]!]!;
    slug = segments[1]!;
  } else if (segments.length === 1) {
    type = "page";
    slug = segments[0]!;
  }
  if (type) {
    const page = await getPublished(db, companyId, type, slug, { now });
    if (page) return { kind: "page", page, html: renderMarkdown(page.bodyMarkdown) };
  }
  const to = await findRedirect(db, companyId, path);
  return to ? { kind: "redirect", to } : { kind: "not_found" };
}

export async function listSection(
  db: Queryable,
  type: PageType,
  now: Date = new Date(),
): Promise<PublishedPage[]> {
  return listPublished(db, siteCompanyId(), { type, now });
}

export interface SitemapEntry {
  url: string;
  lastModified: Date;
}

/** Sitemap: chỉ trang đã xuất bản tới hạn + trang mục lục cố định. */
export async function sitemapEntries(db: Queryable, now: Date = new Date()): Promise<SitemapEntry[]> {
  const origin = appOrigin();
  const pages = await listPublished(db, siteCompanyId(), { now });
  const seen = new Set<string>();
  const out: SitemapEntry[] = [];
  for (const p of pages) {
    const url = origin + pathFor(p.type, p.slug);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, lastModified: p.publishAt ?? now });
  }
  for (const section of ["/dich-vu", "/du-an", "/nang-luc", "/tin-tuc", "/tuyen-dung", "/lien-he"]) {
    const url = origin + section;
    if (!seen.has(url)) out.push({ url, lastModified: now });
  }
  return out;
}

export function robotsRules() {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/api"] }],
    sitemap: `${appOrigin()}/sitemap.xml`,
  };
}
