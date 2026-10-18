// Phân trang thống nhất cho mọi API danh sách (XC-PERF-006, BASE-ERR-004): `?limit=&offset=`.
// limit mặc định 50, tối đa 200; offset tối đa 10.000 (ngoài ra phải lọc/đổi điều kiện, không lật trang vô hạn).
// Giá trị ngoài khoảng, không phải số nguyên thập phân (0, âm, "abc", "1e3", "1.5", rỗng) → 400 VALIDATION — KHÔNG kẹp
// ngầm, để client biết mình xin quá mức. Truy vấn lấy `limit + 1` dòng để biết còn trang sau (`next_offset`).
import { AppError } from "../nen/app-error.ts";
import { t } from "../i18n/index.ts";

export const PAGE_DEFAULT_LIMIT = 50;
export const PAGE_MAX_LIMIT = 200;
export const PAGE_MAX_OFFSET = 10_000;

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
  /** Offset của trang kế; null khi đã hết. */
  next_offset: number | null;
}

const DIGITS = /^[0-9]{1,9}$/;

function intParam(raw: string | null, name: string, min: number, max: number, fallback: number): number {
  if (raw === null) return fallback;
  if (!DIGITS.test(raw))
    throw new AppError("VALIDATION", 400, t("err.nen.intParamRange", { name, min, max }));
  const n = Number(raw);
  if (n < min || n > max)
    throw new AppError("VALIDATION", 400, t("err.nen.intParamRange", { name, min, max }));
  return n;
}

/** Đọc `limit`/`offset` từ query; thiếu → mặc định; sai/quá trần → AppError 400. */
export function parsePage(params: URLSearchParams): PageRequest {
  return {
    limit: intParam(params.get("limit"), "limit", 1, PAGE_MAX_LIMIT, PAGE_DEFAULT_LIMIT),
    offset: intParam(params.get("offset"), "offset", 0, PAGE_MAX_OFFSET, 0),
  };
}

/** Trang lớn nhất cho nơi gọi nội bộ (màn hình server-render) cần "mọi dòng trong trần". */
export const MAX_PAGE: PageRequest = { limit: PAGE_MAX_LIMIT, offset: 0 };

/** Số dòng cần SELECT (`LIMIT $n`): thêm 1 để biết còn trang sau. */
export const fetchLimit = (page: PageRequest): number => page.limit + 1;

/** Cắt dòng thừa và tính `next_offset` từ kết quả của truy vấn `LIMIT fetchLimit(page) OFFSET page.offset`. */
export function toPage<T>(rows: readonly T[], page: PageRequest): Page<T> {
  const more = rows.length > page.limit;
  return {
    items: more ? rows.slice(0, page.limit) : [...rows],
    limit: page.limit,
    offset: page.offset,
    next_offset: more ? page.offset + page.limit : null,
  };
}
