"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
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

function actionsFor(status: string, role: "responsible" | "reviewer"): Action[] {
  if (role === "reviewer") return status === "awaiting_acceptance" ? ["accept", "return"] : [];
  if (status === "todo") return ["start", "block"];
  if (status === "in_progress") return ["submit", "block"];
  if (status === "blocked") return ["unblock"];
  return [];
}

export function TaskActions({
  id,
  status,
  version,
  role,
}: {
  id: string;
  status: string;
  version: number;
  role: "responsible" | "reviewer";
}) {
  const { csrf } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(a: Action) {
    let reason: string | null = null;
    if (NEEDS_REASON.includes(a)) {
      reason = window.prompt("Lý do:");
      if (!reason?.trim()) return;
    }
    setBusy(true);
    const r = await api("POST", `/api/app/tasks/${id}/${a}`, { csrf, body: { version, reason } });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error ?? "Không thực hiện được");
  }

  const acts = actionsFor(status, role);
  if (!acts.length) return null;
  return (
    <div className="row" style={{ marginTop: "0.5rem" }}>
      {acts.map((a) => (
        <button key={a} className="btn" disabled={busy} onClick={() => run(a)}>
          {LABEL[a]}
        </button>
      ))}
      {error && (
        <span role="alert" className="err">
          {error}
        </span>
      )}
    </div>
  );
}
