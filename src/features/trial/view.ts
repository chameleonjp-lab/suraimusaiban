import { CASES, CASE_ORDER } from "../../domain/content";
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
      container.innerHTML = `<section class="trial-panel panel"><div class="trial-progress"><span class="eyebrow" data-testid="case-number">審理 ${String(state.currentIndex + 1).padStart(2, "0")}</span><span><span data-answered-count>${answered}</span><span class="muted"> / 20 回答</span></span></div><div class="progress-track" aria-label="回答の進捗"><div data-answered-progress style="width:${answered * 5}%"></div></div><h1 tabindex="-1">${c.title}</h1><div class="case-fact"><span class="mini-label">記録された事実</span><p>${c.fact}</p></div><div class="argument-grid"><article class="argument prosecution"><h2><span aria-hidden="true">⚖</span> 検察の主張</h2><p>${c.prosecutor}</p></article><article class="argument defense"><h2><span aria-hidden="true">♧</span> 弁護士の主張</h2><p>${c.defense}</p></article></div><fieldset class="judgment"><legend>あなたは、どう判断しますか。</legend><p class="muted small" id="judgment-help">スライダーを左右に動かして、判断の強さを選んでください。中央は未選択です。</p><div class="choice-directions"><span>← 刑罰を求める</span><span>待遇改善を求める →</span></div><div class="score-slider-wrap"><input class="score-slider" type="range" min="-5" max="5" step="1" value="${selected ?? 0}" aria-label="この審理の判断" aria-valuetext="${selected === undefined ? "未選択" : `${scoreLabel(selected)} ${choices[selected]}`}" aria-describedby="judgment-help judgment-selection"><div class="slider-scale" aria-hidden="true"><span>−5</span><span>未選択</span><span>＋5</span></div></div><div id="judgment-selection" class="selection-note" aria-live="polite">${selected === undefined ? "まだ選ばれていません" : `${scoreLabel(selected)} · ${choices[selected]}`}</div></fieldset><div class="trial-actions"><button class="secondary-button" data-prev ${state.currentIndex === 0 ? "disabled" : ""}>← 前へ</button><button class="primary-button" data-next>${state.currentIndex === 19 ? "回答を確認する" : "次の審理へ"} <span aria-hidden="true">→</span></button></div><div class="trial-bottom"><span class="small muted">回答は画面を離れると消えます</span><button class="text-button" data-review>回答一覧</button></div></section>`;
      const slider = container.querySelector<HTMLInputElement>(".score-slider")!;
      slider.oninput = () => {
        const value = Number(slider.value);
        if (value === 0) {
          const draft = { ...state.draft };
          delete draft[c.id];
          state = { ...state, draft };
        } else {
          state = setAnswer(state, c.id, value as Score);
        }
        // Keep the native input mounted while a finger/pointer is dragging it.
        const count = CASE_ORDER.filter(id => state.draft[id] !== undefined).length;
        container.querySelector("[data-answered-count]")!.textContent = String(count);
        container.querySelector<HTMLElement>("[data-answered-progress]")!.style.width = `${count * 5}%`;
        const choice = state.draft[c.id];
        slider.setAttribute("aria-valuetext", choice === undefined ? "未選択" : `${scoreLabel(choice)} ${choices[choice]}`);
        container.querySelector(".selection-note")!.textContent = choice === undefined ? "まだ選ばれていません" : `${scoreLabel(choice)} · ${choices[choice]}`;
      };
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
