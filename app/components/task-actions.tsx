"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "./api";
import { useConfirm, type ConfirmRequest } from "./confirm-dialog";
import { useSession } from "./session-context";

type Action = "start" | "submit" | "block" | "unblock" | "accept" | "return";
const LABEL: Record<Action, string> = {
  start: "Bắt đầu",
  submit: "Gửi nghiệm thu",
  block: "Báo bị chặn",
  unblock: "Tiếp tục",
  accept: "Nghiệm thu",
  return: "Trả lại",
};
const NEEDS_REASON: Action[] = ["block", "return"];
/** Hành động cần xác nhận: nêu đối tượng (tên việc) + hậu quả; nút ghi đúng động từ. */
const CONFIRM: Partial<Record<Action, Omit<ConfirmRequest, "object" | "reasonLabel">>> = {
  block: {
    title: "Báo việc bị chặn?",
    consequence: "Người nghiệm thu và quản lý sẽ thấy việc đang bị chặn.",
    confirmLabel: "Báo bị chặn",
  },
  return: {
    title: "Trả lại việc?",
    consequence: "Việc quay về cho người làm, kèm lý do bạn nhập.",
    confirmLabel: "Trả lại việc",
  },
  accept: {
    title: "Nghiệm thu việc?",
    consequence: "Việc được ghi nhận hoàn thành và rời khỏi danh sách đang mở.",
    confirmLabel: "Nghiệm thu việc",
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
  title,
  status,
  version,
  role,
}: {
  id: string;
  title: string;
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
        object: title,
        ...(NEEDS_REASON.includes(a) ? { reasonLabel: "Lý do" } : {}),
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
    else setError(r.error ?? "Không thực hiện được");
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
