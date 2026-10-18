"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { useSession } from "./session-context";

/** Duyệt / từ chối — luôn trực tuyến (SPEC-pwa: phê duyệt không làm ngoại tuyến). Từ chối bắt buộc lý do. */
export function DecisionButtons({ type, id }: { type: string; id: string }) {
  const { csrf } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approve" | "reject") {
    let note: string | null = null;
    if (decision === "reject") {
      note = window.prompt("Lý do từ chối:");
      if (!note?.trim()) return;
    }
    setBusy(true);
    const r = await api("POST", `/api/app/approvals/${type}/${id}/${decision}`, { csrf, body: { note } });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error ?? "Không thực hiện được");
  }

  return (
    <div className="row" style={{ marginTop: "0.5rem" }}>
      <button className="btn btn-primary" disabled={busy} onClick={() => decide("approve")}>
        Duyệt
      </button>
      <button className="btn" disabled={busy} onClick={() => decide("reject")}>
        Từ chối
      </button>
      {error && (
        <span role="alert" className="err">
          {error}
        </span>
      )}
    </div>
  );
}
