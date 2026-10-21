// Chờ theo điều kiện thay cho `sleep(N)` rồi khẳng định (AUD-TEST-001): poll đến khi đúng, có hạn chót để test không treo.
// Hết hạn → ném lỗi nêu điều kiện đang chờ (đỏ rõ ràng, không im lặng xanh).

export async function waitFor(
  cond: () => boolean | Promise<boolean>,
  label: string,
  { timeoutMs = 5_000, intervalMs = 10 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadline) throw new Error(`hết ${timeoutMs} ms vẫn chưa thoả: ${label}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Chờ một promise (sự kiện) với hạn chót; hết hạn → ném lỗi có nhãn. */
export async function within<T>(p: Promise<T>, label: string, timeoutMs = 5_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`hết ${timeoutMs} ms vẫn chưa xảy ra: ${label}`)), timeoutMs);
  });
  try {
    return await Promise.race([p, cap]);
  } finally {
    clearTimeout(timer);
  }
}
