"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { api, textOrNull } from "./api";
import { useSession } from "./session-context";

/** Đơn nghỉ, OT (đồng ý làm thêm ghi riêng), đề nghị sửa công — luôn có lý do. */
export function RequestForms({ leaveTypes }: { leaveTypes: { id: string; name: string }[] }) {
  const { csrf } = useSession();
  const id = useId();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // chặn bấm đúp trước khi React kịp vô hiệu nút (UX-STATE-006)
  const [msg, setMsg] = useState<{ text: string; cls: string } | null>(null);
  const vnIso = (d: string, t: string) => `${d}T${t}:00+07:00`;

  async function send(e: FormEvent<HTMLFormElement>, path: string, build: (f: FormData) => unknown) {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const form = e.currentTarget;
    const r = await api("POST", path, { csrf, body: build(new FormData(form)) });
    sending.current = false;
    setBusy(false);
    setMsg(
      r.ok
        ? { text: "Đã gửi đơn, chờ duyệt.", cls: "ok" }
        : { text: r.error ?? "Gửi không thành công", cls: "err" },
    );
    if (r.ok) form.reset();
  }

  return (
    <>
      <p role="status" aria-live="polite" className={msg?.cls}>
        {msg?.text}
      </p>
      <form
        className="card"
        aria-labelledby={`${id}-l`}
        onSubmit={(e) =>
          send(e, "/api/app/leave-requests", (f) => ({
            leave_type_id: f.get("type"),
            start_at: vnIso(String(f.get("date")), String(f.get("from"))),
            end_at: vnIso(String(f.get("date")), String(f.get("to"))),
            minutes: Number(f.get("minutes")),
            reason: textOrNull(f.get("reason")),
          }))
        }
      >
        <h2 id={`${id}-l`}>Xin nghỉ</h2>
        <label className="field">
          Loại nghỉ
          <select name="type" required>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Ngày
          <input name="date" type="date" required />
        </label>
        <div className="row">
          <label className="field">
            Từ
            <input name="from" type="time" defaultValue="08:00" required />
          </label>
          <label className="field">
            Đến
            <input name="to" type="time" defaultValue="17:00" required />
          </label>
          <label className="field">
            Số phút làm việc nghỉ
            <input name="minutes" type="number" min={1} defaultValue={480} required />
          </label>
        </div>
        <label className="field">
          Lý do
          <textarea name="reason" maxLength={1000} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          Gửi đơn nghỉ
        </button>
      </form>
      <form
        className="card"
        aria-labelledby={`${id}-o`}
        onSubmit={(e) =>
          send(e, "/api/app/ot-requests", (f) => ({
            business_date: f.get("date"),
            minutes: Number(f.get("minutes")),
            reason: f.get("reason"),
            consent: f.get("consent") === "on",
          }))
        }
      >
        <h2 id={`${id}-o`}>Làm thêm giờ</h2>
        <label className="field">
          Ngày
          <input name="date" type="date" required />
        </label>
        <label className="field">
          Số phút
          <input name="minutes" type="number" min={1} max={720} defaultValue={120} required />
        </label>
        <label className="field">
          Lý do
          <textarea name="reason" maxLength={1000} required />
        </label>
        <label>
          <input name="consent" type="checkbox" required /> Tôi đồng ý làm thêm giờ theo đề nghị này
        </label>
        <p>
          <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
            Gửi đơn OT
          </button>
        </p>
      </form>
      <form
        className="card"
        aria-labelledby={`${id}-s`}
        onSubmit={(e) =>
          send(e, "/api/app/adjustments", (f) => ({
            action: "add_event",
            new_kind: f.get("kind"),
            new_at: vnIso(String(f.get("date")), String(f.get("time"))),
            reason: f.get("reason"),
          }))
        }
      >
        <h2 id={`${id}-s`}>Đề nghị sửa công (quên chấm)</h2>
        <label className="field">
          Loại
          <select name="kind">
            <option value="in">Vào ca</option>
            <option value="out">Ra ca</option>
          </select>
        </label>
        <div className="row">
          <label className="field">
            Ngày
            <input name="date" type="date" required />
          </label>
          <label className="field">
            Giờ
            <input name="time" type="time" required />
          </label>
        </div>
        <label className="field">
          Lý do (bắt buộc)
          <textarea name="reason" maxLength={1000} required />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          Gửi đề nghị
        </button>
      </form>
    </>
  );
}
