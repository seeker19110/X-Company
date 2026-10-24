// Bước hai của đăng nhập (AUD-SEC-002, T-087): nhập mã TOTP 6 số; lần đầu với vai trò bắt buộc thì kèm phần đăng ký
// (khoá thiết lập theo nhóm 4 ký tự + liên kết otpauth://). Không có QR: tự vẽ QR cần bộ mã hoá Reed-Solomon/mặt nạ
// (vài KB gzip) — vượt ngân sách JS tĩnh (perf-budget.json); không gọi dịch vụ QR ngoài (lộ bí mật). Khoá + URI đủ cho P0.
// Logic thuần tách khỏi JSX để test bằng renderToStaticMarkup (FE-TEST-001).
// Chuỗi (messages/vi.app.json `mfa.*`) do trang server dịch rồi truyền xuống (`MfaText`): không nhúng cả vi.app.json vào
// JS của trang đăng nhập (ngân sách JS tĩnh, FE-PERF-004).
import type { FormEvent, Ref } from "react";
import { errorId } from "@/app/components/form-parts";

/** Phản hồi thử thách của POST /api/app/auth/login (docs/api/openapi.json). */
export interface MfaChallenge {
  mfa: "totp" | "totp_enroll";
  challenge: string;
  secret?: string;
  otpauth_uri?: string;
}

export function isMfaChallenge(d: unknown): d is MfaChallenge {
  const x = d as Partial<MfaChallenge> | null;
  return (
    typeof x === "object" &&
    x !== null &&
    (x.mfa === "totp" || x.mfa === "totp_enroll") &&
    typeof x.challenge === "string"
  );
}

/** Khoá base32 theo nhóm 4 ký tự cho dễ gõ tay ("JBSW Y3DP …"). */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(" ");
}

/** Mã người dùng gõ: bỏ khoảng trắng; đúng 6 chữ số ASCII → chuỗi, ngược lại null (khớp normalizeCode phía server). */
export function codeOrNull(v: FormDataEntryValue | null): string | null {
  const c = typeof v === "string" ? v.replace(/\s+/g, "") : "";
  return /^[0-9]{6}$/.test(c) ? c : null;
}

/** Chuỗi của bước mã, dịch sẵn ở server (app/app/login/page.tsx). `wait` là mẫu còn chỗ `{minutes}`. */
export interface MfaText {
  heading: string;
  intro: string;
  code: string;
  submit: string;
  submitting: string;
  back: string;
  badFormat: string;
  wait: string;
  enrollHeading: string;
  enrollIntro: string;
  enrollOpen: string;
  enrollManual: string;
  copy: string;
  copied: string;
  enrollDone: string;
}

/** Thông điệp lỗi kèm thời gian chờ khi 429 có Retry-After (giây → phút, làm tròn lên). */
export function withWait(message: string, waitTemplate: string, retryAfter?: number): string {
  if (retryAfter === undefined || !(retryAfter > 0)) return message;
  const wait = waitTemplate.replace("{minutes}", String(Math.ceil(retryAfter / 60)));
  return `${message.replace(/[.\s]+$/, "")}. ${wait}`;
}

/**
 * Lỗi của POST /api/app/auth/mfa → việc giao diện làm: thử thách không còn dùng được (hết hạn/đã dùng/sai 5 lần) →
 * về bước mật khẩu với thông báo; còn lại (mã sai, 429, mạng) → lỗi theo ô mã, ở lại bước mã.
 */
export function mfaFailure(
  r: { code?: string; error?: string; retryAfter?: number },
  fallback: string,
  waitTemplate: string,
) {
  const message = withWait(r.error ?? fallback, waitTemplate, r.retryAfter);
  return r.code === "MFA_CHALLENGE_INVALID"
    ? ({ kind: "restart", message } as const)
    : ({ kind: "field", message } as const);
}

export interface MfaStepProps {
  base: string;
  text: MfaText;
  step: MfaChallenge;
  error: string | null;
  busy: boolean;
  copied?: boolean;
  codeRef?: Ref<HTMLInputElement>;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  onBack?: () => void;
  /** Chỉ truyền khi trình duyệt có Clipboard API. */
  onCopy?: () => void;
}

export function MfaStepView({
  base,
  text,
  step,
  error,
  busy,
  copied,
  codeRef,
  onSubmit,
  onBack,
  onCopy,
}: MfaStepProps) {
  const enroll =
    step.mfa === "totp_enroll" && step.secret !== undefined && step.secret !== "" ? step.secret : null;
  const hintId = `${base}-hint`;
  const errId = errorId(base, "code");
  return (
    <form method="post" onSubmit={onSubmit} className="card" noValidate aria-labelledby={`${base}-h`}>
      <h2 id={`${base}-h`}>{text.heading}</h2>
      {enroll && (
        <section aria-labelledby={`${base}-eh`}>
          <h3 id={`${base}-eh`}>{text.enrollHeading}</h3>
          <p>{text.enrollIntro}</p>
          {step.otpauth_uri && (
            <p>
              <a href={step.otpauth_uri}>{text.enrollOpen}</a>
            </p>
          )}
          <p>{text.enrollManual}</p>
          <p className="row">
            <code className="secret">{groupSecret(enroll)}</code>
            {onCopy && (
              <button type="button" className="btn" onClick={onCopy}>
                {text.copy}
              </button>
            )}
            <span role="status" className="muted">
              {copied ? text.copied : ""}
            </span>
          </p>
          <p>{text.enrollDone}</p>
        </section>
      )}
      {!enroll && <p id={hintId}>{text.intro}</p>}
      <label className="field" htmlFor={`${base}-code`}>
        {text.code}
        <input
          ref={codeRef}
          id={`${base}-code`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          {...(error !== null ? { "aria-invalid": true as const } : {})}
          aria-describedby={
            enroll === null
              ? [error !== null ? errId : "", hintId].join(" ").trim()
              : error !== null
                ? errId
                : undefined
          }
        />
      </label>
      {error !== null && (
        <p id={errId} className="field-error err" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? text.submitting : text.submit}
        </button>
        <button className="btn" type="button" onClick={onBack}>
          {text.back}
        </button>
      </div>
    </form>
  );
}
