// Proxy HTTP round-robin KHÔNG sticky cho e2e 2 bản sao (T-116, ARC-RES-005, ARC-STYLE-004): mỗi request (không phải mỗi kết nối)
// đi tới bản sao kế tiếp theo vòng; không có cookie/IP affinity. Thêm X-Forwarded-For (app chạy TRUST_PROXY=1 như sau proxy thật) và
// header phản hồi `x-replica` để test biết bản nào đã phục vụ. Request của TEST có thể chỉ đích cho riêng nó bằng header
// `x-replica-target: <tên>` (bị gỡ trước khi chuyển tiếp) để kiểm tất định "đăng nhập ở A, tải lên qua B" — không ghim phiên, không
// ảnh hưởng request khác (trình duyệt vẫn xoay vòng). Chỉ nghe 127.0.0.1. Chỉ dùng trong e2e.
import http from "node:http";
import type { Socket } from "node:net";

export interface Replica {
  name: string;
  port: number;
}

export interface RoundRobinProxy {
  /** Bản sao đã phục vụ từng request xoay vòng (không tính request có `x-replica-target`), theo thứ tự. */
  served: string[];
  close(): Promise<void>;
}

export const TARGET_HEADER = "x-replica-target";

export async function startRoundRobinProxy(port: number, replicas: Replica[]): Promise<RoundRobinProxy> {
  let next = 0;
  const served: string[] = [];
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const want = req.headers[TARGET_HEADER];
    let r: Replica | undefined;
    if (typeof want === "string") {
      r = replicas.find((x) => x.name === want);
      if (!r) {
        res.writeHead(400).end();
        return;
      }
    } else {
      r = replicas[next % replicas.length]!;
      next += 1;
      served.push(r.name);
    }
    const target = r;
    const peer = req.socket.remoteAddress ?? "127.0.0.1";
    const xff = req.headers["x-forwarded-for"];
    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers[TARGET_HEADER];
    headers["x-forwarded-for"] = typeof xff === "string" && xff !== "" ? `${xff}, ${peer}` : peer;
    headers["x-forwarded-proto"] = "http";
    const up = http.request(
      { host: "127.0.0.1", port: target.port, method: req.method, path: req.url, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, { ...upRes.headers, "x-replica": target.name });
        upRes.pipe(res);
      },
    );
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "x-replica": target.name });
      res.end();
    });
    req.pipe(up);
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    served,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}
