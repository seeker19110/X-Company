"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n/client-site";
import { API_FETCH_TIMEOUT_MS } from "@/lib/nen/timeouts";
import { textOrNull } from "./api";
import {
  FieldError,
  fieldA11y,
  focusFirstInvalid,
  SubmitButton,
  toFieldErrors,
  type FieldErrors,
} from "./form-parts";

export type ContactState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; code: string }
  | { kind: "error"; message: string; fields: FieldErrors };

/** Ô nhập thật của form; lỗi ở trường khác (vd. submission_id) chỉ hiện ở thông báo chung. */
const INPUTS = new Set(["name", "email", "phone", "message", "consent"]);
const toInput = (path: string) => (INPUTS.has(path) ? path : null);

/** Biểu mẫu liên hệ (SPEC-website-cms): submission_id sinh khi mở form → gửi lại không tạo hồ sơ trùng. */
export function ContactForm() {
  const base = useId();
  const [state, setState] = useState<ContactState>({ kind: "idle" });
  const submissionId = useRef<string>("");
  const openedAt = useRef<number>(0);
  useEffect(() => {
    submissionId.current = crypto.randomUUID();
    openedAt.current = Date.now();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const payload = {
      submission_id: submissionId.current,
      name: f.get("name"),
      email: textOrNull(f.get("email")),
      phone: textOrNull(f.get("phone")),
      message: f.get("message"),
      consent: f.get("consent") === "on",
      website: textOrNull(f.get("website")) ?? "",
      elapsed_ms: Date.now() - openedAt.current,
      source: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
    };
    // Cùng schema với server (lib/inquiry/schema.pure.ts): sai thì báo theo ô, không gửi. Nạp động lúc gửi để zod
    // không vào JS tải đầu của trang công khai (FE-PERF-004); nạp lỗi (mất mạng) → bỏ kiểm phía client, server vẫn kiểm.
    const schema = await import("@/lib/inquiry/schema.pure").then((m) => m.InquiryInput).catch(() => null);
    const parsed = schema?.safeParse(payload);
    if (parsed && !parsed.success) {
      const { fields } = toFieldErrors(parsed.error.issues, toInput);
      setState({ kind: "error", message: t("common.checkMarkedFields"), fields });
      focusFirstInvalid(form);
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/public/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (res.ok) setState({ kind: "done", code: body.code });
      else {
        const { fields } = toFieldErrors(Array.isArray(body?.fields) ? body.fields : [], toInput);
        setState({ kind: "error", message: body?.error?.message ?? t("common.sendFailed"), fields });
        focusFirstInvalid(form);
      }
    } catch {
      setState({
        kind: "error",
        message: t("contact.offline"),
        fields: {},
      });
    }
  }

  return <ContactFormView base={base} state={state} onSubmit={onSubmit} />;
}

/** Phần hiển thị thuần (test được bằng renderToStaticMarkup — FE-TEST-001). */
export function ContactFormView({
  base,
  state,
  onSubmit,
}: {
  base: string;
  state: ContactState;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const id = (n: string) => `${base}-${n}`;
  if (state.kind === "done") {
    return (
      <p role="status">
        {t("contact.thanksPrefix")}
        <strong>{state.code}</strong>
        {t("contact.thanksSuffix")}
      </p>
    );
  }
  const err = state.kind === "error" ? state : null;
  const errors: FieldErrors = err?.fields ?? {};
  const sending = state.kind === "sending";
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-describedby={err ? `${base}-form-error` : undefined}
      className="contact-form"
    >
      <h2>{t("contact.heading")}</h2>
      {err && (
        <p id={`${base}-form-error`} role="alert" className="form-error">
          {err.message}
        </p>
      )}
      <p>
        <label htmlFor={id("name")}>{t("contact.name")}</label>
        <br />
        <input
          id={id("name")}
          name="name"
          required
          maxLength={120}
          autoComplete="name"
          {...fieldA11y(base, "name", errors)}
        />
        <FieldError base={base} name="name" errors={errors} />
      </p>
      <p>
        <label htmlFor={id("email")}>{t("contact.email")}</label>
        <br />
        <input
          id={id("email")}
          name="email"
          type="email"
          maxLength={254}
          autoComplete="email"
          {...fieldA11y(base, "email", errors)}
        />
        <FieldError base={base} name="email" errors={errors} />
      </p>
      <p>
        <label htmlFor={id("phone")}>{t("contact.phone")}</label>
        <br />
        <input
          id={id("phone")}
          name="phone"
          type="tel"
          maxLength={20}
          autoComplete="tel"
          {...fieldA11y(base, "phone", errors, id("phone-hint"))}
        />
        <FieldError base={base} name="phone" errors={errors} />
        <br />
        <small id={id("phone-hint")} className="muted">
          {t("contact.phoneHint")}
        </small>
      </p>
      <p>
        <label htmlFor={id("message")}>{t("contact.message")}</label>
        <br />
        <textarea
          id={id("message")}
          name="message"
          required
          maxLength={4000}
          rows={6}
          {...fieldA11y(base, "message", errors)}
        />
        <FieldError base={base} name="message" errors={errors} />
      </p>
      <p className="hp" aria-hidden="true">
        <label htmlFor={id("hp")}>{t("contact.honeypot")}</label>
        <input id={id("hp")} name="website" tabIndex={-1} autoComplete="off" />
      </p>
      <p>
        <input
          id={id("consent")}
          name="consent"
          type="checkbox"
          required
          {...fieldA11y(base, "consent", errors)}
        />{" "}
        <label htmlFor={id("consent")}>
          {t("contact.consent")}
          <Link href="/chinh-sach-du-lieu">{t("contact.consentLink")}</Link>.
        </label>
        <FieldError base={base} name="consent" errors={errors} />
      </p>
      <SubmitButton busy={sending} busyText={t("contact.submitting")}>
        {t("contact.submit")}
      </SubmitButton>
    </form>
  );
}
