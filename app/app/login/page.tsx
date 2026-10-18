import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { getSession } from "@/app/server/session";
import { LoginForm } from "./login-form";
import "../app.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: t("login.title"), robots: { index: false } };

export default async function LoginPage() {
  if (await getSession()) redirect("/app/today");
  return (
    <main className="app-main">
      <h1>{t("login.heading")}</h1>
      <LoginForm />
    </main>
  );
}
