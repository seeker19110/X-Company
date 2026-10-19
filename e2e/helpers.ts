import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

type Users = Record<string, { email: string; userId: string; employeeId: string }>;
interface SeedFile {
  companyId: string;
  password: string;
  users: Users;
  mobile: { companyId: string; users: Users };
}
export interface Seed {
  companyId: string;
  password: string;
  users: Users;
}

/** Dữ liệu của project đang chạy: mỗi project một công ty (scripts/seed-e2e.ts) → luồng ghi không giành trạng thái. */
export const seed = (): Seed => {
  const f = JSON.parse(readFileSync("e2e/.seed.json", "utf8")) as SeedFile;
  return test.info().project.name.startsWith("mobile")
    ? { companyId: f.mobile.companyId, password: f.password, users: f.mobile.users }
    : { companyId: f.companyId, password: f.password, users: f.users };
};

export async function login(page: Page, key: string) {
  const s = seed();
  await page.goto("/app/login");
  await page.getByLabel("Email").fill(s.users[key]!.email);
  await page.getByLabel("Mật khẩu").fill(s.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/app\/today$/);
}

export async function logout(page: Page) {
  await page.goto("/app/me");
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  // Hộp xác nhận (<dialog>) chỉ xuất hiện khi còn bản chưa gửi: đồng bộ rồi (nếu cần) xoá và đăng xuất.
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if (await dialog.isVisible()) {
      await dialog.getByRole("button", { name: /^(Đồng bộ|Xoá và đăng xuất)$/ }).click();
    }
    await expect(page).toHaveURL(/\/app\/login$/, { timeout: 1500 });
  }).toPass({ timeout: 15_000 });
}

/** WCAG 2.2 AA (axe, UX-A11Y-001/STD-A11Y-002): KHÔNG có vi phạm nào, ở mọi mức độ. */
export async function expectAccessible(page: Page) {
  // Sau điều hướng/refresh phía client, <title> có thể vắng thoáng chốc (metadata nạp sau) → chờ ổn định rồi mới quét,
  // không bỏ qua luật nào của axe (document-title vẫn bị kiểm).
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    r.violations.map(
      (v) => `${v.impact ?? "?"} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
  ).toEqual([]);
}

/** UX-RESP-001 (WCAG 1.4.10): không cuộn ngang ở bề rộng hiện tại. */
export async function expectNoHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, `scrollWidth ${scroll} > clientWidth ${client} tại ${page.url()}`).toBeLessThanOrEqual(
    client,
  );
}

/** SEC-WEB-004: mọi trang mở trong test không được có vi phạm CSP (style/script bị chặn = giao diện hỏng âm thầm).
 * Gọi một lần ở đầu mỗi file spec (hook của Playwright đăng ký theo file). */
export function failOnCspViolation() {
  let errs: string[] = [];
  const watch = (p: Page) =>
    p.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|violates the following/i.test(m.text()))
        errs.push(m.text());
    });
  test.beforeEach(async ({ page, context }) => {
    errs = [];
    watch(page);
    context.on("page", watch); // cả trang mở thêm trong cùng context
  });
  test.afterEach(async () => {
    expect(errs, "vi phạm CSP trên trang").toEqual([]);
  });
}
