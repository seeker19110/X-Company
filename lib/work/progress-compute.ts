// Lõi thuần của tiến độ (SPEC-work, AT10): không import DB/HTTP/Next (ARC-MOD-003, kiểm bằng ESLint).

export interface LeafInput {
  workPackageId: string;
  weight: number;
  tasks: { status: string; reportedPct: number; dueDate: string | null }[];
}

export interface Progress {
  /** null khi không có baseline/trọng số (không đồng nhất với 0%). */
  acceptedPct: number | null;
  reportedPct: number | null;
  plannedPct: number | null;
  leaves: { workPackageId: string; weight: number; accepted: number; reported: number; planned: number }[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Mỗi lá: tỷ lệ = phần việc (không tính việc huỷ) — chia đều trong lá. accepted = việc `done` / tổng; reported =
 * trung bình % báo (done = 100); planned = việc có hạn ≤ hôm nay / tổng. Tiến độ = Σ(trọng số × tỷ lệ) / Σ trọng số.
 * Chia nhỏ việc trong một lá không vượt được trọng số của lá.
 */
export function computeProgress(leaves: LeafInput[], today: string): Progress {
  const valid = leaves.filter((l) => l.weight > 0);
  const total = valid.reduce((s, l) => s + l.weight, 0);
  const out: Progress["leaves"] = valid.map((l) => {
    const tasks = l.tasks.filter((t) => t.status !== "cancelled");
    const n = tasks.length;
    if (n === 0)
      return { workPackageId: l.workPackageId, weight: l.weight, accepted: 0, reported: 0, planned: 0 };
    return {
      workPackageId: l.workPackageId,
      weight: l.weight,
      accepted: tasks.filter((t) => t.status === "done").length / n,
      reported: tasks.reduce((s, t) => s + (t.status === "done" ? 100 : t.reportedPct), 0) / (100 * n),
      planned: tasks.filter((t) => t.dueDate !== null && t.dueDate <= today).length / n,
    };
  });
  if (total === 0) return { acceptedPct: null, reportedPct: null, plannedPct: null, leaves: out };
  const pct = (k: "accepted" | "reported" | "planned") =>
    round2((100 * out.reduce((s, l) => s + l.weight * l[k], 0)) / total);
  return {
    acceptedPct: pct("accepted"),
    reportedPct: pct("reported"),
    plannedPct: pct("planned"),
    leaves: out,
  };
}
