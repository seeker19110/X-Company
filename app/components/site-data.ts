// Truy cập dữ liệu website cho server component (chỉ chạy phía server).
import "server-only";
import { getPool } from "@/lib/db";
import { listSection, resolvePublicPath } from "@/lib/site";
import type { PageType } from "@/lib/cms";

export function resolvePath(segments: string[]) {
  return resolvePublicPath(getPool(), segments);
}

export function sectionPages(type: PageType) {
  return listSection(getPool(), type);
}
