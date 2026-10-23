import { AXES, CASES, CASE_ORDER, SCORES, VERDICTS } from "../domain/content";
import { selectVerdict } from "../domain/scoring";
import type { Answers, AxisValues, Snapshot, VerdictId } from "../domain/types";
export type ChartModel = {
  labels: readonly string[];
  series: readonly { name: string; values: readonly number[] }[];
  min: number;
  max: number;
};
/** The bounded chart coordinate is a display value; verdicts always use the original integer ratio. */
export function ratioNumber(
  numerator: string | bigint,
  denominator: string | bigint,
): number {
  const n = BigInt(numerator),
    d = BigInt(denominator);
  if (d === 0n) return 0;
  return Number((n * 1000000n) / d) / 1000000;
}
export function formatRatio(
  numerator: string | bigint,
  denominator: string | bigint,
  signed = true,
): string {
  const n = BigInt(numerator),
    d = BigInt(denominator);
  if (d === 0n) return "—";
  if (n === 0n) return "0";
  const absolute = n < 0n ? -n : n,
    sign = n < 0n ? "−" : signed ? "＋" : "";
  if (absolute * 100n < d) return `${sign}0.01未満`;
  const hundredths = (absolute * 100n + d / 2n) / d;
  return `${sign}${hundredths / 100n}${
    hundredths % 100n === 0n
      ? ""
      : `.${String(hundredths % 100n)
          .padStart(2, "0")
          .replace(/0$/, "")}`
  }`;
}
export function signedNumber(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : n > 0 ? `＋${n}` : "0";
}
export function snapshotVerdict(snapshot: Snapshot): VerdictId | null {
  return BigInt(snapshot.count) === 0n
    ? null
    : selectVerdict(BigInt(snapshot.scoreSum), BigInt(snapshot.count));
}
export function snapshotTime(snapshot: Snapshot): string {
  const date = new Date(snapshot.updatedAt);
  if (!Number.isFinite(date.getTime())) return "集計時刻不明";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}:${part("second")} JST`;
}
export function radarModel(
  personal: AxisValues | null,
  snapshot: Snapshot,
): ChartModel | null {
  if (BigInt(snapshot.count) === 0n) return null;
  return {
    labels: AXES.map((a) => a.label),
    series: [
      ...(personal
        ? [{ name: "あなた（実線）", values: AXES.map((a) => personal[a.id]) }]
        : []),
      {
        name: "全体（破線）",
        values: AXES.map((a) =>
          ratioNumber(snapshot.axisSums[a.id], snapshot.count),
        ),
      },
    ],
    min: 0,
    max: 100,
  };
}
export function personalRadarModel(personal: AxisValues): ChartModel {
  return {
    labels: AXES.map((a) => a.label),
    series: [
      { name: "あなた（実線）", values: AXES.map((a) => personal[a.id]) },
    ],
    min: 0,
    max: 100,
  };
}
export function caseModel(answers: Answers, snapshot?: Snapshot): ChartModel {
  return {
    labels: CASE_ORDER.map(
      (id, i) =>
        `${String(i + 1).padStart(2, "0")} ${CASES.find((c) => c.id === id)!.title}`,
    ),
    series: [
      { name: "あなた", values: CASE_ORDER.map((id) => answers[id]) },
      ...(snapshot && BigInt(snapshot.count) > 0n
        ? [
            {
              name: "全体平均",
              values: CASE_ORDER.map((id) =>
                ratioNumber(
                  SCORES.reduce(
                    (sum, score) =>
                      sum +
                      BigInt(score) * BigInt(snapshot.caseCounts[id][score]),
                    0n,
                  ),
                  snapshot.count,
                ),
              ),
            },
          ]
        : []),
    ],
    min: -5,
    max: 5,
  };
}
export function cumulativeModel(answers: Answers): ChartModel {
  let sum = 0;
  return {
    labels: CASE_ORDER.map((_, i) => `${String(i + 1).padStart(2, "0")}`),
    series: [
      {
        name: "固定の出来事番号順の累積点",
        values: CASE_ORDER.map((id) => (sum += answers[id])),
      },
    ],
    min: -100,
    max: 100,
  };
}
export function distributionModel(snapshot: Snapshot): ChartModel {
  return {
    labels: VERDICTS.map((v) => v.label),
    series: [
      {
        name: "判決の割合（%）",
        values: VERDICTS.map((v) =>
          ratioNumber(
            BigInt(snapshot.verdictCounts[v.id]) * 100n,
            snapshot.count,
          ),
        ),
      },
    ],
    min: 0,
    max: 100,
  };
}
export function categoryDistribution(
  snapshot: Snapshot,
): readonly { label: string; count: string; percent: string }[] {
  return [
    {
      label: "刑罰側",
      ids: VERDICTS.filter((v) => v.id.startsWith("N")).map((v) => v.id),
    },
    { label: "釈放", ids: ["Z"] as VerdictId[] },
    {
      label: "待遇改善側",
      ids: VERDICTS.filter((v) => v.id.startsWith("P")).map((v) => v.id),
    },
  ].map((group) => {
    const count = group.ids.reduce(
      (sum, id) => sum + BigInt(snapshot.verdictCounts[id]),
      0n,
    );
    return {
      label: group.label,
      count: String(count),
      percent: formatRatio(count * 100n, snapshot.count, false),
    };
  });
}
