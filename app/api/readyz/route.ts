import { readiness } from "@/lib/nen/health";

export const dynamic = "force-dynamic";
export const GET = () => readiness();
