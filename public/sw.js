// Service worker của ứng dụng nội bộ (SPEC-pwa), phạm vi /app/.
// - Tài nguyên tĩnh có băm (/_next/static/, /icons/): cache-first.
// - Trang /app/**: network-first, mất mạng → bản đã lưu của chính URL đó, không có → /offline.html.
// - KHÔNG cache /api/** (dữ liệu cá nhân) — dữ liệu xem ngoại tuyến nằm ở IndexedDB theo người dùng.
// - Nâng cấp: chỉ xoá Cache Storage phiên bản cũ; KHÔNG đụng IndexedDB (hàng chờ chưa gửi phải còn).
// Đổi offline.html/offline.css/icon precache thì PHẢI tăng VERSION: chúng phục vụ cache-first từ bộ đệm của phiên bản này.
const VERSION = "xc-v3"; // v3: precache thêm /offline.css (AUD-A11Y-011)
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;
const OFFLINE_URL = "/offline.html";
const OFFLINE_CSS = "/offline.css";

function strategyFor(url, mode, method) {
  if (method !== "GET") return "network";
  if (url.origin !== self.location.origin) return "network";
  if (url.pathname.startsWith("/api/")) return "network";
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) return "cache-first";
  if (url.pathname === OFFLINE_CSS) return "cache-first"; // kiểu của /offline.html phải có khi mất mạng
  if (mode === "navigate" && url.pathname.startsWith("/app/")) return "network-first";
  return "network";
}
self.__xcStrategy = strategyFor;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC)
      .then((c) => c.addAll([OFFLINE_URL, OFFLINE_CSS, "/icons/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const s = strategyFor(url, req.mode, req.method);
  if (s === "cache-first") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  } else if (s === "network-first") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Chỉ lưu trang nội bộ khi máy chủ cho phép (không no-store) — trang có dữ liệu riêng mặc định no-store.
          if (res.ok && !(res.headers.get("cache-control") || "").includes("no-store")) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL))),
    );
  }
});

// Nhận lệnh xoá cache khi đăng xuất (bổ sung Clear-Site-Data).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "logout") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
