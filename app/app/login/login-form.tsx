"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { api } from "@/app/components/api";
import { t } from "@/lib/i18n/client";

export function LoginForm() {
  const router = useRouter();
  const ids = { email: useId(), pw: useId() };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const r = await api("POST", "/api/app/auth/login", {
      body: { email: f.get("email"), password: f.get("password") },
    });
    setBusy(false);
    if (r.ok) router.replace("/app/today");
    else setError(r.error ?? t("login.failed"));
  }

  return (
    <form onSubmit={onSubmit} className="card" aria-describedby={error ? "login-error" : undefined}>
      {error && (
        <p id="login-error" role="alert" className="err">
          {error}
        </p>
      )}
      <label className="field" htmlFor={ids.email}>
        {t("login.email")}
        <input id={ids.email} name="email" type="email" autoComplete="username" required />
      </label>
      <label className="field" htmlFor={ids.pw}>
        {t("login.password")}
        <input id={ids.pw} name="password" type="password" autoComplete="current-password" required />
      </label>
      <button className="btn btn-primary btn-big" type="submit" disabled={busy}>
        {busy ? t("login.submitting") : t("login.submit")}
      </button>
    </form>
  );
}
