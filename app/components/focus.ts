import { useEffect, useRef, type RefObject } from "react";

// Giữ focus có nghĩa sau thao tác bất đồng bộ (WCAG 2.4.3): nút vô hiệu hoá khi đang gửi hoặc bị gỡ khỏi DOM thì
// trình duyệt đưa focus về <body> — người dùng bàn phím/đọc màn hình mất vị trí (AUD-A11Y-002).

/** Tiêu đề trang (h1) làm đích dự phòng: không tab được nhưng nhận focus bằng mã (tabindex=-1). */
export function focusPageHeading(): void {
  const h = document.querySelector<HTMLElement>("h1");
  if (!h) return;
  h.tabIndex = -1;
  h.focus();
}

/** Focus vào khối chứa (không phải nút hành động): nhấn Enter lần nữa không vô tình duyệt/gửi mục khác; Tab đi vào nút. */
export function focusContainer(el: HTMLElement): void {
  el.tabIndex = -1;
  el.focus();
}

/** Mục `from` sắp bị gỡ khỏi danh sách: focus mục kế (hoặc mục trước) — chính `li`, KHÔNG phải nút Duyệt của nó; hết mục → tiêu đề trang. */
export function focusAfterRemoval(from: HTMLElement | null): void {
  const li = from?.closest("li");
  const sibling = li?.nextElementSibling ?? li?.previousElementSibling;
  if (sibling instanceof HTMLElement) focusContainer(sibling);
  else focusPageHeading();
}

/**
 * Nút bị vô hiệu khi đang gửi làm focus rơi về <body>. Gọi khi `busy` vừa chuyển true → false: focus vẫn ở <body> (thất bại,
 * hoặc gửi xong mà không có đích khác) thì trả về `target`. Không chạy lúc tải trang (chỉ sau một lần gửi).
 */
export function useRestoreFocus(
  busy: boolean,
  target: RefObject<HTMLElement | null>,
  skip?: RefObject<boolean>,
): void {
  const was = useRef(busy);
  useEffect(() => {
    const ended = was.current && !busy;
    was.current = busy;
    if (!ended || skip?.current) return;
    const el = target.current;
    const active = document.activeElement;
    if (el?.isConnected && (active === null || active === document.body)) el.focus();
  }, [busy, target, skip]);
}
