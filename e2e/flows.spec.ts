import { expect, test } from "@playwright/test";
import { expectAccessible, login, logout } from "./helpers";

test.describe("website công khai (AT01)", () => {
  test("trang chủ, dịch vụ hiển thị nội dung đã duyệt; bản nháp 404; tiếp cận được @smoke", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Giải pháp cơ điện cho công trình của bạn",
    );
    await expect(page.locator("strong", { hasText: "thiết kế, thi công và bảo trì" })).toBeVisible();
    await expectAccessible(page);
    await page.goto("/dich-vu");
    await expect(page.getByRole("link", { name: "Tư vấn thiết kế" })).toBeVisible();
    await expectAccessible(page);
    await expect(page.getByText("Bản nháp chưa duyệt")).toHaveCount(0);
    const draft = await page.goto("/dich-vu/dich-vu-nhap");
    expect(draft?.status()).toBe(404);
    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/dich-vu/tu-van-thiet-ke");
    expect(sitemap).not.toContain("dich-vu-nhap");
  });

  test("gửi liên hệ → nhận mã hồ sơ; header bảo mật có CSP nonce @smoke", async ({ page }) => {
    // Đồng hồ giả (FE-TEST-003): tua qua ngưỡng chống điền tự động 3 s thay vì chờ thật.
    await page.clock.install();
    const res = await page.goto("/lien-he");
    expect(res?.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
    expect(res?.headers()["x-frame-options"]).toBe("DENY");
    await page.getByLabel("Họ tên (bắt buộc)").fill("Khách E2E");
    await page.getByLabel("Email").fill("khach@e2e.test");
    await page.getByLabel("Nhu cầu (bắt buộc)").fill("Cần báo giá hệ thống điện nhẹ");
    await page.getByRole("checkbox").check();
    await page.clock.fastForward(3100);
    await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
    await expect(page.getByRole("status")).toContainText(/Mã yêu cầu: YC-\d{8}-\d{4}/);
    await expectAccessible(page);
  });
});

test.describe("biểu mẫu: lỗi theo từng ô (FE-FORM-001/002)", () => {
  test("liên hệ: gửi rỗng → không gọi server; ô lỗi có aria-invalid + aria-describedby trỏ tới thông điệp", async ({
    page,
  }) => {
    let posted = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/public/inquiries")) posted += 1;
    });
    await page.goto("/lien-he");
    await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
    for (const label of ["Họ tên (bắt buộc)", "Nhu cầu (bắt buộc)"]) {
      const field = page.getByLabel(label);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      const id = await field.getAttribute("aria-describedby");
      await expect(page.locator(`[id="${id}"]`)).not.toBeEmpty();
    }
    await expect(page.locator(".form-error")).toContainText("Vui lòng kiểm tra");
    expect(posted).toBe(0);
    await expectAccessible(page);
  });
});

test.describe("ứng dụng nội bộ", () => {
  test("chưa đăng nhập → /app/login; trang đăng nhập tiếp cận được @smoke", async ({ page }) => {
    await page.goto("/app/today");
    await expect(page).toHaveURL(/\/app\/login$/);
    await expectAccessible(page);
    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest.start_url).toBe("/app/today");
  });

  test("AT03/AT05: vào ca trực tuyến được xác nhận; ra ca khi mất mạng lưu trên thiết bị rồi tự đồng bộ @smoke", async ({
    page,
    context,
  }) => {
    await login(page, "nv");
    await expectAccessible(page);
    await page.getByRole("button", { name: "Vào ca" }).click();
    await expect(page.getByRole("status").first()).toContainText("Vào ca: Đã được xác nhận");
    await page.reload();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Ra ca" }).click();
    await expect(page.getByRole("status").first()).toContainText("Đã lưu trên thiết bị");
    await context.setOffline(false);
    await page.goto("/app/me");
    await page.getByRole("button", { name: "Đồng bộ" }).click();
    await expect(page.getByText(/Chờ gửi:\s*0/)).toBeVisible();
    await expectAccessible(page);
    await page.goto("/app/attendance");
    await expect(page.getByText("Ra ca").first()).toBeVisible();
    await expectAccessible(page);
    await logout(page);
  });

  test("AT09: nhân viên làm và gửi nghiệm thu; trưởng nhóm nghiệm thu @smoke", async ({ page }) => {
    await login(page, "nv");
    await page.goto("/app/tasks");
    const item = page.getByRole("listitem").filter({ hasText: "Lắp đặt tủ điện tầng 3" });
    await item.getByRole("button", { name: "Bắt đầu" }).click();
    await expect(item.getByRole("button", { name: "Gửi nghiệm thu" })).toBeVisible();
    await item.getByRole("button", { name: "Gửi nghiệm thu" }).click();
    // Người làm vẫn thấy việc, ở trạng thái chờ nghiệm thu, không còn nút thao tác.
    await expect(item).toContainText("Chờ nghiệm thu");
    await expect(item.getByRole("button")).toHaveCount(0);
    await expectAccessible(page);
    await logout(page);
    await login(page, "tl");
    await page.goto("/app/tasks");
    const r = page.getByRole("listitem").filter({ hasText: "Lắp đặt tủ điện tầng 3" });
    await expect(r).toContainText("bạn nghiệm thu");
    await r.getByRole("button", { name: "Nghiệm thu" }).click();
    // UX-STATE-008: hộp thoại nêu tên việc; Esc đóng mà không nghiệm thu; nút ghi đúng động từ.
    const dialog = page.getByRole("dialog", { name: "Nghiệm thu việc?" });
    await expect(dialog).toContainText("Lắp đặt tủ điện tầng 3");
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(r).toBeVisible();
    await r.getByRole("button", { name: "Nghiệm thu" }).click();
    await dialog.getByRole("button", { name: "Nghiệm thu việc" }).click();
    await expect(page.getByText("Lắp đặt tủ điện tầng 3")).toHaveCount(0);
    await expectAccessible(page);
    await logout(page);
  });

  test("AT06/AT07: đề nghị sửa công và đơn nghỉ → trưởng nhóm thấy trong hộp duyệt, duyệt và từ chối có lý do @smoke", async ({
    page,
  }) => {
    await login(page, "nv2");
    await page.goto("/app/attendance");
    const adj = page
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Đề nghị sửa công (quên chấm)" }) });
    await adj.getByLabel("Ngày").fill("2026-10-01");
    await adj.getByLabel("Giờ").fill("17:00");
    await adj.getByLabel("Lý do (bắt buộc)").fill("Quên bấm ra ca, có tổ trưởng xác nhận");
    await adj.getByRole("button", { name: "Gửi đề nghị" }).click();
    await expect(page.getByRole("status").first()).toContainText("Đã gửi đơn");
    await expectAccessible(page);
    const leave = page.locator("form").filter({ has: page.getByRole("heading", { name: "Xin nghỉ" }) });
    await leave.getByLabel("Ngày").fill("2026-12-01");
    await leave.getByRole("button", { name: "Gửi đơn nghỉ" }).click();
    await expect(page.getByRole("status").first()).toContainText("Đã gửi đơn");
    await logout(page);
    await login(page, "tl");
    await page.goto("/app/approvals");
    await expectAccessible(page);
    const adjItem = page.getByRole("listitem").filter({ hasText: "Sửa công" });
    await adjItem.getByRole("button", { name: "Duyệt" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Sửa công" })).toHaveCount(0);
    const leaveItem = page.getByRole("listitem").filter({ hasText: "Nghỉ phép" });
    await leaveItem.getByRole("button", { name: "Từ chối" }).click();
    // UX-STATE-008 + FE-FORM-002: hộp thoại nêu đối tượng; Esc = huỷ (đơn còn nguyên); lý do bắt buộc.
    const dialog = page.getByRole("dialog", { name: "Từ chối đơn?" });
    await expect(dialog).toContainText("Nghỉ phép của Lê Thị Hai");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(leaveItem).toBeVisible();
    await leaveItem.getByRole("button", { name: "Từ chối" }).click();
    await dialog.getByRole("button", { name: "Từ chối đơn" }).click();
    const reason = dialog.getByLabel("Lý do từ chối");
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText("Vui lòng nhập lý do.")).toBeVisible();
    await reason.fill("Trùng lịch kiểm tra công trình");
    await dialog.getByRole("button", { name: "Từ chối đơn" }).click();
    await expect(page.getByText("Không có đơn chờ bạn duyệt.")).toBeVisible();
    await expectAccessible(page);
    await logout(page);
  });

  test("UX-STATE-006: bấm đúp nút gửi đơn → chỉ 1 request, request có Idempotency-Key", async ({ page }) => {
    await login(page, "nv2");
    await page.goto("/app/attendance");
    const sent: { key: string | undefined }[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/app/ot-requests"))
        sent.push({ key: r.headers()["idempotency-key"] });
    });
    const ot = page.locator("form").filter({ has: page.getByRole("heading", { name: "Làm thêm giờ" }) });
    await ot.getByLabel("Ngày").fill("2026-12-05");
    await ot.getByLabel("Lý do").fill("Hoàn thiện hạng mục gấp");
    await ot.getByRole("checkbox").check();
    await ot.getByRole("button", { name: "Gửi đơn OT" }).dblclick();
    await expect(page.getByRole("status").first()).toContainText("Đã gửi đơn");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.key).toMatch(/^[0-9a-f-]{16,}$/);
  });

  test("AT12: đăng xuất rồi người khác đăng nhập cùng trình duyệt không thấy dữ liệu người trước @smoke", async ({
    page,
  }) => {
    await login(page, "nv");
    await expect(page.getByText("Nguyễn Văn Nhân")).toBeVisible();
    await logout(page);
    const back = await page.goto("/app/today");
    await expect(page).toHaveURL(/\/app\/login$/);
    expect(back?.status()).toBe(200);
    await login(page, "nv2");
    await expect(page.getByText("Lê Thị Hai")).toBeVisible();
    await expect(page.getByText("Nguyễn Văn Nhân")).toHaveCount(0);
    await expectAccessible(page);
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    // Chỉ còn tối đa DB của người đang đăng nhập (DB của người trước đã bị xoá).
    expect(dbs.filter((n) => n?.startsWith("xc-")).length).toBeLessThanOrEqual(1);
    await logout(page);
  });
});

test.describe("lỗi máy chủ (UX-STATE-005)", () => {
  // Service worker xử lý fetch nên page.route không thấy request; chặn để mock được phản hồi 500.
  test.use({ serviceWorkers: "block" });

  test("UX-STATE-005: API trả 500 → thông báo không lộ chi tiết; gửi lại (cùng Idempotency-Key) thành công", async ({
    page,
  }) => {
    await login(page, "nv2");
    await page.goto("/app/attendance");
    const keys: (string | undefined)[] = [];
    let calls = 0;
    await page.route("**/api/app/ot-requests", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      calls += 1;
      if (calls === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/problem+json",
          body: JSON.stringify({ error: { message: "Lỗi hệ thống, vui lòng thử lại" } }),
        });
      } else await route.continue();
    });
    const ot = page.locator("form").filter({ has: page.getByRole("heading", { name: "Làm thêm giờ" }) });
    await ot.getByLabel("Ngày").fill("2026-12-07");
    await ot.getByLabel("Lý do").fill("Hoàn thiện hạng mục gấp");
    await ot.getByRole("checkbox").check();
    await ot.getByRole("button", { name: "Gửi đơn OT" }).click();
    const status = page.getByRole("status").first();
    await expect(status).toContainText("Lỗi hệ thống");
    await expect(status).not.toContainText(/(Error:|at .*\.js|SELECT|Exception|TypeError)/);
    await ot.getByRole("button", { name: "Gửi đơn OT" }).click();
    await expect(status).toContainText("Đã gửi đơn");
    expect(keys[1]).toBe(keys[0]);
    await logout(page);
  });
});
