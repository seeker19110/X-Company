"use client";

// Kho IndexedDB cho hàng chờ (trình duyệt). Database theo người dùng; nâng cấp lược đồ giữ bản ghi chờ.
import { dbNameFor, foreignDatabases, migrateItem, SCHEMA_VERSION } from "@/lib/offline/device";
import type { QueueItem, QueueStore } from "@/lib/offline/queue";
import { reportClientError } from "../client-log";

const STORE = "queue";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function openQueue(userId: string): Promise<QueueStore> {
  const open = indexedDB.open(dbNameFor(userId), SCHEMA_VERSION);
  open.onupgradeneeded = (ev) => {
    const db = open.result;
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: "id" });
      return;
    }
    // Chuyển đổi bản ghi cũ tại chỗ — không drop store (bản chưa gửi phải còn).
    const store = open.transaction!.objectStore(STORE);
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const c = cursorReq.result;
      if (!c) return;
      c.update(migrateItem(ev.oldVersion, c.value as Record<string, unknown>));
      c.continue();
    };
  };
  const db = await req(open);
  const tx = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    all: () => req(tx("readonly").getAll() as IDBRequest<QueueItem[]>),
    put: async (item) => {
      await req(tx("readwrite").put(item));
    },
    remove: async (id) => {
      await req(tx("readwrite").delete(id));
    },
  };
}

/** Xoá database của người dùng khác (thiết bị dùng chung, AT12). */
export async function removeForeignDatabases(currentUserId: string | null): Promise<void> {
  const list = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
  for (const name of foreignDatabases(list.map((d) => d.name ?? "").filter(Boolean), currentUserId)) {
    await req(indexedDB.deleteDatabase(name)).catch((e: unknown) =>
      reportClientError("xoá database người dùng khác thất bại", e),
    );
  }
}

export async function deleteUserDatabase(userId: string): Promise<void> {
  await req(indexedDB.deleteDatabase(dbNameFor(userId))).catch((e: unknown) =>
    reportClientError("xoá database người dùng thất bại", e),
  );
}
