// Chạy một lần khi server Next khởi động. Chỉ đăng ký ở runtime Node (Edge không có process/http của Node).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerShutdown } = await import("@/lib/nen/shutdown");
    registerShutdown(); // SIGTERM → readiness 503, chờ request đang chạy, đóng pool, thoát 0 (ARC-RES-009)
  }
}
