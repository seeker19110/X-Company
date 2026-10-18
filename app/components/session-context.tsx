"use client";

import { createContext, useContext, type ReactNode } from "react";

interface SessionInfo {
  csrf: string;
  userId: string;
}

const Ctx = createContext<SessionInfo>({ csrf: "", userId: "" });

export function SessionProvider({ csrf, userId, children }: SessionInfo & { children: ReactNode }) {
  return <Ctx.Provider value={{ csrf, userId }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
