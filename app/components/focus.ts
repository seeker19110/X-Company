// Giữ focus có nghĩa sau thao tác bất đồng bộ (WCAG 2.4.3): nút vô hiệu hoá khi đang gửi hoặc bị gỡ khỏi DOM thì
// trình duyệt đưa focus về <body> — người dùng bàn phím/đọc màn hình mất vị trí (AUD-A11Y-002).

/** Tiêu đề trang (h1) làm đích dự phòng: không tab được nhưng nhận focus bằng mã (tabindex=-1). */
export function focusPageHeading(): void {
  const h = document.querySelector<HTMLElement>("h1");
  if (!h) return;
  h.tabIndex = -1;
  h.focus();
}

/** Mục `from` sắp bị gỡ khỏi danh sách: focus nút đầu của mục kế (hoặc mục trước); hết mục → tiêu đề trang. */
export function focusAfterRemoval(from: HTMLElement | null): void {
  const li = from?.closest("li");
  const sibling = li?.nextElementSibling ?? li?.previousElementSibling;
  const next = sibling?.querySelector<HTMLElement>("button");
  if (next) next.focus();
  else focusPageHeading();
}
