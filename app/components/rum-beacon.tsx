"use client";

import { useEffect } from "react";
import { reportClientError } from "./client-log";

// RUM web-vitals tự làm (T-056, D-042): không phụ thuộc, không bên thứ ba, không cookie/định danh. MỘT beacon cho mỗi lần tải
// trang (lúc ẩn trang), gửi về /api/public/rum. Chỉ gửi pathname của lần tải đó (server chuẩn hoá thành nhãn trang có số giá trị
// bị chặn, không lưu id/slug). Chỉ số: LCP, INP (xấp xỉ: thời lượng lớn nhất của tương tác), CLS (tổng), FCP, TTFB.
const ENDPOINT = "/api/public/rum";
/** Trần phía client khớp trần phía server (lib/rum RUM_MAX_TIME_MS / RUM_MAX_CLS): vượt thì cắt, không để cả beacon bị từ chối. */
const MAX_TIME_MS = 120_000;
const MAX_CLS = 10;
const INP_DURATION_THRESHOLD_MS = 40;

type Name = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
interface Sample {
  name: Name;
  value: number;
}
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number;
}
interface NavTimingEntry extends PerformanceEntry {
  responseStart: number;
  type?: string;
}

/** Quan sát một loại entry (buffered); trình duyệt không hỗ trợ → null (bỏ qua chỉ số đó, không lỗi). */
function observe(type: string, onEntries: (entries: PerformanceEntry[]) => void): PerformanceObserver | null {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null;
    const po = new PerformanceObserver((list) => onEntries(list.getEntries()));
    // durationThreshold chỉ có nghĩa với type 'event' (INP); các type khác bỏ qua.
    po.observe({
      type,
      buffered: true,
      durationThreshold: INP_DURATION_THRESHOLD_MS,
    } as PerformanceObserverInit);
    return po;
  } catch (e) {
    reportClientError(`RUM ${type}`, e);
    return null;
  }
}

export function RumBeacon() {
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined" || typeof navigator.sendBeacon !== "function") return;
    const page = location.pathname;
    const v: Partial<Record<Name, number>> = {};
    let nav: string | undefined;
    let sent = false;

    const observers = [
      observe("largest-contentful-paint", (es) => {
        v.LCP = es[es.length - 1]?.startTime;
      }),
      observe("layout-shift", (es) => {
        for (const e of es as LayoutShiftEntry[]) if (!e.hadRecentInput) v.CLS = (v.CLS ?? 0) + e.value;
      }),
      observe("event", (es) => {
        for (const e of es as EventTimingEntry[])
          if ((e.interactionId ?? 0) > 0) v.INP = Math.max(v.INP ?? 0, e.duration);
      }),
      observe("paint", (es) => {
        for (const e of es) if (e.name === "first-contentful-paint") v.FCP = e.startTime;
      }),
      observe("navigation", (es) => {
        const e = es[0] as NavTimingEntry | undefined;
        v.TTFB = e?.responseStart;
        nav = e?.type;
      }),
    ];

    const flush = () => {
      if (sent) return;
      sent = true;
      for (const po of observers) po?.takeRecords(); // phần chưa giao cho callback (không ném)
      const metrics: Sample[] = [];
      for (const name of Object.keys(v) as Name[]) {
        const x = v[name];
        if (x === undefined || !Number.isFinite(x) || x < 0) continue;
        metrics.push({
          name,
          value: name === "CLS" ? Math.min(x, MAX_CLS) : Math.min(Math.round(x), MAX_TIME_MS),
        });
      }
      if (metrics.length === 0) return;
      const body = JSON.stringify({ page, nav, metrics });
      // sendBeacon trả false khi trình duyệt không xếp được hàng gửi (vd quá cỡ hàng đợi): báo, không thử lại.
      if (!navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" })))
        reportClientError("RUM beacon", "sendBeacon false");
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", flush);
      for (const po of observers) po?.disconnect();
    };
  }, []);
  return null;
}
