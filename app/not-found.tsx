import { t } from "@/lib/i18n";

/** Trang 404 riêng (UX-STATE-005): trang mặc định của Next chèn <style> không nonce — CSP không 'unsafe-inline' chặn (ZAP 10055).
 *  Không tự mở <main>: trang nằm trong layout công khai đã có <main>, lồng hai landmark main là sai (AUD-A11Y-006). */
export default function NotFound() {
  return (
    <div className="not-found">
      <section>
        <h1>{t("notFound.title")}</h1>
        <p>{t("notFound.body")}</p>
        {/* <a> thường, không next/link: trang 404 nằm trong cây gốc của mọi route — Link thêm 1 chunk client vào mọi trang (check:perf-budget). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 404 toàn cục: điều hướng đầy đủ về trang chủ, tránh trạng thái router hỏng */}
        <a href="/">{t("notFound.home")}</a>
      </section>
    </div>
  );
}
