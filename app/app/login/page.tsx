import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { RumIfEnabled } from "@/app/server/rum";
import { getSession } from "@/app/server/session";
import { LoginForm } from "./login-form";
import type { MfaText } from "./mfa-step";
import "../app.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: t("login.title"), robots: { index: false } };

/** Chuỗi bước mã TOTP dịch ở server rồi truyền xuống (không nhúng vi.app.json vào JS trang đăng nhập — FE-PERF-004). */
function mfaText(): MfaText {
  return {
    heading: t("mfa.heading"),
    intro: t("mfa.intro"),
    code: t("mfa.code"),
    submit: t("mfa.submit"),
    submitting: t("mfa.submitting"),
    back: t("mfa.back"),
    badFormat: t("mfa.badFormat"),
    wait: t("mfa.wait", { minutes: "{minutes}" }), // giữ chỗ để client nội suy theo Retry-After
    enrollHeading: t("mfa.enrollHeading"),
    enrollIntro: t("mfa.enrollIntro"),
    enrollOpen: t("mfa.enrollOpen"),
    enrollManual: t("mfa.enrollManual"),
    copy: t("mfa.copy"),
    copied: t("mfa.copied"),
    enrollDone: t("mfa.enrollDone"),
  };
}

export default async function LoginPage() {
  if (await getSession()) redirect("/app/today");
  return (
    <main className="app-main">
      <h1>{t("login.heading")}</h1>
      <LoginForm mfaText={mfaText()} />
      <RumIfEnabled />
    </main>
  );
}
