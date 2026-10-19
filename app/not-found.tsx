import Link from "next/link";
import { t } from "@/lib/i18n";

/** Trang 404 riêng (UX-STATE-005): trang mặc định của Next chèn <style> không nonce — CSP không 'unsafe-inline' chặn (ZAP 10055). */
export default function NotFound() {
  return (
    <main className="wrap">
      <section className="error-view">
        <h1>{t("notFound.title")}</h1>
        <p>{t("notFound.body")}</p>
        <Link className="btn" href="/">
          {t("notFound.home")}
        </Link>
      </section>
    </main>
  );
}
