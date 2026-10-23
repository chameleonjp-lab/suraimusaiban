import {
  AXES,
  CASES,
  CASE_ORDER,
  CONTENT_VERSION,
  SCORES,
  VERDICTS,
} from "../../domain/content";
import type { AxisValues, Snapshot } from "../../domain/types";
import {
  categoryDistribution,
  distributionModel,
  formatRatio,
  radarModel,
  snapshotTime,
  snapshotVerdict,
} from "../../charts/chart-model";
import { renderChart } from "../../charts/chart-svg";
import { watchSnapshot } from "./status-feed";
export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  caption?: string,
): HTMLTableElement {
  const t = element("table");
  t.style.width = "100%";
  t.style.borderCollapse = "collapse";
  t.style.fontVariantNumeric = "tabular-nums";
  if (caption) t.append(element("caption", caption));
  const head = element("thead"),
    tr = element("tr");
  headers.forEach((h) => {
    const th = element("th", h);
    th.scope = "col";
    th.style.textAlign = "left";
    th.style.padding = ".65rem .4rem";
    tr.append(th);
  });
  head.append(tr);
  t.append(head);
  const body = element("tbody");
  rows.forEach((row) => {
    const r = element("tr");
    row.forEach((cell, i) => {
      const c = i === 0 ? element("th", cell) : element("td", cell);
      if (c instanceof HTMLTableCellElement && i === 0) c.scope = "row";
      c.style.padding = ".65rem .4rem";
      c.style.borderBottom = "1px solid #d8d1df";
      c.style.textAlign = "left";
      r.append(c);
    });
    body.append(r);
  });
  t.append(body);
  return t;
}
export function renderSnapshot(
  container: HTMLElement,
  snapshot: Snapshot,
  personal?: AxisValues,
): void {
  container.replaceChildren();
  const verdictId = snapshotVerdict(snapshot),
    verdict = VERDICTS.find((v) => v.id === verdictId);
  const header = element("section", undefined, "panel");
  header.append(
    element("p", "CURRENT VERDICT", "eyebrow"),
    element("h2", verdict?.label ?? "判決待ち", "section-heading"),
  );
  const heading = header.querySelector("h2")!;
  heading.dataset.testid = "aggregate-verdict";
  const time = element("p", snapshotTime(snapshot));
  time.dataset.testid = "snapshot-time";
  header.append(
    time,
    element(
      "p",
      `有効投票数 ${snapshot.count}票 ・ 内容 ${snapshot.version} ・ 集計版 ${snapshot.revision}`,
    ),
  );
  if (!verdict) {
    header.append(
      element(
        "p",
        "まだ投票がありません。平均・割合・判断傾向・小説は、最初の提出が届いてから表示します。",
      ),
    );
    container.append(header);
    return;
  }
  const average = element(
    "strong",
    formatRatio(snapshot.scoreSum, snapshot.count),
  );
  average.dataset.testid = "aggregate-average";
  const averageLine = element("p", "全体の平均点 ");
  averageLine.append(average);
  header.append(
    averageLine,
    element(
      "p",
      "全体の判決は平均点から決まります。最も票の多い判決とは限りません。",
    ),
  );
  container.append(header);
  const distribution = element("section", undefined, "panel");
  distribution.dataset.testid = "verdict-distribution";
  distribution.append(
    element("h3", "平均と、意見の分かれ方", "section-heading"),
  );
  const distributionChart = renderChart(distributionModel(snapshot), "bar");
  distribution.append(distributionChart);
  distribution.append(
    table(
      ["判決", "票数", "割合"],
      VERDICTS.map((v) => [
        v.label,
        snapshot.verdictCounts[v.id],
        `${formatRatio(BigInt(snapshot.verdictCounts[v.id]) * 100n, snapshot.count, false)}%`,
      ]),
      "11判決の分布",
    ),
  );
  distribution.append(
    table(
      ["区分", "票数", "割合"],
      categoryDistribution(snapshot).map((c) => [
        c.label,
        c.count,
        `${c.percent}%`,
      ]),
      "三分類の分布",
    ),
  );
  container.append(distribution);
  const model = radarModel(personal ?? null, snapshot)!;
  const axes = element("section", undefined, "panel");
  axes.append(
    element(
      "h3",
      personal ? "あなたと全体の判断傾向" : "全体の判断傾向",
      "section-heading",
    ),
  );
  const radar = renderChart(model);
  radar.dataset.testid = "radar-chart";
  axes.append(
    radar,
    table(
      ["項目", ...(personal ? ["あなた"] : []), "全体平均"],
      AXES.map((axis) => [
        axis.label,
        ...(personal ? [String(personal[axis.id])] : []),
        formatRatio(snapshot.axisSums[axis.id], snapshot.count, false),
      ]),
      "判断傾向の数値（0〜100）",
    ),
  );
  axes.append(
    element(
      "p",
      "これは今回の20件に表れた判断傾向です。人格・能力・善悪の診断や順位ではありません。50は心理的な中立ではなく、極端な2件の回答が相殺されても50になります。",
    ),
  );
  if (snapshot.count === "1" && personal)
    axes.append(
      element("p", "投票はあなたの1票です。個人と全体の線は重なります。"),
    );
  container.append(axes);
  const cases = element("section", undefined, "panel");
  cases.append(
    element("h3", "出来事ごとの平均と選択肢の分布", "section-heading"),
  );
  CASE_ORDER.forEach((id, index) => {
    const detail = element("details");
    const sum = SCORES.reduce(
      (n, s) => n + BigInt(s) * BigInt(snapshot.caseCounts[id][s]),
      0n,
    );
    detail.append(
      element(
        "summary",
        `${String(index + 1).padStart(2, "0")} ${CASES.find((c) => c.id === id)!.title} ／ 平均 ${formatRatio(sum, snapshot.count)}`,
      ),
    );
    detail.append(
      table(
        ["選択値", "票数", "割合"],
        SCORES.map((score) => [
          score > 0 ? `＋${score}` : `−${Math.abs(score)}`,
          snapshot.caseCounts[id][score],
          `${formatRatio(BigInt(snapshot.caseCounts[id][score]) * 100n, snapshot.count, false)}%`,
        ]),
      ),
    );
    cases.append(detail);
  });
  container.append(cases);
  const story = element("section", undefined, "panel");
  story.dataset.testid = "future-story";
  story.append(
    element("p", "IF THIS VERDICT HOLDS", "eyebrow"),
    element("h3", "このまま判決が決まると", "section-heading"),
    element(
      "p",
      "審理はまだ続いています。これは現在の平均による、仮の未来の物語です。",
    ),
    element("p", verdict.story),
  );
  container.append(story);
}
export function renderStatus(container: HTMLElement): () => void {
  const title = element("h1", "最新の審理状況", "section-heading"),
    note = element("p", "公開集計を読み込んでいます。");
  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
  const refresh = element("button", "最新の集計に更新", "secondary-button");
  refresh.type = "button";
  const body = element("div");
  container.replaceChildren(title, note, refresh, body);
  let disposed = false;
  const stop = watchSnapshot(
    CONTENT_VERSION,
    (snapshot) => {
      if (disposed) return;
      renderSnapshot(body, snapshot);
      note.textContent = "集計を取得しました。";
    },
    () => {
      if (disposed) return;
      note.textContent = body.childElementCount
        ? "更新できていません。最後に取得した値と時刻を表示しています。"
        : "集計を取得できません。接続を確認して、もう一度更新してください。";
    },
  );
  const manual = () =>
    window.dispatchEvent(
      new CustomEvent("slime:refresh-snapshot", { detail: CONTENT_VERSION }),
    );
  refresh.addEventListener("click", manual);
  return () => {
    disposed = true;
    stop();
    refresh.removeEventListener("click", manual);
  };
}
