# Mobile controls implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** 一本の回答スライダーと、再開・復帰できるThree.jsアニメーションを公開する。
**Architecture:** native rangeを既存のメモリ上の回答へ結ぶ。appが明示的な動きの設定を管理し、sceneはモデルと描画ループを所有する。
**Tech Stack:** TypeScript、Three.js、Playwright、Vite。
**Spec:** `docs/superpowers/specs/2026-10-24-mobile-controls-design.md`

## Global Constraints

- 0は未選択。20件の有効回答が揃うまで提出しない。
- DB・Edge・個別回答の非保存は変更しない。
- OS設定は初期状態で尊重する。明示的な操作を優先する。
- 描画は非表示・画面外・手動停止中に止め、破棄時に解放する。

## Review Focus

- ドラッグ途中でDOMを置換しない。中央へ戻した回答は未回答に戻る。
- 前後の審理と回答一覧で選択が保持される。再読込では残らない。
- OS省モーション時の明示的な再開は、OS通知と画面遷移後も続く。
- WebGL失敗時に再開表示を出さず、再試行でcanvasを作り直す。
- モバイル縦横・200%文字・キーボード操作で溢れない。

### Task 1: native range

**Files:** `src/features/trial/view.ts`, `src/styles.css`, `tests/e2e/slider.spec.ts`, 既存の回答操作テスト。
**Interface:** input[type=range]、aria-label「この審理の判断」、min=-5/max=5/step=1、0は未選択。

- [ ] スライダーの存在・ドラッグ・中央の未回答化・再訪を検証するテストを書いて失敗を確認。
- [ ] 数字ボタンを置き換え、inputイベントで回答と表示だけを更新。
- [ ] 既存のE2Eをnative range操作へ更新し、関連試験を通す。

### Task 2: Three.js motion and recovery

**Files:** `src/app.ts`, `src/scene/slime.ts`, `tests/e2e/scene.spec.ts`, `tests/e2e/app-lifecycle.spec.ts`。
**Interface:** `SceneHandle`は既存のまま。初期設定＋明示的overrideで停止状態を管理。

- [ ] 省モーションから再開後のOS変更、context失敗後の再試行、実際の描画変化を試験し失敗を確認。
- [ ] 再開・停止のoverride、停止理由、WebGL再試行を実装。既存のアニメーションを視認できる範囲で調整。
- [ ] 手動停止・非表示の停止・リソース解放の既存検証を通す。

### Task 3: verify and publish

**Files:** 運用・要件・QA・release設定、必要ならWebKitの検証設定。

- [ ] 型・単体・Chromium操作、Safari相当WebKitでスライダーと描画を確認。
- [ ] 実際の画面を目視し、独立レビューを受ける。
- [ ] PRのCI成功後にマージし、Pages自動公開と配備SHAを確認。
