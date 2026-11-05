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
const WIDE = { width: 1280, height: 800 }; // AUD-A11Y-007: axe cũng quét bố cục máy tính, không chỉ 320 px

async function checkPage(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  await expectAccessible(page);
  await expectNoHorizontalScroll(page);
}

for (const vp of [NARROW, WIDE]) {
  test.describe(`mọi trang ở ${vp.width} px (UX-RESP-001, UX-A11Y-001)`, () => {
    test.use({ viewport: vp });

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
}

test.describe("trạng thái lỗi, hộp thoại và bảng dashboard (AUD-A11Y-007)", () => {
  for (const vp of [NARROW, WIDE]) {
    test.describe(`ở ${vp.width} px`, () => {
      test.use({ viewport: vp });

      test("form đơn ở trạng thái lỗi: axe 0 vi phạm, ô lỗi nhận focus", async ({ page }) => {
        await login(page, "nv2");
        await page.goto("/app/attendance");
        const leave = page.locator("form").filter({ has: page.getByRole("heading", { name: "Xin nghỉ" }) });
        await leave.getByRole("button", { name: "Gửi đơn nghỉ" }).click();
        await expect(leave.locator('[aria-invalid="true"]').first()).toBeFocused();
        await expect(leave.getByRole("status")).not.toBeEmpty();
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
        await logout(page);
      });

      // page.route cần chặn service worker (check:tests): SW giành request thì mock trượt.
      test.describe("hộp thoại", () => {
        test.use({ serviceWorkers: "block" });

        test("hộp xác nhận đăng xuất (còn bản chưa gửi): axe 0 vi phạm", async ({ page, context }) => {
          // Mỗi viewport một nhân viên chưa vào ca (AUD-TEST-002): nút xác định, không chấp nhận cả hai trạng thái.
          await login(page, vp.width === NARROW.width ? "nv3" : "nv4");
          await context.setOffline(true);
          await page.getByRole("button", { name: "Vào ca", exact: true }).click();
          await expect(page.getByRole("status").first()).toContainText("Đã lưu trên thiết bị");
          // Có mạng lại nhưng chặn đồng bộ → bản ghi vẫn "chờ gửi" khi sang màn Cá nhân (đồng bộ tự chạy lúc mở màn).
          await page.route("**/api/app/sync", (route) => route.abort("failed"));
          await context.setOffline(false);
          await page.getByRole("link", { name: "Cá nhân" }).click();
          await expect(page).toHaveURL(/\/app\/me$/);
          await page.getByRole("button", { name: "Đăng xuất" }).click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          await expectAccessible(page);
          // Huỷ lần 1 → hộp xác nhận xoá (mức nguy hiểm hơn) hiện ngay: quét luôn rồi huỷ lần 2.
          await page.keyboard.press("Escape");
          await expect(dialog.getByRole("heading")).toContainText(/xoá/i);
          await expectAccessible(page);
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
          // Xoá bản chưa gửi rồi đăng xuất (đồng bộ vẫn bị chặn): máy chủ không nhận lượt "Vào ca", nên chạy lặp
          // (`--repeat-each`, FE-TEST-003) vẫn bắt đầu từ "Vào ca" — ca này không đổi trạng thái máy chủ.
          await page.getByRole("button", { name: "Đăng xuất" }).click();
          await expect(dialog).toBeVisible();
          await page.keyboard.press("Escape");
          await dialog.getByRole("button", { name: "Xoá và đăng xuất" }).click();
          await expect(page).toHaveURL(/\/app\/login$/);
          await page.unroute("**/api/app/sync");
        });
      });

      test("bảng dashboard có dữ liệu mốc: có <caption>, axe 0 vi phạm", async ({ page }) => {
        await login(page, "exec");
        await page.goto("/app/dashboard");
        const table = page.getByRole("table");
        await expect(table).toBeVisible();
        await expect(table.locator("caption")).toHaveCount(1);
        await expect(table.getByRole("row")).toHaveCount(3); // tiêu đề + 2 mốc seed
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
        await logout(page);
      });
    });
  }
});

test.describe("khung trang (AUD-A11Y-001, AUD-A11Y-006)", () => {
  test("404: đúng một landmark <main> (không lồng)", async ({ page }) => {
    const res = await page.goto("/khong-co");
    expect(res?.status()).toBe(404);
    await expect(page.locator("main")).toHaveCount(1);
  });

  // UX-DS-006, hai vế (review #92, #95, #96):
  // (1) "font chính có tiếng Việt": họ font ĐẦU TIÊN của `font-family` đã tính trên các phần tử có chữ, nếu là web font
  //     (có trong `document.fonts`): nạp từng face (weight/style) rồi vẽ đủ 134 chữ Việt dựng sẵn bằng `"Họ", serif` và
  //     `"Họ", monospace` — khác = face đó thiếu glyph. Không đọc `unicode-range` (đúng cả subset tách nhiều @font-face
  //     lẫn file thiếu glyph không khai dải); face phụ (`'X Fallback'` của next/font, font icon) không xét; face nạp lỗi
  //     được báo tên thay vì ném. Hiện dự án không có web font (font hệ thống system-ui…) nên vế này rỗng.
  // (2) "fallback hiển thị đủ dấu": vẽ từng chữ bằng `font-family` đã tính của body, so với glyph `.notdef` ("tofu") của
  //     noncharacter — trùng = không font nào có glyph. Không so ảnh baseline (khác theo máy).
  test("UX-DS-006: chữ tiếng Việt có dấu có glyph thật, không tofu", async ({ page }) => {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      // 134 chữ Việt dựng sẵn: 32 ở Latin-1, Ă ă Đ đ Ĩ ĩ Ũ ũ Ơ ơ Ư ư, và U+1EA0–1EF9.
      const cps = [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc8, 0xc9, 0xca, 0xcc, 0xcd, 0xd2, 0xd3, 0xd4, 0xd5, 0xd9, 0xda, 0xdd,
      ];
      cps.push(...cps.map((cp) => cp + 0x20));
      cps.push(0x102, 0x103, 0x110, 0x111, 0x128, 0x129, 0x168, 0x169, 0x1a0, 0x1a1, 0x1af, 0x1b0);
      for (let cp = 0x1ea0; cp <= 0x1ef9; cp++) cps.push(cp);
      const fixed = cps.map((cp) => String.fromCodePoint(cp));
      const onPage = [...document.body.innerText.normalize("NFC")].filter(
        (ch) => /\p{L}/u.test(ch) && ch.codePointAt(0)! > 0x7f,
      );
      const letters = [...new Set([...fixed, ...onPage])];

      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 64;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      const family = getComputedStyle(document.body).fontFamily;
      if (!g || family === "")
        return {
          webFontsLackingVi: [],
          missing: ["(không có canvas 2d hoặc font-family)"],
        };
      const draw = (ch: string, font: string) => {
        g.clearRect(0, 0, 64, 64);
        g.font = font;
        g.textBaseline = "top";
        g.fillText(ch, 4, 4);
        return g.getImageData(0, 0, 64, 64).data.join(",");
      };

      const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
      const textEls = document.querySelectorAll(
        "body, h1, h2, h3, h4, h5, h6, p, a, li, button, input, label, td, th",
      );
      const primary = new Set(
        [...textEls].map((el) => unquote(getComputedStyle(el).fontFamily.split(",")[0] ?? "")),
      );
      const webFontsLackingVi: string[] = [];
      const seen = new Set<string>();
      for (const face of [...document.fonts].filter((f) => primary.has(unquote(f.family)))) {
        const fam = unquote(face.family);
        const variant = `${face.style} ${face.weight.split(" ")[0]}`;
        if (seen.has(`${fam}|${variant}`)) continue; // subset tách nhiều @font-face cùng họ + biến thể: kiểm một lần
        seen.add(`${fam}|${variant}`);
        const loaded = await Promise.allSettled([
          document.fonts.load(`${variant} 40px "${fam}"`, letters.join("")),
        ]);
        if (loaded[0].status === "rejected" || face.status === "error") {
          webFontsLackingVi.push(`${fam} ${variant}: không nạp được`);
          continue;
        }
        const lacking: string[] = [];
        for (const ch of letters) {
          if (draw(ch, `${variant} 40px serif`) === draw(ch, `${variant} 40px monospace`)) {
            webFontsLackingVi.push(`(serif và monospace hệ thống vẽ "${ch}" giống nhau — không kiểm được)`);
            break;
          }
          if (
            draw(ch, `${variant} 40px "${fam}", serif`) !== draw(ch, `${variant} 40px "${fam}", monospace`)
          ) {
            lacking.push(ch);
          }
        }
        if (lacking.length > 0) webFontsLackingVi.push(`${fam} ${variant}: ${lacking.join(" ")}`);
      }

      // Noncharacter (U+FFFF, U+FFFE, U+FDD0, U+1FFFF, U+10FFFF) không bao giờ có glyph → đều là `.notdef`; vẽ ra
      // nhiều ảnh khác nhau = tham chiếu hỏng → đỏ thay vì im lặng xanh.
      const nonchars = [0xffff, 0xfffe, 0xfdd0, 0x1ffff, 0x10ffff].map((cp) => String.fromCodePoint(cp));
      const notdef = new Set(nonchars.map((ch) => draw(ch, `40px ${family}`)));
      if (notdef.size !== 1)
        return {
          webFontsLackingVi,
          missing: ["(tham chiếu .notdef không nhất quán)"],
        };
      return {
        webFontsLackingVi,
        missing: letters.filter((ch) => notdef.has(draw(ch, `40px ${family}`))),
      };
    });
    expect(result.webFontsLackingVi, "web font chính thiếu glyph tiếng Việt").toEqual([]);
    expect(result.missing, "ký tự hiển thị thành ô vuông (thiếu glyph)").toEqual([]);
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

// F-003: tin tuyển dụng → form ứng tuyển → mã hồ sơ UV-… (honeypot trống; form chờ ≥ 3 s mới tránh bị đánh dấu spam).
test.describe("ứng tuyển trên website (F-003)", () => {
  for (const vp of [NARROW, WIDE]) {
    test.describe(`ở ${vp.width} px`, () => {
      test.use({ viewport: vp });

      test("tin tuyển dụng: form ứng tuyển, lỗi theo ô + focus + axe", async ({ page }) => {
        await page.goto("/tuyen-dung/ky-su-co-dien");
        await expect(page.getByRole("heading", { level: 1, name: "Kỹ sư cơ điện" })).toBeVisible();
        const form = page.locator("form.contact-form");
        await expect(form.getByRole("heading", { name: "Ứng tuyển" })).toBeVisible();
        await expect(form.getByLabel(/kho nhân tài/)).not.toBeChecked();
        await expectNoHorizontalScroll(page);

        await form.getByRole("button", { name: "Gửi hồ sơ" }).click();
        await expect(form.locator('[aria-invalid="true"]').first()).toBeFocused();
        await expect(form.getByRole("alert")).not.toBeEmpty();
        await expectAccessible(page);
      });

      test("/tuyen-dung: có form ứng tuyển chung", async ({ page }) => {
        await page.goto("/tuyen-dung");
        await expect(page.getByRole("heading", { name: "Ứng tuyển chung" })).toBeVisible();
        await expectAccessible(page);
        await expectNoHorizontalScroll(page);
      });
    });
  }

  // Gửi thật CHỈ ở một viewport: giới hạn 5 hồ sơ/10 phút/IP của endpoint công khai (cả hai project + chạy lặp
  // `--repeat-each` của FE-TEST-003 cùng một IP) — ca 320 px ở trên không gửi.
  test.describe(`gửi hồ sơ ở ${WIDE.width} px`, () => {
    test.use({ viewport: WIDE });

    test("điền form → thấy mã UV-", async ({ page }) => {
      await page.goto("/tuyen-dung/ky-su-co-dien");
      const form = page.locator("form.contact-form");
      await form.getByLabel("Họ tên (bắt buộc)").fill("Ứng Viên E2E");
      await form.getByLabel("Email (bắt buộc)").fill(`uv-${Date.now()}@example.test`);
      await form.getByLabel("Thư giới thiệu").fill("Tôi quan tâm vị trí này.");
      await form.getByLabel(/Tôi đồng ý để X-Company xử lý/).check();
      await form.getByRole("button", { name: "Gửi hồ sơ" }).click();
      await expect(page.getByRole("status")).toContainText(/UV-\d{8}-\d{4}/);
      await expectAccessible(page);
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
