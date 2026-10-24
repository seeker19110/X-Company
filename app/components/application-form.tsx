"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n/client-site";
import { API_FETCH_TIMEOUT_MS } from "@/lib/nen/timeouts";
import {
  FieldError,
  fieldA11y,
  useFocusFirstInvalid,
  SubmitButton,
  textOrNull,
  toFieldErrors,
  type FieldErrors,
} from "./form-parts";
import { intakeResult, type IntakeState } from "./intake-form";

export type ApplicationState = IntakeState;

/** Ô nhập thật của form; lỗi ở trường khác (job_slug, submission_id…) chỉ hiện ở thông báo chung. */
const INPUTS: ReadonlySet<string> = new Set([
  "name",
  "email",
  "phone",
  "cover_letter",
  "consent",
  "talent_pool",
]);
const toInput = (path: string) => (INPUTS.has(path) ? path : null);

/** Phản hồi của POST /api/public/applications → trạng thái form. */
export const applicationResult = (status: number, text: string): ApplicationState =>
  intakeResult(status, text, INPUTS);

/**
 * Biểu mẫu ứng tuyển (F-003): `jobSlug` = vị trí đang xem, null = ứng tuyển chung. submission_id sinh khi mở form →
 * gửi lại không tạo hồ sơ trùng. Đồng ý "kho nhân tài" là ô RIÊNG, không tích sẵn (D-030).
 */
export function ApplicationForm({ jobSlug }: { jobSlug: string | null }) {
  const base = useId();
  const [state, setState] = useState<ApplicationState>({ kind: "idle" });
  const focusFirstInvalid = useFocusFirstInvalid();
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
      job_slug: jobSlug,
      name: f.get("name"),
      email: textOrNull(f.get("email")),
      phone: textOrNull(f.get("phone")),
      cover_letter: textOrNull(f.get("cover_letter")),
      consent: f.get("consent") === "on",
      talent_pool: f.get("talent_pool") === "on",
      website: textOrNull(f.get("website")) ?? "",
      elapsed_ms: Date.now() - openedAt.current,
    };
    // Cùng schema với server (lib/inquiry/schema.pure.ts); nạp động lúc gửi để zod không vào JS tải đầu (FE-PERF-004).
    const schema = await import("@/lib/inquiry/schema.pure")
      .then((m) => m.ApplicationInput)
      .catch(() => null);
    const parsed = schema?.safeParse(payload);
    if (parsed && !parsed.success) {
      const { fields } = toFieldErrors(parsed.error.issues, toInput);
      setState({ kind: "error", message: t("common.checkMarkedFields"), fields });
      focusFirstInvalid(form);
      return;
    }
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/public/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
        body: JSON.stringify(payload),
      });
      const next = applicationResult(res.status, await res.text());
      setState(next);
      if (next.kind === "error") focusFirstInvalid(form);
    } catch {
      setState({ kind: "error", message: t("contact.offline"), fields: {} });
    }
  }

  return <ApplicationFormView base={base} jobSlug={jobSlug} state={state} onSubmit={onSubmit} />;
}

/** Phần hiển thị thuần (test được bằng renderToStaticMarkup — FE-TEST-001). */
export function ApplicationFormView({
  base,
  jobSlug,
  state,
  onSubmit,
}: {
  base: string;
  jobSlug: string | null;
  state: ApplicationState;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const id = (n: string) => `${base}-${n}`;
  if (state.kind === "done") {
    return (
      <p role="status">
        {t("apply.thanksPrefix")}
        <strong>{state.code}</strong>
        {t("apply.thanksSuffix")}
      </p>
    );
  }
  const err = state.kind === "error" ? state : null;
  const errors: FieldErrors = err?.fields ?? {};
  const sending = state.kind === "sending";
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      aria-describedby={err ? `${base}-form-error` : undefined}
      className="contact-form"
    >
      <h2>{jobSlug ? t("apply.heading") : t("apply.headingGeneral")}</h2>
      {err && (
        <p id={`${base}-form-error`} role="alert" className="form-error">
          {err.message}
        </p>
      )}
      <p>
        <label htmlFor={id("name")}>{t("apply.name")}</label>
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
        <label htmlFor={id("email")}>{t("apply.email")}</label>
        <br />
        <input
          id={id("email")}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          {...fieldA11y(base, "email", errors)}
        />
        <FieldError base={base} name="email" errors={errors} />
      </p>
      <p>
        <label htmlFor={id("phone")}>{t("apply.phone")}</label>
        <br />
        <input
          id={id("phone")}
          name="phone"
          type="tel"
          maxLength={20}
          autoComplete="tel"
          {...fieldA11y(base, "phone", errors)}
        />
        <FieldError base={base} name="phone" errors={errors} />
      </p>
      <p>
        <label htmlFor={id("cover_letter")}>{t("apply.coverLetter")}</label>
        <br />
        <textarea
          id={id("cover_letter")}
          name="cover_letter"
          maxLength={8000}
          rows={6}
          {...fieldA11y(base, "cover_letter", errors)}
        />
        <FieldError base={base} name="cover_letter" errors={errors} />
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
          {t("apply.consent")}
          <Link href="/chinh-sach-du-lieu">{t("contact.consentLink")}</Link>.
        </label>
        <FieldError base={base} name="consent" errors={errors} />
      </p>
      <p>
        <input
          id={id("talent_pool")}
          name="talent_pool"
          type="checkbox"
          {...fieldA11y(base, "talent_pool", errors)}
        />{" "}
        <label htmlFor={id("talent_pool")}>{t("apply.talentPool")}</label>
        <FieldError base={base} name="talent_pool" errors={errors} />
      </p>
      <SubmitButton busy={sending} busyText={t("contact.submitting")}>
        {t("apply.submit")}
      </SubmitButton>
    </form>
  );
}
