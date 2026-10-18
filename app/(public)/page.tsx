import type { Metadata } from "next";
import Link from "next/link";
import { resolvePath, sectionPages } from "@/app/components/site-data";
import { pathFor } from "@/lib/cms";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const r = await resolvePath([]);
  if (r.kind !== "page") return { title: t("brand.name") };
  return {
    title: { absolute: r.page.seoTitle ?? r.page.title },
    description: r.page.seoDescription ?? r.page.summary ?? undefined,
    alternates: { canonical: r.page.canonicalUrl ?? "/" },
  };
}

export default async function HomePage() {
  const [home, services] = await Promise.all([resolvePath([]), sectionPages("service")]);
  return (
    <>
      {home.kind === "page" ? (
        <article className="prose">
          <h1>{home.page.title}</h1>
          {home.page.summary && <p className="muted">{home.page.summary}</p>}
          {/* eslint-disable-next-line react/no-danger -- html chỉ do lib/web/safe-html.ts (markdown-it html:false + safeUrl) sinh từ bản đã duyệt qua lib/site */}
          <div dangerouslySetInnerHTML={{ __html: home.html }} />
        </article>
      ) : (
        <h1>{t("brand.name")}</h1>
      )}
      {services.length > 0 && (
        <section aria-labelledby="dv">
          <h2 id="dv">{t("site.home.servicesHeading")}</h2>
          <ul className="card-list">
            {services.map((s) => (
              <li key={s.pageId}>
                <h3>
                  <Link href={pathFor(s.type, s.slug)}>{s.title}</Link>
                </h3>
                {s.summary && <p className="muted">{s.summary}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p>
        <Link href="/lien-he">{t("site.home.contactCta")}</Link>
      </p>
    </>
  );
}
