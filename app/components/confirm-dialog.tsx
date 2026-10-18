"use client";

// Hộp thoại xác nhận riêng (UX-STATE-008) thay window.confirm/prompt: <dialog> + showModal() — phần còn lại của trang bị
// vô hiệu (focus không thoát ra ngoài), Esc = huỷ, focus trả về nút đã mở; nút ghi đúng động từ, nêu đối tượng và hậu quả.
// Cần lý do (từ chối, trả lại…) → ô nhập có nhãn, bắt buộc không rỗng.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";

export interface ConfirmRequest {
  /** Câu hỏi ngắn, vd. "Từ chối đơn?" */
  title: string;
  /** Đối tượng bị tác động (tên việc, tên người gửi…) — in đậm. */
  object?: string;
  /** Hậu quả nói rõ, vd. "Không thể hoàn tác." */
  consequence?: string;
  /** Động từ trên nút xác nhận, vd. "Từ chối đơn" (không dùng "OK"). */
  confirmLabel: string;
  cancelLabel?: string;
  /** Có giá trị → hiện ô nhập lý do với nhãn này, bắt buộc không rỗng. */
  reasonLabel?: string;
  /** Khoá nội bộ để đặt lại state khi mở yêu cầu mới. */
  id?: number;
}
export interface ConfirmResult {
  confirmed: boolean;
  reason?: string;
}

/** Lý do hợp lệ = không rỗng sau khi bỏ khoảng trắng. Trả thông điệp lỗi hoặc null. */
export function reasonError(reason: string): string | null {
  return reason.trim() === "" ? "Vui lòng nhập lý do." : null;
}

/** Quyết định khi bấm nút xác nhận: cần lý do mà rỗng → báo lỗi, không đóng; ngược lại trả kết quả. */
export function resolveConfirm(
  needsReason: boolean,
  reason: string,
): { error: string } | { result: ConfirmResult } {
  if (!needsReason) return { result: { confirmed: true } };
  const bad = reasonError(reason);
  return bad ? { error: bad } : { result: { confirmed: true, reason: reason.trim() } };
}

/** Esc (sự kiện "cancel" của <dialog>) = huỷ: chặn đóng mặc định để React điều khiển, không thực hiện hành động. */
export function escapeCancels(onResult: (r: ConfirmResult) => void) {
  return (e: { preventDefault: () => void }) => {
    e.preventDefault();
    onResult({ confirmed: false });
  };
}

export function ConfirmDialog({
  request,
  onResult,
}: {
  request: ConfirmRequest | null;
  onResult: (r: ConfirmResult) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (request && !el.open && typeof el.showModal === "function") el.showModal();
    if (!request && el.open) el.close();
  }, [request]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby={`${uid}-t`}
      aria-describedby={`${uid}-d`}
      // Esc: trình duyệt phát "cancel" — huỷ, không thực hiện hành động.
      onCancel={escapeCancels(onResult)}
    >
      {request && (
        <ConfirmBody key={request.id ?? request.title} uid={uid} request={request} onResult={onResult} />
      )}
    </dialog>
  );
}

export function ConfirmBody({
  uid,
  request,
  onResult,
}: {
  uid: string;
  request: ConfirmRequest;
  onResult: (r: ConfirmResult) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const needsReason = request.reasonLabel !== undefined;

  function submit(e: FormEvent) {
    e.preventDefault();
    const r = resolveConfirm(needsReason, reason);
    if ("error" in r) {
      setError(r.error);
      reasonRef.current?.focus();
      return;
    }
    onResult(r.result);
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2 id={`${uid}-t`}>{request.title}</h2>
      <p id={`${uid}-d`}>
        {request.object && <strong>{request.object}</strong>}
        {request.object && request.consequence ? " — " : null}
        {request.consequence}
      </p>
      {needsReason && (
        <p>
          <label htmlFor={`${uid}-r`}>{request.reasonLabel}</label>
          <br />
          <textarea
            id={`${uid}-r`}
            ref={reasonRef}
            required
            maxLength={1000}
            rows={3}
            value={reason}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${uid}-e` : undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <span id={`${uid}-e`} className="field-error err">
              {error}
            </span>
          )}
        </p>
      )}
      <div className="row">
        {/* Huỷ là nút được focus mặc định khi không có ô lý do (hành động an toàn trước). */}
        <button
          type="button"
          className="btn"
          autoFocus={!needsReason}
          onClick={() => onResult({ confirmed: false })}
        >
          {request.cancelLabel ?? "Huỷ"}
        </button>
        <button type="submit" className="btn btn-primary">
          {request.confirmLabel}
        </button>
      </div>
    </form>
  );
}

/** Dùng: const { ask, dialog } = useConfirm(); … if (!(await ask({...})).confirmed) return; … render {dialog}. */
export function useConfirm(): {
  ask: (r: ConfirmRequest) => Promise<ConfirmResult>;
  dialog: ReactElement;
} {
  const [pending, setPending] = useState<{ req: ConfirmRequest; resolve: (r: ConfirmResult) => void } | null>(
    null,
  );
  const seq = useRef(0);
  const ask = useCallback(
    (req: ConfirmRequest) =>
      new Promise<ConfirmResult>((resolve) => {
        seq.current += 1;
        setPending({ req: { ...req, id: seq.current }, resolve });
      }),
    [],
  );
  const onResult = useCallback(
    (r: ConfirmResult) => {
      pending?.resolve(r);
      setPending(null);
    },
    [pending],
  );
  return { ask, dialog: <ConfirmDialog request={pending?.req ?? null} onResult={onResult} /> };
}
