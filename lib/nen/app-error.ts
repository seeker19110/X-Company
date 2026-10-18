/** Lỗi nghiệp vụ có mã ổn định (docs/design/API-CONTRACT.md — Quy ước lỗi). */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
