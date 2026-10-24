import type { Metadata } from "next";
import { requireSession } from "@/app/server/session";
import { getPool } from "@/lib/db";
import { listMine, unreadCount } from "@/lib/notify";
import { MarkAllButton, MarkOneButton } from "@/app/components/notification-actions";
import { NotificationsView } from "@/app/components/notification-list";
import { PAGE_MAX_OFFSET } from "@/lib/nen/pagination";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("notifications.title") };
const PAGE_SIZE = 20;

/** `?offset=` hợp lệ (số nguyên không âm trong trần) hoặc 0 — tham số hỏng không làm sập trang. */
function offsetOf(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s || !/^[0-9]{1,9}$/.test(s)) return 0;
  return Math.min(Number(s), PAGE_MAX_OFFSET);
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await requireSession();
  const offset = offsetOf((await searchParams).offset);
  const pool = getPool();
  const [page, unread] = await Promise.all([
    listMine(pool, actor.companyId, actor.userId, { limit: PAGE_SIZE, offset }),
    unreadCount(pool, actor.companyId, actor.userId),
  ]);
  const href = (o: number) => (o <= 0 ? "/app/thong-bao" : `/app/thong-bao?offset=${o}`);
  return (
    <NotificationsView
      items={page.items}
      unread={unread}
      markAll={<MarkAllButton />}
      markOne={(n, text) => <MarkOneButton id={n.id} text={text} />}
      prevHref={offset > 0 ? href(Math.max(0, offset - PAGE_SIZE)) : null}
      nextHref={page.next_offset === null ? null : href(page.next_offset)}
    />
  );
}
