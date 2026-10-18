import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { resolvePath, sectionPages } from "@/app/components/site-data";
import { pathFor, type PageType } from "@/lib/cms";
import { ContactForm } from "@/app/components/contact-form";

export const dynamic = "force-dynamic";

const SECTIONS: Record<string, { type: PageType; title: string }> = {
  "dich-vu": { type: "service", title: "Dịch vụ" },
  "du-an": { type: "project", title: "Dự án tiêu biểu" },
  "nang-luc": { type: "capability", title: "Năng lực và chứng nhận" },
  "tin-tuc": { type: "news", title: "Tin tức" },
  "tuyen-dung": { type: "job", title: "Tuyển dụng" },
};

type Props = { params: Promise<{ slug: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const section = slug.length === 1 ? SECTIONS[slug[0]!] : undefined;
  if (section) return { title: section.title, alternates: { canonical: `/${slug[0]}` } };
  if (slug.length === 1 && slug[0] === "lien-he") {
    const r = await resolvePath(slug);
    return { title: r.kind === "page" ? r.page.title : "Liên hệ", alternates: { canonical: "/lien-he" } };
  }
  const r = await resolvePath(slug);
  if (r.kind !== "page") return {};
  return {
    title: r.page.seoTitle ?? r.page.title,
    description: r.page.seoDescription ?? r.page.summary ?? undefined,
    alternates: { canonical: r.page.canonicalUrl ?? pathFor(r.page.type, r.page.slug) },
    openGraph: { title: r.page.seoTitle ?? r.page.title, description: r.page.seoDescription ?? undefined },
  };
}

export default async function CmsPage({ params }: Props) {
  const { slug } = await params;
  const section = slug.length === 1 ? SECTIONS[slug[0]!] : undefined;
  if (section) {
    const items = await sectionPages(section.type);
    return (
      <>
        <h1>{section.title}</h1>
        {items.length === 0 ? (
          <p className="muted">Nội dung đang được cập nhật.</p>
        ) : (
          <ul className="card-list">
            {items.map((p) => (
              <li key={p.pageId}>
                <h2>
                  <Link href={pathFor(p.type, p.slug)}>{p.title}</Link>
                </h2>
                {p.summary && <p className="muted">{p.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  const r = await resolvePath(slug);
  if (r.kind === "redirect") permanentRedirect(r.to);
  const isContact = slug.length === 1 && slug[0] === "lien-he";
  if (r.kind === "not_found" && !isContact) notFound();
  return (
    <>
      {r.kind === "page" ? (
        <article className="prose">
          <h1>{r.page.title}</h1>
          {r.page.summary && <p className="muted">{r.page.summary}</p>}
          <div dangerouslySetInnerHTML={{ __html: r.html }} />
        </article>
      ) : (
        <h1>Liên hệ</h1>
      )}
      {isContact && <ContactForm />}
    </>
  );
}
