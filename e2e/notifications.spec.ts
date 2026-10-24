import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalScroll, failOnCspViolation, login } from "./helpers";

failOnCspViolation();

// AUD-DOC-002 (giao diện). Dữ liệu: scripts/seed-e2e.ts giao hai việc cho nv5 rồi chạy worker outbox THẬT (máy chủ e2e không
// chạy worker) → nv5 có đúng hai thông báo chưa đọc ở mỗi công ty (desktop/mobile), không bài nào khác dùng nv5.
test.describe("thông báo trong ứng dụng (AUD-DOC-002)", () => {
  test("người được giao việc thấy số chưa đọc ở điều hướng, mở danh sách, đánh dấu đã đọc → số giảm @smoke", async ({
    page,
  }) => {
    await login(page, "nv5");
    const nav = page.getByRole("navigation", { name: "Điều hướng ứng dụng" });
    // Số chưa đọc là chữ + có nhãn cho trình đọc màn hình (không chỉ màu).
    await expect(nav.getByRole("link", { name: "Thông báo, 2 chưa đọc" })).toBeVisible();

    await nav.getByRole("link", { name: "Thông báo, 2 chưa đọc" }).click();
    await expect(page).toHaveURL(/\/app\/thong-bao$/);
    await expect(page.getByRole("heading", { level: 1, name: "Thông báo" })).toBeVisible();
    await expect(page.getByText("2 thông báo chưa đọc")).toBeVisible();
    const items = page.getByRole("list", { name: "Danh sách thông báo" }).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText("Bạn được giao một việc mới");
    await expect(items.first()).toContainText("Chưa đọc");
    await expect(items.first().getByRole("link", { name: "Xem công việc" })).toHaveAttribute(
      "href",
      "/app/tasks",
    );

    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expectAccessible(page);
      await expectNoHorizontalScroll(page);
    }

    // Đánh dấu một → số giảm, focus không rơi về <body> (vào khối của thông báo).
    await items
      .first()
      .getByRole("button", { name: /^Đánh dấu đã đọc: / })
      .click();
    await expect(nav.getByRole("link", { name: "Thông báo, 1 chưa đọc" })).toBeVisible();
    await expect(page.getByText("1 thông báo chưa đọc")).toBeVisible();
    await expect(items.first()).toBeFocused();
    await expect(page.getByRole("button", { name: "Đánh dấu tất cả đã đọc" })).toBeVisible();

    // Đánh dấu tất cả → hết số, hiện trạng thái đã đọc hết; focus về tiêu đề.
    await page.getByRole("button", { name: "Đánh dấu tất cả đã đọc" }).click();
    await expect(page.getByText("Bạn đã đọc hết thông báo.")).toBeVisible();
    await expect(nav.getByRole("link", { name: "Thông báo", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByRole("button", { name: /Đánh dấu/ })).toHaveCount(0);
    await expectAccessible(page);
  });

  test("người chưa có thông báo thấy trạng thái rỗng, tiếp cận được", async ({ page }) => {
    await login(page, "nv4");
    await page.goto("/app/thong-bao");
    await expect(page.getByText("Chưa có thông báo nào.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Đánh dấu tất cả đã đọc" })).toHaveCount(0);
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await expectAccessible(page);
    }
  });
});
