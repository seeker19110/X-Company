// Tiến trình con cho test tắt êm (ARC-RES-009/BE-REL-004): server http thật + registerShutdown() thật (bắt SIGTERM,
// đóng pool, thoát 0). In "READY <cổng>" khi sẵn sàng. /slow trả 200 sau SLOW_MS; /readyz dùng đúng lib/nen/health.
import http from "node:http";
import { getPool } from "../../lib/db/index.ts";
import { readiness } from "../../lib/nen/health.ts";
import { registerShutdown } from "../../lib/nen/shutdown.ts";

registerShutdown();
const slowMs = Number(process.env.SLOW_MS ?? 800);
async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.url === "/slow") {
    await new Promise((r) => setTimeout(r, slowMs));
    res.writeHead(200, { "content-type": "text/plain" }).end("xong");
  } else if (req.url === "/readyz") {
    const r = await readiness();
    res.writeHead(r.status, { "content-type": "application/json" }).end(await r.text());
  } else res.writeHead(404).end();
}
const server = http.createServer((req, res) => void handle(req, res));
await getPool().query("SELECT 1"); // có sẵn một kết nối trong pool để kiểm pool.end()
server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  if (addr && typeof addr === "object") console.log(`READY ${addr.port}`);
});
