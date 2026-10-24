import { AXES, CASES, CASE_ORDER, VERDICTS } from "../../domain/content";
import type { ResultSession } from "../../domain/types";
import {
  caseModel,
  cumulativeModel,
  formatRatio,
  personalRadarModel,
  radarModel,
  signedNumber,
  snapshotTime,
  snapshotVerdict,
  type ChartModel,
} from "../../charts/chart-model";
export type CardKind = "personality" | "comparison" | "verdict";
export function availableCardKinds(session: ResultSession): readonly CardKind[] {
  return BigInt(session.receipt.snapshot.count) > 0n
    ? ["personality", "comparison", "verdict"]
    : ["personality", "verdict"];
}
export function cardSize(kind: CardKind): { width: number; height: number } {
  return { width: 1080, height: kind === "verdict" ? 1920 : 1350 };
}
const font =
  '"Noto Sans CJK JP", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const ink = "#272b42",
  purple = "#655387",
  teal = "#3c7983";
function line(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = "#d5cedd",
  width = 2,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size = 26,
  color = ink,
  weight = "400",
) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}
function wrap(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 28,
  lineHeight = size * 1.5,
): number {
  ctx.font = `400 ${size}px ${font}`;
  let row = "";
  for (const character of value) {
    if (ctx.measureText(row + character).width > width && row) {
      text(ctx, row, x, y, size);
      row = "";
      y += lineHeight;
    }
    row += character;
  }
  if (row) text(ctx, row, x, y, size);
  return y + lineHeight;
}
function drawRadar(
  ctx: CanvasRenderingContext2D,
  model: ChartModel,
  cx: number,
  cy: number,
  r: number,
) {
  const point = (i: number, v: number, radius = r) => {
    const theta = -Math.PI / 2 + (i * 2 * Math.PI) / model.labels.length;
    return [
      cx + (Math.cos(theta) * radius * v) / 100,
      cy + (Math.sin(theta) * radius * v) / 100,
    ] as const;
  };
  const polygon = (values: readonly number[]) => {
    ctx.beginPath();
    values.forEach((v, i) => {
      const [x, y] = point(i, v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  for (const v of [25, 50, 75, 100]) {
    polygon(model.labels.map(() => v));
    ctx.strokeStyle = "#c4bdcc";
    ctx.lineWidth = 2;
    ctx.stroke();
    text(ctx, String(v), cx + 8, cy - (r * v) / 100 - 5, 20, "#746d80");
  }
  model.labels.forEach((_, i) => {
    const [x, y] = point(i, 100);
    line(ctx, cx, cy, x, y);
    const [lx, ly] = point(i, 100, r + 38);
    ctx.textAlign = "center";
    text(ctx, String(i + 1), lx, ly + 8, 26);
    ctx.textAlign = "left";
  });
  model.series.forEach((series, i) => {
    polygon(series.values);
    ctx.fillStyle = i === 0 ? "#9187b72a" : "#3c798312";
    ctx.fill();
    ctx.strokeStyle = i === 0 ? purple : teal;
    ctx.lineWidth = 5;
    ctx.setLineDash(series.name.includes("破線") ? [13, 9] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}
function drawSeries(
  ctx: CanvasRenderingContext2D,
  model: ChartModel,
  x: number,
  y: number,
  width: number,
  height: number,
  kind: "bar" | "line",
) {
  const py = (v: number) =>
    y + ((model.max - v) / (model.max - model.min)) * height;
  const step = width / model.labels.length;
  for (const v of [model.min, 0, model.max]) {
    line(ctx, x, py(v), x + width, py(v));
    text(ctx, String(v), x - 54, py(v) + 8, 20);
  }
  const values = model.series[0].values;
  ctx.strokeStyle = purple;
  ctx.lineWidth = 4;
  if (kind === "line") {
    ctx.beginPath();
    values.forEach((v, i) => {
      const xx = x + (i + 0.5) * step;
      if (i === 0) ctx.moveTo(xx, py(v));
      else ctx.lineTo(xx, py(v));
    });
    ctx.stroke();
  } else
    values.forEach((v, i) => {
      ctx.fillStyle = v < 0 ? purple : teal;
      ctx.fillRect(
        x + (i + 0.17) * step,
        Math.min(py(0), py(v)),
        step * 0.66,
        Math.max(2, Math.abs(py(v) - py(0))),
      );
    });
  model.labels.forEach((_, i) => {
    ctx.textAlign = "center";
    text(
      ctx,
      String(i + 1).padStart(2, "0"),
      x + (i + 0.5) * step,
      y + height + 28,
      18,
    );
    ctx.textAlign = "left";
  });
}
export function cardDescription(
  kind: CardKind,
  session: ResultSession,
): string {
  const { snapshot } = session.receipt;
  const title =
    kind === "personality"
      ? "今回の裁判に表れた判断傾向"
      : kind === "comparison"
        ? "あなたと全体の比較"
        : "今回の判決の記録";
  return `${title}。${BigInt(snapshot.count) > 0n ? `公開集計 ${snapshotTime(snapshot)}。集計版 ${snapshot.revision}` : "全体の集計準備中"}。内容 ${snapshot.version}。${kind === "verdict" ? CASE_ORDER.map((id, i) => `${String(i + 1).padStart(2, "0")} ${CASES.find((c) => c.id === id)!.title} ${signedNumber(session.receipt.ballot.answers[id])} 累積${signedNumber(session.individual.cumulative[i])}`).join("、") : AXES.map((axis) => `${axis.id} ${axis.label}: あなた ${session.individual.axes[axis.id]}${kind === "comparison" ? `、全体 ${formatRatio(snapshot.axisSums[axis.id], snapshot.count, false)}` : ""}`).join("、")}。`;
}
export async function renderCard(
  kind: CardKind,
  session: ResultSession,
  gameUrl: string,
): Promise<Blob> {
  if (!availableCardKinds(session).includes(kind))
    throw new Error("集計準備中のため比較画像は作成できません。");
  if (document.fonts) {
    await document.fonts.load(`26px ${font}`, "裁判判断傾向");
    await document.fonts.ready;
  }
  const canvas = document.createElement("canvas");
  Object.assign(canvas, cardSize(kind));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("画像を作成できません。");
  ctx.fillStyle = "#f8f5ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ede7f1";
  ctx.fillRect(0, 0, canvas.width, 20);
  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  text(ctx, "SLIME TRIAL  /  スライム裁判", 72, 88, 32, purple, "600");
  const title =
    kind === "personality"
      ? "今回の裁判に表れた判断傾向"
      : kind === "comparison"
        ? "あなたと、全体の判断"
        : "今回、あなたが下した判決";
  text(ctx, title, 72, 154, kind === "personality" ? 38 : 42, ink, "600");
  const snapshot = session.receipt.snapshot,
    individual = session.individual,
    personalVerdict = VERDICTS.find((v) => v.id === individual.verdict)!;
  if (kind !== "verdict") {
    text(ctx, "10項目・0〜100の共通尺度 / 番号は下表に対応", 72, 207, 25);
    const model =
      kind === "comparison"
        ? radarModel(individual.axes, snapshot)!
        : personalRadarModel(individual.axes);
    drawRadar(ctx, model, 540, 450, 170);
    line(ctx, 160, 692, 212, 692, purple, 5);
    text(ctx, "あなた（実線）", 226, 701, 25);
    if (kind === "comparison") {
      ctx.setLineDash([13, 9]);
      line(ctx, 595, 692, 647, 692, teal, 5);
      ctx.setLineDash([]);
      text(ctx, "全体（破線）", 661, 701, 25);
    }
    let tableY: number;
    if (kind === "comparison") {
      const overall = VERDICTS.find((v) => v.id === snapshotVerdict(snapshot));
      text(ctx, `あなた：${personalVerdict.label}`, 72, 751, 25);
      text(
        ctx,
        `全体：${overall?.label ?? "判決待ち"} ／ 平均 ${formatRatio(snapshot.scoreSum, snapshot.count)}`,
        72,
        788,
        25,
      );
      text(
        ctx,
        `公開回答数 ${snapshot.count}回 ・ ${snapshotTime(snapshot)}`,
        72,
        825,
        24,
      );
      tableY = 865;
    } else {
      wrap(
        ctx,
        "人格や善悪を診断する数値ではありません。50は心理的な中立ではなく、極端な回答の相殺も含みます。",
        72,
        752,
        936,
        25,
        36,
      );
      tableY = 854;
    }
    text(ctx, "判断傾向", 88, tableY, 25, purple, "600");
    text(
      ctx,
      "あなた",
      kind === "comparison" ? 789 : 925,
      tableY,
      24,
      purple,
      "600",
    );
    if (kind === "comparison") text(ctx, "全体", 923, tableY, 24, teal, "600");
    AXES.forEach((axis, i) => {
      const rowY = tableY + 35 * (i + 1);
      if (i % 2 === 0) {
        ctx.fillStyle = "#eee8f0";
        ctx.fillRect(72, rowY - 25, 936, 34);
      }
      text(ctx, `${axis.id}. ${axis.label}`, 88, rowY, 24);
      ctx.textAlign = "right";
      text(
        ctx,
        String(individual.axes[axis.id]),
        kind === "comparison" ? 860 : 990,
        rowY,
        24,
      );
      if (kind === "comparison")
        text(
          ctx,
          formatRatio(snapshot.axisSums[axis.id], snapshot.count, false),
          990,
          rowY,
          24,
        );
      ctx.textAlign = "left";
    });
    text(
      ctx,
      kind === "comparison"
        ? "最後の公開集計との比較。今回の回答を含まない場合があります。"
        : "各項目は今回の2件の回答から計算",
      72,
      1254,
      22,
    );
  } else {
    wrap(ctx, personalVerdict.label, 72, 230, 936, 47, 65);
    text(
      ctx,
      `合計 ${signedNumber(individual.total)} / −100〜＋100`,
      72,
      337,
      44,
      ink,
      "600",
    );
    text(
      ctx,
      `刑罰側 ${signedNumber(individual.negativeTotal)}　待遇改善側 ${signedNumber(individual.positiveTotal)}`,
      72,
      390,
      31,
    );
    text(ctx, "20件の選択値（−5〜＋5・0なし）", 72, 457, 29, purple, "600");
    drawSeries(
      ctx,
      caseModel(session.receipt.ballot.answers),
      118,
      489,
      880,
      223,
      "bar",
    );
    text(
      ctx,
      "固定の出来事番号順の累積点（−100〜＋100）",
      72,
      800,
      29,
      purple,
      "600",
    );
    drawSeries(
      ctx,
      cumulativeModel(session.receipt.ballot.answers),
      118,
      832,
      880,
      190,
      "line",
    );
    text(ctx, "出来事", 80, 1101, 26, purple, "600");
    text(ctx, "選択", 832, 1101, 26, purple, "600");
    text(ctx, "累積", 941, 1101, 26, purple, "600");
    CASE_ORDER.forEach((id, i) => {
      const y = 1141 + i * 31;
      if (i % 2 === 0) {
        ctx.fillStyle = "#eee8f0";
        ctx.fillRect(72, y - 23, 936, 31);
      }
      text(
        ctx,
        `${String(i + 1).padStart(2, "0")} ${CASES.find((c) => c.id === id)!.title}`,
        80,
        y,
        24,
      );
      ctx.textAlign = "right";
      text(ctx, signedNumber(session.receipt.ballot.answers[id]), 887, y, 25);
      text(ctx, signedNumber(individual.cumulative[i]), 998, y, 25);
      ctx.textAlign = "left";
    });
    text(
      ctx,
      "20件を同じ重みで合算。強い刑罰と待遇改善も相殺されます。",
      72,
      1792,
      24,
    );
    text(
      ctx,
      BigInt(snapshot.count) > 0n
        ? `公開集計 ${snapshotTime(snapshot)}`
        : "全体の公開集計は準備中",
      72,
      1830,
      24,
    );
  }
  line(ctx, 72, canvas.height - 66, 1008, canvas.height - 66);
  text(
    ctx,
    `内容 ${snapshot.version}${BigInt(snapshot.count) > 0n ? ` ・ 公開集計版 ${snapshot.revision}` : " ・ 集計準備中"}`,
    72,
    canvas.height - 31,
    19,
  );
  ctx.textAlign = "right";
  const safeUrl = new URL(gameUrl, location.origin);
  safeUrl.search = "";
  safeUrl.hash = "";
  const urlLabel = `${safeUrl.host}${safeUrl.pathname}`;
  ctx.font = `400 19px ${font}`;
  if (ctx.measureText(urlLabel).width > 600)
    throw new Error("共有URLが長すぎます。");
  text(ctx, urlLabel, 1008, canvas.height - 31, 19);
  ctx.textAlign = "left";
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNGを作成できません。")),
      "image/png",
    ),
  );
}
