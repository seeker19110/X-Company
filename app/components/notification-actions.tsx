"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { t } from "@/lib/i18n/client-app";
import { api } from "./api";
import { focusContainer, focusPageHeading, useRestoreFocus } from "./focus";
import { useSession } from "./session-context";

/**
 * Đánh dấu đã đọc (một hoặc tất cả). Thành công → làm mới dữ liệu máy chủ; nút biến mất cùng trạng thái "chưa đọc" nên
 * focus phải được chuyển trước: về khối thông báo (một) hoặc tiêu đề trang (tất cả), không rơi về <body>.
 */
function MarkRead({
  body,
  label,
  name,
  scope,
}: {
  body: { ids: string[] } | { all: true };
  label: string;
  name?: string;
  scope: "item" | "all";
}) {
  const { csrf } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const btn = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  const [refreshing, startRefresh] = useTransition();
  useRestoreFocus(busy, btn); // không chờ làm mới mới trả focus (như TaskActions, AUD-TEST-006)

  // Như TaskActions (AUD-CODE-010): làm mới xong mà nút vẫn còn (lỗi tải, ngoại tuyến) → hạ cờ, để lần gỡ nút về sau (điều
  // hướng đi) không giật focus; focus về nút nếu đang rơi về <body>.
  useEffect(() => {
    if (refreshing || !refocus.current) return;
    refocus.current = false;
    const el = btn.current;
    const active = document.activeElement;
    if (el?.isConnected && (active === null || active === document.body)) el.focus();
  }, [refreshing]);
  useEffect(
    () => () => {
      if (!refocus.current) return;
      const h = holder.current;
      if (scope === "item" && h?.isConnected) focusContainer(h);
      else focusPageHeading();
    },
    [scope],
  );

  async function run() {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    setBusy(true);
    holder.current = btn.current?.closest("li") ?? null;
    const r = await api("POST", "/api/app/notifications/read", { csrf, body });
    sending.current = false;
    setBusy(false);
    if (r.ok) {
      refocus.current = true;
      startRefresh(() => router.refresh());
    } else setError(r.error ?? t("common.actionFailed"));
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="btn"
        disabled={busy}
        aria-busy={busy}
        {...(name ? { "aria-label": name } : {})}
        onClick={() => void run()}
      >
        {label}
      </button>
      {error && (
        <span role="alert" className="err">
          {error}
        </span>
      )}
    </>
  );
}

export function MarkOneButton({ id, text }: { id: string; text: string }) {
  return (
    <MarkRead
      body={{ ids: [id] }}
      label={t("notifications.markOne")}
      name={t("notifications.markOneFor", { text })}
      scope="item"
    />
  );
}

export function MarkAllButton() {
  return <MarkRead body={{ all: true }} label={t("notifications.markAll")} scope="all" />;
}
