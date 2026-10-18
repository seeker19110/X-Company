"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { t } from "@/lib/i18n/client-app";
import { flush, summarize } from "@/lib/offline/queue";
import { logoutPlan } from "@/lib/offline/device";
import { api } from "./api";
import { useConfirm } from "./confirm-dialog";
import { reportClientError } from "./client-log";
import { deleteUserDatabase, openQueue } from "./offline/idb-store";
import { sendBatch } from "./offline/sync-client";
import { useSession } from "./session-context";

/** Đăng xuất (AT12): còn bản chưa gửi → hỏi đồng bộ hay xoá (xác nhận 2 lần); sau đăng xuất xoá DB thiết bị. */
export function LogoutButton() {
  const { csrf, userId } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { ask, dialog } = useConfirm();

  async function logout() {
    setBusy(true);
    const store = await openQueue(userId);
    let plan = logoutPlan(summarize(await store.all()));
    if (plan.needsConfirmation) {
      const sync = await ask({
        title: t("logout.syncTitle"),
        object: t("logout.pendingObject", { count: plan.pending }),
        consequence: t("logout.syncConsequence"),
        confirmLabel: t("logout.syncConfirm"),
        cancelLabel: t("logout.syncCancel"),
      });
      if (sync.confirmed) {
        await flush(store, sendBatch(csrf), Date.now(), true).catch((e: unknown) =>
          reportClientError("đồng bộ trước khi đăng xuất thất bại", e),
        );
        plan = logoutPlan(summarize(await store.all()));
      }
      if (plan.needsConfirmation) {
        const discard = await ask({
          title: t("logout.discardTitle"),
          object: t("logout.pendingObject", { count: plan.pending }),
          consequence: t("logout.discardConsequence"),
          confirmLabel: t("logout.discardConfirm"),
          cancelLabel: t("logout.discardCancel"),
        });
        if (!discard.confirmed) {
          setBusy(false);
          setMsg(t("logout.cancelled"));
          return;
        }
      }
    }
    await api("POST", "/api/app/auth/logout", { csrf, body: {} });
    await deleteUserDatabase(userId);
    navigator.serviceWorker?.controller?.postMessage({ type: "logout" });
    router.replace("/app/login");
  }

  return (
    <section className="card">
      <button className="btn" disabled={busy} onClick={() => void logout()}>
        {t("logout.button")}
      </button>
      {msg && <p role="status">{msg}</p>}
      {dialog}
    </section>
  );
}
