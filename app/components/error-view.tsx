// Giao diện lỗi dùng chung cho error.tsx (UX-STATE-005): thông báo thân thiện, KHÔNG hiện message/stack của lỗi,
// có nút "Thử lại" (gọi reset của Next) và đường đi khác (về trang an toàn).
import { ERROR_VIEW_TEXT } from "./error-text";

export function ErrorView({
  reset,
  homeHref,
  homeLabel,
}: {
  reset: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  return (
    <section className="error-view">
      <h1>{ERROR_VIEW_TEXT.title}</h1>
      <p role="alert">{ERROR_VIEW_TEXT.body}</p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          {ERROR_VIEW_TEXT.retry}
        </button>
        {/* Điều hướng cứng: dựng lại cây React sạch sau lỗi render. */}
        <a className="btn" href={homeHref}>
          {homeLabel}
        </a>
      </div>
    </section>
  );
}
