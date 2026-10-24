"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api } from "@/app/components/api";
import { t } from "@/lib/i18n/client";
import {
  codeOrNull,
  isMfaChallenge,
  MfaStepView,
  mfaFailure,
  withWait,
  type MfaChallenge,
  type MfaText,
} from "./mfa-step";

/** Đăng nhập hai bước (AUD-SEC-002): mật khẩu → (nếu vai trò cần) mã TOTP / đăng ký lần đầu → /app/today. */
export function LoginForm({ mfaText }: { mfaText: MfaText }) {
  const router = useRouter();
  const ids = { email: useId(), pw: useId(), mfa: useId() };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<MfaChallenge | null>(null);
  const [codeError, setCodeError] = useState<{ message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [backTick, setBackTick] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Focus theo bước: vào bước mã / mã bị từ chối → ô mã (chọn sẵn để gõ lại); quay lại → ô email.
  useEffect(() => {
    if (!step) return;
    codeRef.current?.focus();
    codeRef.current?.select();
  }, [step, codeError]);
  useEffect(() => {
    if (backTick > 0) emailRef.current?.focus();
  }, [backTick]);

  function backToPassword(message: string | null) {
    setStep(null);
    setCodeError(null);
    setCopied(false);
    setError(message);
    setBackTick((n) => n + 1);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setEmail(String(f.get("email") ?? ""));
    setBusy(true);
    setError(null);
    const r = await api("POST", "/api/app/auth/login", {
      body: { email: f.get("email"), password: f.get("password") },
    });
    setBusy(false);
    if (r.ok && isMfaChallenge(r.data)) setStep(r.data);
    else if (r.ok) router.replace("/app/today");
    else setError(withWait(r.error ?? t("login.failed"), mfaText.wait, r.retryAfter));
  }

  async function onCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!step) return;
    const code = codeOrNull(new FormData(e.currentTarget).get("code"));
    if (code === null) {
      setCodeError({ message: mfaText.badFormat });
      return;
    }
    setBusy(true);
    setCodeError(null);
    const r = await api("POST", "/api/app/auth/mfa", { body: { challenge: step.challenge, code } });
    setBusy(false);
    if (r.ok) {
      router.replace("/app/today");
      return;
    }
    const fail = mfaFailure(r, t("login.failed"), mfaText.wait);
    if (fail.kind === "restart") backToPassword(fail.message);
    else setCodeError({ message: fail.message });
  }

  if (step) {
    const secret = step.secret;
    const canCopy = secret !== undefined && typeof navigator !== "undefined" && "clipboard" in navigator;
    return (
      <MfaStepView
        base={ids.mfa}
        text={mfaText}
        step={step}
        error={codeError?.message ?? null}
        busy={busy}
        copied={copied}
        codeRef={codeRef}
        onSubmit={onCode}
        onBack={() => backToPassword(null)}
        {...(canCopy
          ? {
              onCopy: () =>
                void navigator.clipboard.writeText(secret).then(
                  () => setCopied(true),
                  () => undefined,
                ),
            }
          : {})}
      />
    );
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="card"
      aria-describedby={error ? "login-error" : undefined}
    >
      {error && (
        <p id="login-error" role="alert" className="err">
          {error}
        </p>
      )}
      <label className="field" htmlFor={ids.email}>
        {t("login.email")}
        <input
          ref={emailRef}
          id={ids.email}
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={email}
          required
        />
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
