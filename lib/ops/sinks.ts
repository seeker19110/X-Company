// i18n-ignore-file: nội dung cảnh báo gửi tới kênh trực của vận hành, không tới người dùng cuối
// Kênh đích của cảnh báo (T-046): (1) tệp JSON-lines `ALERT_SINK_FILE` (mặc định), (2) dòng log sự kiện bảo mật
// `ops.alert`; (3) webhook HTTP tuỳ chọn có timeout nằm ở scripts/alert-channels.ts (lib/ không chứa client mạng — DB-TX-003). Thông điệp KHÔNG chứa bí mật/PII: chỉ mã luật, mức, giá trị đo,
// ngưỡng, runbook. URL webhook là bí mật (có thể chứa token) — không bao giờ vào log hay thông điệp lỗi.
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { log, type Logger } from "../nen/log.ts";
import { logSecurityEvent } from "../nen/security-event.ts";
import type { Severity } from "./rules.ts";

export interface AlertNotification {
  /** UTC ISO-8601. */
  timestamp: string;
  status: "firing" | "resolved";
  /** true = nhắc lại một cảnh báo đang bắn (đã hết cửa sổ chống lặp). */
  repeat: boolean;
  rule: string;
  severity: Severity;
  summary: string;
  owner: string;
  runbook: string;
  /** Giá trị đo được lúc gửi (null khi không có dữ liệu). */
  value: number | null;
  threshold: number;
  /** Lúc điều kiện bắt đầu đúng (UTC ISO). */
  since: string | null;
}

export interface AlertSink {
  readonly name: string;
  send(n: AlertNotification): Promise<void>;
}

/** Kênh log: một dòng sự kiện bảo mật `ops.alert` (firing = error, resolved = success). `logger` tiêm được để kiểm thử. */
export function makeLogSink(logger: Logger = log): AlertSink {
  return {
    name: "log",
    async send(n) {
      logSecurityEvent(
        {
          event: "ops.alert",
          outcome: n.status === "firing" ? "error" : "success",
          actorId: null,
          target: { type: "alert_rule", id: n.rule },
          detail: {
            status: n.status,
            severity: n.severity,
            value: n.value,
            threshold: n.threshold,
            runbook: n.runbook,
            repeat: n.repeat,
          },
        },
        logger,
      );
    },
  };
}
export const logSink: AlertSink = makeLogSink();

export function fileSink(file: string): AlertSink {
  return {
    name: "file",
    async send(n) {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await appendFile(file, `${JSON.stringify(n)}\n`, { mode: 0o600 });
    },
  };
}
