// i18n-ignore-file: lỗi cấu hình/vận hành KMS cho người vận hành (không tới người dùng cuối; route bọc thành lỗi 500 chung)
// Lớp nhà cung cấp khoá (T-052, D-039; SEC-SECRET-013, DB-SEC-009, CMP-PRIV-007): `KMS_PROVIDER=env` (mặc định, hành vi cũ — khoá ở
// DATA_ENCRYPTION_KEYS) hoặc `transit` (OpenBao/Vault Transit tự host, API tương thích Vault).
//
// Mô hình phong bì (envelope encryption) — khoá chủ (KEK) KHÔNG BAO GIỜ rời KMS:
//   · DEK 32 byte sinh CỤC BỘ (randomBytes), bọc bằng `transit/encrypt/<khoá>`; chuỗi bọc (`vault:vN:…`) nằm TRONG phong bì v2 của từng
//     bản mã (lib/crypto/index.ts) → không có trạng thái ngoài CSDL; nhiều bản sao ứng dụng đọc/ghi chung được (ARC-RES-005).
//   · Một DEK ghi dùng cho tới khi hết TTL (KMS_DEK_TTL_S) hoặc đủ KMS_DEK_MAX_USES lần mã hoá rồi sinh DEK mới; DEK giải bọc được
//     cache trong bộ nhớ với TTL ngắn, mỗi chuỗi bọc chỉ gọi KMS một lần/TTL (gộp các lời gọi đồng thời), trần KMS_MAX_CALLS_PER_MIN.
//   · Xoay khoá: `transit/keys/<khoá>/rotate` tạo phiên bản mới (bản mã cũ vẫn giải mã được); `transit/rewrap` đổi chuỗi bọc của DEK
//     cũ sang phiên bản mới MÀ KHÔNG đọc dữ liệu rõ — chỉ DEK đi qua KMS, bản mã dữ liệu giữ nguyên (lib/crypto/rotate.ts).
//   · Fail-closed: KMS lỗi/niêm phong/từ chối token → CryptoError (KMS_*), TUYỆT ĐỐI không rơi về khoá env. Có timeout, thử lại có trần
//     (lỗi mạng/5xx/429, lùi theo cấp số nhân), 4xx không thử lại.
// Phần MẠNG tách khỏi lib/ (DB-TX-003): lib/ chỉ định nghĩa `TransitTransport`; bản dùng `fetch` ở adapters/kms-transit-http.ts, đăng ký
// bằng `setKmsTransport` (adapters/register-kms.ts, gọi ở instrumentation.ts và các script). Token KMS chỉ đi vào header của transport,
// không vào log/thông báo lỗi. Không hứa xoá sạch bộ nhớ: JS không bảo đảm; TTL ngắn chỉ giới hạn thời gian giữ DEK.
import { randomBytes } from "node:crypto";
import { EnvError, env } from "../nen/env.ts";
import { log } from "../nen/log.ts";
import { MS_PER_MINUTE, secondsToMs } from "../nen/units.ts";
import {
  CryptoError,
  KMS_ENVELOPE_VERSION,
  decryptField,
  encryptField,
  keyring,
  parseEnvelope,
  type FieldContext,
  type Keyring,
  type KmsKeyOps,
} from "./index.ts";

// ---- Cổng mạng (tiêm) ----------------------------------------------------------------------------------------------

export interface TransitRequest {
  method: "GET" | "POST";
  /** Sau `/v1/`, vd `transit/encrypt/xc-data`. */
  path: string;
  body?: unknown;
  token: string;
  timeoutMs: number;
}
export interface TransitResponse {
  status: number;
  json: unknown;
}
/** Gửi một yêu cầu tới API Transit. Lỗi mạng/hết giờ → ném Error (client quy về KMS_UNAVAILABLE và thử lại có trần). */
export interface TransitTransport {
  request(req: TransitRequest): Promise<TransitResponse>;
}

let transport: TransitTransport | undefined;
let transportEpoch = 0;
export function setKmsTransport(t: TransitTransport | undefined): void {
  transport = t;
  transportEpoch += 1;
}

// ---- Cấu hình ------------------------------------------------------------------------------------------------------

export interface TransitConfig {
  addr: string;
  token: string;
  mount: string;
  key: string;
  timeoutMs: number;
  retries: number;
  ttlMs: number;
  maxUses: number;
  maxCallsPerMin: number;
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

/** Cấu hình Transit từ env; sai/thiếu → CryptoError("KMS_CONFIG") chỉ nêu TÊN biến. Production chỉ nhận https (trừ loopback). */
export function transitConfig(source?: Record<string, string | undefined>): TransitConfig {
  try {
    const addr = env("KMS_TRANSIT_ADDR", source);
    const token = env("KMS_TRANSIT_TOKEN", source);
    if (addr === undefined || token === undefined)
      throw new CryptoError("KMS_CONFIG", "thiếu KMS_TRANSIT_ADDR hoặc KMS_TRANSIT_TOKEN");
    const u = new URL(addr);
    if (env("NODE_ENV", source) === "production" && u.protocol !== "https:" && !LOOPBACK.test(u.hostname))
      throw new CryptoError("KMS_CONFIG", "KMS_TRANSIT_ADDR phải là https ở production (trừ loopback)");
    return {
      addr: u.origin,
      token,
      mount: env("KMS_TRANSIT_MOUNT", source),
      key: env("KMS_TRANSIT_KEY", source),
      timeoutMs: env("KMS_TIMEOUT_MS", source),
      retries: env("KMS_RETRIES", source),
      ttlMs: secondsToMs(env("KMS_DEK_TTL_S", source)),
      maxUses: env("KMS_DEK_MAX_USES", source),
      maxCallsPerMin: env("KMS_MAX_CALLS_PER_MIN", source),
    };
  } catch (err) {
    if (err instanceof EnvError) throw new CryptoError("KMS_CONFIG", err.message);
    throw err;
  }
}

// ---- Client Transit ------------------------------------------------------------------------------------------------

const WRAPPED = /^vault:v([1-9][0-9]{0,8}):[A-Za-z0-9+/]+={0,2}$/;
const DEK_BYTES = 32;
const CACHE_MAX = 1024;
const BACKOFF_BASE_MS = 50;
const BACKOFF_CAP_MS = 500;
const EARLY_RENEW_TTL = 0.8;
const EARLY_RENEW_USES = 0.9;

export interface KmsClientOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Tiêm nguồn DEK (test). Mặc định randomBytes(32). */
  newDek?: () => Buffer;
}

export interface KmsStats {
  /** Số lời gọi tới KMS (kể cả lần thử lại). */
  calls: number;
  unwrapHits: number;
  unwrapMisses: number;
}

interface WriteDek {
  dek: Buffer;
  wrapped: string;
  version: number;
  at: number;
  uses: number;
}

const wrappedVersion = (wrapped: string): number => {
  const m = WRAPPED.exec(wrapped);
  if (!m) throw new CryptoError("KMS_REJECTED", "KMS trả chuỗi bọc DEK sai định dạng");
  return Number(m[1]);
};

/** Client Transit: bọc/mở/bọc lại DEK; cache TTL ngắn; trần lời gọi; thử lại có trần. Không giữ KEK. */
export class TransitKms implements KmsKeyOps {
  readonly stats: KmsStats = { calls: 0, unwrapHits: 0, unwrapMisses: 0 };
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newDek: () => Buffer;
  private readonly cache = new Map<string, { dek: Buffer; exp: number }>();
  private readonly inflight = new Map<string, Promise<Buffer>>();
  private writeDek: WriteDek | undefined;
  private writeInflight: Promise<WriteDek> | undefined;
  private winStart = 0;
  private winCalls = 0;

  constructor(
    readonly cfg: TransitConfig,
    private readonly transport: TransitTransport,
    opts: KmsClientOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.newDek = opts.newDek ?? (() => randomBytes(DEK_BYTES));
  }

  private budget(): void {
    const t = this.now();
    if (t - this.winStart >= MS_PER_MINUTE) {
      this.winStart = t;
      this.winCalls = 0;
    }
    if (this.winCalls >= this.cfg.maxCallsPerMin)
      throw new CryptoError(
        "KMS_RATE_LIMITED",
        "vượt trần số lời gọi KMS mỗi phút (KMS_MAX_CALLS_PER_MIN) — từ chối, không dùng khoá env",
      );
    this.winCalls += 1;
    this.stats.calls += 1;
  }

  /** Một lời gọi Transit (có thử lại có trần). Trả `data` của phản hồi. */
  private async call(method: "GET" | "POST", sub: string, body?: unknown): Promise<Record<string, unknown>> {
    let lastKind: "net" | "5xx" = "net";
    for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
      if (attempt > 0) await this.sleep(Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
      this.budget();
      let res: TransitResponse;
      try {
        res = await this.transport.request({
          method,
          path: `${this.cfg.mount}/${sub}`,
          body,
          token: this.cfg.token,
          timeoutMs: this.cfg.timeoutMs,
        });
      } catch {
        lastKind = "net";
        continue;
      }
      if (res.status >= 200 && res.status < 300) {
        const data = (res.json as { data?: unknown } | null)?.data;
        if (typeof data !== "object" || data === null)
          throw new CryptoError("KMS_REJECTED", "KMS trả phản hồi thiếu `data`");
        return data as Record<string, unknown>;
      }
      if (res.status === 403)
        throw new CryptoError("KMS_AUTH", "KMS từ chối token (sai, hết hạn hoặc thiếu quyền trong policy)");
      if (res.status >= 500 || res.status === 429) {
        lastKind = "5xx"; // 503 = đang niêm phong/chuyển đổi, thử lại có trần
        continue;
      }
      throw new CryptoError("KMS_REJECTED", `KMS từ chối yêu cầu (HTTP ${res.status})`);
    }
    log.warn("KMS không phản hồi sau khi thử lại", { kind: lastKind, op: sub.split("/")[0] });
    throw new CryptoError(
      "KMS_UNAVAILABLE",
      lastKind === "net"
        ? "không tới được KMS (mạng/hết giờ) — từ chối, không dùng khoá env"
        : "KMS không sẵn sàng (đang niêm phong hoặc quá tải) — từ chối, không dùng khoá env",
    );
  }

  async wrap(dek: Buffer): Promise<{ wrapped: string; version: number }> {
    const data = await this.call("POST", `encrypt/${this.cfg.key}`, { plaintext: dek.toString("base64") });
    const wrapped = data.ciphertext;
    if (typeof wrapped !== "string") throw new CryptoError("KMS_REJECTED", "KMS không trả ciphertext");
    return { wrapped, version: wrappedVersion(wrapped) };
  }

  async unwrap(wrapped: string): Promise<Buffer> {
    wrappedVersion(wrapped);
    const t = this.now();
    const hit = this.cache.get(wrapped);
    if (hit !== undefined && hit.exp > t) {
      this.stats.unwrapHits += 1;
      return Buffer.from(hit.dek);
    }
    if (hit !== undefined) this.cache.delete(wrapped);
    let p = this.inflight.get(wrapped);
    if (p === undefined) {
      this.stats.unwrapMisses += 1;
      p = this.call("POST", `decrypt/${this.cfg.key}`, { ciphertext: wrapped })
        .then((data) => {
          const dek = Buffer.from(String(data.plaintext ?? ""), "base64");
          if (dek.length !== DEK_BYTES) throw new CryptoError("KMS_REJECTED", "KMS trả DEK sai độ dài");
          this.remember(wrapped, dek);
          return dek;
        })
        .finally(() => this.inflight.delete(wrapped));
      this.inflight.set(wrapped, p);
    }
    return Buffer.from(await p);
  }

  private remember(wrapped: string, dek: Buffer): void {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(wrapped, { dek, exp: this.now() + this.cfg.ttlMs });
  }

  /** Bọc lại DEK đã bọc bằng phiên bản khoá chủ mới nhất — không cần bản rõ của dữ liệu (chỉ DEK đi qua KMS). */
  async rewrap(wrapped: string): Promise<{ wrapped: string; version: number }> {
    wrappedVersion(wrapped);
    const data = await this.call("POST", `rewrap/${this.cfg.key}`, { ciphertext: wrapped });
    const next = data.ciphertext;
    if (typeof next !== "string") throw new CryptoError("KMS_REJECTED", "KMS không trả ciphertext");
    return { wrapped: next, version: wrappedVersion(next) };
  }

  /** Phiên bản mới nhất của khoá chủ (đọc `transit/keys/<khoá>`; cần quyền read trên đường dẫn đó). */
  async latestVersion(): Promise<number> {
    const data = await this.call("GET", `keys/${this.cfg.key}`);
    const v = data.latest_version;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
      throw new CryptoError("KMS_REJECTED", "KMS không trả latest_version hợp lệ");
    return v;
  }

  /** Tạo phiên bản khoá chủ mới (cần token vận hành có quyền `update` trên `keys/<khoá>/rotate`; token ứng dụng KHÔNG có). */
  async rotate(): Promise<number> {
    await this.call("POST", `keys/${this.cfg.key}/rotate`, {});
    return this.latestVersion();
  }

  /** Sinh DEK mới + bọc (gộp các lời gọi đồng thời). */
  private renew(): Promise<WriteDek> {
    this.writeInflight ??= (async () => {
      try {
        const dek = this.newDek();
        const { wrapped, version } = await this.wrap(dek);
        const fresh: WriteDek = { dek, wrapped, version, at: this.now(), uses: 0 };
        this.remember(wrapped, dek); // đọc lại bản vừa ghi không tốn lời gọi KMS
        this.writeDek = fresh;
        return fresh;
      } finally {
        this.writeInflight = undefined;
      }
    })();
    return this.writeInflight;
  }

  /**
   * DEK ghi hiện hành (sinh mới + bọc khi chưa có/hết TTL/đủ lần dùng). Mỗi lần gọi tính một lần dùng. Làm mới SỚM ở nền khi đã qua
   * 80% TTL hoặc 90% số lần dùng để lời gọi mã hoá hiếm khi phải chờ mạng KMS (nhất là khi đang giữ giao dịch DB); lỗi làm mới nền
   * bị bỏ qua — DEK cũ vẫn dùng tới hết TTL, hết hạn thì lời gọi kế tiếp thất bại (fail-closed).
   */
  async currentDek(): Promise<{ dek: Buffer; wrapped: string; version: number }> {
    for (;;) {
      const w = this.writeDek;
      const t = this.now();
      if (w !== undefined && t - w.at < this.cfg.ttlMs && w.uses < this.cfg.maxUses) {
        w.uses += 1;
        if (t - w.at >= this.cfg.ttlMs * EARLY_RENEW_TTL || w.uses >= this.cfg.maxUses * EARLY_RENEW_USES)
          this.renew().catch((e: unknown) =>
            log.warn("KMS: làm mới DEK ở nền thất bại (DEK cũ dùng tới hết TTL)", {
              code: e instanceof CryptoError ? e.code : "UNKNOWN",
            }),
          );
        return { dek: w.dek, wrapped: w.wrapped, version: w.version };
      }
      await this.renew();
    }
  }
}

// ---- Nhà cung cấp khoá ---------------------------------------------------------------------------------------------

export interface KeyProvider {
  readonly name: "env" | "transit";
  /** Bộ khoá để MÃ HOÁ (khoá hiện hành) — mỗi lời gọi tính một lần dùng DEK. */
  ringForWrite(): Promise<Keyring>;
  /** Bộ khoá đủ để GIẢI MÃ các phong bì này (mở DEK qua KMS nếu cần; `current` chỉ-đọc, không dùng để mã hoá). */
  ringForRead(envelopes: readonly string[]): Promise<Keyring>;
}

const envProvider: KeyProvider = {
  name: "env",
  ringForWrite: async () => keyring(),
  ringForRead: async () => keyring(),
};

/** Khoá env cũ chỉ để ĐỌC phong bì v1 khi chuyển sang KMS — chỉ khi DATA_ENCRYPTION_KEYS được đặt tường minh (không dùng khoá dev). */
function legacyKeys(): ReadonlyMap<string, Buffer> {
  return env("DATA_ENCRYPTION_KEYS") === undefined ? new Map() : keyring().byId;
}

const READ_ONLY_CURRENT = { id: "", key: Buffer.alloc(0) };
const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export class TransitProvider implements KeyProvider {
  readonly name = "transit" as const;
  constructor(
    readonly kms: TransitKms,
    private readonly legacy: () => ReadonlyMap<string, Buffer> = legacyKeys,
  ) {}

  async ringForWrite(): Promise<Keyring> {
    const w = await this.kms.currentDek();
    const id = b64u(w.wrapped);
    const byId = new Map(this.legacy());
    byId.set(id, w.dek);
    return { current: { id, key: w.dek, wrapped: w.wrapped, kmsVersion: w.version }, byId, kms: this.kms };
  }

  async ringForRead(envelopes: readonly string[]): Promise<Keyring> {
    const byId = new Map(this.legacy());
    for (const e of envelopes) {
      const p = parseEnvelope(e);
      if (p.version === KMS_ENVELOPE_VERSION && !byId.has(p.keyId))
        byId.set(p.keyId, await this.kms.unwrap(p.wrapped!));
    }
    return { current: READ_ONLY_CURRENT, byId, kms: this.kms };
  }
}

let override: KeyProvider | undefined;
let cached: { sig: string; provider: TransitProvider } | undefined;

/** Ghi đè nhà cung cấp (test/tiêm phụ thuộc). `undefined` = quay về theo KMS_PROVIDER. */
export function setKeyProvider(p: KeyProvider | undefined): void {
  override = p;
}

/** Nhà cung cấp hiện hành theo env (KMS_PROVIDER). Transit thiếu transport/cấu hình → CryptoError("KMS_CONFIG") (fail-closed). */
export function keyProvider(): KeyProvider {
  if (override !== undefined) return override;
  if (env("KMS_PROVIDER") === "env") return envProvider;
  const cfg = transitConfig();
  const sig = `${transportEpoch}|${JSON.stringify(cfg)}`;
  if (cached?.sig === sig) return cached.provider;
  if (transport === undefined)
    throw new CryptoError(
      "KMS_CONFIG",
      "KMS_PROVIDER=transit nhưng chưa đăng ký transport KMS (import adapters/register-kms.ts ở điểm vào)",
    );
  const provider = new TransitProvider(new TransitKms(cfg, transport));
  cached = { sig, provider };
  return provider;
}

/** Client Transit hiện hành (cho xoay khoá/diễn tập); không phải transit → KMS_CONFIG. */
export function transitClient(): TransitKms {
  const p = keyProvider();
  if (!(p instanceof TransitProvider)) throw new CryptoError("KMS_CONFIG", "KMS_PROVIDER không phải transit");
  return p.kms;
}

/** Kiểm cấu hình khi khởi động (đồng bộ): transit thiếu/sai biến → ném (startup thoát ≠ 0). Không gọi mạng. */
export function assertKmsConfig(source?: Record<string, string | undefined>): void {
  if (env("KMS_PROVIDER", source) === "transit") transitConfig(source);
}

// ---- Mã hoá/giải mã bất đồng bộ (đi qua nhà cung cấp) --------------------------------------------------------------

export async function encryptFieldAsync(ctx: FieldContext, plaintext: string): Promise<string> {
  return encryptField(ctx, plaintext, await keyProvider().ringForWrite());
}

export async function decryptFieldAsync(ctx: FieldContext, envelope: string): Promise<string> {
  return decryptField(ctx, envelope, await keyProvider().ringForRead([envelope]));
}

export async function encryptOptionalAsync(
  ctx: FieldContext,
  plaintext: string | null | undefined,
): Promise<string | null> {
  return plaintext === null || plaintext === undefined ? null : encryptFieldAsync(ctx, plaintext);
}

export async function decryptOptionalAsync(
  ctx: FieldContext,
  envelope: string | null | undefined,
): Promise<string | null> {
  return envelope === null || envelope === undefined ? null : decryptFieldAsync(ctx, envelope);
}
