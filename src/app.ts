import { mountScene, type SceneHandle } from "./scene";
import { startTrial, mountTrial, type TrialState } from "./features/trial";
import { scoreAnswers } from "./domain/scoring";
import { VERDICTS } from "./domain/content";
import type {
  Answers,
  SubmitReceipt,
  SubmitRequest,
} from "./domain/types";
import { isBackendConfigured } from "./platform/supabase-client";
import { purgeBrowserLegacyStorage } from "./platform/draft-storage";
import { submitBallot } from "./features/vote/vote-api";
import { renderResults } from "./features/results/result-view";
import { renderStatus } from "./features/status/status-view";
import { homeShare, xShareLink } from "./features/share/x-share";
export type AppRoute = "home" | "trial" | "result" | "status";
let navigation: (route: AppRoute) => void = () => {};
export const navigate = (route: AppRoute): void => navigation(route);
export function mountApp(container: HTMLElement): () => void {
  let cleanupView = () => {};
  let scene: SceneHandle | null = null;
  let receipt: SubmitReceipt | null = null;
  let currentRoute: AppRoute = "home";
  let generation = 0;
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = motionPreference.matches;
  // null follows the initial OS preference; an explicit start/stop wins until departure.
  let motionOverride: boolean | null = null;
  const updateMotionControl = () => {
    const unavailable = container.querySelector<HTMLCanvasElement>("canvas")?.dataset.sceneState === "unavailable";
    const toggle = container.querySelector<HTMLButtonElement>(".scene-toggle");
    if (toggle) toggle.textContent = unavailable ? "3Dを再試行" : paused ? "スライムを動かす" : "動きを止める";
    const status = container.querySelector<HTMLElement>("[data-motion-status]");
    if (status) {
      status.hidden = !unavailable && !paused;
      status.textContent = unavailable ? "3Dを表示できませんでした。もう一度読み込めます。" :
        motionOverride === true ? "動きを停止しています。" : "端末の動きを減らす設定に合わせて停止中です。ボタンから動かせます。";
    }
  };
  const motionChanged = (event: MediaQueryListEvent) => {
    paused = motionOverride ?? event.matches;
    scene?.setReducedMotion(paused);
    updateMotionControl();
  };
  motionPreference.addEventListener("change", motionChanged);
  let pending: SubmitRequest | null = null;
  const connected = isBackendConfigured();
  purgeBrowserLegacyStorage();
  let submitting = false;
  let submissionController: AbortController | null = null;
  const go = async (route: AppRoute, updateHistory = true) => {
    if (route === "result" && !receipt) route = "home";
    if (currentRoute === "result" && route !== "result") receipt = null;
    if (route !== currentRoute || route === "trial") pending = null;
    currentRoute = route;
    const thisGeneration = ++generation;
    submitting = false;
    submissionController?.abort();
    submissionController = null;
    cleanupView();
    cleanupView = () => {};
    scene?.dispose();
    scene = null;
    if (updateHistory)
      history.pushState(
        null,
        "",
        route === "home" ? location.pathname : `#${route}`,
      );
    container.innerHTML = `<div class="site-shell"><header class="site-header"><button class="brand" aria-label="スライム裁判 ホームへ"><span class="brand-mark" aria-hidden="true">♧</span><span>スライム裁判<small>THE SILENT DEFENDANT</small></span></button><nav aria-label="メインナビゲーション"><button class="nav-button ${route === "home" ? "active" : ""}" data-route="home">物語</button><button class="nav-button ${route === "status" ? "active" : ""}" data-route="status">みんなの判決 <span aria-hidden="true">↗</span></button></nav></header><main id="main-content" class="route-${route}"></main><footer class="site-footer"><span>THE SILENT DEFENDANT</span><span>真意は、まだ誰も知らない。</span><button class="text-button" data-about>この裁判について</button></footer></div>`;
    container.querySelector<HTMLButtonElement>(".brand")!.onclick = () =>
      void go("home");
    container
      .querySelectorAll<HTMLButtonElement>("[data-route]")
      .forEach(
        (button) =>
          (button.onclick = () => void go(button.dataset.route as AppRoute)),
      );
    container.querySelector<HTMLButtonElement>("[data-about]")!.onclick =
      () => {
        const dialog = document.createElement("dialog");
        dialog.className = "about-dialog";
        dialog.innerHTML = `<div class="eyebrow">ABOUT THIS TRIAL</div><h2>声のない被告に、あなたの判断を。</h2><p>20件の事実と、検察・弁護士の主張を読んで判断する物語です。これは人格や善悪を診断するものではありません。</p><p>名前・メールは不要。今回の回答を匿名で集計に加えます。個人の回答や結果は保存しません。画面を離れると消え、後から見返すことはできません。公開集計は10回答ごとに更新します。</p><p>音はありません。3Dを停止してもすべての審理を続けられます。</p><button class="primary-button">閉じる</button>`;
        dialog.querySelector("button")!.onclick = () => {
          dialog.close();
          dialog.remove();
        };
        container.append(dialog);
        dialog.showModal();
      };
    const main = container.querySelector<HTMLElement>("main")!;
    window.scrollTo({ top: 0, behavior: "instant" });
    if (route === "home") {
      main.innerHTML = `<section class="home-hero"><div class="hero-copy"><div class="eyebrow"><span class="tiny-rule"></span> A STORY YOU JUDGE</div><p class="hero-preface">被告は、一匹のスライム。</p><h1>その判断で、<br><em>運命がゆれる。</em></h1><p class="hero-description">人を傷つけた。人を救った。<br>けれど、この小さな生きものは何も語らない。<br>20の出来事に、あなたならどんな判決を？</p><div class="hero-cta"><button class="primary-button start-trial">裁判に参加する <span aria-hidden="true">→</span></button><span>全20件 <span aria-hidden="true">·</span> 約10分 <span aria-hidden="true">·</span> 名前の入力不要</span></div></div><div class="hero-visual"><div class="scene-caption-top"><span>王立小法廷</span><span>審理、進行中。</span></div><div class="scene-holder"><canvas aria-label="法廷で静かに待つ一匹のスライム"></canvas><img hidden data-scene-fallback src="${import.meta.env.BASE_URL}slime-fallback.webp" alt="法廷で静かに待つ一匹のスライム"></div><div class="scene-caption-bottom"><span><i class="live-dot"></i> THE DEFENDANT IS SILENT</span><button class="scene-toggle">${paused ? "スライムを動かす" : "動きを止める"}</button></div><p class="scene-status small muted" data-motion-status role="status" hidden></p><span class="visual-index" aria-hidden="true">CASE FILE — 001</span></div></section><section class="story-intro"><div><span class="section-number">01 / THE STORY</span><h2>正しさは、ひとつじゃない。</h2></div><p>同じ事実にも、ふたつの言い分がある。<br>検察と弁護士の声に耳を傾け、あなたの判断を重ねてください。<br>最後に、あなたと世界の判断が並びます。</p></section><section class="process-grid" aria-label="裁判の流れ"><article><span>01</span><h3>20の事実を読む</h3><p>検察と弁護士、それぞれの主張から<br>出来事の向こう側を想像する。</p></article><article><span>02</span><h3>あなたの判断を選ぶ</h3><p>刑罰か、待遇の改善か。<br>その強さまで、あなたに委ねます。</p></article><article><span>03</span><h3>世界の判断と出会う</h3><p>最後に公開された全体の集計と比較。<br>違いから、また物語がはじまる。</p></article></section>${connected ? "" : '<p class="preview-banner"><span>PREVIEW</span> 現在は未接続プレビューです。回答は送信されず、全体集計には加わりません。</p>'}`;
      main.querySelector<HTMLButtonElement>(".start-trial")!.onclick = () =>
        void go("trial");
      main
        .querySelector(".hero-copy")!
        .append(xShareLink("このゲームをXでシェア", homeShare()));
    } else if (route === "trial") {
      main.innerHTML = `<div class="trial-layout"><aside class="trial-scene"><div class="eyebrow">THE COURT IS IN SESSION</div><div class="scene-holder"><canvas aria-label="審理を待つ一匹のスライム"></canvas><img hidden data-scene-fallback src="${import.meta.env.BASE_URL}slime-fallback.webp" alt="審理を待つスライム"></div><div class="scene-caption-bottom"><span>被告は、何も語らない。</span><button class="scene-toggle">${paused ? "スライムを動かす" : "動きを止める"}</button></div><p class="scene-status small muted" data-motion-status role="status" hidden></p>${connected ? "" : '<p class="preview-banner">プレビュー · 未送信</p>'}</aside><div class="trial-content"><p role="status">審理記録を開いています…</p></div></div>`;
      const target = main.querySelector<HTMLElement>(".trial-content")!;
      setupScene(main, "trial");
      cleanupView = mountTrial(
        target,
        startTrial(),
        (answers, edited) => {
          if (generation === thisGeneration) void submit(answers, edited, target);
        },
        { preview: !connected },
      );
      return;
    } else if (route === "result" && receipt) {
      cleanupView = renderResults(main, receipt);
    } else {
      cleanupView = renderStatus(main);
    }
    setupScene(main, route);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const setupScene = (main: HTMLElement, route: AppRoute) => {
    const canvas = main.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return;
    canvas.hidden = false;
    delete canvas.dataset.sceneState;
    const fallback = main.querySelector<HTMLImageElement>("[data-scene-fallback]");
    if (fallback) fallback.hidden = true;
    const unavailable = () => {
      canvas.dataset.sceneState = "unavailable";
      canvas.hidden = true;
      const fallback = main.querySelector<HTMLImageElement>(
        "[data-scene-fallback]",
      );
      if (fallback) fallback.hidden = false;
      updateMotionControl();
    };
    try {
      scene = mountScene(canvas, unavailable);
      scene.setView(
        route === "home" ? "home" : route === "trial" ? "trial" : "still",
      );
      scene.setReducedMotion(paused);
    } catch {
      unavailable();
    }
    updateMotionControl();
    const toggle = main.querySelector<HTMLButtonElement>(".scene-toggle");
    if (toggle)
      toggle.onclick = () => {
        if (canvas.dataset.sceneState === "unavailable") {
          scene?.dispose();
          scene = null;
          // A failed/lost WebGL context cannot resume. Give Three.js a fresh canvas.
          const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
          canvas.replaceWith(replacement);
          setupScene(main, route);
          return;
        }
        paused = !paused;
        motionOverride = paused;
        scene?.setReducedMotion(paused);
        updateMotionControl();
      };
  };
  const submit = async (
    answers: Answers,
    state: TrialState,
    target: HTMLElement,
  ) => {
    if (currentRoute !== "trial") return;
    if (!connected) {
      const result = scoreAnswers(answers);
      const verdict = VERDICTS.find((item) => item.id === result.verdict)!;
      cleanupView();
      target.innerHTML = `<section class="panel preview-result"><span class="eyebrow">LOCAL PREVIEW · 未送信</span><h1>あなたの判断</h1><p class="result-score">${result.total > 0 ? "＋" : ""}${result.total}<small> / 100</small></p><h2>${verdict.label}</h2><p>${verdict.description}</p><p class="preview-banner">この結果は未送信です。回答の送信・全体集計・比較画像は、接続後に利用できます。</p><button class="primary-button" data-edit>判断を見直す</button></section>`;
      target.querySelector<HTMLButtonElement>("[data-edit]")!.onclick = () => {
        cleanupView = mountTrial(
          target,
          state,
          (newAnswers, newState) => void submit(newAnswers, newState, target),
          { preview: true },
        );
      };
      return;
    }
    if (submitting) return;
    submitting = true;
    if (!pending)
      pending = {
        version: state.version,
        answers: { ...answers },
        requestId: crypto.randomUUID(),
      };
    const thisGeneration = generation;
    submissionController = new AbortController();
    target
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => (button.disabled = true));
    target.insertAdjacentHTML(
      "afterbegin",
      '<p class="submit-status" role="status">あなたの判断を送信しています…</p>',
    );
    try {
      const value = await submitBallot(pending, submissionController.signal);
      if (generation !== thisGeneration) return;
      pending = null;
      receipt = value;
      void go("result");
    } catch (error) {
      if (generation !== thisGeneration) return;
      const code = (error as { code?: string }).code ?? "";
      target.querySelector(".submit-status")?.remove();
      submitting = false;
      if (
        code === "VERSION_CHANGED" ||
        code === "INVALID_ANSWERS" ||
        code === "NOT_CONFIGURED"
      ) {
        target.insertAdjacentHTML(
          "afterbegin",
          '<section class="submit-error panel" role="alert"><h2>送信内容を確認できません</h2><p data-error-message></p><button class="primary-button" data-restart>ホームへ戻る</button></section>',
        );
        target.querySelector("[data-error-message]")!.textContent =
          error instanceof Error ? error.message : "時間をおいてお試しください。";
        target.querySelector<HTMLButtonElement>("[data-restart]")!.onclick =
          () => void go("home");
      } else {
        target.insertAdjacentHTML(
          "afterbegin",
          '<section class="submit-error panel" role="alert"><h2>送信の完了を確認できません</h2><p>回答はこの画面でのみ保持しています。同じ送信を確認するため、もう一度お試しください。</p><button class="primary-button" data-retry>同じ送信を確認する</button></section>',
        );
        if (code === "RATE_LIMITED") {
          const note = target.querySelector(".submit-error p")!;
          note.textContent =
            "送信が続いています。しばらく待ってから、同じ送信を確認してください。";
          const retry =
            target.querySelector<HTMLButtonElement>("[data-retry]")!;
          retry.disabled = true;
          setTimeout(() => {
            if (retry.isConnected) retry.disabled = false;
          }, 60_000);
        }
        target.querySelector<HTMLButtonElement>("[data-retry]")!.onclick =
          () => {
            target.querySelector(".submit-error")?.remove();
            void submit(answers, state, target);
          };
      }
    }
  };
  navigation = (route) => void go(route);
  const onPop = () => {
    const route = location.hash.slice(1);
    receipt = null;
    void go(route === "status" ? "status" : "home", false);
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      receipt = null;
      void go("home", false);
    }
  };
  const onPageHide = () => {
    ++generation;
    submissionController?.abort();
    submissionController = null;
    pending = null;
    receipt = null;
    submitting = false;
    cleanupView();
    cleanupView = () => {};
    scene?.dispose();
    scene = null;
    container.replaceChildren();
    currentRoute = "home";
  };
  addEventListener("pagehide", onPageHide);
  addEventListener("popstate", onPop);
  addEventListener("pageshow", onPageShow);
  const initial = location.hash.slice(1);
  void go(
    initial === "trial" || initial === "status" ? initial : "home",
    false,
  );
  return () => {
    generation++;
    submissionController?.abort();
    cleanupView();
    scene?.dispose();
    receipt = null;
    pending = null;
    navigation = () => {};
    motionPreference.removeEventListener("change", motionChanged);
    removeEventListener("pagehide", onPageHide);
    removeEventListener("popstate", onPop);
    removeEventListener("pageshow", onPageShow);
    container.replaceChildren();
  };
}
