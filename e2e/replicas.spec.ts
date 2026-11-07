// ARC-RES-005 / ARC-STYLE-004 (T-116, D-073): HAI bản sao app (cùng bản build `next start`) sau một proxy round-robin KHÔNG sticky,
// dùng chung Postgres + kho tệp S3-compatible tự host (rclone serve s3, tests/helpers/s3-fixture.ts). Kiểm: phiên, CSRF, khoá
// idempotency, khoá đăng nhập (đếm sai) và tệp không phụ thuộc bộ nhớ/đĩa của từng tiến trình; không ghi tệp ngoài thư mục tạm.
// Bản sao nghe 127.0.0.1:3111/3112, proxy 127.0.0.1:3110 (APP_ORIGIN của hai bản sao). Máy chủ 3100 của playwright.config không dùng ở đây.
import { expect, test, type APIResponse } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startS3, type S3Fixture } from "../tests/helpers/s3-fixture.ts";
import { login, seed } from "./helpers";
import { startRoundRobinProxy, TARGET_HEADER, type RoundRobinProxy } from "./rr-proxy";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROXY = "http://127.0.0.1:3110";
/** Việc seed của nv5 (scripts/seed-e2e.ts) — không spec nào đổi trạng thái việc này. */
const TASK = "Đo điện trở nối đất";
const REPLICAS = [
  { name: "A", port: 3111 },
  { name: "B", port: 3112 },
];

let s3: S3Fixture;
let proxy: RoundRobinProxy;
const apps: { name: string; child: ChildProcess; dir: string; log: () => string }[] = [];
let startedAt = 0;

async function waitReady(port: number, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`bản sao :${port} thoát sớm (mã ${child.exitCode}): ${log()}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/readyz`, { signal: AbortSignal.timeout(2_000) });
      if (r.status === 200) return;
    } catch {
      /* chưa lên */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`bản sao :${port} không sẵn sàng sau 90 giây: ${log()}`);
}

/** Tệp thường dưới `dir` có mtime ≥ `since` (bỏ thư mục sinh/được phép: build, phụ thuộc, công cụ, kết quả test). */
function writtenSince(dir: string, since: number, skip: Set<string>, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (skip.has(r)) continue;
    if (e.isDirectory()) out.push(...writtenSince(dir, since, skip, r));
    else if (e.isFile() && statSync(path.join(dir, r)).mtimeMs >= since) out.push(r);
  }
  return out;
}

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

type Headers = Record<string, string>;
/** Gửi request qua proxy, chỉ đích bản sao `name` cho RIÊNG request này (header gỡ ở proxy) và kiểm đúng bản đó đã phục vụ. */
async function on(name: string, send: (h: Headers) => Promise<APIResponse>): Promise<APIResponse> {
  const res = await send({ [TARGET_HEADER]: name });
  expect(res.headers()["x-replica"], "proxy phải chuyển tới đúng bản sao").toBe(name);
  return res;
}

test.describe("2 bản sao sau proxy không sticky, chung Postgres + S3 @desktop", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.use({ baseURL: PROXY });

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    startedAt = Date.now() - 1_000;
    s3 = await startS3();
    for (const r of REPLICAS) {
      const dir = mkdtempSync(path.join(tmpdir(), `xc-replica-${r.name}-`));
      let out = "";
      const child = spawn(
        process.execPath,
        [
          path.join(ROOT, "node_modules/next/dist/bin/next"),
          "start",
          "-p",
          String(r.port),
          "-H",
          "127.0.0.1",
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            ...s3.env,
            APP_ORIGIN: PROXY,
            TRUST_PROXY: "1", // sau proxy: IP client lấy từ X-Forwarded-For (khoá đăng nhập theo IP thật)
            FILE_STORAGE_DIR: dir, // FILE_STORAGE=s3 → thư mục này phải RỖNG suốt test (không ghi đĩa cục bộ)
            SHUTDOWN_GRACE_MS: "1000",
            SHUTDOWN_READY_DELAY_MS: "0",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout?.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-4_000)));
      child.stderr?.on("data", (d: Buffer) => (out = (out + d.toString()).slice(-4_000)));
      apps.push({ name: r.name, child, dir, log: () => out });
    }
    for (const [i, r] of REPLICAS.entries()) await waitReady(r.port, apps[i]!.child, apps[i]!.log);
    proxy = await startRoundRobinProxy(3110, REPLICAS);
  });

  test.afterAll(async () => {
    await proxy?.close();
    for (const a of apps) {
      if (a.child.exitCode === null) {
        const done = new Promise((r) => a.child.once("exit", r));
        a.child.kill("SIGTERM");
        await done;
      }
      rmSync(a.dir, { recursive: true, force: true });
    }
    await s3?.stop();
  });

  test("trình duyệt qua proxy: đăng nhập + điều hướng, request rải đều cả hai bản sao, phiên dùng được ở cả hai", async ({
    page,
  }) => {
    const before = proxy.served.length;
    // nv5 + việc của nv5: "Lắp đặt tủ điện tầng 3" (nv) bị AT09 (flows.spec) nghiệm thu và biến khỏi danh sách khi chạy cả bộ.
    await login(page, "nv5");
    await page.goto("/app/tasks");
    await expect(page.getByText(TASK).first()).toBeVisible();
    await page.goto("/app/today");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const used = new Set(proxy.served.slice(before));
    expect([...used].sort(), "luồng trình duyệt phải đi qua cả A và B").toEqual(["A", "B"]);
    for (const r of ["A", "B"]) {
      const me = await on(r, (h) => page.request.get("/api/app/me", { headers: h }));
      expect(me.status()).toBe(200);
      expect(((await me.json()) as { email: string }).email).toBe(seed().users.nv5!.email);
    }
  });

  test("tệp: đăng nhập ở A, tải lên qua B, tải về qua A; Idempotency-Key gửi lại ở bản kia → cùng kết quả; S3 chỉ giữ bản mã", async ({
    request,
  }) => {
    const s = seed();
    const headers = { origin: PROXY };
    const loginRes = await on("A", (h) =>
      request.post("/api/app/auth/login", {
        data: { email: s.users.nv5!.email, password: s.password },
        headers: { ...headers, ...h },
      }),
    );
    expect(loginRes.status()).toBe(200);
    const csrf = ((await loginRes.json()) as { csrf_token: string }).csrf_token;
    const tasks = await on("B", (h) => request.get("/api/app/tasks", { headers: h }));
    expect(tasks.status()).toBe(200);
    const task = ((await tasks.json()) as { items: { id: string; title: string }[] }).items.find(
      (t) => t.title === TASK,
    );
    expect(task, "nv5 phải thấy việc của mình").toBeTruthy();

    const marker = `BAN-RO-${randomBytes(8).toString("hex")}`;
    const pdf = Buffer.from(`%PDF-1.7\n% ${marker}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
    const key = randomUUID();
    const upload = (h: Headers) =>
      request.post("/api/app/files", {
        headers: { ...headers, ...h, "x-csrf-token": csrf, "idempotency-key": key },
        multipart: {
          object_type: "task",
          object_id: task!.id,
          file: { name: "bien-ban-do-cach-dien.pdf", mimeType: "application/pdf", buffer: pdf },
        },
      });
    const up = await on("B", upload);
    expect(up.status()).toBe(201);
    const created = (await up.json()) as { file_id: string; version: number };

    const down = await on("A", (h) => request.get(`/api/app/files/${created.file_id}`, { headers: h }));
    expect(down.status()).toBe(200);
    expect(Buffer.compare(await down.body(), pdf)).toBe(0);

    const replay = await on("A", upload); // cùng khoá, bản sao khác → phản hồi cũ, không ghi lần hai
    expect(replay.status()).toBe(201);
    expect(((await replay.json()) as { file_id: string }).file_id).toBe(created.file_id);

    const objects = readdirSync(path.join(s3.dataDir, s3.bucket), {
      recursive: true,
      withFileTypes: true,
    }).filter((e) => e.isFile());
    expect(objects.length, "đúng MỘT đối tượng (gửi lại không tạo đối tượng thứ hai)").toBe(1);
    const raw = readFileSync(path.join(objects[0]!.parentPath, objects[0]!.name));
    expect(raw.subarray(0, 6).toString("latin1")).toBe("XCFILE");
    expect(raw.includes(Buffer.from(marker)), "bản rõ lọt vào kho S3").toBe(false);
    for (const a of apps)
      expect(filesIn(a.dir), `bản sao ${a.name} không được ghi tệp lên đĩa cục bộ`).toEqual([]);
  });

  test("đăng xuất ở B → phiên bị thu hồi ở A (không có phiên trong bộ nhớ tiến trình)", async ({
    request,
  }) => {
    const s = seed();
    const headers = { origin: PROXY };
    const res = await on("A", (h) =>
      request.post("/api/app/auth/login", {
        data: { email: s.users.nv2!.email, password: s.password },
        headers: { ...headers, ...h },
      }),
    );
    const csrf = ((await res.json()) as { csrf_token: string }).csrf_token;
    expect((await on("B", (h) => request.get("/api/app/me", { headers: h }))).status()).toBe(200);
    const out = await on("B", (h) =>
      request.post("/api/app/auth/logout", { headers: { ...headers, ...h, "x-csrf-token": csrf } }),
    );
    expect(out.ok()).toBe(true);
    expect((await on("A", (h) => request.get("/api/app/me", { headers: h }))).status()).toBe(401);
  });

  test("khoá đăng nhập đếm chung: 5 lần sai rải A/B → lần 6 (dù đúng mật khẩu) bị 429 ở bất kỳ bản sao", async ({
    request,
  }) => {
    const s = seed();
    const email = s.users.nv4!.email;
    const post = (password: string) => (h: Headers) =>
      request.post("/api/app/auth/login", { data: { email, password }, headers: { origin: PROXY, ...h } });
    for (let i = 0; i < 5; i++) {
      const r = await on(i % 2 === 0 ? "A" : "B", post(`sai-mat-khau-${i}-0123456789`));
      expect(r.status()).toBe(401);
    }
    expect((await on("B", post(s.password))).status()).toBe(429);
    expect((await on("A", post(s.password))).status()).toBe(429);
  });

  test("không ghi tệp ngoài thư mục tạm: cây dự án (kể cả .next/, .data/) không có tệp mới từ lúc bản sao khởi động", () => {
    // Bỏ: lịch sử git, phụ thuộc, công cụ tải về, đầu ra của chính Playwright (test-results/, playwright-report/), và trạng
    // thái của harness agent (.autopilot/ — hook guard ghi nhật ký mỗi lệnh; .claude/ — worktree của agent) vốn ghi song
    // song với test khi chạy trong phiên agent, không phải tệp của ứng dụng.
    const skip = new Set([
      ".git",
      "node_modules",
      ".tools",
      "test-results",
      "playwright-report",
      ".autopilot",
      ".claude",
    ]);
    expect(writtenSince(ROOT, startedAt, skip)).toEqual([]);
  });
});
