import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

export interface Seed {
  companyId: string;
  password: string;
  users: Record<string, { email: string; userId: string; employeeId: string }>;
}
export const seed = (): Seed => JSON.parse(readFileSync("e2e/.seed.json", "utf8")) as Seed;

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
  // Hộp xác nhận chỉ xuất hiện khi còn bản chưa gửi — gỡ listener sau đó để không nuốt hộp thoại của bước sau.
  const accept = (d: { accept: () => Promise<void> }) => void d.accept();
  page.on("dialog", accept);
  await page.getByRole("button", { name: "Đăng xuất" }).click();
  await expect(page).toHaveURL(/\/app\/login$/);
  page.off("dialog", accept);
}

/** WCAG 2.2 AA (axe): không có vi phạm mức serious/critical. */
export async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}
