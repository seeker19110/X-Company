import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  failOnCspViolation,
  expectAccessible,
  expectNoHorizontalScroll,
  login,
  logout,
  seed,
} from "./helpers";

failOnCspViolation();

// Mọi trang/màn (UX-A11Y-001, STD-A11Y-002, UX-RESP-001): axe WCAG 2.2 AA 0 vi phạm + không cuộn ngang ở 320 CSS px.
// Luồng chỉ bằng bàn phím (UX-A11Y-003): Tab/Enter/Escape, không click.
const NARROW = { width: 320, height: 800 };

async function checkPage(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
}

test.describe("mọi trang ở 320 px (UX-RESP-001, UX-A11Y-001)", () => {
  test.use({ viewport: NARROW });

  test("trang công khai: sitemap + liên hệ + đăng nhập", async ({ page }) => {
    const xml = await (await page.request.get("/sitemap.xml")).text();
    const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const p of new Set([...paths, "/lien-he", "/app/login"])) await checkPage(page, p);
  });

  test("màn nội bộ theo vai trò: nhân viên, trưởng nhóm, điều hành", async ({ page }) => {
    const byRole: [string, string[]][] = [
      ["nv", ["/app/today", "/app/tasks", "/app/attendance", "/app/me"]],
      ["tl", ["/app/approvals"]],
      ["exec", ["/app/dashboard"]],
    ];
    for (const [who, paths] of byRole) {
      await login(page, who);
      for (const p of paths) await checkPage(page, p);
      await logout(page);
      await expect(page).toHaveURL(/\/app\/login$/);
    }
  });
});

test.describe("khung trang (AUD-A11Y-001, AUD-A11Y-006)", () => {
  test("404: đúng một landmark <main> (không lồng)", async ({ page }) => {
    const res = await page.goto("/khong-co");
    expect(res?.status()).toBe(404);
    await expect(page.locator("main")).toHaveCount(1);
  });

  test.describe("ở 320 px", () => {
    test.use({ viewport: NARROW });

    // WCAG 2.4.11 (AA, 2.2): ô đang focus không bị thanh điều hướng cố định ở đáy che hoàn toàn.
    test("Tab qua mọi ô của /app/attendance: ô nhận focus không nằm dưới `.app-nav`", async ({ page }) => {
      await login(page, "nv2");
      await page.goto("/app/attendance");
      const covered: string[] = [];
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        const hit = await page.evaluate(() => {
          const el = document.activeElement;
          const nav = document.querySelector(".app-nav");
          if (!el || !nav || nav.contains(el) || el === document.body) return null;
          const r = el.getBoundingClientRect();
          const top = nav.getBoundingClientRect().top;
          return r.bottom > top
            ? `${el.tagName} ${el.getAttribute("name") ?? ""} bottom=${r.bottom} navTop=${top}`
            : null;
        });
        if (hit) covered.push(hit);
      }
      expect(covered).toEqual([]);
      await logout(page);
    });
  });
});

/** Tab tới khi `target` nhận focus (tối đa `max` lần); đỏ nếu không tới được bằng bàn phím. */
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.describe("chỉ bàn phím (UX-A11Y-003)", () => {
  test("đăng nhập → vào ca → đăng xuất chỉ bằng Tab/Enter/Escape @smoke", async ({ page }) => {
    const s = seed();
    await page.goto("/app/login");
    await tabTo(page, page.getByLabel("Email"));
    await page.keyboard.type(s.users.nv2!.email);
    await tabTo(page, page.getByLabel("Mật khẩu"));
    await page.keyboard.type(s.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/today$/);

    await tabTo(page, page.getByRole("button", { name: "Vào ca" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").first()).toContainText("Vào ca: Đã được xác nhận");
    await tabTo(page, page.getByRole("link", { name: "Chấm công" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/attendance$/);

    await tabTo(page, page.getByRole("link", { name: "Cá nhân" }));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/me$/);
    await tabTo(page, page.getByRole("button", { name: "Đăng xuất" }));
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    // Hộp xác nhận (nếu có) thoát được bằng Escape — không bẫy focus — rồi đăng xuất lại bằng phím.
    if (await dialog.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await tabTo(page, page.getByRole("button", { name: "Đăng xuất" }));
      await page.keyboard.press("Enter");
      await tabTo(page, dialog.getByRole("button", { name: /^(Đồng bộ|Xoá và đăng xuất)$/ }));
      await page.keyboard.press("Enter");
    }
    await expect(page).toHaveURL(/\/app\/login$/);
  });

  test("website: tới trang liên hệ từ trang chủ bằng bàn phím", async ({ page }) => {
    await page.goto("/");
    await tabTo(page, page.getByRole("link", { name: "Liên hệ" }).first());
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/lien-he$/);
    await tabTo(page, page.getByLabel("Họ tên (bắt buộc)"));
    await expect(page.getByLabel("Họ tên (bắt buộc)")).toBeFocused();
  });
});
