// FE-TEST-001, FE-FORM-001/002, UX-STATE-001/005/008, UX-DS-001..003, UX-A11Y-002.
// Không thêm phụ thuộc DOM: logic tách khỏi JSX + react-dom/server (renderToStaticMarkup) cho thuộc tính ARIA;
// truy vấn theo vai trò/nhãn (không testid). Hành vi thật trong trình duyệt do E2E (e2e/flows.spec.ts) phủ.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ConfirmDialog,
  escapeCancels,
  reasonError,
  resolveConfirm,
} from "../../app/components/confirm-dialog.tsx";
import { ContactFormView, contactResult } from "../../app/components/contact-form.tsx";
import { ErrorView } from "../../app/components/error-view.tsx";
import { ERROR_VIEW_TEXT, syncErrorMessage } from "../../app/components/messages.ts";
import { FieldError, fieldA11y, SubmitButton, toFieldErrors } from "../../app/components/form-parts.tsx";
import { adjMap, leaveMap, otMap } from "../../app/components/request-forms.tsx";
import {
  AdjustmentInput,
  LeaveFormInput,
  OtFormInput,
  OtInput,
} from "../../lib/attendance/request-schema.pure.ts";
import { InquiryInput } from "../../lib/inquiry/index.ts";
import { InquiryInput as SharedInquiryInput } from "../../lib/inquiry/schema.pure.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as tokenScript from "../../scripts/check-tokens.mjs";
// @ts-expect-error -- script .mjs thuần JS
import * as buildScript from "../../scripts/build-tokens.mjs";
import manifest from "../../app/manifest.ts";
import { THEME_COLOR } from "../../lib/web/theme.ts";

const { check, checkContrast, contrastRatio, hardcodedColors, parseHex } = tokenScript;
const { parseTokens, renderTheme } = buildScript;
const html = (n: ReactElement) => renderToStaticMarkup(n);
/** Thẻ mở của phần tử có name="…" (thứ tự thuộc tính do React quyết định nên test không dựa vào thứ tự). */
const field = (markup: string, name: string) =>
  new RegExp(`<(?:input|textarea|select)[^>]*\\bname="${name}"[^>]*>`).exec(markup)?.[0] ?? "";
/** Phần tử trong markup theo thuộc tính id. */
const byId = (markup: string, id: string) =>
  new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>([^<]*)`).exec(markup);

describe("UX-STATE-008: hộp thoại xác nhận", () => {
  const base = {
    title: "Từ chối đơn?",
    object: "Nghỉ phép của Nguyễn Văn A",
    consequence: "Người gửi sẽ nhận được lý do.",
    confirmLabel: "Từ chối đơn",
  };

  test("là <dialog> có tên + mô tả; nêu đối tượng; nút ghi đúng động từ (không 'OK'); huỷ có sẵn", () => {
    const m = html(<ConfirmDialog request={base} onResult={() => undefined} />);
    assert.match(m, /<dialog[^>]*aria-labelledby="([^"]+)-t"[^>]*aria-describedby="\1-d"/);
    assert.match(m, /<strong>Nghỉ phép của Nguyễn Văn A<\/strong>/);
    assert.match(m, /<button[^>]*type="submit"[^>]*>Từ chối đơn<\/button>/);
    assert.match(m, /<button[^>]*type="button"[^>]*>Huỷ<\/button>/);
    assert.ok(!/>OK</.test(m));
    assert.ok(!/<textarea/.test(m), "không cần lý do → không có ô nhập");
  });

  test("huỷ là nút focus mặc định khi không cần lý do (hành động an toàn trước)", () => {
    const m = html(<ConfirmDialog request={base} onResult={() => undefined} />);
    assert.match(m, /<button[^>]*autofocus=""[^>]*>Huỷ<\/button>/);
  });

  test("không có yêu cầu → <dialog> rỗng (không lộ nội dung cũ)", () => {
    const m = html(<ConfirmDialog request={null} onResult={() => undefined} />);
    assert.match(m, /<dialog[^>]*><\/dialog>/);
  });

  test("cần lý do: ô nhập có nhãn gắn chương trình, bắt buộc, được focus đầu tiên", () => {
    const m = html(
      <ConfirmDialog request={{ ...base, reasonLabel: "Lý do từ chối" }} onResult={() => undefined} />,
    );
    const label = /<label for="([^"]+)">Lý do từ chối<\/label>/.exec(m);
    assert.ok(label, "có <label for>");
    assert.match(m, new RegExp(`<textarea[^>]*id="${label[1]}"[^>]*required=""`));
    assert.match(m, /<textarea[^>]*autofocus=""/);
  });

  test("reasonError/resolveConfirm: rỗng, toàn khoảng trắng, Unicode, có lý do", () => {
    assert.equal(reasonError(""), "Vui lòng nhập lý do.");
    assert.equal(reasonError(" \n\t "), "Vui lòng nhập lý do.");
    assert.equal(reasonError("Trùng lịch"), null);
    assert.deepEqual(resolveConfirm(false, ""), { result: { confirmed: true } });
    assert.deepEqual(resolveConfirm(true, "   "), { error: "Vui lòng nhập lý do." });
    assert.deepEqual(resolveConfirm(true, "  Trùng lịch kiểm tra công trình  "), {
      result: { confirmed: true, reason: "Trùng lịch kiểm tra công trình" },
    });
  });

  test("Esc = huỷ: chặn đóng mặc định và trả confirmed=false (không thực hiện hành động)", () => {
    const got: unknown[] = [];
    let prevented = false;
    escapeCancels((r) => got.push(r))({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true);
    assert.deepEqual(got, [{ confirmed: false }]);
  });

  test("mọi xác nhận trong app/ đi qua hộp thoại riêng: không còn window.confirm/prompt/alert", () => {
    for (const f of [
      "app/components/logout-button.tsx",
      "app/components/task-actions.tsx",
      "app/components/decision-buttons.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      assert.ok(!/window\.(confirm|prompt|alert)\(/.test(src), f);
      assert.match(src, /useConfirm\(\)/, f);
    }
  });
});

describe("FE-FORM-001/002: biểu mẫu lỗi theo từng ô", () => {
  test("toFieldErrors: lấy lỗi đầu tiên mỗi ô; trường không có ô → lỗi chung; rỗng → không lỗi", () => {
    assert.deepEqual(toFieldErrors([]), { fields: {}, general: [] });
    const r = toFieldErrors(
      [
        { path: ["name"], message: "a" },
        { path: ["name"], message: "b" },
        { path: ["submission_id"], message: "c" },
      ],
      (p) => (p === "name" ? "name" : null),
    );
    assert.deepEqual(r, { fields: { name: "a" }, general: ["c"] });
  });

  test("fieldA11y: chỉ gắn aria-invalid/describedby khi ô lỗi; giữ gợi ý có sẵn", () => {
    assert.deepEqual(fieldA11y("f", "x", {}), {});
    assert.deepEqual(fieldA11y("f", "x", {}, "hint"), { "aria-describedby": "hint" });
    assert.deepEqual(fieldA11y("f", "x", { x: "sai" }, "hint"), {
      "aria-invalid": true,
      "aria-describedby": "f-x-err hint",
    });
  });

  test("FieldError: không lỗi → không render; có lỗi → phần tử có id mà describedby trỏ tới", () => {
    assert.equal(html(<FieldError base="f" name="x" errors={{}} />), "");
    assert.equal(
      html(<FieldError base="f" name="x" errors={{ x: "Sai rồi" }} />),
      '<span id="f-x-err" class="field-error err">Sai rồi</span>',
    );
  });

  test("liên hệ: gửi rỗng → lỗi từng ô (schema dùng chung), aria-invalid + describedby trỏ tới phần tử lỗi", () => {
    const parsed = InquiryInput.safeParse({
      submission_id: "3f2b1c9e-8d4a-4f6e-9b1a-2c3d4e5f6a7b",
      name: "  ",
      email: null,
      phone: null,
      message: "",
      consent: false,
    });
    assert.ok(!parsed.success);
    const { fields } = toFieldErrors(parsed.error.issues);
    assert.deepEqual(Object.keys(fields).sort(), ["consent", "email", "message", "name"]);
    const m = html(
      <ContactFormView
        base="c"
        state={{ kind: "error", message: "Vui lòng kiểm tra các ô được đánh dấu.", fields }}
      />,
    );
    for (const [name, msg] of Object.entries(fields)) {
      const tag = field(m, name);
      assert.match(tag, /aria-invalid="true"/, name);
      assert.match(tag, new RegExp(`aria-describedby="c-${name}-err"`), name);
      assert.equal(byId(m, `c-${name}-err`)?.[1], msg, `phần tử lỗi của ${name}`);
    }
    assert.match(m, /<p id="c-form-error" role="alert"/);
    assert.ok(!/aria-invalid/.test(field(m, "phone")), "ô không lỗi không bị đánh dấu");
  });

  test("liên hệ: ô điện thoại giữ gợi ý trong aria-describedby cùng lỗi", () => {
    const m = html(
      <ContactFormView
        base="c"
        state={{ kind: "error", message: "x", fields: { phone: "Số điện thoại không hợp lệ" } }}
      />,
    );
    const phone = field(m, "phone");
    assert.match(phone, /aria-invalid="true"/);
    assert.match(phone, /aria-describedby="c-phone-err c-phone-hint"/);
    assert.ok(byId(m, "c-phone-hint"));
  });

  test("liên hệ: trạng thái đang gửi khoá nút + aria-busy; idle thì không khoá; xong thì báo mã", () => {
    const sending = html(<ContactFormView base="c" state={{ kind: "sending" }} />);
    assert.match(sending, /<button type="submit" disabled="" aria-busy="true">Đang gửi…<\/button>/);
    const idle = html(<ContactFormView base="c" state={{ kind: "idle" }} />);
    assert.match(idle, /<button type="submit" aria-busy="false">Gửi yêu cầu<\/button>/);
    assert.ok(!/aria-invalid/.test(idle));
    const done = html(<ContactFormView base="c" state={{ kind: "done", code: "LH-1" }} />);
    assert.match(done, /<p role="status">[^]*<strong>LH-1<\/strong>/);
  });

  test("liên hệ: phản hồi không phải JSON (502/5xx HTML) → lỗi máy chủ có mã, không báo mất mạng (AUD-XFEAT-007)", () => {
    const bad = contactResult(502, "<html><body>Bad Gateway</body></html>");
    assert.equal(bad.kind, "error");
    assert.ok(
      bad.kind === "error" && /502/.test(bad.message) && !/kết nối/i.test(bad.message),
      JSON.stringify(bad),
    );
    const empty = contactResult(500, "");
    assert.ok(empty.kind === "error" && /500/.test(empty.message));
    // 2xx mà thân không đọc được (proxy cắt) → không khai "đã gửi" khi không có mã hồ sơ
    assert.equal(contactResult(200, "<html>").kind, "error");
    assert.deepEqual(contactResult(201, JSON.stringify({ code: "LH-9" })), { kind: "done", code: "LH-9" });
    const v = contactResult(
      400,
      JSON.stringify({
        error: { message: "Sai" },
        fields: [{ path: "email", message: "Email không hợp lệ" }],
      }),
    );
    assert.deepEqual(v, { kind: "error", message: "Sai", fields: { email: "Email không hợp lệ" } });
  });

  test("SubmitButton: busy khoá nút; không busy thì không", () => {
    assert.match(html(<SubmitButton busy>Gửi</SubmitButton>), /disabled="" aria-busy="true"/);
    assert.ok(!/disabled/.test(html(<SubmitButton busy={false}>Gửi</SubmitButton>)));
  });

  test("lỗi từ server (problem+json fields) map về đúng ô liên hệ", () => {
    const serverFields = [{ path: "email", message: "Cần email hoặc điện thoại" }];
    assert.deepEqual(toFieldErrors(serverFields).fields, { email: "Cần email hoặc điện thoại" });
  });

  test("đơn nghỉ: ngày trống → lỗi ở ô Ngày; có ngày mà giờ kết thúc ≤ bắt đầu → lỗi ở ô Đến", () => {
    const leaveType = "3f2b1c9e-8d4a-4f6e-9b1a-2c3d4e5f6a7b";
    const empty = new FormData();
    const bad = LeaveFormInput.safeParse({
      leave_type_id: leaveType,
      start_at: "T08:00:00+07:00",
      end_at: "T17:00:00+07:00",
      minutes: 480,
      reason: null,
    });
    assert.ok(!bad.success);
    assert.deepEqual(Object.keys(toFieldErrors(bad.error.issues, leaveMap(empty)).fields), ["date"]);
    const withDate = new FormData();
    withDate.set("date", "2026-12-01");
    const reversed = LeaveFormInput.safeParse({
      leave_type_id: leaveType,
      start_at: "2026-12-01T17:00:00+07:00",
      end_at: "2026-12-01T08:00:00+07:00",
      minutes: 480,
    });
    assert.ok(!reversed.success);
    assert.deepEqual(toFieldErrors(reversed.error.issues, leaveMap(withDate)).fields, {
      to: "Giờ kết thúc phải sau giờ bắt đầu",
    });
    const minutes = LeaveFormInput.safeParse({
      leave_type_id: leaveType,
      start_at: "2026-12-01T08:00:00+07:00",
      end_at: "2026-12-01T17:00:00+07:00",
      minutes: 0,
    });
    assert.ok(!minutes.success);
    assert.deepEqual(toFieldErrors(minutes.error.issues, leaveMap(withDate)).fields, {
      minutes: "Số phút phải lớn hơn 0",
    });
  });

  test("OT: chưa tích đồng ý / lý do trống → lỗi theo ô; server (OtInput) không ép đồng ý (hành vi cũ)", () => {
    const body = { business_date: "2026-11-03", minutes: 60, reason: "  ", consent: false };
    const r = OtFormInput.safeParse(body);
    assert.ok(!r.success);
    assert.deepEqual(toFieldErrors(r.error.issues, otMap).fields, {
      reason: "Vui lòng nhập lý do",
      consent: "Cần đồng ý làm thêm giờ để gửi đơn",
    });
    assert.ok(OtInput.safeParse({ ...body, reason: "Gấp tiến độ" }).success);
    assert.equal(OtFormInput.safeParse({ ...body, reason: "Gấp tiến độ", consent: true }).success, true);
  });

  test("sửa công: thiếu giờ → lỗi ở ô Giờ (đã có ngày) hoặc ô Ngày (chưa có); thiếu lý do → ô Lý do", () => {
    const r = AdjustmentInput.safeParse({
      action: "add_event",
      new_kind: "in",
      new_at: "2026-10-01T:00+07:00",
      reason: "",
    });
    assert.ok(!r.success);
    const noDate = new FormData();
    const withDate = new FormData();
    withDate.set("date", "2026-10-01");
    assert.deepEqual(Object.keys(toFieldErrors(r.error.issues, adjMap(noDate)).fields).sort(), [
      "date",
      "reason",
    ]);
    assert.deepEqual(Object.keys(toFieldErrors(r.error.issues, adjMap(withDate)).fields).sort(), [
      "reason",
      "time",
    ]);
  });

  test("FE-FORM-001: client và server import CÙNG module schema", () => {
    assert.strictEqual(InquiryInput, SharedInquiryInput, "lib/inquiry/index.ts tái xuất schema dùng chung");
    const need: [string, RegExp][] = [
      ["app/components/contact-form.tsx", /lib\/inquiry\/schema\.pure/],
      ["app/components/request-forms.tsx", /lib\/attendance\/request-schema\.pure/],
      ["lib/attendance/request-routes.ts", /\.\/request-schema\.pure\.ts/],
      ["lib/inquiry/index.ts", /\.\/schema\.pure\.ts/],
    ];
    for (const [file, re] of need) assert.match(readFileSync(file, "utf8"), re, file);
    for (const f of ["lib/inquiry/schema.pure.ts", "lib/attendance/request-schema.pure.ts"]) {
      assert.ok(!/from "(pg|next|\.\.\/db)/.test(readFileSync(f, "utf8")), `${f} không import pg/next/db`);
    }
  });
});

describe("UX-STATE-001/005: trạng thái lỗi/đang tải, thông báo không lộ chi tiết", () => {
  const leak = /(Error:|at .*\.js|SELECT|Exception|TypeError)/;

  test("ErrorView: có nút Thử lại gọi reset; thông báo thân thiện, không lộ nội dung lỗi", () => {
    let resets = 0;
    const el = ErrorView({ reset: () => resets++, homeHref: "/", homeLabel: "Về trang chủ" });
    const m = html(el);
    assert.match(m, /<button[^>]*type="button"[^>]*>Thử lại<\/button>/);
    assert.ok(!leak.test(m));
    const find = (n: ReactNode): ReactElement | null => {
      if (n === null || n === undefined || typeof n !== "object" || !("props" in n)) return null;
      const e = n as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
      if (e.type === "button") return e;
      for (const c of [e.props.children].flat()) {
        const r = find(c);
        if (r) return r;
      }
      return null;
    };
    const btn = find(el) as ReactElement<{ onClick: () => void }>;
    btn.props.onClick();
    assert.equal(resets, 1);
    assert.equal(ERROR_VIEW_TEXT.retry, "Thử lại");
  });

  test("error.tsx (gốc + khu nội bộ) và loading.tsx tồn tại, không render error.message", () => {
    for (const f of ["app/error.tsx", "app/app/(secure)/error.tsx"]) {
      const src = readFileSync(f, "utf8");
      assert.match(src, /^"use client";/, f);
      assert.match(src, /<ErrorView reset=\{reset\}/, f);
      assert.ok(!/\{[^}]*error\.(message|stack)/.test(src), `${f} không hiển thị message/stack`);
    }
    assert.ok(existsSync("app/app/(secure)/loading.tsx"));
    assert.match(readFileSync("app/app/(secure)/loading.tsx", "utf8"), /role="status"/);
  });

  test("syncErrorMessage: không bao giờ chứa nguyên message gốc; map theo tên lỗi IndexedDB", () => {
    const secret = new Error("SELECT * FROM queue — at idb.js:1");
    secret.name = "UnknownError";
    assert.ok(!syncErrorMessage(secret).includes("SELECT"));
    assert.ok(!leak.test(syncErrorMessage(secret)));
    assert.match(syncErrorMessage(Object.assign(new Error("x"), { name: "QuotaExceededError" })), /đã đầy/);
    assert.match(syncErrorMessage(Object.assign(new Error("x"), { name: "VersionError" })), /phiên bản/);
    assert.match(syncErrorMessage("chuỗi lạ"), /Không đọc được dữ liệu/);
    assert.match(syncErrorMessage(null), /Không đọc được dữ liệu/);
    assert.ok(!/e\.message/.test(readFileSync("app/components/sync-status.tsx", "utf8")));
  });
});

describe("UX-DS-001..003, UX-A11Y-002: token màu + tương phản", () => {
  test("contrastRatio: đen/trắng = 21, cùng màu = 1, đối xứng, #rgb rút gọn", () => {
    assert.equal(contrastRatio("#000000", "#ffffff"), 21);
    assert.equal(contrastRatio("#123456", "#123456"), 1);
    assert.equal(contrastRatio("#0f3d5e", "#ffffff"), contrastRatio("#ffffff", "#0f3d5e"));
    assert.equal(contrastRatio("#fff", "#000"), 21);
    assert.deepEqual(parseHex("#0f3d5e"), [15, 61, 94]);
    assert.equal(parseHex("rgb(1,2,3)"), null);
    assert.throws(() => contrastRatio("xanh", "#fff"));
  });

  test("contrastRatio khớp giá trị WCAG đã biết: #777 / trắng ≈ 4,48; viền focus cũ #f2a900 / trắng ≈ 2,0 (< 3)", () => {
    assert.ok(Math.abs(contrastRatio("#777777", "#ffffff") - 4.48) < 0.01);
    const old = contrastRatio("#f2a900", "#ffffff");
    assert.ok(old > 1.9 && old < 2.1, String(old));
  });

  test("checkContrast: bắt cặp trượt (chữ < 4,5; focus < 3), thiếu token, màu không phải hex", () => {
    const ok =
      ":root{--fg:#12202b;--bg:#ffffff;--muted:#4b5b67;--brand:#0f3d5e;--brand-fg:#ffffff;--danger:#a4161a;--ok:#1b6e3c;--warn:#8a5300;--focus:#0a58ca;}";
    assert.deepEqual(checkContrast(ok), []);
    const badFocus = checkContrast(ok.replace("#0a58ca", "#f2a900"));
    assert.equal(badFocus.length, 1);
    assert.match(badFocus[0], /--focus/);
    assert.match(checkContrast(ok.replace("--muted:#4b5b67", "--muted:#999999")).join("\n"), /--muted/);
    assert.match(checkContrast(ok.replace("--warn:#8a5300;", "")).join("\n"), /thiếu token --warn/);
    assert.match(checkContrast(ok.replace("#12202b", "red")).join("\n"), /không phải #rgb/);
    assert.match(checkContrast("").join("\n"), /không có khối :root/);
  });

  test("checkContrast: theme thứ hai (tối) cũng bị kiểm", () => {
    const light =
      ":root{--fg:#12202b;--bg:#ffffff;--muted:#4b5b67;--brand:#0f3d5e;--brand-fg:#ffffff;--danger:#a4161a;--ok:#1b6e3c;--warn:#8a5300;--focus:#0a58ca;}";
    const dark = '[data-theme="dark"]{--bg:#111111;--fg:#222222;}';
    const errs: string[] = checkContrast(light + dark);
    assert.equal(
      errs.some((e) => e.includes("data-theme")),
      true,
      errs.join("\n"),
    );
  });

  test("hardcodedColors: bắt hex/rgb ngoài khối token; bỏ qua trong :root và chú thích; TSX chỉ chuỗi màu", () => {
    const css =
      ":root{--a:#112233;} /* #ff0000 */ .x{color:#8a5300;background:rgb(1 2 3);border:1px solid var(--a)}";
    assert.deepEqual(hardcodedColors("a.css", css), ["#8a5300", "rgb("]);
    assert.deepEqual(hardcodedColors("a.css", ":root{--a:#112233;}.y{color:var(--a)}"), []);
    assert.deepEqual(hardcodedColors("a.tsx", '<p style={{ color: "#a4161a" }}>#noi-dung</p>'), ["#a4161a"]);
    assert.deepEqual(hardcodedColors("a.tsx", '<a href="#noi-dung">x</a>\n// "#fff"'), []);
    assert.deepEqual(hardcodedColors("a.css", ""), []);
  });

  test("parseTokens/renderTheme: theme gốc là :root đầu tiên; thiếu --brand → lỗi", () => {
    const { themes } = parseTokens(":root{--brand:#0f3d5e;--bg:#fff;font-family:system-ui,sans-serif;}");
    assert.equal(themes.get("gốc").get("--brand"), "#0f3d5e");
    assert.match(renderTheme(":root{--brand:#0f3d5e;--bg:#ffffff;}"), /THEME_COLOR = "#0f3d5e"/);
    assert.throws(() => renderTheme(":root{--bg:#fff;}"), /thiếu --brand/);
  });

  test("kho thật: token đạt tương phản, không màu cứng, theme_color khớp token (manifest + viewport dùng một nguồn)", () => {
    assert.deepEqual(check(process.cwd()), []);
    assert.equal(manifest().theme_color, THEME_COLOR);
    assert.match(readFileSync("app/layout.tsx", "utf8"), /themeColor: THEME_COLOR/);
    assert.ok(
      contrastRatio(
        readFileSync("app/globals.css", "utf8").match(/--focus:\s*(#[0-9a-f]+)/i)?.[1] ?? "#fff",
        "#ffffff",
      ) >= 3,
    );
  });
});
