// Cổng GPS ở server (T-051, D-032; DPIA mục 1, 6, 9): toạ độ chỉ được lưu khi cờ GEO_CAPTURE_ENABLED bật VÀ nhân viên có đồng ý
// riêng `geo_attendance` còn hiệu lực; lưu thì mã hoá. Postgres thật. Nhãn bằng chứng: faithful-fixture.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { recordEvent } from "../../lib/attendance/events.ts";
import { openGeo } from "../../lib/crypto/columns.ts";
import { withTx } from "../../lib/db/index.ts";
import {
  PURPOSE_GEO_ATTENDANCE,
  hasActiveConsent,
  recordConsent,
  withdrawConsent,
} from "../../lib/privacy/consent.ts";
import { freshDb, type TestDb } from "../helpers/db.ts";
import { seedCompany, seedUser, setTestEnv } from "../helpers/fixtures.ts";

setTestEnv();
process.env.DATA_ENCRYPTION_KEYS = `g1:${randomBytes(32).toString("base64")}`;
process.env.DATA_INDEX_KEY = randomBytes(32).toString("base64");

const LAT = 10.762622;
const LNG = 106.660172;
const geo = { lat: LAT, lng: LNG, accuracyM: 8, capturedAt: new Date("2026-10-19T01:00:00Z") };

describe("cổng GPS ở server (T-051)", () => {
  let db: TestDb;
  let companyId: string;
  let emp: Awaited<ReturnType<typeof seedUser>>;
  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany());
    emp = await seedUser(companyId);
  });
  after(async () => {
    delete process.env.GEO_CAPTURE_ENABLED;
    await db.close();
  });

  const actor = () => ({ userId: emp.userId, companyId, employeeId: emp.employeeId! });
  const send = (withGeo: boolean) =>
    recordEvent(db.app, actor(), {
      idempotencyKey: randomUUID(),
      kind: "in",
      deviceTime: new Date(),
      source: "gps",
      geo: withGeo ? geo : null,
    });
  const grant = () =>
    withTx((tx) =>
      recordConsent(tx, {
        companyId,
        subjectType: "employee",
        subjectId: emp.employeeId!,
        purposeId: PURPOSE_GEO_ATTENDANCE,
        policyVersion: "geo-v1",
        channel: "test",
        at: new Date(),
      }),
    );
  const row = async (id: string) =>
    (await db.admin.query("SELECT * FROM attendance_event WHERE id = $1", [id])).rows[0]!;
  const auditOf = async (id: string) =>
    (
      await db.admin.query(
        "SELECT after FROM audit_event WHERE object_type = 'attendance_event' AND object_id = $1 AND action = 'attendance.event'",
        [id],
      )
    ).rows[0]!.after as Record<string, unknown>;

  test("S-AT-14: cờ TẮT (mặc định) → bỏ toạ độ dù có đồng ý; không lỗi; audit ghi lý do, không có toạ độ", async () => {
    delete process.env.GEO_CAPTURE_ENABLED;
    await grant();
    const r = await send(true);
    assert.equal(r.status, "accepted");
    assert.equal(r.geoStored, false);
    const e = await row(r.eventId);
    assert.deepEqual(
      [e.geo_lat, e.geo_lng, e.geo_accuracy_m, e.geo_captured_at, e.geo_enc],
      [null, null, null, null, null],
    );
    const a = await auditOf(r.eventId);
    assert.equal(a.geoDropped, "flag_off");
    assert.equal(JSON.stringify(a).includes(String(LAT)), false);
  });

  test("S-AT-15: cờ BẬT nhưng thiếu đồng ý → bỏ toạ độ", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    const other = await seedUser(companyId);
    const r = await recordEvent(
      db.app,
      { userId: other.userId, companyId, employeeId: other.employeeId! },
      {
        idempotencyKey: randomUUID(),
        kind: "in",
        deviceTime: new Date(),
        source: "gps",
        geo,
      },
    );
    assert.equal(r.geoStored, false);
    assert.equal((await row(r.eventId)).geo_enc, null);
    assert.equal((await auditOf(r.eventId)).geoDropped, "no_consent");
  });

  test("S-AT-16: cờ BẬT + có đồng ý → lưu MÃ HOÁ (bản rõ NULL, dump không thấy toạ độ), đọc giải mã đúng; replay giữ geo_stored", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    assert.equal(await hasActiveConsent(db.app, "employee", emp.employeeId!, PURPOSE_GEO_ATTENDANCE), true);
    const key = randomUUID();
    const input = {
      idempotencyKey: key,
      kind: "in" as const,
      deviceTime: new Date(),
      source: "gps" as const,
      geo,
    };
    const r = await recordEvent(db.app, actor(), input);
    assert.equal(r.geoStored, true);
    const e = await row(r.eventId);
    assert.deepEqual([e.geo_lat, e.geo_lng, e.geo_accuracy_m, e.geo_captured_at], [null, null, null, null]);
    assert.match(e.geo_enc, /^v1:g1:/);
    assert.equal(String(e.geo_enc).includes("10.76"), false);
    assert.deepEqual(openGeo(r.eventId, e), {
      lat: LAT,
      lng: LNG,
      accuracy_m: 8,
      captured_at: "2026-10-19T01:00:00.000Z",
    });
    const a = await auditOf(r.eventId);
    assert.equal(a.geoStored, true);
    assert.equal(JSON.stringify(a).includes("10.76"), false);
    const again = await recordEvent(db.app, actor(), input);
    assert.equal(again.replayed, true);
    assert.equal(again.geoStored, true);
  });

  test("S-AT-17: rút đồng ý → dừng thu ngay (lần gửi kế tiếp bỏ toạ độ); cấp lại → thu lại", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    const withdrawn = await withTx((tx) =>
      withdrawConsent(tx, companyId, "employee", emp.employeeId!, new Date(), "test", [
        PURPOSE_GEO_ATTENDANCE,
      ]),
    );
    assert.deepEqual(withdrawn, [PURPOSE_GEO_ATTENDANCE]);
    const r = await send(true);
    assert.equal(r.geoStored, false);
    assert.equal((await auditOf(r.eventId)).geoDropped, "no_consent");
    await grant();
    assert.equal((await send(true)).geoStored, true);
  });

  test("hạn chế xử lý (restrict) cũng chặn thu toạ độ; không gửi geo → không ghi geoDropped", async () => {
    process.env.GEO_CAPTURE_ENABLED = "true";
    const u = await seedUser(companyId);
    await withTx(async (tx) => {
      await recordConsent(tx, {
        companyId,
        subjectType: "employee",
        subjectId: u.employeeId!,
        purposeId: PURPOSE_GEO_ATTENDANCE,
        policyVersion: "geo-v1",
        channel: "test",
        at: new Date(),
      });
    });
    const ev = (g: typeof geo | null) =>
      recordEvent(
        db.app,
        { userId: u.userId, companyId, employeeId: u.employeeId! },
        {
          idempotencyKey: randomUUID(),
          kind: "in",
          deviceTime: new Date(),
          source: "gps",
          geo: g,
        },
      );
    const ok = await ev(null);
    assert.equal("geoDropped" in (await auditOf(ok.eventId)), false);
    await db.admin.query(
      `INSERT INTO processing_restriction (company_id, subject_type, subject_id, kind, reason)
       VALUES ($1, 'employee', $2, 'restrict', 'kiểm thử')`,
      [companyId, u.employeeId],
    );
    assert.equal((await ev(geo)).geoStored, false);
  });

  test("không có sinh trắc/ảnh khuôn mặt: schema không có cột và mã không có đường dẫn như vậy", async () => {
    const cols = await db.admin.query(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ~* '(biometric|face|fingerprint|selfie|photo|vein|iris|sinh_trac|khuon_mat|van_tay)'`,
    );
    assert.deepEqual(cols.rows, []);
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else routes.push(p);
      }
    };
    walk(new URL("../../app/api", import.meta.url).pathname);
    assert.deepEqual(
      routes.filter((p) => /biometric|face|fingerprint|selfie|photo/i.test(p)),
      [],
    );
    const src = readFileSync(new URL("../../lib/attendance/routes.ts", import.meta.url), "utf8");
    assert.equal(/biometric|faceId|fingerprint|selfie/i.test(src), false);
  });
});

// AUD-DATA-003 (T-068): đường xoá toạ độ CÓ KIỂM SOÁT. Trigger vẫn chặn mọi UPDATE trực tiếp xoá bản mã (cả khi tự đặt cờ
// xc.geo_erase); chỉ hàm SECURITY DEFINER hẹp attendance_event_erase_geo (migration 0029) được đặt cả năm cột toạ độ về NULL.
describe("xoá toạ độ có kiểm soát (AUD-DATA-003)", () => {
  let db: TestDb;
  let companyId: string;
  let employeeId: string;
  const NOW = new Date("2026-10-18T10:00:00Z");
  before(async () => {
    db = await freshDb();
    ({ companyId } = await seedCompany());
    employeeId = (await seedUser(companyId)).employeeId!;
  });
  after(async () => {
    await db.close();
  });

  const addEvent = async (
    receivedAt: Date,
    g: { enc?: string | null; plain?: boolean } = { enc: "v1:g1:ban-ma-gia" },
  ) =>
    (
      await db.admin.query(
        `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time,
           server_received_at, source, status, geo_enc, geo_lat, geo_lng, geo_accuracy_m, geo_captured_at)
         VALUES ($1, $2, $3, 'h', 'in', $4, $4, 'gps', 'accepted', $5, $6, $6, $7, $8) RETURNING id`,
        [
          companyId,
          employeeId,
          randomUUID(),
          receivedAt,
          g.enc ?? null,
          g.plain ? 10.5 : null,
          g.plain ? 12 : null,
          g.plain ? receivedAt : null,
        ],
      )
    ).rows[0]!.id as string;
  const geoOf = async (id: string) =>
    (
      await db.admin.query(
        "SELECT geo_enc, geo_lat, geo_lng, geo_accuracy_m, geo_captured_at, status, kind FROM attendance_event WHERE id = $1",
        [id],
      )
    ).rows[0]!;
  const erase = (pool: typeof db.app, before: Date, limit = 100) =>
    pool.query<{ company_id: string }>("SELECT attendance_event_erase_geo($1, $2) AS company_id", [
      before,
      limit,
    ]);

  test("role ứng dụng UPDATE trực tiếp geo_enc = NULL vẫn bị chặn — kể cả xoá cả năm cột, kể cả tự đặt cờ xc.geo_erase", async () => {
    const ev = await addEvent(new Date("2025-01-01T00:00:00Z"));
    await assert.rejects(
      db.app.query("UPDATE attendance_event SET geo_enc = NULL WHERE id = $1", [ev]),
      /không xoá bản mã/,
    );
    const c = await db.app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL xc.geo_erase = 'on'");
      await assert.rejects(
        c.query(
          "UPDATE attendance_event SET geo_enc = NULL, geo_lat = NULL, geo_lng = NULL, geo_accuracy_m = NULL, geo_captured_at = NULL WHERE id = $1",
          [ev],
        ),
        /không xoá bản mã/,
      );
      await c.query("ROLLBACK");
      // Gọi hàm xoá xong, UPDATE trực tiếp sau đó trong CÙNG giao dịch vẫn bị chặn (cờ chỉ sống trong hàm).
      const ev2 = await addEvent(new Date("2025-01-01T00:00:00Z"));
      await c.query("BEGIN");
      await c.query("SELECT attendance_event_erase_geo($1, 10)", [new Date("2000-01-01T00:00:00Z")]);
      await assert.rejects(
        c.query("UPDATE attendance_event SET geo_enc = NULL WHERE id = $1", [ev2]),
        /không xoá bản mã/,
      );
      await c.query("ROLLBACK");
    } finally {
      c.release();
    }
    // Owner (migration) UPDATE trực tiếp cũng không đi tắt được — chỉ đường hàm.
    await assert.rejects(
      db.admin.query("UPDATE attendance_event SET geo_enc = NULL WHERE id = $1", [ev]),
      /không xoá bản mã/,
    );
    assert.equal((await geoOf(ev)).geo_enc, "v1:g1:ban-ma-gia");
  });

  test("hàm xoá: hàng quá hạn bị xoá cả bản mã lẫn bản rõ; hàng chưa tới hạn, đúng ranh giới (UTC) và cột khác không đổi", async () => {
    const cutoff = new Date("2026-07-20T00:00:00Z");
    const old = await addEvent(new Date("2026-07-19T23:59:59.999Z"));
    const oldPlain = await addEvent(new Date("2026-06-01T00:00:00Z"), { enc: null, plain: true });
    const edge = await addEvent(cutoff); // đúng mốc: giữ (chỉ < mốc)
    const fresh = await addEvent(new Date("2026-10-01T00:00:00Z"));
    const noGeo = await addEvent(new Date("2025-01-01T00:00:00Z"), { enc: null });
    const before0 = await geoOf(old);
    // Hàng quá hạn còn toạ độ (gồm cả hàng của ca trước trong file) — đếm độc lập bằng owner trước khi xoá.
    const due = (
      await db.admin.query(
        `SELECT count(*)::int AS n FROM attendance_event
          WHERE server_received_at < $1 AND (geo_enc IS NOT NULL OR geo_lat IS NOT NULL)`,
        [cutoff],
      )
    ).rows[0]!.n as number;
    assert.ok(due >= 2);
    const r = await erase(db.app, cutoff);
    assert.equal(r.rowCount, due);
    assert.deepEqual([...new Set(r.rows.map((x) => x.company_id))], [companyId]);
    for (const id of [old, oldPlain]) {
      const g = await geoOf(id);
      assert.deepEqual(
        [g.geo_enc, g.geo_lat, g.geo_lng, g.geo_accuracy_m, g.geo_captured_at],
        [null, null, null, null, null],
      );
    }
    const after0 = await geoOf(old);
    assert.deepEqual([after0.status, after0.kind], [before0.status, before0.kind]);
    assert.equal((await geoOf(edge)).geo_enc, "v1:g1:ban-ma-gia");
    assert.equal((await geoOf(fresh)).geo_enc, "v1:g1:ban-ma-gia");
    assert.equal((await geoOf(noGeo)).geo_enc, null);
    // Chạy lại: idempotent — hàng đã NULL không bị đếm lại.
    assert.equal((await erase(db.app, cutoff)).rowCount, 0);
  });

  test("hàm xoá: tham số sai bị từ chối (mốc NULL/tương lai, lô ngoài 1..10000)", async () => {
    await assert.rejects(erase(db.app, new Date(Date.now() + 86_400_000)), /mốc/);
    // AUD-DATA-006: sàn tuổi 1 ngày — p_before = now() (xoá mọi toạ độ, bỏ qua RETENTION_GEO_DAYS) bị từ chối.
    const fresh = await addEvent(new Date(Date.now() - 3_600_000));
    await assert.rejects(erase(db.app, new Date()), /ít nhất 1 ngày/);
    await assert.rejects(erase(db.app, new Date(Date.now() - 23 * 3_600_000)), /ít nhất 1 ngày/);
    assert.equal((await geoOf(fresh)).geo_enc, "v1:g1:ban-ma-gia");
    assert.ok((await erase(db.app, new Date(Date.now() - 25 * 3_600_000))).rowCount! >= 0);
    await assert.rejects(db.app.query("SELECT attendance_event_erase_geo(NULL, 10)"), /mốc/);
    await assert.rejects(erase(db.app, NOW, 0), /lô/);
    await assert.rejects(erase(db.app, NOW, 10_001), /lô/);
  });

  test("phân quyền: role ứng dụng được EXECUTE; role không thuộc xc_app_rw bị từ chối; hàm cố định search_path", async () => {
    const outsider = `xc_outsider_${randomBytes(3).toString("hex")}`;
    await db.admin.query(`CREATE ROLE ${outsider} NOLOGIN`);
    const c = await db.admin.connect();
    try {
      await c.query(`SET ROLE ${outsider}`);
      await assert.rejects(c.query("SELECT attendance_event_erase_geo($1, 10)", [NOW]), /permission denied/);
      await c.query("RESET ROLE");
    } finally {
      c.release();
      await db.admin.query(`DROP ROLE ${outsider}`);
    }
    const fns = await db.admin.query<{ proname: string; prosecdef: boolean; proconfig: string[] }>(
      `SELECT proname, prosecdef, proconfig FROM pg_proc
        WHERE proname = 'attendance_event_erase_geo'`,
    );
    assert.equal(fns.rowCount, 1);
    for (const f of fns.rows) {
      assert.equal(f.prosecdef, true);
      assert.ok(
        f.proconfig.some((x) => x.startsWith("search_path=")),
        `${f.proname} thiếu search_path cố định`,
      );
    }
    assert.ok((await erase(db.app, NOW)).rowCount! >= 0, "role ứng dụng gọi được");
  });

  test("đồng thời: hai phiên xoá cùng lúc không đếm trùng (SKIP LOCKED) và xoá đủ", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 30; i++) await addEvent(at);
    const before1 = new Date("2026-01-02T00:00:00Z");
    const [a, b] = await Promise.all([erase(db.app, before1, 7), erase(db.app, before1, 7)]);
    let total = a.rowCount! + b.rowCount!;
    for (;;) {
      const n = (await erase(db.app, before1, 7)).rowCount!;
      total += n;
      if (n === 0) break;
    }
    assert.equal(total, 30);
    const left = await db.admin.query(
      "SELECT count(*)::int AS n FROM attendance_event WHERE server_received_at = $1 AND geo_enc IS NOT NULL",
      [at],
    );
    assert.equal(left.rows[0]!.n, 0);
  });
});
