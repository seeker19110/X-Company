// Phiên cho server component (chỉ chạy phía server): đọc cookie qua next/headers rồi dùng đúng lớp lib như route.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadActor } from "@/lib/authz/load";
import type { ActorContext } from "@/lib/authz";
import { getPool } from "@/lib/db";
import { cookieName, csrfTokenFor, resolveSession } from "@/lib/identity/session";
import { mfaSatisfied } from "@/lib/identity/mfa";

export interface PageSession {
  actor: ActorContext;
  csrf: string;
  displayName: string;
}

export async function getSession(): Promise<PageSession | null> {
  const token = (await cookies()).get(cookieName())?.value;
  if (!token) return null;
  const pool = getPool();
  const s = await resolveSession(pool, token);
  const actor = s ? await loadActor(pool, s.userId) : null;
  // Vai trò bắt buộc TOTP mà phiên chưa qua bước hai → coi như chưa đăng nhập (cùng điều kiện với withActor).
  if (!s || !actor || !mfaSatisfied(actor.grants, s.mfaAt)) return null;
  const { rows } = await pool.query<{ display_name: string }>(
    "SELECT display_name FROM app_user WHERE id = $1",
    [actor.userId],
  );
  return { actor, csrf: csrfTokenFor(token), displayName: rows[0]?.display_name ?? "" };
}

/** Trang nội bộ: chưa đăng nhập → chuyển tới /app/login. */
export async function requireSession(): Promise<PageSession> {
  const s = await getSession();
  if (!s) redirect("/app/login");
  return s;
}
