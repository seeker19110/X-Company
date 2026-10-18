"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type * as RequestSchemas from "@/lib/attendance/request-schema.pure";
import { api, textOrNull } from "./api";
import {
  FieldError,
  fieldA11y,
  focusFirstInvalid,
  SubmitButton,
  toFieldErrors,
  type FieldErrors,
  type FieldMap,
} from "./form-parts";
import { useSession } from "./session-context";

type FormKey = "leave" | "ot" | "adj";
const vnIso = (d: string, t: string) => `${d}T${t}:00+07:00`;

type SchemaName = "LeaveFormInput" | "OtFormInput" | "AdjustmentInput";
/** Schema dùng chung với server, nạp động lúc gửi để zod không vào JS tải đầu (FE-PERF-004); nạp lỗi (mất mạng)
 *  → null: bỏ kiểm phía client, server vẫn kiểm và trả `fields`. */
const loadSchema = (name: SchemaName): Promise<(typeof RequestSchemas)[SchemaName] | null> =>
  import("@/lib/attendance/request-schema.pure").then((m) => m[name]).catch(() => null);

/** Tên trường API → tên ô nhập của từng form (lỗi giờ gắn vào ô ngày khi ngày trống, vào ô giờ khi đã có ngày). */
export function leaveMap(f: FormData): FieldMap {
  return (p) => {
    if (p === "leave_type_id") return "type";
    if (p === "start_at") return "date";
    if (p === "end_at") return textOrNull(f.get("date")) !== null ? "to" : "date";
    if (p === "minutes" || p === "reason") return p;
    return null;
  };
}
export const otMap: FieldMap = (p) =>
  ({ business_date: "date", minutes: "minutes", reason: "reason", consent: "consent" })[p] ?? null;
export function adjMap(f: FormData): FieldMap {
  return (p) => {
    if (p === "new_at") return textOrNull(f.get("date")) !== null ? "time" : "date";
    if (p === "reason") return "reason";
    if (p === "new_kind") return "kind";
    return null;
  };
}

/** Đơn nghỉ, OT (đồng ý làm thêm ghi riêng), đề nghị sửa công — luôn có lý do. */
export function RequestForms({ leaveTypes }: { leaveTypes: { id: string; name: string }[] }) {
  const { csrf } = useSession();
  const base = useId();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false); // chặn bấm đúp trước khi React kịp vô hiệu nút (UX-STATE-006)
  const [msg, setMsg] = useState<{ text: string; cls: string } | null>(null);
  const [errors, setErrors] = useState<Record<FormKey, FieldErrors>>({ leave: {}, ot: {}, adj: {} });
  const setFormErrors = (k: FormKey, e: FieldErrors) => setErrors((all) => ({ ...all, [k]: e }));

  /** Kiểm bằng cùng schema với server → gửi → lỗi server (`fields`) map về đúng ô. */
  async function send(
    e: FormEvent<HTMLFormElement>,
    key: FormKey,
    path: string,
    schema: SchemaName,
    build: (f: FormData) => unknown,
    mapFor: (f: FormData) => FieldMap,
  ) {
    e.preventDefault();
    if (sending.current) return;
    sending.current = true;
    const form = e.currentTarget;
    const data = new FormData(form);
    const body = build(data);
    const map = mapFor(data);
    const parsed = (await loadSchema(schema))?.safeParse(body);
    if (parsed && !parsed.success) {
      sending.current = false;
      const { fields, general } = toFieldErrors(parsed.error.issues, map);
      setFormErrors(key, fields);
      setMsg({ text: general[0] ?? "Vui lòng kiểm tra các ô được đánh dấu.", cls: "err" });
      focusFirstInvalid(form);
      return;
    }
    setFormErrors(key, {});
    setBusy(true);
    const r = await api("POST", path, { csrf, body });
    sending.current = false;
    setBusy(false);
    if (!r.ok && r.fields !== undefined && r.fields.length > 0) {
      setFormErrors(key, toFieldErrors(r.fields, map).fields);
      focusFirstInvalid(form);
    }
    setMsg(
      r.ok
        ? { text: "Đã gửi đơn, chờ duyệt.", cls: "ok" }
        : { text: r.error ?? "Gửi không thành công", cls: "err" },
    );
    if (r.ok) form.reset();
  }

  const L = errors.leave;
  const O = errors.ot;
  const A = errors.adj;
  const lb = `${base}-l`;
  const ob = `${base}-o`;
  const ab = `${base}-a`;
  return (
    <>
      <p role="status" aria-live="polite" className={msg?.cls}>
        {msg?.text}
      </p>
      <form
        className="card"
        noValidate
        aria-labelledby={`${lb}-h`}
        onSubmit={(e) =>
          send(
            e,
            "leave",
            "/api/app/leave-requests",
            "LeaveFormInput",
            (f) => ({
              leave_type_id: f.get("type"),
              start_at: vnIso(String(f.get("date")), String(f.get("from"))),
              end_at: vnIso(String(f.get("date")), String(f.get("to"))),
              minutes: Number(f.get("minutes")),
              reason: textOrNull(f.get("reason")),
            }),
            leaveMap,
          )
        }
      >
        <h2 id={`${lb}-h`}>Xin nghỉ</h2>
        <label className="field">
          Loại nghỉ
          <select name="type" required {...fieldA11y(lb, "type", L)}>
            {leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <FieldError base={lb} name="type" errors={L} />
        <label className="field">
          Ngày
          <input name="date" type="date" required {...fieldA11y(lb, "date", L)} />
        </label>
        <FieldError base={lb} name="date" errors={L} />
        <div className="row">
          <div>
            <label className="field">
              Từ
              <input name="from" type="time" defaultValue="08:00" required {...fieldA11y(lb, "from", L)} />
            </label>
            <FieldError base={lb} name="from" errors={L} />
          </div>
          <div>
            <label className="field">
              Đến
              <input name="to" type="time" defaultValue="17:00" required {...fieldA11y(lb, "to", L)} />
            </label>
            <FieldError base={lb} name="to" errors={L} />
          </div>
          <div>
            <label className="field">
              Số phút làm việc nghỉ
              <input
                name="minutes"
                type="number"
                min={1}
                defaultValue={480}
                required
                {...fieldA11y(lb, "minutes", L)}
              />
            </label>
            <FieldError base={lb} name="minutes" errors={L} />
          </div>
        </div>
        <label className="field">
          Lý do
          <textarea name="reason" maxLength={1000} {...fieldA11y(lb, "reason", L)} />
        </label>
        <FieldError base={lb} name="reason" errors={L} />
        <SubmitButton className="btn btn-primary" busy={busy}>
          Gửi đơn nghỉ
        </SubmitButton>
      </form>
      <form
        className="card"
        noValidate
        aria-labelledby={`${ob}-h`}
        onSubmit={(e) =>
          send(
            e,
            "ot",
            "/api/app/ot-requests",
            "OtFormInput",
            (f) => ({
              business_date: f.get("date"),
              minutes: Number(f.get("minutes")),
              reason: f.get("reason"),
              consent: f.get("consent") === "on",
            }),
            () => otMap,
          )
        }
      >
        <h2 id={`${ob}-h`}>Làm thêm giờ</h2>
        <label className="field">
          Ngày
          <input name="date" type="date" required {...fieldA11y(ob, "date", O)} />
        </label>
        <FieldError base={ob} name="date" errors={O} />
        <label className="field">
          Số phút
          <input
            name="minutes"
            type="number"
            min={1}
            max={720}
            defaultValue={120}
            required
            {...fieldA11y(ob, "minutes", O)}
          />
        </label>
        <FieldError base={ob} name="minutes" errors={O} />
        <label className="field">
          Lý do
          <textarea name="reason" maxLength={1000} required {...fieldA11y(ob, "reason", O)} />
        </label>
        <FieldError base={ob} name="reason" errors={O} />
        <label>
          <input name="consent" type="checkbox" required {...fieldA11y(ob, "consent", O)} /> Tôi đồng ý làm
          thêm giờ theo đề nghị này
        </label>
        <FieldError base={ob} name="consent" errors={O} />
        <p>
          <SubmitButton className="btn btn-primary" busy={busy}>
            Gửi đơn OT
          </SubmitButton>
        </p>
      </form>
      <form
        className="card"
        noValidate
        aria-labelledby={`${ab}-h`}
        onSubmit={(e) =>
          send(
            e,
            "adj",
            "/api/app/adjustments",
            "AdjustmentInput",
            (f) => ({
              action: "add_event",
              new_kind: f.get("kind"),
              new_at: vnIso(String(f.get("date")), String(f.get("time"))),
              reason: f.get("reason"),
            }),
            adjMap,
          )
        }
      >
        <h2 id={`${ab}-h`}>Đề nghị sửa công (quên chấm)</h2>
        <label className="field">
          Loại
          <select name="kind" {...fieldA11y(ab, "kind", A)}>
            <option value="in">Vào ca</option>
            <option value="out">Ra ca</option>
          </select>
        </label>
        <FieldError base={ab} name="kind" errors={A} />
        <div className="row">
          <div>
            <label className="field">
              Ngày
              <input name="date" type="date" required {...fieldA11y(ab, "date", A)} />
            </label>
            <FieldError base={ab} name="date" errors={A} />
          </div>
          <div>
            <label className="field">
              Giờ
              <input name="time" type="time" required {...fieldA11y(ab, "time", A)} />
            </label>
            <FieldError base={ab} name="time" errors={A} />
          </div>
        </div>
        <label className="field">
          Lý do (bắt buộc)
          <textarea name="reason" maxLength={1000} required {...fieldA11y(ab, "reason", A)} />
        </label>
        <FieldError base={ab} name="reason" errors={A} />
        <SubmitButton className="btn btn-primary" busy={busy}>
          Gửi đề nghị
        </SubmitButton>
      </form>
    </>
  );
}
