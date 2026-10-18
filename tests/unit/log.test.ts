import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  REDACTED,
  createLogger,
  parseTraceparent,
  redact,
  runWithLogContext,
  type LevelSetting,
} from "../../lib/nen/log.ts";
import { installProcessHandlers } from "../../lib/nen/startup.ts";
import { SECURITY_EVENTS, logSecurityEvent, securityEventSchema } from "../../lib/nen/security-event.ts";

function capture(level: LevelSetting = "debug") {
  const lines: string[] = [];
  const logger = createLogger({ sink: (l) => lines.push(l), level: () => level, service: "svc" });
  const records = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { logger, lines, records };
}

describe("cấu trúc bản ghi (BASE-ERR-005/006)", () => {
  test("đủ trường bắt buộc; timestamp RFC 3339 UTC ms; level_number theo OTel", () => {
    const { logger, records } = capture();
    logger.info("xin chào", { user_id: "u1" });
    logger.error("hỏng");
    const [a, b] = records();
    assert.match(String(a!.timestamp), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(a!.level, "info");
    assert.equal(a!.level_number, 9);
    assert.equal(b!.level_number, 17);
    assert.equal(a!.message, "xin chào");
    assert.equal(a!.service, "svc");
    assert.equal(typeof a!.version, "string");
    assert.equal(typeof a!.env, "string");
    assert.equal(a!.user_id, "u1");
  });

  test("request_id/trace_id/span_id lấy từ ngữ cảnh request, kể cả qua await", async () => {
    const { logger, records } = capture();
    await runWithLogContext(
      { request_id: "r1", trace_id: "t".repeat(32), span_id: "s".repeat(16) },
      async () => {
        await Promise.resolve();
        logger.info("trong request");
      },
    );
    logger.info("ngoài request");
    const [inside, outside] = records();
    assert.equal(inside!.request_id, "r1");
    assert.equal(inside!.trace_id, "t".repeat(32));
    assert.equal(inside!.span_id, "s".repeat(16));
    assert.equal(outside!.request_id, undefined);
  });

  test("lọc theo mức; silent tắt hẳn; child gắn thuộc tính; trường chuẩn không bị ghi đè", () => {
    const warn = capture("warn");
    warn.logger.info("bỏ");
    warn.logger.warn("giữ");
    assert.equal(warn.lines.length, 1);
    const silent = capture("silent");
    silent.logger.fatal("không ra");
    assert.equal(silent.lines.length, 0);
    const c = capture();
    c.logger.child({ module: "m" }).info("x", { level: "hacked", service: "evil", message: "evil" });
    const r = c.records()[0]!;
    assert.equal(r.module, "m");
    assert.equal(r.level, "info");
    assert.equal(r.service, "svc");
    assert.equal(r.message, "x");
  });

  test("giá trị đặc biệt không làm logger ném: vòng tham chiếu, BigInt, Date sai, Buffer, quá sâu, chuỗi rất dài", () => {
    const { logger, records } = capture();
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    let deep: Record<string, unknown> = { end: 1 };
    for (let i = 0; i < 20; i++) deep = { d: deep };
    logger.info("lạ", {
      loop,
      big: 10n,
      bad: new Date("x"),
      buf: Buffer.from("abc"),
      deep,
      long: "x".repeat(20000),
      fn: () => 1,
    });
    const r = records()[0]!;
    assert.equal((r.loop as Record<string, unknown>).self, "[Circular]");
    assert.equal(r.big, "10");
    assert.equal(r.bad, null);
    assert.equal(r.buf, "[Buffer 3]");
    assert.ok(String(r.long).length < 9000);
    assert.equal(r.fn, undefined);
  });

  test("ghi stdout thật: một dòng JSON parse được (head -1 | jq .)", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "const m = await import('./lib/nen/log.ts'); m.log.info('một', {a: 1}); m.log.warn('hai');",
      ],
      { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" }, encoding: "utf8" },
    );
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]!) as { message: string }).message, "một");
    assert.equal(r.stderr, "");
  });
});

describe("che dữ liệu nhạy cảm (SEC-SECRET-007, BASE-ERR-007, CMP-PRIV-008)", () => {
  test("theo tên trường: password|token|authorization|cookie|secret|key → [REDACTED], kể cả lồng/mảng", () => {
    const { logger, lines, records } = capture();
    logger.info("đăng nhập", {
      password: "hunter2",
      user: { name: "an", Token: "tok123", nested: { api_key: "k", apiKey: "k2", private_key: "pk" } },
      headers: { Authorization: "Bearer abcdefgh12345", cookie: "sid=1", "x-csrf-token": "c" },
      list: [{ secret: "s" }, { session_id: "x" }],
      signing_key: "k",
      idempotency_key: "i",
      client_secret: "cs",
    });
    const out = lines[0]!;
    for (const leaked of ["hunter2", "tok123", "abcdefgh12345", "sid=1", '"k"', '"k2"', '"pk"', '"cs"'])
      assert.equal(out.includes(leaked), false, leaked);
    const r = records()[0]!;
    assert.equal(r.password, REDACTED);
    assert.equal(r.signing_key, REDACTED);
    assert.equal((r.user as Record<string, unknown>).name, "an"); // trường thường giữ nguyên
    assert.equal((r.headers as Record<string, unknown>).Authorization, REDACTED);
    assert.equal(((r.list as Record<string, unknown>[])[0] as Record<string, unknown>).secret, REDACTED);
  });

  test("theo mẫu giá trị: Bearer, JWT, URL có mật khẩu, key=value, khoá cloud, PEM, email", () => {
    const { logger, lines } = capture();
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "abc123def456"].join(".");
    // Khoá giả ghép lúc chạy: mã nguồn không chứa mẫu nguyên vẹn để gitleaks/lệnh quét lịch sử không báo nhầm.
    const cloudKey = "AKIA" + "ABCDEFGHIJKLMNOP";
    const pem = ["-----BEGIN ", "PRIVATE KEY-----\nMIIabc\n-----END ", "PRIVATE KEY-----"].join("");
    const stripe = "sk_" + "live_ABCDEFGH12345";
    logger.error(
      `lỗi kết nối postgres://app:matkhau-bi-mat@db:5432/x với Bearer abcdef123456 jwt ${jwt} password=hunter2 ${stripe} ${cloudKey} an@example.com`,
      { note: pem, other: "token: xyz789abc" },
    );
    const out = lines[0]!;
    for (const leaked of [
      "matkhau-bi-mat",
      "abcdef123456",
      jwt,
      "hunter2",
      "ABCDEFGH12345",
      cloudKey,
      "an@example.com",
      "MIIabc",
      "xyz789abc",
    ])
      assert.equal(out.includes(leaked), false, leaked);
    assert.ok(out.includes(REDACTED));
  });

  test("PII thường: email/phone/toạ độ bị che theo tên trường; id thường giữ", () => {
    const r = redact({
      email: "a@example.test",
      phone: "0900000000",
      lat: 10.1,
      lng: 106.1,
      latitude: 1,
      request_id: "r",
      employee_id: "e1",
    });
    assert.equal(r.email, REDACTED);
    assert.equal(r.phone, REDACTED);
    assert.equal(r.lat, REDACTED);
    assert.equal(r.lng, REDACTED);
    assert.equal(r.latitude, REDACTED);
    assert.equal(r.request_id, "r");
    assert.equal(r.employee_id, "e1");
  });

  test("null/undefined của trường nhạy cảm không bị giả thành [REDACTED]", () => {
    const r = redact({ password: null, token: undefined });
    assert.equal(r.password, null);
    assert.equal(r.token, undefined);
  });
});

describe("chống log injection (BASE-ERR-008)", () => {
  test("CRLF/giả dòng log → đúng MỘT bản ghi, chuỗi nằm trong trường", () => {
    const { logger, lines, records } = capture();
    const evil = 'ok\n[ERROR] fake\r\n{"level":"fatal"}\u2028tiếp\u2029nữa';
    logger.info(evil, { user_agent: evil, [evil]: 1 });
    assert.equal(lines.length, 1);
    assert.equal(/[\n\r\u2028\u2029]/.test(lines[0]!), false);
    const r = records()[0]!;
    assert.equal(r.message, evil);
    assert.equal(r.user_agent, evil);
    assert.equal(r.level, "info");
  });
});

describe("ngoại lệ (BASE-ERR-009)", () => {
  test("exception.type/message/stacktrace + chuỗi cause đầy đủ", () => {
    const { logger, records } = capture();
    const root = new RangeError("gốc rễ");
    const mid = new Error("giữa", { cause: root });
    const top = new TypeError("ngoài cùng", { cause: mid });
    logger.error("thất bại", { err: top });
    const r = records()[0]!;
    assert.equal(r["exception.type"], "TypeError");
    assert.equal(r["exception.message"], "ngoài cùng");
    assert.match(String(r["exception.stacktrace"]), /TypeError: ngoài cùng\s+at /);
    const causes = r["exception.cause"] as Record<string, string>[];
    assert.deepEqual(
      causes.map((c) => [c["exception.type"], c["exception.message"]]),
      [
        ["Error", "giữa"],
        ["RangeError", "gốc rễ"],
      ],
    );
    assert.match(causes[1]!["exception.stacktrace"]!, /at /);
  });

  test("cause vòng không lặp vô hạn; cause không phải Error; lỗi không phải Error", () => {
    const { logger, records } = capture();
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    logger.error("vòng", { err: a });
    logger.error("chuỗi", { err: new Error("x", { cause: "nguyên nhân dạng chuỗi" }) });
    logger.error("lạ", { err: { code: 5 } });
    const [r1, r2, r3] = records();
    assert.equal((r1!["exception.cause"] as unknown[]).length, 1);
    assert.equal(
      (r2!["exception.cause"] as Record<string, string>[])[0]!["exception.message"],
      "nguyên nhân dạng chuỗi",
    );
    assert.deepEqual(r3!.err, { code: 5 });
  });

  test("message/stack của lỗi cũng được che bí mật", () => {
    const { logger, lines } = capture();
    logger.error("x", { err: new Error("connect postgres://u:pw-leak@h/db password=abc12345") });
    assert.equal(lines[0]!.includes("pw-leak"), false);
    assert.equal(lines[0]!.includes("abc12345"), false);
  });
});

describe("trace context", () => {
  test("parseTraceparent chấp nhận W3C hợp lệ, từ chối sai/toàn 0", () => {
    const ok = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
    assert.deepEqual(parseTraceparent(ok), { trace_id: "a".repeat(32) });
    for (const bad of [
      null,
      undefined,
      "",
      "rác",
      `00-${"0".repeat(32)}-${"b".repeat(16)}-01`,
      `00-${"a".repeat(31)}-${"b".repeat(16)}-01`,
    ])
      assert.equal(parseTraceparent(bad), null);
  });
});

describe("sự kiện bảo mật (SEC-LOG-001/002)", () => {
  test("mỗi sự kiện sinh một dòng log hợp lệ theo schema; không lộ email", () => {
    for (const event of SECURITY_EVENTS) {
      const { logger, lines, records } = capture();
      runWithLogContext(
        { request_id: "req-1", source_ip: "203.0.113.9", user_agent: "UA/1.0", actor_id: "u-1" },
        () => logSecurityEvent({ event, outcome: "denied", target: { type: "app_user", id: "t-1" } }, logger),
      );
      assert.equal(lines.length, 1, event);
      const parsed = securityEventSchema.parse(records()[0]);
      assert.equal(parsed.event, event);
      assert.deepEqual(parsed.actor, { type: "user", id: "u-1" });
      assert.equal(parsed.source_ip, "203.0.113.9");
      assert.equal(records()[0]!.level, "warn");
    }
  });

  test("ngoài request: actor ẩn danh, source_ip/user_agent = unknown; ghi đè request_id; mức theo outcome", () => {
    const { logger, records } = capture();
    logSecurityEvent(
      { event: "auth.login", outcome: "success", target: { type: "app_user" }, requestId: "r9" },
      logger,
    );
    logSecurityEvent(
      { event: "auth.login", outcome: "error", target: { type: "app_user" }, requestId: "r9" },
      logger,
    );
    const [ok, err] = records();
    const p = securityEventSchema.parse(ok);
    assert.deepEqual(p.actor, { type: "anonymous", id: null });
    assert.equal(p.source_ip, "unknown");
    assert.equal(p.request_id, "r9");
    assert.equal(ok!.level, "info");
    assert.equal(err!.level, "error");
  });

  test("schema từ chối thiếu trường / timestamp không UTC / outcome lạ / event lạ", () => {
    const good = {
      timestamp: "2026-10-18T08:00:00.000Z",
      event: "auth.login",
      actor: { type: "user", id: "u" },
      target: { type: "app_user", id: null },
      outcome: "success",
      source_ip: "1.2.3.4",
      user_agent: "ua",
      request_id: "r",
    };
    assert.ok(securityEventSchema.safeParse(good).success);
    const bad = (patch: Record<string, unknown>) =>
      securityEventSchema.safeParse({ ...good, ...patch }).success;
    assert.equal(bad({ timestamp: "2026-10-18T15:00:00.000+07:00" }), false);
    assert.equal(bad({ timestamp: "2026-10-18 08:00:00" }), false);
    assert.equal(bad({ outcome: "ok" }), false);
    assert.equal(bad({ event: "khac" }), false);
    assert.equal(bad({ source_ip: undefined }), false);
    assert.equal(bad({ request_id: "" }), false);
  });

  test("bảng docs/security/security-events.md liệt kê đúng tập sự kiện trong mã", () => {
    const doc = readFileSync("docs/security/security-events.md", "utf8");
    const table = doc.split("## Chưa nối")[0]!;
    const inDoc = [...table.matchAll(/^\|\s*`([a-z_.]+)`/gm)].map((m) => m[1]).sort();
    assert.deepEqual(inDoc, [...SECURITY_EVENTS].sort());
  });
});

describe("bắt lỗi toàn cục của tiến trình (BASE-ERR-002)", () => {
  test("handler ghi log ERROR cho rejection và FATAL + exit 1 cho exception (giả tiến trình)", () => {
    const { logger, records } = capture();
    const handlers: Record<string, (e: unknown) => void> = {};
    let exited: number | undefined;
    installProcessHandlers(logger, {
      on: ((ev: string, fn: (e: unknown) => void) => {
        handlers[ev] = fn;
      }) as never,
      exit: ((c: number) => {
        exited = c;
      }) as never,
    });
    handlers.unhandledRejection!(new Error("bị từ chối"));
    handlers.uncaughtException!(new Error("sập"));
    const [rej, exc] = records();
    assert.equal(rej!.level, "error");
    assert.equal(rej!["exception.message"], "bị từ chối");
    assert.equal(exc!.level, "fatal");
    assert.equal(exited, 1);
  });

  test("tiến trình thật: unhandledRejection được log mà không chết; uncaughtException → log FATAL, exit 1", () => {
    const code = `
      const { installProcessHandlers } = await import('./lib/nen/startup.ts');
      installProcessHandlers();
      Promise.reject(new Error('rejection-test'));
      await new Promise((r) => setTimeout(r, 50));
      process.stdout.write(JSON.stringify({ alive: true }) + '\\n');
      setTimeout(() => { throw new Error('crash-test'); }, 10);
      await new Promise((r) => setTimeout(r, 1000));
    `;
    const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
      encoding: "utf8",
      timeout: 30_000,
    });
    const recs = r.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(r.status, 1);
    assert.ok(recs.some((x) => x.level === "error" && x["exception.message"] === "rejection-test"));
    assert.ok(recs.some((x) => x.alive === true));
    const fatal = recs.find((x) => x.level === "fatal");
    assert.equal(fatal?.["exception.message"], "crash-test");
    assert.match(String(fatal?.["exception.stacktrace"]), /at /);
  });
});

describe("luật lint chống nuốt lỗi và console (BASE-ERR-001, BASE-GATE-003)", () => {
  test("ESLint báo .catch(() => {}), .catch(() => undefined) và console.log trong lib/", async () => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint();
    const lint = async (code: string) =>
      (await eslint.lintText(code, { filePath: "lib/nen/app-error.ts" }))[0]!.messages.map((m) => m.ruleId);
    assert.ok(
      (await lint("export const a = () => Promise.resolve().catch(() => {});\n")).includes(
        "no-restricted-syntax",
      ),
    );
    assert.ok(
      (await lint("export const a = () => Promise.resolve().catch(() => undefined);\n")).includes(
        "no-restricted-syntax",
      ),
    );
    assert.ok((await lint("export const a = () => { console.log(1); };\n")).includes("no-console"));
    assert.ok((await lint("export const a = () => { console.error(1); };\n")).includes("no-console"));
    assert.deepEqual(
      await lint("export const a = () => Promise.resolve().catch((e: unknown) => String(e));\n"),
      [],
    );
    assert.deepEqual(await lint("export const a = () => Promise.resolve().catch(() => false);\n"), []);
  });
});
