"use client";

import { useEffect } from "react";
import {
  clsSessionWindow,
  lastStartTime,
  navTiming,
  slowestInteractionMs,
  type NavTiming,
  type ShiftEntry,
} from "@/lib/rum/vitals.pure";
import { reportClientError } from "./client-log";

// RUM web-vitals tự làm (T-056, D-042): không phụ thuộc, không bên thứ ba, không cookie/định danh. MỘT beacon cho mỗi TÀI LIỆU
// (lần tải trang), gửi về /api/public/rum lúc ẩn trang. Cài đặt ở cấp module: điều hướng client giữa các layout làm component
// mount/unmount nhưng module sống cùng tài liệu, nên chỉ lần mount đầu cài observer và `page` là pathname LÚC TẢI tài liệu
// (số đo LCP/FCP/TTFB thuộc tài liệu đó; mount sau không gán chúng cho đường dẫn mới). Server chuẩn hoá `page` thành nhãn.
const ENDPOINT = "/api/public/rum";
/** Trần phía client khớp trần phía server (lib/rum RUM_MAX_TIME_MS / RUM_MAX_CLS): vượt thì cắt, không để cả beacon bị từ chối. */
const MAX_TIME_MS = 120_000;
const MAX_CLS = 10;
/** Ngưỡng nhỏ nhất Event Timing cho phép: lượt xem chỉ có tương tác nhanh vẫn có INP đúng. */
const EVENT_DURATION_THRESHOLD_MS = 16;

type Name = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
interface NavTimingEntry extends PerformanceEntry {
  responseStart: number;
  type?: string;
}

let installed = false;

/** Quan sát một loại entry (buffered); không hỗ trợ → null (bỏ qua chỉ số đó). Trả cặp observer/callback để flush bằng takeRecords. */
function observe(type: string, cb: (entries: PerformanceEntry[]) => void) {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null;
    const po = new PerformanceObserver((list) => cb(list.getEntries()));
    po.observe({
      type,
      buffered: true,
      durationThreshold: EVENT_DURATION_THRESHOLD_MS,
    } as PerformanceObserverInit);
    return { po, cb };
  } catch (e) {
    reportClientError(`RUM ${type}`, e);
    return null;
  }
}

function install(): void {
  if (typeof PerformanceObserver === "undefined" || typeof navigator.sendBeacon !== "function") return;
  const page = location.pathname;
  const v: Partial<Record<Name, number>> = {};
  const shifts: ShiftEntry[] = [];
  let nt: NavTiming = {};
  let sent = false;
  const interaction = (es: PerformanceEntry[]) => {
    const ms = slowestInteractionMs(es);
    if (ms !== undefined) v.INP = Math.max(v.INP ?? 0, ms);
  };

  const observers = [
    observe("largest-contentful-paint", (es) => {
      v.LCP = lastStartTime(es, v.LCP);
    }),
    observe("layout-shift", (es) => {
      shifts.push(...(es as unknown as ShiftEntry[]));
      v.CLS = clsSessionWindow(shifts);
    }),
    observe("event", interaction),
    observe("first-input", interaction),
    observe("paint", (es) => {
      for (const e of es) if (e.name === "first-contentful-paint") v.FCP = e.startTime;
    }),
    observe("navigation", (es) => {
      nt = navTiming(es as NavTimingEntry[], nt);
      v.TTFB = nt.ttfb;
    }),
  ];

  const flush = () => {
    if (sent) return;
    for (const o of observers) if (o) o.cb(o.po.takeRecords()); // phần chưa giao cho callback
    const metrics: { name: Name; value: number }[] = [];
    for (const name of Object.keys(v) as Name[]) {
      const x = v[name];
      if (x === undefined || !Number.isFinite(x) || x < 0) continue;
      metrics.push({
        name,
        value: name === "CLS" ? Math.min(x, MAX_CLS) : Math.min(Math.round(x), MAX_TIME_MS),
      });
    }
    if (metrics.length === 0) return; // chưa có số đo: lần ẩn trang sau còn gửi được
    sent = true;
    const body = JSON.stringify({ page, nav: nt.nav, metrics });
    // sendBeacon trả false khi trình duyệt không xếp được hàng gửi: báo, không thử lại.
    if (!navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" })))
      reportClientError("RUM beacon", "sendBeacon false");
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  addEventListener("pagehide", flush);
}

export function RumBeacon() {
  useEffect(() => {
    if (installed) return;
    installed = true;
    install();
    // Không dọn khi unmount: cài đặt sống tới khi tài liệu bị bỏ (điều hướng client chỉ đổi component, không đổi tài liệu).
  }, []);
  return null;
}
