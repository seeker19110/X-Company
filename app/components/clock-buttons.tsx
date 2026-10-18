"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "./session-context";
import { submitAttendance, type SubmitOutcome } from "./offline/attendance-submit";

const LABEL: Record<SubmitOutcome["state"], string> = {
  confirmed: "Đã được xác nhận",
  needs_review: "Đã gửi — chờ xác minh",
  pending: "Đã lưu trên thiết bị — sẽ gửi khi có mạng",
  rejected: "Bị từ chối",
};

/** Nút Vào/Ra ca (SPEC-pwa): vùng bấm lớn; trạng thái Đã lưu trên thiết bị / Đã gửi / Đã xác nhận. */
export function ClockButtons({ nextKind }: { nextKind: "in" | "out" }) {
  const { csrf, userId } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; cls: string } | null>(null);

  async function clock(kind: "in" | "out") {
    setBusy(true);
    const r = await submitAttendance(userId, csrf, { kind, source: "gps" });
    setBusy(false);
    setMsg({
      text: `${kind === "in" ? "Vào ca" : "Ra ca"}: ${LABEL[r.state]}${r.reason ? ` (${r.reason})` : ""}`,
      cls: r.state === "confirmed" ? "ok" : r.state === "rejected" ? "err" : "warn",
    });
    if (r.state !== "pending") router.refresh();
  }

  return (
    <div>
      <div className="row">
        <button className="btn btn-primary btn-big" disabled={busy} onClick={() => clock(nextKind)}>
          {nextKind === "in" ? "Vào ca" : "Ra ca"}
        </button>
      </div>
      <p role="status" aria-live="polite" className={msg?.cls}>
        {msg?.text}
      </p>
    </div>
  );
}
