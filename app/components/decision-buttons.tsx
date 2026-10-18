"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "./api";
import { useConfirm } from "./confirm-dialog";
import { useSession } from "./session-context";

/** Duyệt / từ chối — luôn trực tuyến (SPEC-pwa: phê duyệt không làm ngoại tuyến). Từ chối bắt buộc lý do. */
export function DecisionButtons({ type, id, subject }: { type: string; id: string; subject?: string }) {
  const { csrf } = useSession();
  const { ask, dialog } = useConfirm();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  async function decide(decision: "approve" | "reject") {
    let note: string | null = null;
    if (decision === "reject") {
      const r = await ask({
        title: "Từ chối đơn?",
        object: subject,
        consequence: "Người gửi sẽ nhận được lý do từ chối.",
        reasonLabel: "Lý do từ chối",
        confirmLabel: "Từ chối đơn",
        cancelLabel: "Không từ chối",
      });
      if (!r.confirmed) return;
      note = r.reason ?? null;
    }
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const r = await api("POST", `/api/app/approvals/${type}/${id}/${decision}`, { csrf, body: { note } });
    sending.current = false;
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error ?? "Không thực hiện được");
  }

  return (
    <div className="row" style={{ marginTop: "0.5rem" }}>
      <button className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={() => decide("approve")}>
        Duyệt
      </button>
      <button className="btn" disabled={busy} aria-busy={busy} onClick={() => decide("reject")}>
        Từ chối
      </button>
      {error && (
        <span role="alert" className="err">
          {error}
        </span>
      )}
      {dialog}
    </div>
  );
}
