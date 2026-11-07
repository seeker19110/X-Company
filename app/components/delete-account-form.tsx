"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n/client-app";
import { SELF_DELETE_CONFIRM } from "@/lib/privacy/self-delete.pure";
import { api } from "./api";
import { useConfirm } from "./confirm-dialog";
import {
  FieldError,
  fieldA11y,
  SubmitButton,
  textOrNull,
  toFieldErrors,
  useFocusFirstInvalid,
  type FieldErrors,
} from "./form-parts";
import { deleteUserDatabase } from "./offline/idb-store";
import { useSession } from "./session-context";

/** Lỗi kiểm phía client trước khi hỏi xác nhận: thiếu mật khẩu, gõ sai chuỗi xác nhận. Thuần để test không cần DOM. */
export function deleteAccountErrors(f: { password: string | null; confirm: string | null }): FieldErrors {
  const errors: FieldErrors = {};
  if (f.password === null) errors.password = t("accountDelete.passwordRequired");
  if (f.confirm?.trim() !== SELF_DELETE_CONFIRM) errors.confirm = t("accountDelete.confirmMismatch");
  return errors;
}

/**
 * Xoá tài khoản tự phục vụ (T-121, D-075): nhập lại mật khẩu (+ mã TOTP nếu đã bật) và gõ chuỗi xác nhận, rồi hộp thoại hỏi
 * lần cuối. Server xác thực lại và xoá trong một giao dịch; thành công → xoá dữ liệu thiết bị, về trang đăng nhập.
 */
export function DeleteAccountForm() {
  const { csrf, userId } = useSession();
  const router = useRouter();
  const base = useId();
  const focusFirstInvalid = useFocusFirstInvalid();
  const { ask, dialog } = useConfirm();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<{ text: string; cls: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending.current) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const password = textOrNull(data.get("password"));
    const totp = textOrNull(data.get("totp"));
    const confirm = textOrNull(data.get("confirm"));
    const bad = deleteAccountErrors({ password, confirm });
    setErrors(bad);
    if (Object.keys(bad).length > 0) {
      focusFirstInvalid(form);
      return;
    }
    const sure = await ask({
      title: t("accountDelete.dialogTitle"),
      object: t("accountDelete.dialogObject"),
      consequence: t("accountDelete.dialogConsequence"),
      confirmLabel: t("accountDelete.dialogConfirm"),
      cancelLabel: t("accountDelete.dialogCancel"),
    });
    if (!sure.confirmed) {
      setMsg({ text: t("accountDelete.cancelled"), cls: "" });
      return;
    }
    sending.current = true;
    setBusy(true);
    const r = await api("POST", "/api/app/me/delete", {
      csrf,
      body: { password, totp, confirm: confirm?.trim() },
    });
    sending.current = false;
    setBusy(false);
    if (r.ok) {
      await deleteUserDatabase(userId);
      navigator.serviceWorker?.controller?.postMessage({ type: "logout" });
      router.replace("/app/login");
      return;
    }
    if (r.fields !== undefined && r.fields.length > 0) {
      setErrors(toFieldErrors(r.fields).fields);
      focusFirstInvalid(form);
    }
    setMsg({ text: r.error ?? t("common.sendFailed"), cls: "err" });
  }

  return (
    <>
      <form
        method="post"
        className="card"
        noValidate
        aria-labelledby={`${base}-h`}
        onSubmit={(e) => void submit(e)}
      >
        <h2 id={`${base}-h`}>{t("accountDelete.heading")}</h2>
        <p>{t("accountDelete.intro")}</p>
        <label className="field">
          {t("accountDelete.password")}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            {...fieldA11y(base, "password", errors)}
          />
        </label>
        <FieldError base={base} name="password" errors={errors} />
        <label className="field">
          {t("accountDelete.totp")}
          <input
            name="totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={16}
            {...fieldA11y(base, "totp", errors)}
          />
        </label>
        <FieldError base={base} name="totp" errors={errors} />
        <label className="field">
          {t("accountDelete.confirmLabel", { phrase: SELF_DELETE_CONFIRM })}
          <input name="confirm" autoComplete="off" required {...fieldA11y(base, "confirm", errors)} />
        </label>
        <FieldError base={base} name="confirm" errors={errors} />
        <SubmitButton className="btn" busy={busy} busyText={t("accountDelete.busy")}>
          {t("accountDelete.submit")}
        </SubmitButton>
        <p role="status" tabIndex={-1} className={msg?.cls}>
          {msg?.text}
        </p>
      </form>
      {dialog}
    </>
  );
}
