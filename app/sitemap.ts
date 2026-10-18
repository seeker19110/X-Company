import type { MetadataRoute } from "next";
import { getPool } from "@/lib/db";
import { sitemapEntries } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries(getPool());
}
