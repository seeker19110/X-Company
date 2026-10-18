"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { flush, summarize } from "@/lib/offline/queue";
import { logoutPlan } from "@/lib/offline/device";
import { api } from "./api";
import { deleteUserDatabase, openQueue } from "./offline/idb-store";
import { sendBatch } from "./offline/sync-client";
import { useSession } from "./session-context";

/** Đăng xuất (AT12): còn bản chưa gửi → hỏi đồng bộ hay xoá (xác nhận 2 lần); sau đăng xuất xoá DB thiết bị. */
export function LogoutButton() {
  const { csrf, userId } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function logout() {
    setBusy(true);
    const store = await openQueue(userId);
    let plan = logoutPlan(summarize(await store.all()));
    if (plan.needsConfirmation) {
      if (window.confirm(`Còn ${plan.pending} thao tác chưa gửi. Đồng bộ trước khi đăng xuất?`)) {
        await flush(store, sendBatch(csrf), Date.now(), true).catch(() => undefined);
        plan = logoutPlan(summarize(await store.all()));
      }
      if (
        plan.needsConfirmation &&
        !window.confirm(`Vẫn còn ${plan.pending} thao tác chưa gửi. XOÁ chúng và đăng xuất?`)
      ) {
        setBusy(false);
        setMsg("Đã huỷ đăng xuất — dữ liệu chưa gửi vẫn còn trên thiết bị.");
        return;
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
        Đăng xuất
      </button>
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
