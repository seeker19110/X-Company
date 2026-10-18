"use client";

import { useCallback, useEffect, useState } from "react";
import { t } from "@/lib/i18n/client-app";
import { flush, summarize, type QueueSummary } from "@/lib/offline/queue";
import { reportClientError } from "./client-log";
import { syncErrorMessage } from "./messages";
import { openQueue, removeForeignDatabases } from "./offline/idb-store";
import { sendBatch } from "./offline/sync-client";
import { useSession } from "./session-context";

/** Trạng thái đồng bộ + nút Đồng bộ; tự đồng bộ khi mở app, có mạng lại, trở lại foreground (SPEC-pwa). */
export function SyncStatus() {
  const { csrf, userId } = useSession();
  const [s, setS] = useState<QueueSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const sync = useCallback(
    async (force: boolean) => {
      try {
        const store = await openQueue(userId);
        await flush(store, sendBatch(csrf), Date.now(), force);
        setS(summarize(await store.all()));
        setErr(null);
      } catch (e) {
        reportClientError("đồng bộ/đọc hàng chờ thất bại", e);
        setErr(syncErrorMessage(e));
      }
    },
    [csrf, userId],
  );

  useEffect(() => {
    void removeForeignDatabases(userId);
    // Đồng bộ lần đầu sau khi gắn (không setState đồng bộ trong effect).
    const first = window.setTimeout(() => void sync(false), 0);
    const online = () => void sync(true);
    const visible = () => document.visibilityState === "visible" && void sync(false);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [sync, userId]);

  return (
    <section className="card" aria-labelledby="dong-bo">
      <h2 id="dong-bo">{t("sync.heading")}</h2>
      <p role="status" aria-live="polite">
        {s ? (
          <>
            {t("sync.pending")} <strong>{s.pending}</strong> · {t("sync.needsReview")} {s.needsReview} ·{" "}
            {t("sync.rejected")} {s.rejected}
          </>
        ) : (
          t("sync.checking")
        )}
      </p>
      {err && (
        <p role="alert" className="err">
          {err}
        </p>
      )}
      <button className="btn" onClick={() => void sync(true)}>
        {t("sync.button")}
      </button>
    </section>
  );
}
