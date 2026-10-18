"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/i18n/client-app";
import { KIND_LABEL } from "./labels";
import { useSession } from "./session-context";
import { submitAttendance, type SubmitOutcome } from "./offline/attendance-submit";

const LABEL: Record<SubmitOutcome["state"], string> = {
  confirmed: t("clock.confirmed"),
  needs_review: t("clock.needs_review"),
  pending: t("clock.pending"),
  rejected: t("clock.rejected"),
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
    const params = { kind: KIND_LABEL[kind] ?? kind, state: LABEL[r.state] };
    setMsg({
      text: r.reason
        ? t("clock.resultWithReason", { ...params, reason: r.reason })
        : t("clock.result", params),
      cls: r.state === "confirmed" ? "ok" : r.state === "rejected" ? "err" : "warn",
    });
    if (r.state !== "pending") router.refresh();
  }

  return (
    <div>
      <div className="row">
        <button className="btn btn-primary btn-big" disabled={busy} onClick={() => clock(nextKind)}>
          {KIND_LABEL[nextKind]}
        </button>
      </div>
      <p role="status" aria-live="polite" className={msg?.cls}>
        {msg?.text}
      </p>
    </div>
  );
}
