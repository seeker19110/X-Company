"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { t } from "@/lib/i18n/client-app";
import { api } from "./api";
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
    if (r.ok) router.refresh();
    else setError(r.error ?? t("common.actionFailed"));
  }

  const acts = actionsFor(status, role);
  if (acts.length === 0) return null;
  return (
    <div className="row" style={{ marginTop: "0.5rem" }}>
      {acts.map((a) => (
        <button key={a} className="btn" disabled={busy} aria-busy={busy} onClick={() => run(a)}>
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
