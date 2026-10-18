// Thành phần biểu mẫu dùng chung: lỗi theo từng ô (aria-invalid + aria-describedby → phần tử lỗi), nút gửi khoá khi đang gửi.
// Logic thuần (zod issues → lỗi theo ô) tách khỏi JSX để test không cần trình duyệt (FE-FORM-002, FE-TEST-001).
import type { ReactNode } from "react";

export type FieldErrors = Record<string, string>;
export interface Issue {
  path: PropertyKey[] | string;
  message: string;
}

/** Tên trường API → tên ô nhập (null = không có ô tương ứng, đi vào lỗi chung). */
export type FieldMap = (apiPath: string, message: string) => string | null;

export function pathKey(path: Issue["path"]): string {
  return typeof path === "string" ? path : path.map(String).join(".");
}

/** Gom lỗi (zod issues hoặc `fields` của problem+json) thành { theo ô: thông điệp đầu tiên, chung: [...] }. */
export function toFieldErrors(
  issues: readonly Issue[],
  map: FieldMap = (p) => p,
): { fields: FieldErrors; general: string[] } {
  const fields: FieldErrors = {};
  const general: string[] = [];
  for (const i of issues) {
    const input = map(pathKey(i.path), i.message);
    if (input === null) general.push(i.message);
    else if (!(input in fields)) fields[input] = i.message;
  }
  return { fields, general };
}

export const errorId = (base: string, name: string) => `${base}-${name}-err`;

/** Thuộc tính ARIA cho ô nhập: chỉ gắn khi ô đang lỗi; `hintId` (gợi ý có sẵn) được giữ trong describedby. */
export function fieldA11y(base: string, name: string, errors: FieldErrors, hintId?: string) {
  const bad = errors[name] !== undefined;
  const describedBy = [bad ? errorId(base, name) : null, hintId ?? null].filter(Boolean).join(" ");
  return {
    ...(bad ? { "aria-invalid": true as const } : {}),
    ...(describedBy !== "" ? { "aria-describedby": describedBy } : {}),
  };
}

export function FieldError({ base, name, errors }: { base: string; name: string; errors: FieldErrors }) {
  const msg = errors[name];
  if (msg === undefined) return null;
  return (
    <span id={errorId(base, name)} className="field-error err">
      {msg}
    </span>
  );
}

/** Nút gửi: khoá + aria-busy khi đang gửi (UX-STATE-006). */
export function SubmitButton({
  busy,
  className,
  children,
  busyText,
}: {
  busy: boolean;
  className?: string;
  children: ReactNode;
  busyText?: string;
}) {
  return (
    <button type="submit" className={className} disabled={busy} aria-busy={busy}>
      {busy && busyText ? busyText : children}
    </button>
  );
}

/** Đưa focus vào ô lỗi đầu tiên của form sau khi render lại. */
export function focusFirstInvalid(form: HTMLFormElement): void {
  window.requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}
