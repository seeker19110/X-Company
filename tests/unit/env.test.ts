import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { collectFiles, findEnvViolations } from "../../scripts/check-env.ts";
import {
  CLIENT_SPEC,
  EnvError,
  PUBLIC_SECRET_NAME,
  SERVER_SPEC,
  clientSpecProblems,
  env,
  loadClientEnv,
  loadEnv,
  maskedEnv,
  printConfig,
  serverEnvNames,
} from "../../lib/nen/env.ts";

const SECRET = "s3cr3t-value-0123456789abcdef-0123456789";
const GOOD = {
  APP_ORIGIN: "https://x-company.example/",
  DATABASE_URL: "postgres://app:p4ssw0rd-hunter2" + "@db.internal:5432/xc", // ghép: không giống email trong fixture
  SESSION_SECRET: SECRET,
  QR_SIGNING_KEYS: "k1:qr-key-0123456789abcdef0123456789abcdef",
} as const;

// Khoá thử ghép lúc chạy (không literal khoá): 32 byte base64.
const DATA_KEY = Buffer.alloc(32, 7).toString("base64");

const issueNames = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof EnvError, "phải là EnvError");
    return e.issues.map((i) => i.name);
  }
  assert.fail("không ném lỗi");
};

describe("schema env (BASE-CFG-002)", () => {
  test("env trống → liệt kê MỌI biến bắt buộc thiếu theo tên", () => {
    const names = issueNames(() => loadEnv({}));
    for (const n of ["APP_ORIGIN", "DATABASE_URL", "SESSION_SECRET", "QR_SIGNING_KEYS"])
      assert.ok(names.includes(n), `thiếu ${n} trong lỗi`);
    assert.equal(names.includes("DB_POOL_MAX"), false, "biến tuỳ chọn không bị báo thiếu");
  });

  test("chuỗi rỗng/chỉ khoảng trắng = chưa đặt", () => {
    const names = issueNames(() => loadEnv({ ...GOOD, SESSION_SECRET: "   " }));
    assert.deepEqual(names, ["SESSION_SECRET"]);
  });

  test("giá trị sai → lỗi nêu TÊN biến, KHÔNG lộ giá trị", () => {
    const bad = {
      ...GOOD,
      DATABASE_URL: "khong-phai-url-mat-khau-hunter2",
      SESSION_SECRET: "ngan-secret-xyz",
      QR_SIGNING_KEYS: "k1:ngan-key-leak-me",
      APP_ORIGIN: "ftp://x.example",
      DB_POOL_MAX: "mười",
      TRUST_PROXY_HOPS: "-1",
      LOG_LEVEL: "tat-ca-leak",
      SITE_COMPANY_ID: "khong-phai-uuid-leak",
      NODE_ENV: "staging-leak",
    };
    let message = "";
    try {
      loadEnv(bad);
    } catch (e) {
      assert.ok(e instanceof EnvError);
      message = e.message;
    }
    for (const n of [
      "DATABASE_URL",
      "SESSION_SECRET",
      "QR_SIGNING_KEYS",
      "APP_ORIGIN",
      "DB_POOL_MAX",
      "TRUST_PROXY_HOPS",
      "LOG_LEVEL",
      "SITE_COMPANY_ID",
      "NODE_ENV",
    ])
      assert.ok(message.includes(n), `thiếu ${n}`);
    for (const leaked of [
      "hunter2",
      "ngan-secret-xyz",
      "leak-me",
      "ftp://",
      "mười",
      "tat-ca-leak",
      "staging-leak",
    ])
      assert.equal(message.includes(leaked), false, `lộ giá trị: ${leaked}`);
  });

  test("hợp lệ: chuẩn hoá và đặt mặc định", () => {
    const c = loadEnv({ ...GOOD });
    assert.equal(c.APP_ORIGIN, "https://x-company.example"); // chuẩn hoá về origin
    assert.equal(c.DB_POOL_MAX, 10);
    assert.equal(c.LOG_LEVEL, "info");
    assert.equal(c.NODE_ENV, "development");
    assert.equal(c.TRUST_PROXY_HOPS, undefined);
    assert.equal(loadEnv({ ...GOOD, TRUST_PROXY_HOPS: "0" }).TRUST_PROXY_HOPS, 0); // 0 ≠ chưa đặt
  });

  test("ca biên: SESSION_SECRET đúng 32 byte đạt, 31 byte hỏng; tính theo BYTE (Unicode)", () => {
    assert.equal(loadEnv({ ...GOOD, SESSION_SECRET: "a".repeat(32) }).SESSION_SECRET.length, 32);
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, SESSION_SECRET: "a".repeat(31) })),
      ["SESSION_SECRET"],
    );
    // 11 ký tự "ệ" = 33 byte UTF-8 nhưng chỉ 11 ký tự → đạt vì đếm byte
    assert.doesNotThrow(() => loadEnv({ ...GOOD, SESSION_SECRET: "ệ".repeat(11) }));
  });

  test("QR_SIGNING_KEYS: nhiều khoá hợp lệ; một khoá ngắn làm hỏng cả chuỗi", () => {
    const k = (id: string) => `${id}:${"x".repeat(32)}`;
    assert.doesNotThrow(() => loadEnv({ ...GOOD, QR_SIGNING_KEYS: `${k("a")},${k("b")}` }));
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, QR_SIGNING_KEYS: `${k("a")},b:ngan` })),
      ["QR_SIGNING_KEYS"],
    );
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, QR_SIGNING_KEYS: "khong-co-dau-hai-cham" })),
      ["QR_SIGNING_KEYS"],
    );
  });

  test("env(name) đọc lười process.env hiện tại và chỉ nêu tên biến đó", () => {
    const saved = process.env.SITE_COMPANY_ID;
    try {
      process.env.SITE_COMPANY_ID = "11111111-1111-4111-8111-111111111111";
      assert.equal(env("SITE_COMPANY_ID"), "11111111-1111-4111-8111-111111111111");
      process.env.SITE_COMPANY_ID = "rác-không-lộ";
      assert.throws(
        () => env("SITE_COMPANY_ID"),
        (e: unknown) => e instanceof EnvError && /SITE_COMPANY_ID/.test(e.message) && !/rác/.test(e.message),
      );
      delete process.env.SITE_COMPANY_ID;
      assert.equal(env("SITE_COMPANY_ID"), undefined);
    } finally {
      if (saved === undefined) delete process.env.SITE_COMPANY_ID;
      else process.env.SITE_COMPANY_ID = saved;
    }
    assert.throws(() => env("SESSION_SECRET", {}), /SESSION_SECRET/);
  });

  test("tên biến trong schema là duy nhất và viết hoa", () => {
    const names = serverEnvNames();
    assert.equal(new Set(names).size, names.length);
    for (const n of names) assert.match(n, /^[A-Z][A-Z0-9_]*$/);
  });
});

describe("che bí mật khi dump (BASE-CFG-005)", () => {
  const everything = {
    ...GOOD,
    MIGRATE_DATABASE_URL: "postgres://owner:owner-pw-leak@db:5432/xc",
    NODE_ENV: "production",
    TRUST_PROXY: "1",
    DATA_ENCRYPTION_KEYS: `k1:${DATA_KEY}`,
    DATA_INDEX_KEY: DATA_KEY,
    METRICS_TOKEN: "metrics-leak-0123456789abcdef",
    ALERT_WEBHOOK_URL: "https://hooks.example/webhook-leak-0123456789",
    KMS_PROVIDER: "transit",
    KMS_TRANSIT_ADDR: "https://kms.example.test:8200",
    KMS_TRANSIT_TOKEN: "kms-token-leak-0123456789",
    FILE_STORAGE_DIR: "/srv/files",
  };

  test("JSON.stringify(maskedEnv) cho *** ở MỌI trường bí mật và không lộ giá trị", () => {
    const masked = maskedEnv(loadEnv(everything));
    const secrets = Object.entries(SERVER_SPEC)
      .filter(([, f]) => "secret" in f && f.secret)
      .map(([n]) => n);
    assert.ok(secrets.length >= 4);
    for (const n of secrets) assert.equal(masked[n], "***", n);
    const dump = JSON.stringify(masked);
    assert.equal(masked.DATA_ENCRYPTION_KEYS, "***");
    assert.equal(masked.DATA_INDEX_KEY, "***");
    for (const leaked of [
      "hunter2",
      SECRET,
      "qr-key-0123",
      "owner-pw-leak",
      "metrics-leak",
      "webhook-leak",
      "kms-token-leak",
      DATA_KEY,
    ])
      assert.equal(dump.includes(leaked), false, `lộ ${leaked}`);
    assert.equal(masked.NODE_ENV, "production"); // không bí mật thì giữ nguyên
    assert.equal(masked.FILE_STORAGE_DIR, "/srv/files");
  });

  test("bí mật chưa đặt không bị giả làm ***", () => {
    assert.equal(maskedEnv(loadEnv(GOOD)).MIGRATE_DATABASE_URL, undefined);
  });

  test("printConfig dạng TÊN=giá trị, đã che", () => {
    const text = printConfig(everything);
    assert.match(text, /^APP_ORIGIN=https:\/\/x-company\.example$/m);
    assert.match(text, /^SESSION_SECRET=\*\*\*$/m);
    assert.equal(text.includes(SECRET), false);
  });
});

describe("khoá mã hoá dữ liệu lúc lưu (T-048) và cờ GPS (T-051)", () => {
  test("production thiếu khoá → lỗi nêu TÊN biến (fail-closed); dev/test không bắt buộc", () => {
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, NODE_ENV: "production" })),
      ["DATA_ENCRYPTION_KEYS", "DATA_INDEX_KEY", "TRUST_PROXY"],
    );
    assert.equal(loadEnv({ ...GOOD }).DATA_ENCRYPTION_KEYS, undefined);
  });

  test("khoá sai định dạng/độ dài/trùng id bị từ chối, không lộ giá trị", () => {
    for (const bad of ["k1:ngan", "khongcoid", `k1:${DATA_KEY},k1:${DATA_KEY}`, `bad id:${DATA_KEY}`]) {
      const names = issueNames(() => loadEnv({ ...GOOD, DATA_ENCRYPTION_KEYS: bad }));
      assert.deepEqual(names, ["DATA_ENCRYPTION_KEYS"]);
    }
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, DATA_INDEX_KEY: "ngan" })),
      ["DATA_INDEX_KEY"],
    );
    assert.equal(
      loadEnv({
        ...GOOD,
        DATA_ENCRYPTION_KEYS: `k2:${DATA_KEY},k1:${DATA_KEY}`,
      }).DATA_ENCRYPTION_KEYS?.startsWith("k2:"),
      true,
    );
  });

  test("KMS (T-052): mặc định env; transit bắt buộc ADDR + TOKEN; production + transit không bắt buộc khoá env nhưng vẫn bắt DATA_INDEX_KEY", () => {
    assert.equal(loadEnv({ ...GOOD }).KMS_PROVIDER, "env");
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, KMS_PROVIDER: "transit" })),
      ["KMS_TRANSIT_ADDR", "KMS_TRANSIT_TOKEN"],
    );
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, KMS_PROVIDER: "vault" })),
      ["KMS_PROVIDER"],
    );
    const transit = { ...GOOD, KMS_PROVIDER: "transit", KMS_TRANSIT_ADDR: "https://kms.example.test:8200" };
    const tok = ["kms", "tok", "12345678"].join("-"); // ghép lúc chạy: không có literal giống bí mật
    assert.equal(loadEnv({ ...transit, KMS_TRANSIT_TOKEN: tok }).KMS_TRANSIT_MOUNT, "transit");
    assert.deepEqual(
      issueNames(() => loadEnv({ ...transit, KMS_TRANSIT_TOKEN: tok, NODE_ENV: "production" })),
      ["DATA_INDEX_KEY", "TRUST_PROXY"],
    );
    assert.deepEqual(
      issueNames(() => loadEnv({ ...transit, KMS_TRANSIT_TOKEN: "ngan" })),
      ["KMS_TRANSIT_TOKEN"],
    );
    for (const bad of [{ KMS_TIMEOUT_MS: "10" }, { KMS_RETRIES: "9" }, { KMS_TRANSIT_KEY: "a/b" }])
      assert.equal(issueNames(() => loadEnv({ ...GOOD, ...bad })).length, 1);
  });

  test("GEO_CAPTURE_ENABLED mặc định TẮT; chỉ true|false", () => {
    assert.equal(loadEnv({ ...GOOD }).GEO_CAPTURE_ENABLED, false);
    assert.equal(loadEnv({ ...GOOD, GEO_CAPTURE_ENABLED: "true" }).GEO_CAPTURE_ENABLED, true);
    assert.deepEqual(
      issueNames(() => loadEnv({ ...GOOD, GEO_CAPTURE_ENABLED: "1" })),
      ["GEO_CAPTURE_ENABLED"],
    );
  });
});

describe("tách client/server (BASE-CFG-008, PRF-WEB-003)", () => {
  test("schema client hiện tại sạch và loadClientEnv không trả biến server", () => {
    assert.deepEqual(clientSpecProblems(), []);
    assert.deepEqual(loadClientEnv({ ...GOOD }), {});
    for (const n of Object.keys(CLIENT_SPEC)) assert.match(n, /^NEXT_PUBLIC_/);
  });

  test("schema client lệch (không tiền tố / bí mật / tên gợi bí mật) bị báo", () => {
    const f = (secret = false) => ({ schema: z.string(), secret });
    const problems = clientSpecProblems({
      DATABASE_URL: f(),
      ["NEXT_PUBLIC_" + "API_KEY"]: f(),
      NEXT_PUBLIC_SITE_NAME: f(true),
      NEXT_PUBLIC_OK: f(),
    });
    assert.equal(problems.length, 3);
    assert.ok(problems.some((p) => p.startsWith("DATABASE_URL")));
    assert.ok(problems.some((p) => p.includes("NEXT_PUBLIC_API_KEY")));
    assert.ok(problems.some((p) => p.startsWith("NEXT_PUBLIC_SITE_NAME")));
    assert.equal(
      problems.some((p) => p.startsWith("NEXT_PUBLIC_OK")),
      false,
    );
  });

  test("biến server không có tiền tố công khai", () => {
    for (const n of serverEnvNames()) assert.equal(n.startsWith("NEXT_PUBLIC_"), false, n);
  });

  test("PUBLIC_SECRET_NAME bắt SECRET|KEY|TOKEN|PASSWORD", () => {
    for (const n of ["SECRET_X", "API_KEY", "AUTH_TOKEN", "DB_PASSWORD"]) assert.match(n, PUBLIC_SECRET_NAME);
    assert.doesNotMatch("SITE_NAME", PUBLIC_SECRET_NAME);
  });
});

describe("check:env — chặn process.env ngoài module env", () => {
  const f = (path: string, text: string) => ({ path, text });

  test("phát hiện đọc process.env ở lib/app/proxy; cho phép module env, scripts, tests", () => {
    const v = findEnvViolations([
      f("lib/a.ts", "const x = process.env.FOO;"),
      f("app/page.tsx", "const { A } = process.env;"),
      f("proxy.ts", "if (process.env['X']) {}"),
      f("lib/b.ts", 'const e = process["env"];'),
      f("lib/nen/env.ts", "const x = process.env;"),
      f("scripts/s.ts", "process.env.A"),
      f("tests/t.ts", "process.env.A"),
    ]);
    assert.deepEqual(
      v.map((s) => s.split(":")[0]),
      ["lib/a.ts", "app/page.tsx", "proxy.ts", "lib/b.ts"],
    );
  });

  test("bỏ qua chú thích; instrumentation chỉ cho NEXT_RUNTIME", () => {
    assert.deepEqual(
      findEnvViolations([
        f("lib/a.ts", "// không dùng process.env.X ở đây\n/* process.env.Y */\nconst a = 1;"),
        f("instrumentation.ts", 'if (process.env.NEXT_RUNTIME === "nodejs") {}'),
      ]),
      [],
    );
    assert.equal(
      findEnvViolations([f("instrumentation.ts", "const k = process.env.SECRET_THING;")]).length,
      1,
    );
    assert.equal(findEnvViolations([f("lib/a.ts", "process.env.NEXT_RUNTIME")]).length, 1);
  });

  test("tên NEXT_PUBLIC_ chứa SECRET|KEY|TOKEN|PASSWORD bị chặn ở mọi tệp quét", () => {
    const bad = ["NEXT_PUBLIC_", "SUPABASE_SERVICE_KEY"].join("");
    const v = findEnvViolations([
      f("app/x.tsx", `const a = process_like.${bad};`),
      f(".github/workflows/ci.yml", `env:\n  ${["NEXT_PUBLIC_", "AUTH_TOKEN"].join("")}: x`),
      f("lib/ok.ts", "const n = 'NEXT_PUBLIC_SITE_NAME';"),
    ]);
    assert.equal(v.length, 2);
    assert.ok(v.every((s) => /SECRET\|KEY\|TOKEN\|PASSWORD/.test(s)));
  });

  test("mã nguồn hiện tại của repo đạt (0 vi phạm)", () => {
    const files = collectFiles(process.cwd(), ["lib", "app", "scripts", "e2e", ".github"]).filter(
      (x) => x.path !== "scripts/check-env.ts",
    );
    for (const top of ["proxy.ts", "instrumentation.ts", "next.config.ts", "package.json"])
      files.push({ path: top, text: readFileSync(top, "utf8") });
    assert.deepEqual(findEnvViolations(files), []);
  });
});

describe("kiểm khi khởi động chạy trong tiến trình thật (BASE-CFG-002, FE-BUILD-005)", () => {
  const run = (envVars: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "const m = await import('./lib/nen/startup.ts'); m.assertEnvOrExit(); process.stdout.write('OK\\n');",
      ],
      {
        env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", ...envVars },
        encoding: "utf8",
        timeout: 30_000,
      },
    );

  test("env trống → exit ≠ 0, stderr liệt kê tên biến thiếu, stdout không có OK", () => {
    const r = run({});
    assert.notEqual(r.status, 0);
    assert.equal(r.status, 78);
    for (const n of ["APP_ORIGIN", "DATABASE_URL", "SESSION_SECRET", "QR_SIGNING_KEYS"])
      assert.match(r.stderr, new RegExp(n));
    assert.equal(r.stdout.includes("OK"), false);
    // log FATAL cũng là một dòng JSON hợp lệ
    const fatal = r.stdout
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(fatal.at(-1)?.level, "fatal");
  });

  test("giá trị sai → exit ≠ 0 và KHÔNG in giá trị ra stderr/stdout", () => {
    const r = run({ ...GOOD, SESSION_SECRET: "ngan-leak-me", DATABASE_URL: "mat-khau-hunter2" });
    assert.equal(r.status, 78);
    assert.match(r.stderr, /SESSION_SECRET/);
    assert.match(r.stderr, /DATABASE_URL/);
    for (const leaked of ["leak-me", "hunter2"]) {
      assert.equal(r.stderr.includes(leaked), false);
      assert.equal(r.stdout.includes(leaked), false);
    }
  });

  test("env hợp lệ → exit 0 và log cấu hình hiệu lực đã che bí mật", () => {
    const r = run({ ...GOOD });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK/);
    assert.equal(r.stdout.includes(SECRET), false);
    assert.equal(r.stdout.includes("hunter2"), false);
    const line = JSON.parse(r.stdout.split("\n")[0]!) as { config: Record<string, unknown> };
    assert.match(String(line.config.SESSION_SECRET), /^(\*\*\*|\[REDACTED\])$/); // che hai lớp: env + logger
    assert.equal(line.config.DATABASE_URL, "***");
  });
});

describe("TRUST_PROXY ở production (AUD-SEC-001)", () => {
  const prod = {
    ...GOOD,
    NODE_ENV: "production",
    DATA_ENCRYPTION_KEYS: `k1:${DATA_KEY}`,
    DATA_INDEX_KEY: DATA_KEY,
  };
  test("thiếu cả TRUST_PROXY lẫn TRUST_PROXY_HOPS → lỗi nêu tên biến; dev/test không bắt buộc", () => {
    assert.deepEqual(
      issueNames(() => loadEnv(prod)),
      ["TRUST_PROXY"],
    );
    assert.equal(loadEnv({ ...GOOD }).TRUST_PROXY, undefined);
  });
  test("khai tường minh: TRUST_PROXY=0, =1 hoặc HOPS (kể cả 0) đều hợp lệ", () => {
    assert.equal(loadEnv({ ...prod, TRUST_PROXY: "0" }).TRUST_PROXY, "0");
    assert.equal(loadEnv({ ...prod, TRUST_PROXY: "1" }).TRUST_PROXY, "1");
    assert.equal(loadEnv({ ...prod, TRUST_PROXY_HOPS: "0" }).TRUST_PROXY_HOPS, 0);
    assert.equal(loadEnv({ ...prod, TRUST_PROXY_HOPS: "2" }).TRUST_PROXY_HOPS, 2);
  });
});

describe("APP_ORIGIN ở production phải https (AUD-SEC-003)", () => {
  const prod = {
    ...GOOD,
    NODE_ENV: "production",
    TRUST_PROXY: "1",
    DATA_ENCRYPTION_KEYS: `k1:${DATA_KEY}`,
    DATA_INDEX_KEY: DATA_KEY,
  };
  test("http với tên miền thật → lỗi nêu tên biến (cookie mất Secure/__Host-, không HSTS)", () => {
    assert.deepEqual(
      issueNames(() => loadEnv({ ...prod, APP_ORIGIN: "http://x-company.example" })),
      ["APP_ORIGIN"],
    );
    assert.deepEqual(
      issueNames(() => loadEnv({ ...prod, APP_ORIGIN: "http://10.0.0.5:3000" })),
      ["APP_ORIGIN"],
    );
  });
  test("https luôn hợp lệ; http chỉ cho loopback (harness e2e/DAST chạy build production cục bộ); dev/test không ràng buộc", () => {
    assert.equal(loadEnv(prod).APP_ORIGIN, "https://x-company.example");
    for (const o of ["http://localhost:3100", "http://127.0.0.1:3100", "http://[::1]:3100"])
      assert.equal(loadEnv({ ...prod, APP_ORIGIN: o }).APP_ORIGIN, o);
    assert.equal(
      loadEnv({ ...GOOD, APP_ORIGIN: "http://x-company.example" }).APP_ORIGIN,
      "http://x-company.example",
    );
    assert.deepEqual(
      issueNames(() => loadEnv({ ...prod, APP_ORIGIN: "http://localhost.evil.example" })),
      ["APP_ORIGIN"],
    );
  });
});
