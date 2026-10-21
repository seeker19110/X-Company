"use client";

import { createContext, useContext, type ReactNode } from "react";
// Nạp sẵn ở layout khu nội bộ (FE-PERF-004): client API và hộp thoại xác nhận dùng ở nhiều trang; nằm trong chunk của
// layout thì Turbopack không chép lại module vào chunk riêng của từng trang (đo: tổng JS tĩnh giảm ~3,5 KB gzip).
// Chỉ nạp module (không có tác dụng phụ ngoài khởi tạo hằng); trang vẫn import trực tiếp thứ mình dùng.
import "./api";
import "./confirm-dialog";

interface SessionInfo {
  csrf: string;
  userId: string;
}

const Ctx = createContext<SessionInfo>({ csrf: "", userId: "" });

export function SessionProvider({ csrf, userId, children }: SessionInfo & { children: ReactNode }) {
  return <Ctx.Provider value={{ csrf, userId }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
