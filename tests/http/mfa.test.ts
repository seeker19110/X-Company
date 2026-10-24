// Xác thực hai bước TOTP (AUD-SEC-002, D-058; SPEC-identity-org S-ID-10..13).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { grantRole } from "../../lib/authz/grants.ts";
import { SYSTEM_ACTOR } from "../../lib/authz/index.ts";
import { withTx } from "../../lib/db/index.ts";
import { loginHandler, meHandler, mfaHandler } from "../../lib/identity/routes.ts";
import { verifyMfa } from "../../lib/identity/mfa.ts";
import { base32Decode, hotp, totpStep } from "../../lib/identity/totp.pure.ts";
import { AppError } from "../../lib/nen/app-error.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import {
  cookieFrom,
  loginThrough,
  nextTotpCode,
  PASSWORD,
  req,
  seedCompany,
  seedUser,
  setTestEnv,
  totpStateOf,
} from "../helpers/fixtures.ts";

setTestEnv();

type LoginBody = {
  mfa?: "totp" | "totp_enroll";
  challenge?: string;
  secret?: string;
  otpauth_uri?: string;
  user_id?: string;
  csrf_token?: string;
};

async function passwordStep(email: string): Promise<{ res: Response; body: LoginBody }> {
  const res = await loginHandler(req("POST", "/api/app/auth/login", { body: { email, password: PASSWORD } }));
  return { res, body: (await res.json()) as LoginBody };
}
const sendCode = (
  challenge: string,
  code: string,
  opts: { origin?: string | null; headers?: Record<string, string> } = {},
) => mfaHandler(req("POST", "/api/app/auth/mfa", { body: { challenge, code }, ...opts }));
const codeOf = async (res: Response) => ((await res.json()) as { code: string }).code;

/** Mã chắc chắn sai: 6 chữ số không trùng mã nào trong cửa sổ ±2 bước. */
function wrongCode(secretB32: string): string {
  const s = base32Decode(secretB32)!;
  const cur = totpStep(Date.now());
  const near = new Set([-2, -1, 0, 1, 2].map((d) => hotp(s, cur + d)));
  for (let n = 0; ; n++) {
    const c = String(n).padStart(6, "0");
    if (!near.has(c)) return c;
  }
}

describe("TOTP hai bước (AUD-SEC-002)", () => {
  let db: TestDb;
  let org: Awaited<ReturnType<typeof seedCompany>>;

  before(async () => {
    db = await freshDb();
    org = await seedCompany();
  });
  after(async () => {
    await db.close();
  });

  /** Người dùng vai trò bắt buộc đã bật TOTP (qua đúng luồng đăng ký). */
  async function enrolled(role: "hr" | "sysadmin" | "executive" = "hr") {
    const u = await seedUser(org.companyId, { grants: [{ role, scopeType: "company" }] });
    assert.equal((await loginThrough(u.email)).status, 200);
    const st = await totpStateOf(u.email);
    assert.ok(st.secret);
    return { ...u, secret: st.secret };
  }

  test("S-ID-10: HR đã bật TOTP — đúng mật khẩu → không cookie, có challenge; mã đúng → 200 + cookie phiên có mfa_at", async () => {
    const u = await enrolled("hr");
    const { res, body } = await passwordStep(u.email);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("set-cookie"), null, "chưa qua TOTP thì không cấp phiên");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(body.mfa, "totp");
    assert.match(body.challenge!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(body.secret, undefined, "đã bật thì không trả lại bí mật");
    assert.equal(body.csrf_token, undefined);
    // DB chỉ lưu băm token thử thách.
    const raw = await db.admin.query("SELECT count(*)::int AS n FROM mfa_challenge WHERE token_hash = $1", [
      body.challenge,
    ]);
    assert.equal(raw.rows[0].n, 0);

    const ok = await sendCode(
      body.challenge!,
      await nextTotpCode(u.secret, (await totpStateOf(u.email)).lastStep),
    );
    assert.equal(ok.status, 200);
    const okBody = (await ok.json()) as LoginBody;
    assert.equal(okBody.user_id, u.userId);
    assert.match(String(okBody.csrf_token), /\S/);
    const cookie = cookieFrom(ok);
    assert.match(ok.headers.get("set-cookie") ?? "", /HttpOnly/);
    const me = await meHandler(req("GET", "/api/app/me", { cookie }));
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).roles, [{ role: "hr", scope_type: "company", scope_id: null }]);
    const s = await db.admin.query(
      "SELECT count(*)::int AS n FROM session WHERE user_id = $1 AND mfa_at IS NOT NULL",
      [u.userId],
    );
    assert.ok(s.rows[0].n >= 1);
    const a = await db.admin.query(
      "SELECT action, result FROM audit_event WHERE actor_user_id = $1 AND action LIKE 'auth.%' ORDER BY seq",
      [u.userId],
    );
    const actions = a.rows.map((r) => `${r.action}:${r.result}`);
    assert.ok(actions.includes("auth.mfa_challenge:ok"));
    assert.ok(actions.includes("auth.login:ok"));
  });

  test("S-ID-11: 5 mã sai huỷ thử thách (lần 6 → MFA_CHALLENGE_INVALID, kể cả mã đúng); phát lại mã đã dùng → 401", async () => {
    const u = await enrolled("executive");
    const { body } = await passwordStep(u.email);
    for (let i = 1; i <= 5; i++) {
      const r = await sendCode(body.challenge!, wrongCode(u.secret));
      assert.equal(r.status, 401, `lần ${i}`);
      assert.equal(await codeOf(r), "INVALID_MFA_CODE");
      assert.equal(r.headers.get("set-cookie"), null);
    }
    const sixth = await sendCode(
      body.challenge!,
      await nextTotpCode(u.secret, (await totpStateOf(u.email)).lastStep),
    );
    assert.equal(sixth.status, 401);
    assert.equal(await codeOf(sixth), "MFA_CHALLENGE_INVALID");
    const left = await db.admin.query("SELECT count(*)::int AS n FROM mfa_challenge WHERE user_id = $1", [
      u.userId,
    ]);
    assert.equal(left.rows[0].n, 0);
    const denied = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.mfa' AND result = 'denied' AND object_id = $1",
      [u.userId],
    );
    assert.equal(denied.rows[0].n, 5);

    // Phát lại: mã đúng đã dùng một lần, gửi lại cho thử thách mới trong cùng bước → 401.
    const first = await passwordStep(u.email);
    const code = await nextTotpCode(u.secret, (await totpStateOf(u.email)).lastStep);
    assert.equal((await sendCode(first.body.challenge!, code)).status, 200);
    const second = await passwordStep(u.email);
    const replay = await sendCode(second.body.challenge!, code);
    assert.equal(replay.status, 401);
    assert.equal(await codeOf(replay), "INVALID_MFA_CODE");
    // Thử thách đã dùng thành công không dùng lại được.
    const reuse = await sendCode(first.body.challenge!, code);
    assert.equal(await codeOf(reuse), "MFA_CHALLENGE_INVALID");
  });

  test("S-ID-12: sysadmin chưa đăng ký — đăng nhập → totp_enroll + bí mật; xác nhận mã đúng → TOTP bật, có phiên", async () => {
    const u = await seedUser(org.companyId, { grants: [{ role: "sysadmin", scopeType: "company" }] });
    const { res, body } = await passwordStep(u.email);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(body.mfa, "totp_enroll");
    assert.match(body.secret!, /^[A-Z2-7]{32}$/, "20 byte base32 không padding");
    assert.equal(base32Decode(body.secret!)!.length, 20);
    const uri = new URL(body.otpauth_uri!);
    assert.equal(uri.protocol, "otpauth:");
    assert.equal(uri.searchParams.get("secret"), body.secret);
    assert.equal(uri.searchParams.get("issuer"), "X-Company");
    let row = (await db.admin.query("SELECT * FROM app_user WHERE id = $1", [u.userId])).rows[0];
    assert.equal(row.totp_enabled_at, null, "chưa xác nhận mã thì chưa bật");
    assert.equal(row.totp_secret_enc, null);
    // Bí mật tạm trong thử thách là bản mã, không phải bản rõ.
    const ch = (await db.admin.query("SELECT secret_enc FROM mfa_challenge WHERE user_id = $1", [u.userId]))
      .rows[0];
    assert.match(ch.secret_enc, /^v\d:/);
    assert.equal(String(ch.secret_enc).includes(body.secret!), false);

    const ok = await sendCode(body.challenge!, await nextTotpCode(body.secret!, null));
    assert.equal(ok.status, 200);
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie: cookieFrom(ok) }))).status, 200);
    row = (await db.admin.query("SELECT * FROM app_user WHERE id = $1", [u.userId])).rows[0];
    assert.ok(row.totp_enabled_at instanceof Date);
    assert.equal(row.totp_secret, null, "cột bản rõ luôn NULL");
    assert.match(row.totp_secret_enc, /^v\d:/);
    assert.equal((await totpStateOf(u.email)).secret, body.secret);
    const enroll = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_event WHERE action = 'auth.mfa_enroll' AND object_id = $1",
      [u.userId],
    );
    assert.equal(enroll.rows[0].n, 1);
    // Lần sau: chỉ hỏi mã, không cấp bí mật mới.
    assert.equal((await passwordStep(u.email)).body.mfa, "totp");
    // CHECK: không ghi được bí mật bản rõ kể cả bằng role owner.
    await assert.rejects(
      db.admin.query("UPDATE app_user SET totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id = $1", [u.userId]),
      /app_user_totp_secret_never_plain/,
    );
  });

  test("S-ID-13: phiên không MFA, vai trò `hr` tới hiệu lực → request kế tiếp 401 MFA_REQUIRED; phiên MFA thì được (api5-bfla)", async () => {
    const u = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    // Grant hẹn giờ: cấp ngay bây giờ (huỷ phiên cũ — BE-AUTH-004), hiệu lực sau 1,5 s.
    const validFrom = new Date(Date.now() + 1500);
    await withTx((tx) =>
      grantRole(tx, SYSTEM_ACTOR, org.companyId, {
        userId: u.userId,
        role: "hr",
        scopeType: "company",
        validFrom,
      }),
    );
    const plain = await passwordStep(u.email);
    assert.equal(plain.body.mfa, undefined, "grant chưa hiệu lực → đăng nhập như cũ");
    const cookie = cookieFrom(plain.res);
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie }))).status, 200);
    await new Promise((r) => setTimeout(r, Math.max(0, validFrom.getTime() - Date.now() + 100)));
    const denied = await meHandler(req("GET", "/api/app/me", { cookie }));
    assert.equal(denied.status, 401);
    assert.equal(await codeOf(denied), "MFA_REQUIRED");
    // Đi qua TOTP (đăng ký lần đầu) → phiên mới dùng được với vai trò hr.
    const ok = await loginThrough(u.email);
    assert.equal(ok.status, 200);
    const me = await meHandler(req("GET", "/api/app/me", { cookie: cookieFrom(ok) }));
    assert.equal(me.status, 200);
    assert.ok(((await me.json()).roles as { role: string }[]).some((r) => r.role === "hr"));
  });

  test("người không cần MFA đăng nhập như cũ (cookie ngay, phiên không mfa_at)", async () => {
    const u = await seedUser(org.companyId, { grants: [{ role: "employee", scopeType: "self" }] });
    const { res, body } = await passwordStep(u.email);
    assert.equal(res.status, 200);
    assert.equal(body.mfa, undefined);
    assert.equal(body.user_id, u.userId);
    assert.match(res.headers.get("set-cookie") ?? "", /^xc_session=/);
    const s = await db.admin.query("SELECT mfa_at FROM session WHERE user_id = $1", [u.userId]);
    assert.deepEqual(s.rows, [{ mfa_at: null }]);
  });

  test("thử thách hết hạn (> 5 phút) / rác / của người khác → từ chối, không cấp phiên", async () => {
    const a = await enrolled("hr");
    const b = await enrolled("hr");
    const { body } = await passwordStep(a.email);
    const code = await nextTotpCode(a.secret, (await totpStateOf(a.email)).lastStep);
    await assert.rejects(
      verifyMfa(
        db.app,
        { challenge: body.challenge!, code, ip: "direct" },
        new Date(Date.now() + 6 * 60_000),
      ),
      (e: unknown) => e instanceof AppError && e.code === "MFA_CHALLENGE_INVALID" && e.status === 401,
    );
    const gone = await db.admin.query("SELECT count(*)::int AS n FROM mfa_challenge WHERE user_id = $1", [
      a.userId,
    ]);
    assert.equal(gone.rows[0].n, 0, "thử thách hết hạn bị xoá");
    assert.equal(await codeOf(await sendCode(body.challenge!, code)), "MFA_CHALLENGE_INVALID");
    assert.equal(await codeOf(await sendCode("rac-khong-ton-tai", code)), "MFA_CHALLENGE_INVALID");
    // Thử thách của A + mã của B → mã sai cho A (không phiên của ai cả).
    const ca = await passwordStep(a.email);
    const codeB = await nextTotpCode(b.secret, (await totpStateOf(b.email)).lastStep);
    const cross = await sendCode(ca.body.challenge!, codeB);
    if (codeB !== (await nextTotpCode(a.secret, (await totpStateOf(a.email)).lastStep))) {
      assert.equal(cross.status, 401);
      assert.equal(await codeOf(cross), "INVALID_MFA_CODE");
    }
    // Thân sai dạng → 400, không đếm lần sai.
    const bad = await mfaHandler(req("POST", "/api/app/auth/mfa", { body: { challenge: 1, code: "x" } }));
    assert.equal(bad.status, 400);
  });

  test("10 lần sai / 15 phút theo người dùng (qua nhiều thử thách) → 429 + Retry-After, kể cả mã đúng; hết cửa sổ thì qua", async () => {
    const u = await enrolled("sysadmin");
    for (let round = 0; round < 2; round++) {
      const { body } = await passwordStep(u.email);
      for (let i = 0; i < 5; i++)
        assert.equal((await sendCode(body.challenge!, wrongCode(u.secret))).status, 401);
    }
    const { body } = await passwordStep(u.email);
    assert.ok(body.challenge, "giới hạn TOTP không chặn bước mật khẩu");
    const code = await nextTotpCode(u.secret, (await totpStateOf(u.email)).lastStep);
    const limited = await sendCode(body.challenge!, code);
    assert.equal(limited.status, 429);
    assert.equal(await codeOf(limited), "RATE_LIMITED");
    const ra = Number(limited.headers.get("retry-after"));
    assert.ok(ra > 0 && ra <= 900, String(ra));
    // Người khác không bị ảnh hưởng.
    assert.equal((await loginThrough((await enrolled("hr")).email)).status, 200);
    // Dời các lần sai ra ngoài cửa sổ 15 phút → cùng thử thách, cùng mã giờ được chấp nhận.
    await db.admin.query(
      "UPDATE mfa_failure SET failed_at = failed_at - interval '16 minutes' WHERE user_id = $1",
      [u.userId],
    );
    assert.equal((await sendCode(body.challenge!, code)).status, 200);
  });

  test("khác Origin / thiếu Origin → 403 CSRF (không đếm lần sai, thử thách còn dùng được)", async () => {
    const u = await enrolled("hr");
    const { body } = await passwordStep(u.email);
    const code = await nextTotpCode(u.secret, (await totpStateOf(u.email)).lastStep);
    const evil = await sendCode(body.challenge!, code, { origin: "https://evil.example" });
    assert.equal(evil.status, 403);
    assert.equal(await codeOf(evil), "CSRF");
    assert.equal((await sendCode(body.challenge!, code, { origin: null })).status, 403);
    const same = await sendCode(body.challenge!, code, {
      origin: null,
      headers: { "sec-fetch-site": "same-origin" },
    });
    assert.equal(same.status, 200);
  });

  test("đăng ký lần hai không ghi đè bí mật đã bật", async () => {
    const u = await seedUser(org.companyId, { grants: [{ role: "executive", scopeType: "company" }] });
    const c1 = (await passwordStep(u.email)).body;
    const c2 = (await passwordStep(u.email)).body;
    assert.equal(c1.mfa, "totp_enroll");
    assert.equal(c2.mfa, "totp_enroll");
    assert.notEqual(c1.secret, c2.secret);
    assert.equal((await sendCode(c1.challenge!, await nextTotpCode(c1.secret!, null))).status, 200);
    const late = await sendCode(c2.challenge!, await nextTotpCode(c2.secret!, null));
    assert.equal(late.status, 401);
    assert.equal(await codeOf(late), "MFA_CHALLENGE_INVALID");
    assert.equal((await totpStateOf(u.email)).secret, c1.secret);
  });

  test("song song: cùng mã đúng gửi 2 thử thách cùng lúc → đúng một phiên (chống phát lại dưới tranh chấp)", async () => {
    const u = await enrolled("hr");
    const a = (await passwordStep(u.email)).body;
    const b = (await passwordStep(u.email)).body;
    const code = await nextTotpCode(u.secret, (await totpStateOf(u.email)).lastStep);
    const rs = await Promise.all([
      sendCode(a.challenge!, code),
      sendCode(b.challenge!, code),
      sendCode(a.challenge!, code),
    ]);
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 401, 401]);
  });

  test("bí mật / mã không xuất hiện trong audit_event lẫn log", async () => {
    const u = await seedUser(org.companyId, { grants: [{ role: "hr", scopeType: "company" }] });
    const saved = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    let secret = "";
    let code = "";
    let wrong = "";
    try {
      const { body } = await passwordStep(u.email);
      secret = body.secret!;
      wrong = wrongCode(secret);
      await sendCode(body.challenge!, wrong);
      code = await nextTotpCode(secret, null);
      assert.equal((await sendCode(body.challenge!, code)).status, 200);
    } finally {
      process.stdout.write = orig;
      if (saved === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved;
    }
    const logs = lines.join("");
    assert.ok(/"auth\.mfa"/.test(logs), "có sự kiện auth.mfa trong log");
    // Bí mật: không xuất hiện ở đâu cả. Mã 6 số: không xuất hiện như một giá trị (chuỗi trong ngoặc kép hoặc số JSON) —
    // so khớp chuỗi con trần sẽ trùng ngẫu nhiên với băm hex/uuid.
    const asValue = (c: string) => new RegExp(`["':]\\s*"?${c}"?\\s*[,}\\]]|"${c}"`);
    assert.equal(logs.includes(secret), false, "log lộ bí mật");
    for (const c of [code, wrong]) assert.equal(asValue(c).test(logs), false, "log lộ mã");
    const audit = await db.admin.query("SELECT row_to_json(a)::text AS j FROM audit_event a");
    for (const r of audit.rows) {
      assert.equal(String(r.j).includes(secret), false, "audit lộ bí mật");
      for (const c of [code, wrong]) assert.equal(asValue(c).test(String(r.j)), false, "audit lộ mã");
    }
  });

  test("mfa:reset — xoá bí mật, huỷ phiên, audit auth.mfa_reset (actor hệ thống); lần sau đăng ký lại; thiếu/sai email → 2/1", async () => {
    const u = await enrolled("hr");
    const ok = await loginThrough(u.email);
    const cookie = cookieFrom(ok);
    const run = (args: string[]) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.pathname = `/${db.name}`;
      return spawnSync("npx", ["--no-install", "tsx", "scripts/mfa-reset.ts", ...args], {
        env: {
          NODE_ENV: "test",
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          DATABASE_URL: url.toString(),
          LOG_LEVEL: "info",
        },
        encoding: "utf8",
        timeout: 60_000,
      });
    };
    assert.equal(run([]).status, 2);
    const missing = run(["khong-co@x.test"]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /NOT_FOUND/);
    const r = run([u.email.toUpperCase()]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.includes(u.secret), false);
    assert.match(r.stdout, /"auth\.mfa_reset"/);
    assert.equal((await meHandler(req("GET", "/api/app/me", { cookie }))).status, 401);
    const row = (
      await db.admin.query(
        "SELECT totp_secret_enc, totp_enabled_at, totp_last_step_seq FROM app_user WHERE id = $1",
        [u.userId],
      )
    ).rows[0];
    assert.deepEqual(row, { totp_secret_enc: null, totp_enabled_at: null, totp_last_step_seq: null });
    const a = await db.admin.query(
      "SELECT actor_user_id, reason FROM audit_event WHERE action = 'auth.mfa_reset' AND object_id = $1",
      [u.userId],
    );
    assert.equal(a.rows.length, 1);
    assert.equal(a.rows[0].actor_user_id, null);
    assert.match(String(a.rows[0].reason), /\S/);
    assert.equal((await passwordStep(u.email)).body.mfa, "totp_enroll");
  });
});
