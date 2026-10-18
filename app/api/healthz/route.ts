import { liveness } from "@/lib/nen/health";

export const dynamic = "force-dynamic";
export const GET = () => liveness();
