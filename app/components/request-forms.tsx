"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n/client-app";
import type * as RequestSchemas from "@/lib/attendance/request-schema.pure";
import { api } from "./api";
import {
  FieldError,
  fieldA11y,
  useFocusFirstInvalid,
  SubmitButton,
  textOrNull,
  toFieldErrors,
  type FieldErrors,
  type FieldMap,
} from "./form-parts";
import { KIND_LABEL } from "./labels";
import { useSession } from "./session-context";

type FormKey = "leave" | "ot" | "adj";
type Msg = { text: string; cls: string };
/** Nhãn ô bắt buộc: ghi rõ trong nhãn (WCAG 3.3.2), cùng cách với form liên hệ. */
const req = (label: string) => t("requests.required", { label });
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
  const focusFirstInvalid = useFocusFirstInvalid();
  // Mỗi form có trạng thái gửi và vùng thông báo riêng (AUD-A11Y-004): gửi form này không khoá form kia, thông báo nằm cạnh form.
  const [busy, setBusy] = useState<Record<FormKey, boolean>>({ leave: false, ot: false, adj: false });
  const sending = useRef<Record<FormKey, boolean>>({ leave: false, ot: false, adj: false }); // chặn bấm đúp trước khi React kịp vô hiệu nút (UX-STATE-006)
  const [msgs, setMsgs] = useState<Record<FormKey, Msg | null>>({ leave: null, ot: null, adj: null });
  const setMsg = (k: FormKey, m: Msg) => setMsgs((all) => ({ ...all, [k]: m }));
  const setBusyOf = (k: FormKey, v: boolean) => setBusy((all) => ({ ...all, [k]: v }));
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
    if (sending.current[key]) return;
    sending.current[key] = true;
    const form = e.currentTarget;
    const data = new FormData(form);
    const body = build(data);
    const map = mapFor(data);
    const parsed = (await loadSchema(schema))?.safeParse(body);
    if (parsed && !parsed.success) {
      sending.current[key] = false;
      const { fields, general } = toFieldErrors(parsed.error.issues, map);
      setFormErrors(key, fields);
      setMsg(key, { text: general[0] ?? t("common.checkMarkedFields"), cls: "err" });
      focusFirstInvalid(form);
      return;
    }
    setFormErrors(key, {});
    setBusyOf(key, true);
    const r = await api("POST", path, { csrf, body });
    sending.current[key] = false;
    setBusyOf(key, false);
    if (!r.ok && r.fields !== undefined && r.fields.length > 0) {
      setFormErrors(key, toFieldErrors(r.fields, map).fields);
      focusFirstInvalid(form);
    }
    setMsg(
      key,
      r.ok
        ? { text: t("requests.sent"), cls: "ok" }
        : { text: r.error ?? t("common.sendFailed"), cls: "err" },
    );
    if (r.ok) form.reset();
  }

  const L = errors.leave;
  const O = errors.ot;
  const A = errors.adj;
  const M = msgs;
  const lb = `${base}-l`;
  const ob = `${base}-o`;
  const ab = `${base}-a`;
  return (
    <>
      <form
        method="post"
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
        <h2 id={`${lb}-h`}>{t("requests.leave.heading")}</h2>
        <label className="field">
          {req(t("requests.leave.type"))}
          <select name="type" required {...fieldA11y(lb, "type", L)}>
            {leaveTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </select>
        </label>
        <FieldError base={lb} name="type" errors={L} />
        <label className="field">
          {req(t("requests.date"))}
          <input name="date" type="date" required {...fieldA11y(lb, "date", L)} />
        </label>
        <FieldError base={lb} name="date" errors={L} />
        <div className="row">
          <div>
            <label className="field">
              {req(t("requests.leave.from"))}
              <input name="from" type="time" defaultValue="08:00" required {...fieldA11y(lb, "from", L)} />
            </label>
            <FieldError base={lb} name="from" errors={L} />
          </div>
          <div>
            <label className="field">
              {req(t("requests.leave.to"))}
              <input name="to" type="time" defaultValue="17:00" required {...fieldA11y(lb, "to", L)} />
            </label>
            <FieldError base={lb} name="to" errors={L} />
          </div>
          <div>
            <label className="field">
              {req(t("requests.leave.minutes"))}
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
          {t("requests.reason")}
          <textarea name="reason" maxLength={1000} {...fieldA11y(lb, "reason", L)} />
        </label>
        <FieldError base={lb} name="reason" errors={L} />
        <SubmitButton className="btn btn-primary" busy={busy.leave}>
          {t("requests.leave.submit")}
        </SubmitButton>
        <p role="status" aria-live="polite" className={M.leave?.cls}>
          {M.leave?.text}
        </p>
      </form>
      <form
        method="post"
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
        <h2 id={`${ob}-h`}>{t("requests.ot.heading")}</h2>
        <label className="field">
          {req(t("requests.date"))}
          <input name="date" type="date" required {...fieldA11y(ob, "date", O)} />
        </label>
        <FieldError base={ob} name="date" errors={O} />
        <label className="field">
          {req(t("requests.ot.minutes"))}
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
          {req(t("requests.reason"))}
          <textarea name="reason" maxLength={1000} required {...fieldA11y(ob, "reason", O)} />
        </label>
        <FieldError base={ob} name="reason" errors={O} />
        <label>
          <input name="consent" type="checkbox" required {...fieldA11y(ob, "consent", O)} />{" "}
          {req(t("requests.ot.consent"))}
        </label>
        <FieldError base={ob} name="consent" errors={O} />
        <p>
          <SubmitButton className="btn btn-primary" busy={busy.ot}>
            {t("requests.ot.submit")}
          </SubmitButton>
        </p>
        <p role="status" aria-live="polite" className={M.ot?.cls}>
          {M.ot?.text}
        </p>
      </form>
      <form
        method="post"
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
        <h2 id={`${ab}-h`}>{t("requests.adjustment.heading")}</h2>
        <label className="field">
          {t("requests.adjustment.kind")}
          <select name="kind" {...fieldA11y(ab, "kind", A)}>
            <option value="in">{KIND_LABEL.in}</option>
            <option value="out">{KIND_LABEL.out}</option>
          </select>
        </label>
        <FieldError base={ab} name="kind" errors={A} />
        <div className="row">
          <div>
            <label className="field">
              {req(t("requests.date"))}
              <input name="date" type="date" required {...fieldA11y(ab, "date", A)} />
            </label>
            <FieldError base={ab} name="date" errors={A} />
          </div>
          <div>
            <label className="field">
              {req(t("requests.adjustment.time"))}
              <input name="time" type="time" required {...fieldA11y(ab, "time", A)} />
            </label>
            <FieldError base={ab} name="time" errors={A} />
          </div>
        </div>
        <label className="field">
          {t("requests.adjustment.reason")}
          <textarea name="reason" maxLength={1000} required {...fieldA11y(ab, "reason", A)} />
        </label>
        <FieldError base={ab} name="reason" errors={A} />
        <SubmitButton className="btn btn-primary" busy={busy.adj}>
          {t("requests.adjustment.submit")}
        </SubmitButton>
        <p role="status" aria-live="polite" className={M.adj?.cls}>
          {M.adj?.text}
        </p>
      </form>
    </>
  );
}
