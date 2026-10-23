import { mountScene, type SceneHandle } from "./scene";
import { startTrial, mountTrial, type TrialState } from "./features/trial";
import { scoreAnswers } from "./domain/scoring";
import { VERDICTS, CASES, CASE_ORDER } from "./domain/content";
import type {
  Answers,
  Participant,
  SubmitReceipt,
  SubmitRequest,
} from "./domain/types";
import {
  getSupabaseClient,
  isBackendConfigured,
} from "./platform/supabase-client";
import { clearDraft, saveDraft } from "./platform/draft-storage";
import { ensureParticipant } from "./features/vote/participant";
import {
  loadOwnBallot,
  submitBallot,
  VoteError,
} from "./features/vote/vote-api";
import { renderResults } from "./features/results/result-view";
import { renderStatus } from "./features/status/status-view";
import { homeShare, xShareLink } from "./features/share/x-share";
export type AppRoute = "home" | "trial" | "result" | "status";
let navigation: (route: AppRoute) => void = () => {};
export const navigate = (route: AppRoute): void => navigation(route);
export function mountApp(container: HTMLElement): () => void {
  let cleanupView = () => {};
  let scene: SceneHandle | null = null;
  let participant: Participant | null = null;
  let receipt: SubmitReceipt | null = null;
  let currentRoute: AppRoute = "home";
  let generation = 0;
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = motionPreference.matches;
  let manuallyPaused = false;
  const motionChanged = (event: MediaQueryListEvent) => {
    paused = event.matches || manuallyPaused;
    scene?.setReducedMotion(paused);
    const toggle = container.querySelector<HTMLButtonElement>(".scene-toggle");
    if (toggle) toggle.textContent = paused ? "3Dを再開" : "3Dを停止";
  };
  motionPreference.addEventListener("change", motionChanged);
  let pending: SubmitRequest | null = null;
  const connected = isBackendConfigured();
  let previewId = `preview-${crypto.randomUUID()}`;
  try {
    previewId = sessionStorage.getItem("slime-trial:preview-id") ?? previewId;
    sessionStorage.setItem("slime-trial:preview-id", previewId);
  } catch {
    /* Memory-only participation remains available. */
  }
  const go = async (route: AppRoute, updateHistory = true) => {
    if (route === "result" && !receipt) route = "home";
    if (currentRoute === "result" && route !== "result") receipt = null;
    if (route !== currentRoute || route === "trial") pending = null;
    currentRoute = route;
    const thisGeneration = ++generation;
    cleanupView();
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
        dialog.innerHTML = `<div class="eyebrow">ABOUT THIS TRIAL</div><h2>声のない被告に、あなたの判断を。</h2><p>20件の事実と、検察・弁護士の主張を読んで判断する物語です。これは人格や善悪を診断するものではありません。</p><p>名前・メールは不要。匿名IDで一票を保存し、再提出時は置き換えます。個人の過去結果は公開・保存しません。端末のデータを失うと、新しい匿名IDでの参加になります。</p><p>音はありません。3Dを停止してもすべての審理を続けられます。</p><button class="primary-button">閉じる</button>`;
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
      main.innerHTML = `<section class="home-hero"><div class="hero-copy"><div class="eyebrow"><span class="tiny-rule"></span> A STORY YOU JUDGE</div><p class="hero-preface">被告は、一匹のスライム。</p><h1>その一票で、<br><em>運命がゆれる。</em></h1><p class="hero-description">人を傷つけた。人を救った。<br>けれど、この小さな生きものは何も語らない。<br>20の出来事に、あなたならどんな判決を？</p><div class="hero-cta"><button class="primary-button start-trial">裁判に参加する <span aria-hidden="true">→</span></button><span>全20件 <span aria-hidden="true">·</span> 約10分 <span aria-hidden="true">·</span> 名前の入力不要</span></div></div><div class="hero-visual"><div class="scene-caption-top"><span>王立小法廷</span><span>審理、進行中。</span></div><div class="scene-holder"><canvas aria-label="法廷で静かに待つ一匹のスライム"></canvas><img hidden data-scene-fallback src="${import.meta.env.BASE_URL}slime-fallback.webp" alt="法廷で静かに待つ一匹のスライム"></div><div class="scene-caption-bottom"><span><i class="live-dot"></i> THE DEFENDANT IS SILENT</span><button class="scene-toggle">${paused ? "3Dを再開" : "3Dを停止"}</button></div><span class="visual-index" aria-hidden="true">CASE FILE — 001</span></div></section><section class="story-intro"><div><span class="section-number">01 / THE STORY</span><h2>正しさは、ひとつじゃない。</h2></div><p>同じ事実にも、ふたつの言い分がある。<br>検察と弁護士の声に耳を傾け、あなたの判断を重ねてください。<br>最後に、あなたと世界の判断が並びます。</p></section><section class="process-grid" aria-label="裁判の流れ"><article><span>01</span><h3>20の事実を読む</h3><p>検察と弁護士、それぞれの主張から<br>出来事の向こう側を想像する。</p></article><article><span>02</span><h3>あなたの判断を選ぶ</h3><p>刑罰か、待遇の改善か。<br>その強さまで、あなたに委ねます。</p></article><article><span>03</span><h3>世界の判断と出会う</h3><p>提出したその瞬間の全体と比較。<br>違いから、また物語がはじまる。</p></article></section>${connected ? "" : '<p class="preview-banner"><span>PREVIEW</span> 現在は未接続プレビューです。回答は送信されず、全体集計には加わりません。</p>'}`;
      main.querySelector<HTMLButtonElement>(".start-trial")!.onclick = () =>
        void go("trial");
      main
        .querySelector(".hero-copy")!
        .append(xShareLink("このゲームをXでシェア", homeShare()));
    } else if (route === "trial") {
      main.innerHTML = `<div class="trial-layout"><aside class="trial-scene"><div class="eyebrow">THE COURT IS IN SESSION</div><div class="scene-holder"><canvas aria-label="審理を待つ一匹のスライム"></canvas><img hidden data-scene-fallback src="${import.meta.env.BASE_URL}slime-fallback.webp" alt="審理を待つスライム"></div><div class="scene-caption-bottom"><span>被告は、何も語らない。</span><button class="scene-toggle">${paused ? "3Dを再開" : "3Dを停止"}</button></div>${connected ? "" : '<p class="preview-banner">プレビュー · 未送信</p>'}</aside><div class="trial-content"><p role="status">審理記録を開いています…</p></div></div>`;
      const target = main.querySelector<HTMLElement>(".trial-content")!;
      setupScene(main, "trial");
      try {
        // Identity can change in another tab while this app remains mounted.
        const activeParticipant = connected
          ? await ensureParticipant()
          : { id: previewId, persistent: false };
        const ballot = connected
          ? await loadOwnBallot("v1", activeParticipant.id)
          : null;
        if (generation !== thisGeneration) return;
        participant = activeParticipant;
        const state = startTrial(activeParticipant, ballot);
        cleanupView = mountTrial(
          target,
          state,
          (answers, edited) => void submit(answers, edited, target),
          { preview: !connected },
        );
        if (!participant.persistent && connected)
          target.insertAdjacentHTML(
            "afterbegin",
            '<p class="preview-banner">匿名IDをこの端末に保存できません。再読み込み後は同じ一票を編集できない場合があります。</p>',
          );
      } catch {
        if (generation === thisGeneration)
          target.innerHTML =
            '<section class="panel"><h1>接続を確認できません</h1><p>匿名の参加情報を取得できませんでした。時間をおいて、もう一度お試しください。</p><button class="primary-button" data-retry>もう一度試す</button></section>';
        target
          .querySelector<HTMLButtonElement>("[data-retry]")
          ?.addEventListener("click", () => void go("trial", false));
      }
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
    const unavailable = () => {
      canvas.hidden = true;
      const fallback = main.querySelector<HTMLImageElement>(
        "[data-scene-fallback]",
      );
      if (fallback) fallback.hidden = false;
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
    const toggle = main.querySelector<HTMLButtonElement>(".scene-toggle");
    if (toggle)
      toggle.onclick = () => {
        paused = !paused;
        manuallyPaused = paused;
        scene?.setReducedMotion(paused);
        toggle.textContent = paused ? "3Dを再開" : "3Dを停止";
      };
  };
  const submit = async (
    answers: Answers,
    state: TrialState,
    target: HTMLElement,
  ) => {
    if (!connected) {
      const result = scoreAnswers(answers);
      const verdict = VERDICTS.find((item) => item.id === result.verdict)!;
      cleanupView();
      target.innerHTML = `<section class="panel preview-result"><span class="eyebrow">LOCAL PREVIEW · 未送信</span><h1>あなたの判断</h1><p class="result-score">${result.total > 0 ? "＋" : ""}${result.total}<small> / 100</small></p><h2>${verdict.label}</h2><p>${verdict.description}</p><p class="preview-banner">この結果は未送信です。実際の投票・全体集計・比較画像は、接続後に利用できます。</p><button class="primary-button" data-edit>判断を見直す</button></section>`;
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
    if (!pending)
      pending = {
        version: state.version,
        answers,
        requestId: crypto.randomUUID(),
        expectedRevision: state.expectedRevision,
      };
    const thisGeneration = generation;
    target
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => (button.disabled = true));
    target.insertAdjacentHTML(
      "afterbegin",
      '<p class="submit-status" role="status">あなたの判断を送信しています…</p>',
    );
    try {
      const identity = await getSupabaseClient()!.auth.getSession();
      if (identity.error) throw new VoteError("NETWORK_ERROR");
      if (identity.data.session?.user.id !== state.participantId)
        throw new VoteError("UNAUTHENTICATED");
      const value = await submitBallot(pending, state.participantId);
      if (generation !== thisGeneration) return;
      pending = null;
      receipt = value;
      clearDraft(state.participantId, state.version);
      void go("result");
    } catch (error) {
      if (generation !== thisGeneration) return;
      const code = (error as { code?: string }).code ?? "";
      target.querySelector(".submit-status")?.remove();
      if (code === "STALE_REVISION") {
        pending = null;
        const showConflict = async () => {
          const ballot = await loadOwnBallot(
            state.version,
            state.participantId,
          ).catch(() => null);
          if (generation !== thisGeneration) return;
          target.querySelector(".conflict")?.remove();
          if (!ballot) {
            target.insertAdjacentHTML(
              "afterbegin",
              '<section class="conflict panel" role="alert"><h2>保存済みの判断を取得できません</h2><p>編集中の判断は保持されています。接続を確認して再度読み込んでください。</p><button class="primary-button" data-load-conflict>保存済みの判断を読み込む</button></section>',
            );
            target.querySelector<HTMLButtonElement>(
              "[data-load-conflict]",
            )!.onclick = () => void showConflict();
            return;
          }
          target.insertAdjacentHTML(
            "afterbegin",
            `<section class="conflict panel" role="alert"><h2>別の画面で判断が更新されています</h2><p>編集中の判断と保存済みの判断を確認し、続ける内容を選んでください。</p><details><summary>20件の判断を比較する</summary><div class="conflict-table"><table><thead><tr><th>審理</th><th>編集中</th><th>保存済み</th></tr></thead><tbody>${CASE_ORDER.map((id) => `<tr><th>${CASES.find((item) => item.id === id)!.title}</th><td>${state.draft[id]! > 0 ? "＋" : "−"}${Math.abs(state.draft[id]!)}</td><td>${ballot.answers[id] > 0 ? "＋" : "−"}${Math.abs(ballot.answers[id])}</td></tr>`).join("")}</tbody></table></div></details><button class="secondary-button" data-reload>保存済みの判断を読む</button><button class="primary-button" data-keep>編集中の判断を確認する</button></section>`,
          );
          target.querySelector<HTMLButtonElement>("[data-reload]")!.onclick =
            () => {
              const next = {
                ...state,
                draft: { ...ballot.answers },
                expectedRevision: ballot.revision,
              };
              saveDraft(next);
              cleanupView = mountTrial(
                target,
                next,
                (a, s) => void submit(a, s, target),
              );
            };
          target.querySelector<HTMLButtonElement>("[data-keep]")!.onclick =
            () => {
              const next = { ...state, expectedRevision: ballot.revision };
              saveDraft(next);
              cleanupView = mountTrial(
                target,
                next,
                (a, s) => void submit(a, s, target),
              );
            };
        };
        await showConflict();
      } else if (
        code === "UNAUTHENTICATED" ||
        code === "VERSION_CHANGED" ||
        code === "REQUEST_ID_REUSED" ||
        code === "INVALID_ANSWERS"
      ) {
        pending = null;
        target.insertAdjacentHTML(
          "afterbegin",
          '<section class="submit-error panel" role="alert"><h2>参加情報の確認が必要です</h2><p data-error-message></p><p>入力は元の匿名IDに紐づけて保持されています。</p><button class="primary-button" data-restart>ホームへ戻る</button></section>',
        );
        target.querySelector("[data-error-message]")!.textContent =
          error instanceof Error
            ? error.message
            : "参加情報を確認してください。";
        target.querySelector<HTMLButtonElement>("[data-restart]")!.onclick =
          () => {
            participant = null;
            void go("home");
          };
      } else {
        target.insertAdjacentHTML(
          "afterbegin",
          '<section class="submit-error panel" role="alert"><h2>送信の完了を確認できません</h2><p>回答を保持しています。同じ送信を確認するため、もう一度お試しください。</p><button class="primary-button" data-retry>同じ送信を確認する</button></section>',
        );
        if (code === "RATE_LIMITED") {
          const note = target.querySelector(".submit-error p")!;
          note.textContent =
            "送信が続いています。60秒ほど待ってから、同じ送信を確認してください。";
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
    void go(route === "trial" || route === "status" ? route : "home", false);
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      receipt = null;
      void go("home", false);
    }
  };
  addEventListener("popstate", onPop);
  addEventListener("pageshow", onPageShow);
  const initial = location.hash.slice(1);
  void go(
    initial === "trial" || initial === "status" ? initial : "home",
    false,
  );
  return () => {
    generation++;
    cleanupView();
    scene?.dispose();
    receipt = null;
    motionPreference.removeEventListener("change", motionChanged);
    removeEventListener("popstate", onPop);
    removeEventListener("pageshow", onPageShow);
    container.replaceChildren();
  };
}
