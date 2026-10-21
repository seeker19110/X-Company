"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { t } from "@/lib/i18n/client-app";
import { api } from "./api";
import { focusAfterRemoval } from "./focus";
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
  const box = useRef<HTMLDivElement>(null);

  async function decide(decision: "approve" | "reject") {
    let note: string | null = null;
    if (decision === "reject") {
      const r = await ask({
        title: t("approvals.rejectTitle"),
        object: subject,
        consequence: t("approvals.rejectConsequence"),
        reasonLabel: t("approvals.rejectReason"),
        confirmLabel: t("approvals.rejectConfirm"),
        cancelLabel: t("approvals.rejectCancel"),
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
    if (r.ok) {
      // Mục đã xử lý sắp biến mất khỏi danh sách → đưa focus sang mục kế trước khi làm mới (AUD-A11Y-002).
      focusAfterRemoval(box.current);
      router.refresh();
    } else setError(r.error ?? t("common.actionFailed"));
  }

  return (
    <div ref={box} className="row row-actions">
      <button className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={() => decide("approve")}>
        {t("approvals.approve")}
      </button>
      <button className="btn" disabled={busy} aria-busy={busy} onClick={() => decide("reject")}>
        {t("approvals.reject")}
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
