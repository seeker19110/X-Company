"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { API_FETCH_TIMEOUT_MS } from "@/lib/nen/timeouts";
import { textOrNull } from "./api";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; code: string }
  | { kind: "error"; message: string; fields?: Record<string, string> };

/** Biểu mẫu liên hệ (SPEC-website-cms): submission_id sinh khi mở form → gửi lại không tạo hồ sơ trùng. */
export function ContactForm() {
  const ids = {
    name: useId(),
    email: useId(),
    phone: useId(),
    message: useId(),
    consent: useId(),
    hp: useId(),
  };
  const [state, setState] = useState<State>({ kind: "idle" });
  const submissionId = useRef<string>("");
  const openedAt = useRef<number>(0);
  useEffect(() => {
    submissionId.current = crypto.randomUUID();
    openedAt.current = Date.now();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/public/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          submission_id: submissionId.current,
          name: f.get("name"),
          email: textOrNull(f.get("email")),
          phone: textOrNull(f.get("phone")),
          message: f.get("message"),
          consent: f.get("consent") === "on",
          website: textOrNull(f.get("website")) ?? "",
          elapsed_ms: Date.now() - openedAt.current,
          source: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
        }),
      });
      const body = await res.json();
      if (res.ok) setState({ kind: "done", code: body.code });
      else {
        const fields: Record<string, string> = {};
        for (const i of body?.error?.details?.issues ?? []) fields[i.path] = i.message;
        setState({ kind: "error", message: body?.error?.message ?? "Gửi không thành công", fields });
      }
    } catch {
      setState({
        kind: "error",
        message: "Không kết nối được. Nội dung vẫn còn trên form, vui lòng gửi lại.",
      });
    }
  }

  if (state.kind === "done") {
    return (
      <p role="status">
        Cảm ơn bạn. Mã yêu cầu: <strong>{state.code}</strong>. Chúng tôi sẽ liên hệ trong 1 ngày làm việc.
      </p>
    );
  }

  const err = state.kind === "error" ? state : null;
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-describedby={err ? "form-error" : undefined}
      className="contact-form"
    >
      <h2>Gửi yêu cầu</h2>
      {err && (
        <p id="form-error" role="alert" className="form-error">
          {err.message}
        </p>
      )}
      <p>
        <label htmlFor={ids.name}>Họ tên (bắt buộc)</label>
        <br />
        <input id={ids.name} name="name" required maxLength={120} autoComplete="name" />
      </p>
      <p>
        <label htmlFor={ids.email}>Email</label>
        <br />
        <input id={ids.email} name="email" type="email" maxLength={254} autoComplete="email" />
      </p>
      <p>
        <label htmlFor={ids.phone}>Điện thoại</label>
        <br />
        <input id={ids.phone} name="phone" type="tel" maxLength={20} autoComplete="tel" />
        <br />
        <small className="muted">Cần ít nhất email hoặc điện thoại.</small>
      </p>
      <p>
        <label htmlFor={ids.message}>Nhu cầu (bắt buộc)</label>
        <br />
        <textarea id={ids.message} name="message" required maxLength={4000} rows={6} />
      </p>
      <p className="hp" aria-hidden="true">
        <label htmlFor={ids.hp}>Để trống ô này</label>
        <input id={ids.hp} name="website" tabIndex={-1} autoComplete="off" />
      </p>
      <p>
        <input id={ids.consent} name="consent" type="checkbox" required />{" "}
        <label htmlFor={ids.consent}>
          Tôi đồng ý để X-Company xử lý thông tin trên nhằm phản hồi yêu cầu, theo{" "}
          <Link href="/chinh-sach-du-lieu">chính sách dữ liệu cá nhân</Link>.
        </label>
      </p>
      <button type="submit" disabled={state.kind === "sending"} aria-busy={state.kind === "sending"}>
        {state.kind === "sending" ? "Đang gửi…" : "Gửi yêu cầu"}
      </button>
    </form>
  );
}
