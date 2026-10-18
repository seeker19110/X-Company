import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";
import {
  dbNameFor,
  foreignDatabases,
  logoutPlan,
  migrateItem,
  SCHEMA_VERSION,
} from "../../lib/offline/device.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("dữ liệu thiết bị theo người dùng (T-022, S-PWA-02, AT12)", () => {
  test("mỗi người dùng một database; userId lạ bị từ chối (không ghép chuỗi tuỳ ý vào tên DB)", () => {
    assert.equal(dbNameFor(A), `xc-${A}`);
    assert.notEqual(dbNameFor(A), dbNameFor(B));
    assert.throws(() => dbNameFor("../../x"));
  });

  test("S-PWA-02: B đăng nhập trên máy A đã dùng → xoá DB của A; chưa đăng nhập → xoá mọi DB của ứng dụng", () => {
    const names = [`xc-${A}`, `xc-${B}`, "other-app-db"];
    assert.deepEqual(foreignDatabases(names, B), [`xc-${A}`]);
    assert.deepEqual(foreignDatabases(names, null), [`xc-${A}`, `xc-${B}`]);
    assert.deepEqual(foreignDatabases(names, A), [`xc-${B}`]);
  });

  test("đăng xuất còn bản chưa gửi → phải hỏi (đồng bộ rồi thoát / xoá và thoát); không còn → thoát ngay", () => {
    assert.deepEqual(logoutPlan({ pending: 0, needsReview: 2, rejected: 1, lastConfirmedAt: null }), {
      needsConfirmation: false,
      pending: 0,
      options: [],
    });
    assert.deepEqual(logoutPlan({ pending: 3, needsReview: 0, rejected: 0, lastConfirmedAt: null }), {
      needsConfirmation: true,
      pending: 3,
      options: ["sync_then_logout", "discard_and_logout"],
    });
  });

  test("nâng cấp lược đồ giữ bản ghi chờ và bổ sung trường mới (không drop)", () => {
    assert.equal(SCHEMA_VERSION, 2);
    const v1 = { id: "x", state: "pending", payload: { kind: "in" } };
    assert.deepEqual(migrateItem(1, v1), { reviewReason: null, serverId: null, ...v1 });
    const v2 = { ...v1, reviewReason: "CLOCK_SKEW", serverId: "e" };
    assert.deepEqual(migrateItem(2, v2), v2);
  });

  test("service worker nhận lệnh logout → xoá mọi Cache Storage", async () => {
    const deleted: string[] = [];
    const listeners: Record<string, (e: unknown) => void> = {};
    const self = {
      location: { origin: "https://xc.example" },
      addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] = f),
    };
    const caches = {
      keys: async () => ["xc-v1-static", "xc-v1-pages"],
      delete: async (k: string) => (deleted.push(k), true),
    };
    vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, caches, fetch: () => undefined });
    let done: Promise<unknown> = Promise.resolve();
    listeners.message!({ data: { type: "logout" }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    assert.deepEqual(deleted.sort(), ["xc-v1-pages", "xc-v1-static"]);
  });
});
