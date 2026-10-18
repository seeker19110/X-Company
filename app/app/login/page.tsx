import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/app/server/session";
import { LoginForm } from "./login-form";
import "../app.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Đăng nhập", robots: { index: false } };

export default async function LoginPage() {
  if (await getSession()) redirect("/app/today");
  return (
    <main className="app-main">
      <h1>Đăng nhập X-Company</h1>
      <LoginForm />
    </main>
  );
}
