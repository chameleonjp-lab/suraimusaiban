import { CASES, CASE_ORDER, SCORES } from "../../domain/content";
import type { Answers, Score } from "../../domain/types";
import {
  canSubmit,
  completeAnswers,
  setAnswer,
  type TrialState,
} from "./state";
export const scoreLabel = (value: number): string =>
  value < 0 ? `−${Math.abs(value)}` : `＋${value}`;
const choices: Record<Score, string> = {
  "-5": "強く刑罰を求める",
  "-4": "刑罰を求める",
  "-3": "やや刑罰を求める",
  "-2": "少し刑罰を求める",
  "-1": "わずかに刑罰を求める",
  "1": "わずかに待遇改善を求める",
  "2": "少し待遇改善を求める",
  "3": "やや待遇改善を求める",
  "4": "待遇改善を求める",
  "5": "強く待遇改善を求める",
};
export function mountTrial(
  container: HTMLElement,
  initial: TrialState,
  onSubmit: (answers: Answers, state: TrialState) => void,
  options: { preview?: boolean } = {},
): () => void {
  let state = initial;
  let reviewing = false;
  const render = (focus = false) => {
    const answered = CASE_ORDER.filter(
      (id) => state.draft[id] !== undefined,
    ).length;
    if (reviewing) {
      container.innerHTML = `<section class="trial-panel panel"><div class="eyebrow">FINAL REVIEW · 最終確認</div><h1 tabindex="-1">あなたの判断を確認</h1><p>${answered} / 20 件を回答済み</p><p class="muted">気になる審理を選ぶと、判断を変更できます。20件すべての判断を、同じ重みで合わせます。</p><ol class="answer-review">${CASE_ORDER.map(
        (id, i) => {
          const c = CASES.find((c) => c.id === id)!;
          return `<li><button class="review-row" data-case="${i}"><span class="review-number">${String(i + 1).padStart(2, "0")}</span><span>${c.title}</span><strong>${state.draft[id] === undefined ? "未回答" : scoreLabel(state.draft[id]!)}</strong></button></li>`;
        },
      ).join(
        "",
      )}</ol><p class="privacy-note">名前や個人の回答は保存しません。今回の回答を匿名で集計に加えます。回答し直した分は、新しい回答として加わります。</p><button class="primary-button full" data-submit ${canSubmit(state) ? "" : "disabled"}>${options.preview ? "未送信の結果を見る" : "この判断を提出する"} <span aria-hidden="true">→</span></button><button class="text-button full" data-back>審理に戻る</button></section>`;
      container.querySelectorAll<HTMLButtonElement>("[data-case]").forEach(
        (button) =>
          (button.onclick = () => {
            state = { ...state, currentIndex: Number(button.dataset.case) };
            reviewing = false;
            render(true);
          }),
      );
      container.querySelector<HTMLButtonElement>("[data-back]")!.onclick =
        () => {
          reviewing = false;
          render(true);
        };
      container.querySelector<HTMLButtonElement>("[data-submit]")!.onclick =
        () => {
          if (canSubmit(state)) onSubmit(completeAnswers(state), state);
        };
    } else {
      const c = CASES.find((c) => c.id === CASE_ORDER[state.currentIndex])!;
      const selected = state.draft[c.id];
      container.innerHTML = `<section class="trial-panel panel"><div class="trial-progress"><span class="eyebrow" data-testid="case-number">審理 ${String(state.currentIndex + 1).padStart(2, "0")}</span><span>${answered}<span class="muted"> / 20 回答</span></span></div><div class="progress-track" aria-label="回答の進捗"><div style="width:${answered * 5}%"></div></div><h1 tabindex="-1">${c.title}</h1><div class="case-fact"><span class="mini-label">記録された事実</span><p>${c.fact}</p></div><div class="argument-grid"><article class="argument prosecution"><h2><span aria-hidden="true">⚖</span> 検察の主張</h2><p>${c.prosecutor}</p></article><article class="argument defense"><h2><span aria-hidden="true">♧</span> 弁護士の主張</h2><p>${c.defense}</p></article></div><fieldset class="judgment"><legend>あなたは、どう判断しますか。</legend><p class="muted small">刑罰を求める、または待遇の改善を求める。その強さを選んでください。</p><div class="choice-directions"><span>← 刑罰を求める</span><span>待遇改善を求める →</span></div><div class="score-grid" role="radiogroup" aria-label="この審理の判断">${[
        -1, 1,
      ]
        .map(
          (sign) =>
            `<div class="score-side">${SCORES.filter(
              (value) => Math.sign(value) === sign,
            )
              .map(
                (value) =>
                  `<button type="button" role="radio" aria-checked="${selected === value}" aria-label="${scoreLabel(value)} ${choices[value]}" class="score-button ${value < 0 ? "minus" : "plus"} ${selected === value ? "selected" : ""}" data-score="${value}">${scoreLabel(value)}</button>`,
              )
              .join("")}</div>`,
        )
        .join(
          "",
        )}</div><div class="selection-note" aria-live="polite">${selected === undefined ? "まだ選ばれていません" : `${scoreLabel(selected)} · ${choices[selected]}`}</div></fieldset><div class="trial-actions"><button class="secondary-button" data-prev ${state.currentIndex === 0 ? "disabled" : ""}>← 前へ</button><button class="primary-button" data-next>${state.currentIndex === 19 ? "回答を確認する" : "次の審理へ"} <span aria-hidden="true">→</span></button></div><div class="trial-bottom"><span class="small muted">回答は画面を離れると消えます</span><button class="text-button" data-review>回答一覧</button></div></section>`;
      container.querySelectorAll<HTMLButtonElement>("[data-score]").forEach(
        (button) =>
          (button.onclick = () => {
            state = setAnswer(
              state,
              c.id,
              Number(button.dataset.score) as Score,
            );
            render();
            container
              .querySelector<HTMLButtonElement>(
                `[data-score="${button.dataset.score}"]`,
              )
              ?.focus({ preventScroll: true });
          }),
      );
      container.querySelector<HTMLButtonElement>("[data-prev]")!.onclick =
        () => {
          state = {
            ...state,
            currentIndex: Math.max(0, state.currentIndex - 1),
          };
          render(true);
        };
      container.querySelector<HTMLButtonElement>("[data-next]")!.onclick =
        () => {
          if (state.currentIndex === 19) reviewing = true;
          else state = { ...state, currentIndex: state.currentIndex + 1 };
          render(true);
        };
      container.querySelector<HTMLButtonElement>("[data-review]")!.onclick =
        () => {
          reviewing = true;
          render(true);
        };
      const group = container.querySelector('[role="radiogroup"]')!;
      group.addEventListener("keydown", ((event: KeyboardEvent) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        const index = SCORES.indexOf(selected ?? -5);
        const delta =
          event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
        const value = SCORES[(index + delta + 10) % 10];
        container
          .querySelector<HTMLButtonElement>(`[data-score="${value}"]`)!
          .click();
      }) as EventListener);
    }
    if (focus) {
      const heading = container.querySelector<HTMLHeadingElement>("h1");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  };
  render();
  return () => container.replaceChildren();
}
