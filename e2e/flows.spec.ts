import { expect, test } from "@playwright/test";
import { expectAccessible, login, logout } from "./helpers";

test.describe("website công khai (AT01)", () => {
  test("trang chủ, dịch vụ hiển thị nội dung đã duyệt; bản nháp 404; tiếp cận được @mobile", async ({
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
    await expect(page.getByText("Bản nháp chưa duyệt")).toHaveCount(0);
    const draft = await page.goto("/dich-vu/dich-vu-nhap");
    expect(draft?.status()).toBe(404);
    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    expect(sitemap).toContain("/dich-vu/tu-van-thiet-ke");
    expect(sitemap).not.toContain("dich-vu-nhap");
  });

  test("gửi liên hệ → nhận mã hồ sơ; header bảo mật có CSP nonce", async ({ page }) => {
    const res = await page.goto("/lien-he");
    expect(res?.headers()["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
    expect(res?.headers()["x-frame-options"]).toBe("DENY");
    await page.getByLabel("Họ tên (bắt buộc)").fill("Khách E2E");
    await page.getByLabel("Email").fill("khach@e2e.test");
    await page.getByLabel("Nhu cầu (bắt buộc)").fill("Cần báo giá hệ thống điện nhẹ");
    await page.getByRole("checkbox").check();
    await page.waitForTimeout(3100); // > ngưỡng chống điền tự động 3 s
    await page.getByRole("button", { name: "Gửi yêu cầu" }).click();
    await expect(page.getByRole("status")).toContainText(/Mã yêu cầu: YC-\d{8}-\d{4}/);
    await expectAccessible(page);
  });
});

test.describe("ứng dụng nội bộ", () => {
  test("chưa đăng nhập → /app/login; trang đăng nhập tiếp cận được @mobile", async ({ page }) => {
    await page.goto("/app/today");
    await expect(page).toHaveURL(/\/app\/login$/);
    await expectAccessible(page);
    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest.start_url).toBe("/app/today");
  });

  test("AT03/AT05: vào ca trực tuyến được xác nhận; ra ca khi mất mạng lưu trên thiết bị rồi tự đồng bộ", async ({
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
    await page.goto("/app/attendance");
    await expect(page.getByText("Ra ca").first()).toBeVisible();
    await logout(page);
  });

  test("AT09: nhân viên làm và gửi nghiệm thu; trưởng nhóm nghiệm thu", async ({ page }) => {
    await login(page, "nv");
    await page.goto("/app/tasks");
    const item = page.getByRole("listitem").filter({ hasText: "Lắp đặt tủ điện tầng 3" });
    await item.getByRole("button", { name: "Bắt đầu" }).click();
    await expect(item.getByRole("button", { name: "Gửi nghiệm thu" })).toBeVisible();
    await item.getByRole("button", { name: "Gửi nghiệm thu" }).click();
    // Người làm vẫn thấy việc, ở trạng thái chờ nghiệm thu, không còn nút thao tác.
    await expect(item).toContainText("Chờ nghiệm thu");
    await expect(item.getByRole("button")).toHaveCount(0);
    await logout(page);
    await login(page, "tl");
    await page.goto("/app/tasks");
    const r = page.getByRole("listitem").filter({ hasText: "Lắp đặt tủ điện tầng 3" });
    await expect(r).toContainText("bạn nghiệm thu");
    await r.getByRole("button", { name: "Nghiệm thu" }).click();
    await expect(page.getByText("Lắp đặt tủ điện tầng 3")).toHaveCount(0);
    await logout(page);
  });

  test("AT06/AT07: đề nghị sửa công và đơn nghỉ → trưởng nhóm thấy trong hộp duyệt, duyệt và từ chối có lý do", async ({
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
    page.once("dialog", (d) => void d.accept("Trùng lịch kiểm tra công trình"));
    await page
      .getByRole("listitem")
      .filter({ hasText: "Nghỉ phép" })
      .getByRole("button", { name: "Từ chối" })
      .click();
    await expect(page.getByText("Không có đơn chờ bạn duyệt.")).toBeVisible();
    await logout(page);
  });

  test("AT12: đăng xuất rồi người khác đăng nhập cùng trình duyệt không thấy dữ liệu người trước", async ({
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
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    // Chỉ còn tối đa DB của người đang đăng nhập (DB của người trước đã bị xoá).
    expect(dbs.filter((n) => n?.startsWith("xc-")).length).toBeLessThanOrEqual(1);
    await logout(page);
  });
});
