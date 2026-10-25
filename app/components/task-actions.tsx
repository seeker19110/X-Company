"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { t } from "@/lib/i18n/client-app";
import { api } from "./api";
import { focusContainer, focusPageHeading, useRestoreFocus } from "./focus";
import { useConfirm, type ConfirmRequest } from "./confirm-dialog";
import { useSession } from "./session-context";

type Action = "start" | "submit" | "block" | "unblock" | "accept" | "return";
const LABEL: Record<Action, string> = {
  start: t("tasks.action.start"),
  submit: t("tasks.action.submit"),
  block: t("tasks.action.block"),
  unblock: t("tasks.action.unblock"),
  accept: t("tasks.action.accept"),
  return: t("tasks.action.return"),
};
const NEEDS_REASON: Action[] = ["block", "return"];
/** Hành động cần xác nhận: nêu đối tượng (tên việc) + hậu quả; nút ghi đúng động từ. */
const CONFIRM: Partial<Record<Action, Omit<ConfirmRequest, "object" | "reasonLabel">>> = {
  block: {
    title: t("tasks.confirm.blockTitle"),
    consequence: t("tasks.confirm.blockConsequence"),
    confirmLabel: t("tasks.confirm.blockButton"),
  },
  return: {
    title: t("tasks.confirm.returnTitle"),
    consequence: t("tasks.confirm.returnConsequence"),
    confirmLabel: t("tasks.confirm.returnButton"),
  },
  accept: {
    title: t("tasks.confirm.acceptTitle"),
    consequence: t("tasks.confirm.acceptConsequence"),
    confirmLabel: t("tasks.confirm.acceptButton"),
  },
};

function actionsFor(status: string, role: "responsible" | "reviewer"): Action[] {
  if (role === "reviewer") return status === "awaiting_acceptance" ? ["accept", "return"] : [];
  if (status === "todo") return ["start", "block"];
  if (status === "in_progress") return ["submit", "block"];
  if (status === "blocked") return ["unblock"];
  return [];
}

export function TaskActions({
  id,
  taskTitle,
  status,
  version,
  role,
}: {
  id: string;
  taskTitle: string;
  status: string;
  version: number;
  role: "responsible" | "reviewer";
}) {
  const { csrf } = useSession();
  const { ask, dialog } = useConfirm();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const [refreshing, startRefresh] = useTransition();

  const pressed = useRef<HTMLButtonElement | null>(null);
  // Gửi xong (thành công hay thất bại) → focus về nút vừa bấm nếu đang rơi về <body>, KHÔNG chờ làm mới: `isPending` của
  // transition `router.refresh()` có lúc không về false (AUD-TEST-006) — chờ nó thì focus kẹt ở <body>. Dữ liệu mới về và
  // bộ nút đổi → effect dưới chuyển focus vào khối của việc.
  useRestoreFocus(busy, pressed);

  // Nút bị vô hiệu/thay bằng bộ nút của trạng thái mới → focus rơi về <body>. Khi dữ liệu mới về (status/version đổi),
  // đưa focus vào KHỐI của việc này (không phải nút: Enter lần nữa không vô tình "Gửi nghiệm thu"); việc không còn thao
  // tác/biến mất khỏi danh sách → về tiêu đề trang.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const holder = box.current?.closest("li") ?? box.current;
    if (holder) focusContainer(holder);
    else focusPageHeading();
  }, [status, version]);
  // AUD-CODE-010: làm mới xong mà status/version không đổi (lỗi tải, ngoại tuyến) → hạ cờ ngay, không để lần đổi version
  // sau (do người khác) giật focus; focus về nút vừa bấm nếu nó đang rơi về <body>. Khai báo SAU effect trên: cùng một
  // lượt commit, effect trên đã hạ cờ khi dữ liệu đổi.
  useEffect(() => {
    if (refreshing || !refocus.current) return;
    refocus.current = false;
    const el = pressed.current;
    const active = document.activeElement;
    if (el?.isConnected && (active === null || active === document.body)) el.focus();
  }, [refreshing]);
  useEffect(
    () => () => {
      if (refocus.current) focusPageHeading(); // bị gỡ khỏi danh sách (vd. đã nghiệm thu) trước khi kịp focus
    },
    [],
  );

  async function run(a: Action) {
    let reason: string | null = null;
    const ask1 = CONFIRM[a];
    if (ask1) {
      const r = await ask({
        ...ask1,
        object: taskTitle,
        ...(NEEDS_REASON.includes(a) ? { reasonLabel: t("tasks.reasonLabel") } : {}),
      });
      if (!r.confirmed) return;
      reason = r.reason ?? null;
    }
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const r = await api("POST", `/api/app/tasks/${id}/${a}`, { csrf, body: { version, reason } });
    sending.current = false;
    setBusy(false);
    if (r.ok) {
      refocus.current = true;
      startRefresh(() => router.refresh());
    } else setError(r.error ?? t("common.actionFailed"));
  }

  const acts = actionsFor(status, role);
  if (acts.length === 0) return null;
  return (
    <div ref={box} className="row row-actions">
      {acts.map((a) => (
        <button
          key={a}
          className="btn"
          disabled={busy}
          aria-busy={busy}
          onClick={(e) => {
            pressed.current = e.currentTarget;
            void run(a);
          }}
        >
          {LABEL[a]}
        </button>
      ))}
      {error && (
        <span role="alert" className="err">
          {error}
        </span>
      )}
      {dialog}
    </div>
  );
}
