import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";
import manifest from "../../app/manifest.ts";

function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${file} là PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Chạy public/sw.js thật trong sandbox và lấy hàm chọn chiến lược mà nó tự công bố. */
function loadStrategy() {
  const listeners: Record<string, unknown> = {};
  const self = {
    location: { origin: "https://xc.example" },
    addEventListener: (t: string, f: unknown) => (listeners[t] = f),
  } as Record<string, unknown>;
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, URL, caches: {}, fetch: () => undefined });
  return {
    strategy: self.__xcStrategy as (u: URL, mode: string, method: string) => string,
    listeners: Object.keys(listeners).sort(),
  };
}

describe("PWA: manifest + service worker (T-020, S-PWA-04)", () => {
  test("manifest đủ điều kiện cài đặt: tên, start_url trong scope /app/, standalone, icon 192/512 + maskable", () => {
    const m = manifest();
    assert.equal(m.scope, "/app/");
    assert.ok(m.start_url?.startsWith("/app/"));
    assert.equal(m.display, "standalone");
    assert.equal(m.lang, "vi");
    assert.ok(m.name && m.short_name && m.short_name.length <= 12);
    const icons = m.icons ?? [];
    for (const [size, purpose] of [
      ["192x192", "any"],
      ["512x512", "any"],
      ["512x512", "maskable"],
    ]) {
      const icon = icons.find((i) => i.sizes === size && i.purpose === purpose);
      assert.ok(icon, `${size} ${purpose}`);
      const [w, h] = pngSize(`public${icon!.src}`);
      assert.equal(`${w}x${h}`, size);
    }
    assert.deepEqual(pngSize("public/icons/apple-touch-icon.png"), [180, 180]);
  });

  test("service worker: không bao giờ cache API; tĩnh cache-first; trang /app network-first; khác origin bỏ qua", () => {
    const { strategy, listeners } = loadStrategy();
    const u = (p: string, o = "https://xc.example") => new URL(p, o);
    assert.equal(strategy(u("/api/app/me"), "cors", "GET"), "network");
    assert.equal(strategy(u("/api/app/attendance/events"), "cors", "POST"), "network");
    assert.equal(strategy(u("/_next/static/chunks/a.js"), "no-cors", "GET"), "cache-first");
    assert.equal(strategy(u("/icons/icon-192.png"), "no-cors", "GET"), "cache-first");
    assert.equal(strategy(u("/app/today"), "navigate", "GET"), "network-first");
    assert.equal(
      strategy(u("/dich-vu"), "navigate", "GET"),
      "network",
      "website công khai không nằm trong phạm vi PWA",
    );
    assert.equal(strategy(u("/x.js", "https://cdn.other"), "no-cors", "GET"), "network");
    assert.deepEqual(listeners, ["activate", "fetch", "install", "message"]);
  });

  test("nâng cấp SW chỉ xoá Cache Storage cũ, không đụng IndexedDB (hàng chờ chưa gửi còn nguyên)", () => {
    const src = readFileSync("public/sw.js", "utf8");
    assert.ok(!/indexedDB/i.test(src.replace(/\/\/.*$/gm, "")), "sw.js không thao tác IndexedDB");
    assert.match(src, /keys\.filter\(\(k\) => !k\.startsWith\(VERSION\)\)/);
  });

  test("trang ngoại tuyến tồn tại, tiếng Việt, không tải tài nguyên ngoài", () => {
    assert.ok(existsSync("public/offline.html"));
    const html = readFileSync("public/offline.html", "utf8");
    assert.match(html, /<html lang="vi">/);
    assert.ok(!/(src|href)="https?:\/\//.test(html));
  });
});
