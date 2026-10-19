// KMS Transit (T-052; SEC-SECRET-013, DB-SEC-009, CMP-PRIV-007, SEC-SECRET-008, ARC-RES-005). Hai bộ chạy CÙNG một danh sách kiểm:
//  (1) máy chủ Transit GIẢ trong tiến trình (contract test, chạy được khi mất mạng/không có binary);
//  (2) OpenBao THẬT (scripts/kms-dev.sh: raft + TLS tự ký + audit file + policy tối thiểu). Thiếu binary → test ĐỎ có thông báo rõ
//      (không skip): `node scripts/tools/install-tool.mjs install openbao`.
// Nhãn bằng chứng: faithful-fixture (OpenBao 2.7.1 thật nhưng cục bộ, niêm phong 1 khoá, không HSM, không hạ tầng thật).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fetchTransitTransport } from "../../adapters/kms-transit-http.ts";
import { textColumn, openTextAsync, sealTextAsync } from "../../lib/crypto/columns.ts";
import { collect, decryptFileStream } from "../../lib/crypto/file.ts";
import { CryptoError, KMS_ENVELOPE_VERSION, parseEnvelope } from "../../lib/crypto/index.ts";
import {
  TransitKms,
  TransitProvider,
  decryptFieldAsync,
  encryptFieldAsync,
  keyProvider,
  setKeyProvider,
  setKmsTransport,
  transitConfig,
  type TransitConfig,
  type TransitRequest,
  type TransitResponse,
  type TransitTransport,
} from "../../lib/crypto/kms.ts";
import { rotateFiles, rotateKeys, verifyFiles } from "../../lib/crypto/rotate.ts";
import { withTx } from "../../lib/db/index.ts";
import { diskStorage } from "../../lib/files/storage.ts";
import { createEmployee } from "../../lib/org/index.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
const ROOT = new URL("../..", import.meta.url).pathname;
const PHONE = "+84 90 123 4567";
const KEY = "xc-data";

// ---- Máy chủ Transit giả -------------------------------------------------------------------------------------------
class FakeTransit {
  version = 1;
  down = false;
  readonly hits: string[] = [];
  readonly token = randomBytes(12).toString("hex");
  readonly opsToken = randomBytes(12).toString("hex");
  private server = http.createServer((req, res) => void this.handle(req, res));
  addr = "";
  private k = (v: number) => createHash("sha256").update(`fake-kek-${v}`).digest();
  private seal(v: number, pt: Buffer): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.k(v), iv);
    const ct = Buffer.concat([c.update(pt), c.final()]);
    return `vault:v${v}:${Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64")}`;
  }
  private open(ct: string): { v: number; pt: Buffer } | null {
    const m = /^vault:v(\d+):(.+)$/.exec(ct);
    if (!m) return null;
    const raw = Buffer.from(m[2]!, "base64");
    try {
      const d = createDecipheriv("aes-256-gcm", this.k(Number(m[1])), raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(raw.length - 16));
      return { v: Number(m[1]), pt: Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]) };
    } catch {
      return null;
    }
  }
  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body =
      chunks.length > 0 ? (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, string>) : {};
    const send = (status: number, data?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data === undefined ? {} : { data }));
    };
    const url = (req.url ?? "").replace(/^\/v1\/transit\//, "");
    this.hits.push(url.split("/")[0]!);
    if (this.down) return void res.destroy();
    const tok = req.headers["x-vault-token"];
    if (tok !== this.token && tok !== this.opsToken) return send(403, undefined);
    if (url === `encrypt/${KEY}`)
      return send(200, { ciphertext: this.seal(this.version, Buffer.from(body.plaintext!, "base64")) });
    if (url === `decrypt/${KEY}`) {
      const o = this.open(body.ciphertext!);
      return o ? send(200, { plaintext: o.pt.toString("base64") }) : send(400, undefined);
    }
    if (url === `rewrap/${KEY}`) {
      const o = this.open(body.ciphertext!);
      return o ? send(200, { ciphertext: this.seal(this.version, o.pt) }) : send(400, undefined);
    }
    if (url === `keys/${KEY}`) return send(200, { latest_version: this.version });
    if (url === `keys/${KEY}/rotate`) {
      if (tok !== this.opsToken) return send(403, undefined);
      this.version += 1;
      return send(200, { latest_version: this.version });
    }
    return send(404, undefined);
  }
  async start() {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.addr = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`;
  }
  async stop() {
    this.server.closeAllConnections();
    await new Promise((r) => this.server.close(r));
  }
  count(op: string) {
    return this.hits.filter((h) => h === op).length;
  }
}

// ---- OpenBao thật -------------------------------------------------------------------------------------------------
class RealBao {
  dir = mkdtempSync(path.join(tmpdir(), "xc-kms-test-"));
  addr = "";
  ca = "";
  token = "";
  opsToken = "";
  private sh = (...a: string[]) =>
    spawnSync(path.join(ROOT, "scripts/kms-dev.sh"), [...a, "--dir", this.dir], { encoding: "utf8" });
  start() {
    if (!existsSync(path.join(ROOT, ".tools/bin/bao")))
      assert.fail(
        "thiếu OpenBao: chạy `node scripts/tools/install-tool.mjs install openbao` (test KMS thật không skip)",
      );
    const r = this.sh("start");
    assert.equal(r.status, 0, r.stderr);
    this.addr = `https://127.0.0.1:${readFileSync(path.join(this.dir, "port"), "utf8").trim()}`;
    this.ca = readFileSync(path.join(this.dir, "tls/cert.pem"), "utf8");
    this.token = readFileSync(path.join(this.dir, "app.token"), "utf8").trim();
    this.opsToken = readFileSync(path.join(this.dir, "ops.token"), "utf8").trim();
  }
  stop() {
    this.sh("stop");
  }
  purge() {
    this.sh("stop", "--purge");
    rmSync(this.dir, { recursive: true, force: true });
  }
  /** Transport dùng node:https + CA tự ký (kiểm chứng chứng chỉ THẬT, không tắt kiểm tra). */
  transport(): TransitTransport {
    const ca = this.ca;
    const addr = this.addr;
    return {
      request: (req: TransitRequest) =>
        new Promise<TransitResponse>((resolve, reject) => {
          const r = https.request(
            `${addr}/v1/${req.path}`,
            {
              method: req.method,
              ca,
              timeout: req.timeoutMs,
              headers: { "X-Vault-Token": req.token, "content-type": "application/json" },
            },
            (res) => {
              const b: Buffer[] = [];
              res.on("data", (c: Buffer) => b.push(c));
              res.on("end", () => {
                let json: unknown = null;
                try {
                  json = JSON.parse(Buffer.concat(b).toString());
                } catch {
                  /* thân rỗng */
                }
                resolve({ status: res.statusCode ?? 0, json });
              });
            },
          );
          r.on("timeout", () => r.destroy(new Error("timeout")));
          r.on("error", reject);
          r.end(req.body === undefined ? undefined : JSON.stringify(req.body));
        }),
    };
  }
}

interface Target {
  name: string;
  transport(): TransitTransport;
  token(): string;
  opsToken(): string;
  /** KMS dừng/sống lại. */
  down(): Promise<void> | void;
  up(): Promise<void> | void;
  hits?(op: string): number;
}

const cfg = (t: Target, over: Partial<TransitConfig> = {}): TransitConfig => ({
  addr: "http://x",
  token: t.token(),
  mount: "transit",
  key: KEY,
  timeoutMs: 1500,
  retries: 1,
  ttlMs: 60_000,
  maxUses: 1_000_000,
  maxCallsPerMin: 1000,
  ...over,
});
const sleepless = { sleep: async () => undefined };
const mk = (t: Target, over: Partial<TransitConfig> = {}, now?: () => number) =>
  new TransitKms(cfg(t, over), t.transport(), { ...sleepless, now });
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof CryptoError ? e.code : `lạ:${String(e)}`),
  );

function suite(t: Target) {
  describe(`KMS Transit — ${t.name}`, () => {
    let db: TestDb;
    let companyId: string;
    const phoneCol = textColumn("employee", "phone");
    let prov: TransitProvider;
    before(async () => {
      db = await freshDb();
      ({ companyId } = await seedCompany());
      prov = new TransitProvider(mk(t), () => new Map());
      setKeyProvider(prov);
    });
    after(async () => {
      setKeyProvider(undefined);
      await db.close();
    });
    const mkEmp = (c: string) =>
      withTx((tx) =>
        createEmployee(tx, { userId: null }, companyId, { code: c, fullName: `NV ${c}`, phone: PHONE }),
      );
    const raw = async (id: string) =>
      (await db.admin.query("SELECT phone, phone_enc FROM employee WHERE id = $1", [id])).rows[0]!;

    test("ghi → cột là phong bì v2 (không bản rõ, DEK bọc bởi KMS), đọc lại qua KMS đúng; Unicode/rỗng", async () => {
      const id = await mkEmp("K1");
      const r = await raw(id);
      assert.equal(r.phone, null);
      assert.match(r.phone_enc, /^v2:1:/);
      assert.equal(String(r.phone_enc).includes("90 123"), false);
      assert.equal(await openTextAsync(phoneCol, id, r), PHONE);
      const ctx = { table: "t", column: "c", rowId: "1" };
      for (const v of ["", "Đặng Thị Ánh ✓", "x".repeat(10_000)])
        assert.equal(await decryptFieldAsync(ctx, await encryptFieldAsync(ctx, v)), v);
      const p = parseEnvelope(r.phone_enc);
      assert.equal(p.version, KMS_ENVELOPE_VERSION);
      assert.match(p.wrapped!, /^vault:v1:/);
    });

    test("tráo AAD (sang dòng/cột khác) → AUTH_FAILED", async () => {
      const env = await encryptFieldAsync({ table: "employee", column: "phone_enc", rowId: "A" }, "bí mật");
      assert.equal(
        await code(decryptFieldAsync({ table: "employee", column: "phone_enc", rowId: "B" }, env)),
        "AUTH_FAILED",
      );
      assert.equal(
        await code(decryptFieldAsync({ table: "inquiry", column: "phone_enc", rowId: "A" }, env)),
        "AUTH_FAILED",
      );
    });

    test("DEK dùng chung nhiều bản ghi: số lời gọi KMS nhỏ (cache + gộp)", async () => {
      const k = mk(t);
      const p = new TransitProvider(k, () => new Map());
      const ctx = { table: "t", column: "c", rowId: "1" };
      const { encryptField, decryptField } = await import("../../lib/crypto/index.ts");
      const envs: string[] = [];
      for (let i = 0; i < 50; i++) envs.push(encryptField(ctx, `v${i}`, await p.ringForWrite()));
      const cold = new TransitProvider(mk(t), () => new Map());
      const ring = await cold.ringForRead(envs);
      assert.equal(decryptField(ctx, envs[7]!, ring), "v7");
      assert.equal(k.stats.calls, 1, "50 lần mã hoá chỉ một lời gọi bọc");
      assert.equal((cold.kms as TransitKms).stats.calls, 1, "50 phong bì chung DEK chỉ một lời gọi mở");
    });

    test("xoay khoá KMS: dữ liệu cũ vẫn đọc được; rotateKeys rewrap DEK, không cần đọc dữ liệu rõ", async () => {
      const ids = [await mkEmp("R1"), await mkEmp("R2"), await mkEmp("R3")];
      const ops = new TransitKms(cfg(t, { token: t.opsToken() }), t.transport(), sleepless);
      const v2 = await ops.rotate();
      assert.ok(v2 >= 2);
      for (const id of ids) assert.equal(await openTextAsync(phoneCol, id, await raw(id)), PHONE);
      const decryptsBefore = t.hits?.("decrypt");
      const cold = new TransitProvider(mk(t), () => new Map());
      const rep = (await rotateKeys(db.app, { provider: cold, batchSize: 2 })).find(
        (x) => x.target === "employee.phone",
      )!;
      assert.ok(rep.rewrapped >= 3, JSON.stringify(rep));
      assert.equal(rep.reencrypted, 0);
      assert.equal(rep.stale, 0);
      if (t.hits)
        assert.equal(
          t.hits("decrypt"),
          decryptsBefore,
          "rewrap không gọi decrypt (DEK/dữ liệu không hiện ra)",
        );
      for (const id of ids) {
        const r = await raw(id);
        assert.match(r.phone_enc, new RegExp(`^v2:${v2}:`));
        assert.equal(await openTextAsync(phoneCol, id, r), PHONE);
      }
      const again = (await rotateKeys(db.app, { provider: cold })).find(
        (x) => x.target === "employee.phone",
      )!;
      assert.equal(again.rotated, 0, "idempotent");
      // Token ứng dụng KHÔNG có quyền rotate (policy tối thiểu).
      assert.equal(await code(mk(t).rotate()), "KMS_AUTH");
    });

    test("chuyển env → KMS: phong bì v1 cũ được mã hoá lại bằng KMS khi còn khoá env", async () => {
      const { encryptField, keyring } = await import("../../lib/crypto/index.ts");
      const id = randomUUID();
      const v1 = encryptField({ table: "employee", column: "phone_enc", rowId: id }, PHONE, keyring());
      assert.match(v1, /^v1:/);
      const prov2 = new TransitProvider(mk(t), () => keyring().byId);
      assert.equal(
        await decryptFieldAsync({ table: "employee", column: "phone_enc", rowId: id }, v1).catch(() => "no"),
        "no",
      ); // provider mặc định không có khoá env
      const ring = await prov2.ringForRead([v1]);
      const { decryptField } = await import("../../lib/crypto/index.ts");
      assert.equal(decryptField({ table: "employee", column: "phone_enc", rowId: id }, v1, ring), PHONE);
    });

    test("token sai → KMS_AUTH rõ ràng, không lộ token; KMS_REJECTED với ciphertext rác", async () => {
      const bad = mk(t, { token: "token-sai-0123456789" });
      const e = await bad.wrap(Buffer.alloc(32)).then(
        () => null,
        (x: unknown) => x as CryptoError,
      );
      assert.equal(e?.code, "KMS_AUTH");
      assert.equal(String(e?.message).includes("token-sai"), false);
      assert.equal(await code(mk(t).unwrap("vault:v1:AAAA")), "KMS_REJECTED");
    });

    test("DEK cache hết hạn theo TTL: trong TTL không gọi lại, quá TTL gọi lại KMS", async () => {
      let now = 1_000_000;
      const k = mk(t, { ttlMs: 10_000 }, () => now);
      const { wrapped } = await k.wrap(randomBytes(32));
      await k.unwrap(wrapped); // miss
      assert.equal(k.stats.unwrapMisses, 1);
      now += 5_000;
      await k.unwrap(wrapped);
      assert.equal(k.stats.unwrapHits, 1);
      now += 6_000; // quá TTL
      await k.unwrap(wrapped);
      assert.equal(k.stats.unwrapMisses, 2);
      // DEK ghi cũng đổi theo TTL
      const a = await k.currentDek();
      now += 11_000;
      const b = await k.currentDek();
      assert.notEqual(a.wrapped, b.wrapped);
    });

    test("trần lời gọi KMS/phút → KMS_RATE_LIMITED (fail-closed)", async () => {
      const k = mk(t, { maxCallsPerMin: 2 });
      await k.latestVersion();
      await k.latestVersion();
      assert.equal(await code(k.latestVersion()), "KMS_RATE_LIMITED");
    });

    test("hai bản sao ứng dụng (cache riêng): A ghi, B đọc (ARC-RES-005: không trạng thái cục bộ)", async () => {
      const a = new TransitProvider(mk(t), () => new Map());
      const b = new TransitProvider(mk(t), () => new Map());
      const ctx = { table: "t", column: "c", rowId: "9" };
      const { encryptField, decryptField } = await import("../../lib/crypto/index.ts");
      const env = encryptField(ctx, "chung", await a.ringForWrite());
      assert.equal(decryptField(ctx, env, await b.ringForRead([env])), "chung");
    });

    test("tệp: mã hoá qua KMS (v2), đọc lại, xoay khoá → bọc lại đầu tệp, nội dung giữ nguyên", async () => {
      const root = mkdtempSync(path.join(tmpdir(), "xc-kms-files-"));
      try {
        const st = diskStorage(root);
        const data = randomBytes(150_000);
        const key = await st.put(data);
        const head = readFileSync(path.join(root, key)).subarray(0, 8);
        assert.equal(head[7], 2);
        assert.ok((await st.get(key)).equals(data));
        const ops = new TransitKms(cfg(t, { token: t.opsToken() }), t.transport(), sleepless);
        await ops.rotate();
        const rep = await rotateFiles(root, {
          ring: await new TransitProvider(mk(t), () => new Map()).ringForWrite(),
        });
        assert.equal(rep.rewrapped, 1);
        assert.equal(
          await verifyFiles(root, await new TransitProvider(mk(t), () => new Map()).ringForRead([])),
          1,
        );
        assert.ok((await st.get(key)).equals(data));
        const swapped = await collect(
          decryptFileStream(
            [readFileSync(path.join(root, key))],
            { storageKey: "aa/" + "b".repeat(40) },
            await new TransitProvider(mk(t), () => new Map()).ringForRead([]),
          ),
        ).then(
          () => "ok",
          (e: unknown) => (e as CryptoError).code,
        );
        assert.equal(swapped, "AUTH_FAILED");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("KMS dừng → ghi/đọc THẤT BẠI (fail-closed), KHÔNG rơi về khoá env; bật lại thì chạy tiếp", async () => {
      const env = await encryptFieldAsync({ table: "t", column: "c", rowId: "1" }, "trước khi dừng");
      await t.down();
      try {
        const coldW = new TransitProvider(mk(t), () => new Map());
        assert.equal(await code(coldW.ringForWrite()), "KMS_UNAVAILABLE");
        const coldR = new TransitProvider(mk(t), () => new Map());
        assert.equal(await code(coldR.ringForRead([env])), "KMS_UNAVAILABLE");
        setKeyProvider(coldW);
        assert.equal(await code(mkEmp("DOWN")), "KMS_UNAVAILABLE");
        assert.equal(await code(sealTextAsync(phoneCol, randomUUID(), PHONE)), "KMS_UNAVAILABLE");
      } finally {
        setKeyProvider(prov);
        await t.up();
      }
      const fresh = new TransitProvider(mk(t), () => new Map());
      const ring = await fresh.ringForRead([env]);
      const { decryptField } = await import("../../lib/crypto/index.ts");
      assert.equal(decryptField({ table: "t", column: "c", rowId: "1" }, env, ring), "trước khi dừng");
    });
  });
}

describe("cấu hình KMS (không cần máy chủ)", () => {
  after(() => {
    setKmsTransport(undefined);
    setKeyProvider(undefined);
  });
  const base = {
    NODE_ENV: "test",
    KMS_PROVIDER: "transit",
    KMS_TRANSIT_ADDR: "https://kms.example.test:8200",
  };
  const tok = ["kms", "tok", "12345678"].join("-");
  test("production chỉ nhận https (trừ loopback); thiếu token → KMS_CONFIG nêu tên biến, không lộ giá trị", () => {
    assert.throws(
      () =>
        transitConfig({
          ...base,
          NODE_ENV: "production",
          KMS_TRANSIT_ADDR: "http://kms.example.test:8200",
          KMS_TRANSIT_TOKEN: tok,
        }),
      (e: unknown) => e instanceof CryptoError && e.code === "KMS_CONFIG" && !String(e.message).includes(tok),
    );
    assert.equal(
      transitConfig({
        ...base,
        NODE_ENV: "production",
        KMS_TRANSIT_ADDR: "http://127.0.0.1:8200",
        KMS_TRANSIT_TOKEN: tok,
      }).addr,
      "http://127.0.0.1:8200",
    );
    assert.throws(
      () => transitConfig(base),
      (e: unknown) => e instanceof CryptoError && /KMS_TRANSIT_TOKEN/.test(e.message),
    );
  });
  test("transit chưa đăng ký transport → KMS_CONFIG; env mặc định không cần KMS", async () => {
    assert.equal(keyProvider().name, "env");
    const prev = { ...process.env };
    Object.assign(process.env, {
      KMS_PROVIDER: "transit",
      KMS_TRANSIT_ADDR: "http://127.0.0.1:1",
      KMS_TRANSIT_TOKEN: tok,
    });
    try {
      setKmsTransport(undefined);
      assert.throws(
        () => keyProvider(),
        (e: unknown) => e instanceof CryptoError && e.code === "KMS_CONFIG",
      );
    } finally {
      for (const k of ["KMS_PROVIDER", "KMS_TRANSIT_ADDR", "KMS_TRANSIT_TOKEN"]) delete process.env[k];
      Object.assign(process.env, { ...prev, KMS_PROVIDER: undefined });
      delete process.env.KMS_PROVIDER;
    }
  });
  test("adapter fetch: gửi X-Vault-Token, không theo chuyển hướng, lỗi mạng ném lỗi (client quy về KMS_UNAVAILABLE)", async () => {
    let seen: { url: string; token: string | null } | undefined;
    const tr = fetchTransitTransport(() => "http://kms.test", (async (url: string, init: RequestInit) => {
      seen = { url, token: new Headers(init.headers).get("x-vault-token") };
      assert.equal(init.redirect, "error");
      return new Response('{"data":{}}', { status: 200 });
    }) as unknown as typeof fetch);
    const r = await tr.request({ method: "GET", path: "transit/keys/xc-data", token: "tkn", timeoutMs: 500 });
    assert.equal(r.status, 200);
    assert.deepEqual(seen, { url: "http://kms.test/v1/transit/keys/xc-data", token: "tkn" });
    const dead = fetchTransitTransport(() => "http://127.0.0.1:1");
    await assert.rejects(dead.request({ method: "GET", path: "x", token: "t", timeoutMs: 500 }));
  });
});

const fake = new FakeTransit();
before(async () => fake.start());
after(async () => fake.stop());
suite({
  name: "máy chủ giả trong tiến trình (contract)",
  transport: () => fetchTransitTransport(() => fake.addr),
  token: () => fake.token,
  opsToken: () => fake.opsToken,
  down: () => void (fake.down = true),
  up: () => void (fake.down = false),
  hits: (op) => fake.count(op),
});

const bao = new RealBao();
before(() => bao.start());
after(() => bao.purge());
suite({
  name: "OpenBao thật (raft + TLS + policy tối thiểu)",
  transport: () => bao.transport(),
  token: () => bao.token,
  opsToken: () => bao.opsToken,
  down: () => bao.stop(),
  up: () => bao.start(),
});

describe("OpenBao thật: audit device không chứa bản rõ", () => {
  test("nhật ký audit tồn tại và không chứa DEK/bản rõ (giá trị bị băm HMAC)", async () => {
    const k = new TransitKms(
      cfg({ transport: () => bao.transport(), token: () => bao.token } as Target),
      bao.transport(),
      sleepless,
    );
    const dek = randomBytes(32);
    await k.wrap(dek);
    const log = readFileSync(path.join(bao.dir, "audit.log"), "utf8");
    assert.ok(log.length > 0);
    assert.equal(log.includes(dek.toString("base64")), false);
    assert.equal(log.includes(bao.token), false);
  });
});
