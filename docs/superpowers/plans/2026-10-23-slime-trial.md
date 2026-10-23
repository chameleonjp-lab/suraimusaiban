# スライム裁判 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添付デザインに基づく3Dアニメ風の法廷で20件を判断し、匿名投票・全体比較・結果画像の保存を行えるブラウザゲームを作る。

**Architecture:** TypeScriptとThree.jsで3D描画を行い、本文・入力・チャートはHTML/SVGへ分離する。判決と判断傾向は副作用のない関数で計算し、Supabase側でも同じ入力から検証・再計算する。投票と集計を1トランザクションで更新し、結果比較には保存済みの本人票を含む固定スナップショットを使う。

**Tech Stack:** Vite、TypeScript、Three.js、Supabase Auth/Postgres/Realtime、Vitest、Playwright、Canvas 2D。バージョンはT01着手時に公式資料で互換性を確認して固定し、lockfileをコミットする。React、物理流体エンジン、外部文章生成APIは初期構成に加えない。

**Spec:** [要件設計案](../../requirements.md)、[3Dデザイン仕様](../../design/3d-art-direction.md)、[参照画像4枚](../../references/slime/README.md)。実装者は3点とも読む。

作成日：2026-10-23。原計画は文書・参照画像だけを追加した[PR #1](https://github.com/chameleonjp-lab/suraimusaiban/pull/1)のためのもので、その時点ではゲーム実装・DB作成・公開を含まなかった。確定した参加ルール・最大刑罰・最大厚遇・添付外見を守り、中間区分・式・具体的な20件は要件設計案を採用した計画としてレビューする。

### 実装の進捗（2026-10-23更新）

現在は[実装Draft PR #2](https://github.com/chameleonjp-lab/suraimusaiban/pull/2)でT01〜T09の実装とローカル検証を進めた。型検査・ビルド、単体80件、実DB16件、Chromium26件、Linux WebKit11件が合格している。重要レビュー指摘2件は修正・回帰試験済み。詳細は[公開前検証記録](../../qa/release-checks.md)、[独立レビュー](../../qa/implementation-review.md)、[DB記録](../../qa/database.md)、[操作記録](../../qa/journey.md)、[モデル記録](../../qa/slime-model.md)を参照。

チェック済みは記録で確認できた実施項目を示す。実機iPhone/Android/macOS Safari、Realtime実配信、本番接続先・CAPTCHA・公開は未完了。30分14.816秒の変更前観測と最終実装5分観測は完了し、それぞれ360/63標本・page error 0件を記録したが、短い観測を最終実装30分の確認とは扱わない。複数条件を含む項目は未完了条件を添えて未チェックに残し、RED実行の記録が足りない項目も推測で埋めない。

## Global Constraints

- 各件の選択値は `-5,-4,-3,-2,-1,1,2,3,4,5`。未回答は値なしであり、0ではない。
- 20件は同じ重みで加算。個人点数は `-100…100`。合計0は釈放、0票は判決待ち。
- 最重判決は悪魔の使いとして公開処刑。最大厚遇は神の使いとして神殿管理。
- スライムは一匹、話せず、真意は明かさない。回答に喜怒哀楽・神魔の姿を対応させない。
- 判断傾向は10項目・各2件のA方式。人格の診断、善悪の点数、ランキングにしない。
- 名前・メール入力なし。同じ匿名IDの再提出は1票の置換。ID喪失後は新規票を認める。
- 個人の過去結果画面・公開結果URLを設けない。再参加の回答復元と、再提出による新しい結果は可能。
- 全体の平均と分布を併記。本人反映後の同一集計版を結果画面・比較画像で共有する。
- 小説は11区分、各本文300 Unicodeコードポイント。作中の現在は常に審理中。
- iPhone Safariの縦画面を主対象に、横画面・44×44 CSS px以上の操作・文字拡大・読み上げに対応。
- Three.jsによる3Dアニメ風。3D失敗時も裁判・送信・集計・画像保存は利用できる。
- 秘密キーをブラウザへ渡さない。投票は本人だけが読み、全体には集計のみ公開する。
- X投稿は本人が確定。画像保存を必ず用意し、端末の直接共有だけに依存しない。

## Review Focus

| 見落としやすい条件 | 期待する動作 | 担当・試験 |
| --- | --- | --- |
| DB保存後に応答だけ失われ、同じリクエストを再送 | 票を増やさず保存成否を確認。別タブで票がさらに変わった場合は古い結果を作らない | T06 `lost_response_retries_once` / `receipt_after_newer_vote_conflicts` |
| 全体平均がごく小さい非ゼロ、または正負に二極化 | 丸めて釈放にせず、厳密な区分と分布を表示 | T01 `rational_verdict_boundaries`、T07 `polarized_zero_mean` |
| 二つのタブの競合、匿名ID喪失後に残った下書き | 古い編集を無言で上書きしない。別IDの下書きを流用しない | T02 `identity_scoped_draft`、T06 `stale_revision_rejected` |
| 結果表示中のライブ更新、共有取消、戻る・再読込 | 比較値を固定、取消で結果を失わず、終了済み結果を履歴から復元しない | T07 `snapshot_stays_fixed`、T08 `share_cancel_keeps_result`、T09 `result_lifetime` |
| 3Dコンテキスト消失・低速・文字200%・端末共有非対応 | 読んで投票でき、画像を保存できる。実機と模擬の試験を区別 | T03 `scene_context_lost`、T08 `share_fallback`、T09 `accessible_fallback_flow` |

## 実装計画表

日数は担当人数・モデル調整・実機確認の環境が未確定のため確約しない。各行の受入条件で進捗を判断する。

| 段階 | ID | 工程・成果物 | 先行工程 | 完了条件 |
| --- | --- | --- | --- | --- |
| 1：裁判と3D画面 | T01 | 開発基盤、20件・10軸・11判決・小説のデータ、計算関数 | なし | 字数・全回答組合せ・判決境界の試験が通る |
| 1 | T02 | 20件を行き来する裁判、回答一覧、下書き、再参加用の状態管理 | T01 | 全件の両符号を選べ、19件では提出不可。ID・版を混ぜない |
| 1 | T03 | 添付準拠の3Dスライム、素材、待機動作、静止代替 | T01 | 5方向の比較画像と動画で造形・描画順・中立性を確認 |
| 1 | T04 | アニメ風の法廷、人物、ホームと裁判の画面統合 | T02,T03 | スマホ縦横で20件を最後まで操作できるプレビュー |
| 2：保存と集計 | T05 | Supabaseのテーブル、権限、匿名参加、集計読取契約 | T01 | 他人の回答と書込を拒否し、0票を未成立として取得できる |
| 2 | T06 | 投票置換、再送対策、競合検出、本人反映済み集計 | T02,T05 | 同IDは1票、別IDは2票、保存と集計が不可分に更新 |
| 2 | T07 | 個人結果、最新状況、比較レーダー、分布、300文字小説 | T04,T06 | 数字・図・小説が同一版、結果比較は固定、最新状況は更新 |
| 3：共有と仕上げ | T08 | 3種類の画像、プレビュー、保存、X向け共有導線 | T07 | 画像内の10軸・20件が読め、共有非対応や取消でも結果を維持 |
| 3 | T09 | 結合試験、アクセシビリティ、性能調整、公開前確認資料 | T03〜T08 | 自動試験と画像実見、端末条件付き性能記録、公開手順が揃う |

段階1はローカルの未送信プレビューとして動く。段階2で複数ブラウザから投票・集計できる。段階3で共有と公開前品質を整える。各段階で動作する状態を保ち、未接続の値を実投票と表示しない。

## ファイル構成と責務

以下は原計画の責務別パス。実装では裁判を `src/features/trial/state.ts`・`view.ts`、描画寿命を `src/scene/index.ts` などへ整理して作成した。文書保存のPR #1では空の実装ファイルを作らず、実装をPR #2へ分離した。

| 作成先 | 担当 | 責務 |
| --- | --- | --- |
| `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | T01 | 固定依存、型検査、開発・ビルド・試験コマンド |
| `src/domain/types.ts`, `src/domain/content.ts`, `src/domain/scoring.ts` | T01 | 共通契約、編集済み本文、検証・計算の唯一のクライアント側実装 |
| `src/features/trial/trial-state.ts`, `src/features/trial/trial-view.ts` | T02 | 回答状態とHTMLの裁判画面 |
| `src/platform/draft-storage.ts` | T02 | 匿名ID・内容版ごとの下書き保存、保存拒否時のメモリ代替 |
| `src/scene/slime.ts`, `src/scene/slime-geometry.ts`, `src/scene/slime-material.ts` | T03 | 造形・素材・中立的な動作 |
| `src/scene/scene-host.ts`, `src/scene/quality.ts`, `public/slime-fallback.webp` | T03 | 描画寿命、画質、静止代替 |
| `src/scene/courtroom.ts`, `src/app.ts`, `src/main.ts`, `src/styles.css` | T04 | 法廷・簡略人物、画面遷移、共通UI |
| `supabase/config.toml`, `supabase/seed.sql`, `supabase/migrations/` | T05,T06 | ローカル環境、版情報、テーブル・関数・権限。migration名はCLIで生成 |
| `src/platform/supabase-client.ts`, `src/features/vote/participant.ts`, `src/features/vote/vote-api.ts` | T05,T06 | 匿名参加、本人票の読取、提出API、エラーの変換 |
| `src/features/results/result-state.ts`, `src/features/results/result-view.ts` | T07 | 一時結果と固定比較 |
| `src/features/status/status-view.ts`, `src/features/status/status-feed.ts` | T07 | 公開集計・更新状態・小説 |
| `src/charts/chart-model.ts`, `src/charts/chart-svg.ts` | T07 | 同じ座標モデルからレーダー・棒・累積・分布を描く |
| `src/features/share/card.ts`, `src/features/share/share-view.ts` | T08 | 画像化、プレビュー、共有・保存 |
| `tests/unit/`, `tests/integration/`, `tests/e2e/`, `playwright.config.ts` | 各工程 | 計算、DB権限・並行処理、画面操作の検証 |
| `.github/workflows/ci.yml`, `docs/qa/`, `docs/operations.md` | T09 | CI、測定と画像、接続・公開・復旧手順 |

最初から複数サービスや複数リポジトリに分けない。3D・入力・保存・画像出力の境界を上のファイルで分離する。

## 共通データ契約

`src/domain/types.ts`で以下を定義する。配列長・キー完全性・整数条件は実行時にも検証する。

```ts
type Score = -5|-4|-3|-2|-1|1|2|3|4|5;
type Suffix = '01'|'02'|'03'|'04'|'05'|'06'|'07'|'08'|'09'|'10';
type CaseId = `H${Suffix}` | `K${Suffix}`;
type AxisId = 1|2|3|4|5|6|7|8|9|10;
type VerdictId = 'N5'|'N4'|'N3'|'N2'|'N1'|'Z'|'P1'|'P2'|'P3'|'P4'|'P5';
type Answers = Readonly<Record<CaseId, Score>>;
type Draft = Partial<Record<CaseId, Score>>;
type AxisValues = Readonly<Record<AxisId, number>>;
type DecimalInteger = string; // JSONで精度を失わない10進整数。境界判定はBigInt
type ContentVersion = string; // 初回 'v1'、意味・式の変更時は新しい版
type Participant = { id: string; persistent: boolean };
type Ballot = { version: ContentVersion; answers: Answers; revision: DecimalInteger };
type IndividualResult = {
  total: number; negativeTotal: number; positiveTotal: number;
  verdict: VerdictId; axes: AxisValues; cumulative: readonly number[];
};
type Snapshot = {
  version: ContentVersion; revision: DecimalInteger; updatedAt: string;
  count: DecimalInteger; scoreSum: DecimalInteger;
  caseCounts: Readonly<Record<CaseId, Readonly<Record<Score, DecimalInteger>>>>;
  axisSums: Readonly<Record<AxisId, DecimalInteger>>;
  verdictCounts: Readonly<Record<VerdictId, DecimalInteger>>;
};
type SubmitRequest = {
  version: ContentVersion; answers: Answers;
  requestId: string; expectedRevision: DecimalInteger; // 初回は '0'
};
type SubmitReceipt = { ballot: Ballot; snapshot: Snapshot };
type ResultSession = { receipt: SubmitReceipt; individual: IndividualResult };
```

Snapshotの平均は `scoreSum/count`。`count='0'`なら平均・レーダー・小説を作らない。判決選択は整数比の比較を使い、表示用小数への丸めを挟まない。軸平均は `axisSums[axis]/count`、各件の平均は選択肢別票数の加重和/count、三分類の割合は11判決の票数から求める。`revision` は同一版の集計で増加する整数。日時はISO 8601・UTCで通信し、画面と画像は同じ形式の日本時間で表示する。

公開APIに参加者ID・20回答・送信履歴を混ぜない。`ResultSession` は現在の画面のメモリにだけ置き、URL、localStorage、sessionStorage、History APIのstateへ保存しない。

## T01：計算とコンテンツの基盤

**Files:** 上表T01のファイル、`tests/unit/content.test.ts`、`tests/unit/scoring.test.ts`を作成。

**Interfaces:** 入力は要件文書。出力は `CONTENT_VERSION: ContentVersion`、`CASE_ORDER: readonly CaseId[]`、`validateAnswers(input: unknown): Answers`、`scoreAnswers(answers: Answers): IndividualResult`、`selectVerdict(scoreSum: bigint, count: bigint): VerdictId | null`。本文・軸定義・11小説は `content.ts`へ移し、以後の編集は文書と同じPRで同期する。

- [x] Vite/TypeScript/Vitestの必要最小限の構成と固定依存を作り、`dev`、`build`、`typecheck`、`test`のnpm scriptを定義する。
- [x] `content.test.ts`に20件一意、各軸専用2件、本文300文字×11、固定順を検証する試験を作る。`scoring.test.ts`に以下の具体値と拒否入力を記述する。

```ts
// allScores / pairedScores はこの試験内で20件を組み立てるfixture helper
expect(scoreAnswers(allScores(-5)).total).toBe(-100);
expect(scoreAnswers(allScores(5)).verdict).toBe('P5');
expect(scoreAnswers(pairedScores(-5, 5)).verdict).toBe('Z');
expect(selectVerdict(0n, 0n)).toBeNull();
expect(selectVerdict(0n, 2n)).toBe('Z');
expect(selectVerdict(1n, 1000000n)).toBe('P1');
expect(selectVerdict(-80n, 1n)).toBe('N4');
expect(selectVerdict(80n, 1n)).toBe('P4');
expect(selectVerdict(-80001n, 1000n)).toBe('N5');
expect(selectVerdict(80001n, 1000n)).toBe('P5');
```

- [x] `npm test -- tests/unit/content.test.ts tests/unit/scoring.test.ts`を実行し、未実装の関数・本文で失敗することを確認する。
- [x] 上記インターフェースを実装する。通常8軸は `50+5*(K-H)`、軸4は `50-5*(H+K)`、軸10は `50+5*(H+K)`。3種類とも100組を試験する。19/21件、0、±6、小数、文字列、未知IDを拒否し、DB側と共用する入出力fixtureを `tests/fixtures/scoring.json` に作る。
- [x] 同じ試験、全境界の前後、`npm run typecheck`、`npm run build`を実行しPASSを確認する。
- [x] T01の作成ファイルをコミットする。メッセージ：`feat: define trial content and scoring`。

## T02：裁判の入力と下書き

**Files:** 上表T02の4ファイル、`tests/unit/trial-state.test.ts`、`tests/unit/draft-storage.test.ts`、`tests/e2e/trial.spec.ts`、Playwrightの最小設定を作成。

**Interfaces:** T01の型・固定順を使う。`TrialState = { draft: Draft; currentIndex: number; expectedRevision: DecimalInteger; participantId: string; version: ContentVersion }`。出力は `startTrial(participant: Participant, ballot: Ballot | null): TrialState`、`setAnswer(state: TrialState, id: CaseId, value: Score): TrialState`、`canSubmit(state: TrialState): boolean`、`mountTrial(container: HTMLElement, state: TrialState, onSubmit: (answers: Answers) => void): () => void`。下書きは `loadDraft(participantId: string, version: ContentVersion): TrialState | null` と `saveDraft(state: TrialState): void`。

- [x] `identity_scoped_draft`でID A/v1の回答がID B/v1やA/v2に出ない、`nineteen_answers_cannot_submit`で19件はfalse、20件はtrue、`edit_preserves_expected_revision`で下書きから古い基準版が保持される試験を書く。
- [x] `npm test -- tests/unit/trial-state.test.ts tests/unit/draft-storage.test.ts`を実行しFAILを確認する。
- [x] 本人・同じ版の下書き、本人の保存済み回答、未回答の順で初期化する。下書きには編集開始時の `expectedRevision` も保存し、読み込み時に最新の値へすり替えない。保存拒否時はメモリ内で続け、再読込で失うことを短く表示する。
- [x] 各件に事実・検察・弁護士と同じ10選択肢を表示する。両者を同条件で読める配置とし、進捗・未回答・回答一覧・前後移動・最終確認を作る。未接続プレビューは「未送信」と明示し、完了メッセージを偽装しない。
- [x] 同じ単体試験と `npx playwright test tests/e2e/trial.spec.ts` を実行する。全件で正負を選び直せること、44px操作領域、200%拡大時の操作を確認する。
- [x] コミット：`feat: add trial input and scoped drafts`。

## T03：参照準拠の3Dスライム

**Files:** 上表T03のファイル、`tests/unit/slime-animation.test.ts`、`tests/e2e/scene.spec.ts`、`docs/qa/slime-model.md`を作成。

**Interfaces:** `SceneQuality = 'standard' | 'low'`、`SlimeRig = { root: THREE.Group; update(dtSeconds: number, elapsedSeconds: number, reducedMotion: boolean): void; dispose(): void }`。`createSlime(quality: SceneQuality): SlimeRig`、`mountScene(canvas: HTMLCanvasElement, onUnavailable: () => void): SceneHandle`。`SceneHandle`は `setView(view: 'home'|'trial'|'still'): void`、`setReducedMotion(value: boolean): void`、`dispose(): void` を持つ。回答・判決・人物傾向をこれらの引数に追加しない。

- [x] `slime-animation.test.ts`で `dt=0` 時の安定、復帰時のdt上限0.05秒、reducedMotion時の静止、同じ時刻のポーズ再現を検証する。`scene.spec.ts`にWebGL不可とcontext lostで静止代替を出す試験を書く。
- [ ] `npm test -- tests/unit/slime-animation.test.ts` と `npx playwright test tests/e2e/scene.spec.ts` を実行しFAILを確認する。 **進捗：単体の未実装・スタブによるREDは記録済み。E2Eの機能未実装によるREDは記録不足のため、この混合項目は未チェック。最終の両試験は合格。**
- [x] デザイン仕様どおり胴体・渦・後方の裾・目・しずくを立体で作る。コードで形状を生成する方式から始め、作者にモデリングソフトの準備を求めない。造形上の限界でGLBへ移す場合も `SlimeRig` を保ち、必要な原本と制作手順を同じPRに保存する。
- [x] 軽量シェーダー、階調・艶・縁、目の遮蔽、中立的な変形を実装する。GPU資源とイベントの解放を `dispose()` に集約し、非表示時は描画を停止する。
- [x] 5方向の静止画と10秒の待機動画を作成し、添付と並べて実見する。完成モデルから静止代替を出力する。透明度を高くする試作は標準品質だけで比較し、採否を `slime-model.md` に記録する。
- [x] 同じ試験をPASSにし、360度・最大変形・縮小表示で目の裏抜けや接合の穴がないことを確認してコミットする：`feat: create anime slime and scene fallback`。

## T04：法廷と画面統合

**Files:** 上表T04のファイル、`tests/e2e/courtroom.spec.ts`、`docs/qa/courtroom.md`を作成。T02/T03の接続箇所だけ変更。

**Interfaces:** `createCourtroom(): THREE.Group`。`AppRoute = 'home'|'trial'|'result'|'status'`、`navigate(route: AppRoute): void`。T02の `mountTrial` とT03の `mountScene` を使用。`result` は有効な `ResultSession` がある場合だけ入れるようT07で接続する。

- [x] `courtroom.spec.ts`にホームから裁判へ進める、前回結果への入口がない、390×844と844×390で本文とボタンが収まる、3D停止中にも回答できる試験を書く。
- [ ] `npx playwright test tests/e2e/courtroom.spec.ts` を実行しFAILを確認する。 **進捗：初期E2Eの機能未実装によるRED記録は未確認。最終の画面試験・実見は完了。**
- [x] 石と木の法廷、裁判官・検察・弁護士の簡略人物、固定ライト・カメラを作る。本文を3Dテクスチャに焼き込まず、HTMLに配置する。送信中などの業務状態もHTMLで示す。
- [x] 画面ごとの3D構図と寿命を接続する。縦は3D上/本文下、横は高さ不足に合わせて縮小。移動・縮小設定と無音を初期状態にする。音を追加する場合は利用者の切替操作後だけ再生する。
- [x] 同じ試験をPASSにし、縦横のホーム・裁判を画像で実見して `courtroom.md` に残す。
- [x] コミット：`feat: integrate anime courtroom and trial screens`。

## T05：匿名参加とDBの読取・権限

**Files:** 上表T05のファイル、`.env.example`（値は空）、`tests/integration/access.test.ts`、`tests/unit/participant.test.ts`を作成。DBはローカル開発環境から作る。

**Interfaces:** `ensureParticipant(): Promise<Participant>`、`loadOwnBallot(version: ContentVersion): Promise<Ballot | null>`、`loadSnapshot(version: ContentVersion): Promise<Snapshot>`。認証はSupabase Authの匿名サインイン。JWTの本人IDを利用し、任意のブラウザUUIDを本人認証として使わない。

| DBの作成物 | 列・制約の要点 | 読取・書込 |
| --- | --- | --- |
| `public.content_versions` | `id text PK`, `definition jsonb`, `active boolean`。20ID・式の版を固定 | 公開読取、クライアント書込なし |
| `public.ballots` | PK `(participant_id uuid, version text)`、`answers jsonb`, `revision bigint`, `updated_at timestamptz`。1本人1版1票 | 本人のSELECTのみ。直接DMLは許可せずT06の関数経由 |
| `public.aggregate_snapshots` | `version text PK`, `revision bigint`, `updated_at timestamptz`, `payload jsonb`。上記Snapshotを保持 | 公開SELECT、クライアント書込なし |
| `private.submissions` | PK `(participant_id, version, request_id)`、payload hash、保存したballot revision、時刻 | 外部へ非公開。再送の同一性確認にだけ使用 |
| `private.submit_limits` | 本人・時間窓・回数 | T06の送信制限用、外部へ非公開 |

全公開テーブルでRLSを有効化する。本人読取は `TO authenticated` に加え `auth.uid() = participant_id` を検査する。匿名サインインも `authenticated` ロールである。閲覧だけなら匿名アカウントを作らない。参加開始時に匿名参加を確立する。[公式の匿名サインイン](https://supabase.com/docs/guides/auth/auth-anonymous)・[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

- [x] ローカルSupabaseと検証環境を作り、CLIの `--help` とバージョンを確認する。migrationは `supabase migration new trial_schema` で生成する。`npm run test:db` はローカルDB限定の試験として定義する。 **実施：公式CLI一式の起動は容量制約のため未完了。実PostgreSQL17＋公式Auth/RESTの縮小構成で検証した。**
- [x] `access.test.ts`で未認証の本人票読取、AによるBの票読取、直接票書込、集計書込が拒否され、公開集計だけは取得できる試験を書く。`participant.test.ts`では一時的な通信エラーで新IDを作らず、保存不可でも当該タブで継続できることを検証する。
- [x] `npm run test:db -- tests/integration/access.test.ts` と単体試験を実行し、未作成スキーマ・未実装関数でFAILを確認する。
- [x] テーブル・制約・GRANT・RLSと `supabase-client.ts` を実装する。公開キーだけをフロントで使い、秘密キーを `.env.example` にも書かない。匿名参加の再利用と明確な喪失を区別し、ホームや最新状況の表示だけで新アカウントを増やさない。
- [x] 同じ試験をPASSにする。0票Snapshotはcount/合計/全分布が0、判決は派生計算でnull。migration再適用と権限検査を行う。
- [x] コミット：`feat: define anonymous voting storage and access`。リモートプロジェクトへの適用はT09の環境確認後に行う。

## T06：投票の不可分な置換と通信復旧

**Files:** T05スキーマに `supabase migration new trial_submit` でmigration追加。`src/features/vote/vote-api.ts`を変更、`tests/integration/submit.test.ts`、`tests/integration/concurrency.test.ts`、`tests/e2e/submit.spec.ts`を作成。

**Interfaces:** `submitBallot(request: SubmitRequest): Promise<SubmitReceipt>`。DBの公開窓口は `public.submit_ballot(p_version text, p_answers jsonb, p_request_id uuid, p_expected_revision bigint) returns jsonb`。ネットワークでは回答を `{caseId, score}` 20要素へ変換して送り、重複IDも検出する。戻り値は `SubmitReceipt`。失敗は `INVALID_ANSWERS`、`VERSION_CHANGED`、`STALE_REVISION`、`REQUEST_ID_REUSED`、`RATE_LIMITED`、`UNAUTHENTICATED` を明示してUIへ変換する。

公開窓口 `public.submit_ballot` はSECURITY INVOKERで、非公開スキーマの `private.apply_ballot(p_version text, p_answers jsonb, p_request_id uuid, p_expected_revision bigint) returns jsonb` を呼び出すだけとする。内部関数はSECURITY DEFINERとして、JWTからの本人確認・入力検証・ロック・票の置換・集計・再送記録・送信制限の更新まで、全トランザクションを担当する。集計だけに権限を限定して、票や内部記録を更新できない構成にしない。

権限昇格はこの内部関数に閉じ込め、固定search_path・完全修飾名・`auth.uid()`非null検査を必須にする。両関数のPUBLIC/anonのEXECUTEを剥がし、authenticatedには呼出しに必要なスキーマUSAGEと関数EXECUTEだけを与える。privateスキーマをData APIに公開せず、authenticatedには4表への直接DMLを与えない。内部関数の所有者が必要な書込を行える権限とRLSの扱いをmigrationへ明記し、通常の匿名サインインの権限から試験する。クライアントから本人ID・個人点数・集計値は受け取らない。

- [x] `submit.test.ts`に初回1票、同ID更新1票、別ID2票、再送1票、同内容新送信1票、20IDの重複・0・小数・版不一致の拒否を記述する。`authenticated_rpc_succeeds_direct_dml_denied`では、通常の匿名サインインのJWTでRPCが成功し、同じ権限による票・集計・再送記録・制限表への直接書込は拒否されることを検証する。T01のfixtureをSQL計算にも与え、点数・10軸・判決が一致することを検査する。
- [x] `concurrency.test.ts`に同ID同時更新の片方が `STALE_REVISION` になる、異なるIDの同時送信が両方残る、意図的な途中例外で票と集計が共に戻る試験を作る。全件分布・11判決分布の合計がcountと一致することも検証する。
- [x] `npm run test:db -- tests/integration/submit.test.ts tests/integration/concurrency.test.ts`を実行しFAILを確認する。
- [x] 同じ内容版の集計行をまずロックし、本人票・同一requestIdの記録を確認する順で処理する。入力を検証し、サーバー再計算、旧票の寄与を除去、新票追加、集計更新、再送記録を同じトランザクションで行う。初回だけcountを増やす。初期の単一集計行方式の負荷はT09で測り、必要なら集計構造を変える。
- [x] 同じrequestId・同じ内容は二重加算せず、現在の本人票のrevisionが保存時と一致する場合に、本人票を含む現在のSnapshotを返す。別の送信で本人票が変わっていたら `STALE_REVISION` を返す。同じrequestIdで内容が違えば拒否する。無変更の新しい送信は票と集計のrevisionを増やさず、新しい比較用Snapshotを返す。
- [ ] 1匿名IDあたり新しい送信操作10回/60秒を初期制限とする。同一requestIdの照会・再送は重複加算も制限枠の追加消費もしない。新規匿名参加の自動大量生成はSupabaseの設定とCAPTCHAで対処し、IDを失った通常の再参加は認める。 **進捗：DBの制限・再送除外は実装検証済み。本番Auth制限とCAPTCHAプロバイダ・ウィジェットの接続は未実施。**
- [x] 送信UIを実装する。応答喪失ではrequestIdを保って再送し、成否未確認の間は入力を維持する。競合時は保存済み回答を取得し、現在の編集中内容も示して再選択できるようにする。異なる匿名IDで保留中の送信を自動再実行しない。
- [x] 同じDB試験と `npx playwright test tests/e2e/submit.spec.ts`をPASSにする。`lost_response_retries_once`、`receipt_after_newer_vote_conflicts` を実際の保存後応答遮断で確認し、書込関数の権限を再点検する。
- [x] コミット：`feat: submit ballots atomically with retry protection`。

## T07：結果・最新状況・比較・小説

**Files:** 上表T07の6ファイル、`tests/unit/chart-model.test.ts`、`tests/e2e/results.spec.ts`、`tests/e2e/status.spec.ts`を作成。T04の画面遷移を接続。

**Interfaces:** T06のreceiptから `openResult(receipt: SubmitReceipt): ResultSession` を作り、`clearResult(): void`で消去する。`ChartModel = { labels: readonly string[]; series: readonly { name: string; values: readonly number[] }[]; min: number; max: number }`。`radarModel(personal: AxisValues | null, snapshot: Snapshot): ChartModel | null`、`renderChart(model: ChartModel): SVGElement`。`watchSnapshot(version: ContentVersion, onData: (snapshot: Snapshot) => void, onError: () => void): () => void` は購読解除関数を返す。

- [x] `results.spec.ts`に個人合計・負正内訳・20棒・固定順累積・10軸・軸根拠2件を表示する試験を作る。1票では個人と平均が一致する旨を表示し、`snapshot_stays_fixed`で他人の追加投票後も結果の図・時刻が変わらないことを検証する。
- [x] `status.spec.ts`に0票は判決待ち、小説なし、正負各1票で平均0でも両端の分布を表示する `polarized_zero_mean`、微小な正数は「＋0.01未満」でP1、通信失敗で前の時刻と値を残す試験を作る。
- [ ] `npx playwright test tests/e2e/results.spec.ts tests/e2e/status.spec.ts`を実行しFAILを確認する。 **進捗：単体のRED→GREENと最終ブラウザ合格は記録済み。このブラウザコマンドの初期RED記録は未確認。**
- [x] 個人結果と比較はreceiptを固定し、最新画面だけwatchSnapshotで更新する。集計行のRealtime通知は再取得のきっかけとして使い、本人票のテーブルは通知対象にしない。通知失敗時は可視中30秒polling、手動更新・復帰時更新を用意。再取得中の古い応答はrevisionで捨てる。 **実施：実装・ポーリング・publication設定を確認済み。Realtime実配信は公開前確認へ残す。**
- [x] 判決・平均・分布・レーダー・小説を一つのSnapshotから同時に描画する。軸ラベルと0〜100の尺度、個人/全体の線種、数値表、根拠の回答を付ける。極端な回答の相殺と、50が心理的中立ではない旨を表示する。
- [x] 11判決から対応する300文字本文を選ぶ。「このまま判決が決まると」と仮の未来である説明を添え、0票では本文を選ばない。
- [x] 同じ試験とチャートの単体試験をPASSにし、図と読み上げ用数値表の一致を実見する。
- [x] コミット：`feat: show verdicts distributions and fixed comparisons`。

## T08：画像の保存とX向け共有

**Files:** 上表T08の2ファイル、`tests/unit/card.test.ts`、`tests/e2e/share.spec.ts`を作成。

**Interfaces:** `CardKind = 'personality'|'comparison'|'verdict'`。`renderCard(kind: CardKind, session: ResultSession, gameUrl: string): Promise<Blob>` はimage/pngを返す。`shareCard(blob: Blob, text: string): Promise<'shared'|'cancelled'|'fallback'>`。T07のChartModelからCanvas 2Dへ描画し、別の採点式を作らない。

- [x] `card.test.ts`でpersonality/comparisonが1080×1350、verdictが1080×1920、不透明PNGであることを検証する。`share.spec.ts`に10軸ラベル・凡例・20回答の見切れなし、匿名IDなし、図と元receiptの一致を検証する試験を書く。
- [ ] `npm test -- tests/unit/card.test.ts` と `npx playwright test tests/e2e/share.spec.ts`を実行しFAILを確認する。 **進捗：単体のモジュール未実装REDは記録済み。共有E2Eの初期RED記録は未確認。最終の両試験は合格。**
- [x] フォント準備後に画像を生成し、プレビューと保存ボタンを出す。3Dの一枚絵は用意できる場合だけ加え、3D取得失敗でも文字と図を出力する。外部画像によるCanvasの汚染を避け、自サイト素材を使用する。
- [x] 画像生成を終えてから共有ボタンを有効にし、利用者のクリック内で `navigator.canShare({files})` と `navigator.share({files,text})` を使う。非対応時は保存・投稿文コピーを提示する。Xへのリンクに画像が自動添付されると説明しない。[共有APIと利用者の操作条件](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)
- [x] `AbortError` は取消として結果を維持する。保存・コピー失敗も再試行可能にし、投票処理を呼ばない。`share_cancel_keeps_result` と `share_fallback`をPASSにする。
- [ ] 3枚とも実際に開いて文字・線・日付を確認し、iPhone Safariで保存した画像が開けることを記録する。直接共有が利用できたかも別に記録する。 **進捗：3種PNGの実見とLinux WebKitでの保存・再表示は完了。物理iPhone Safariでの保存とOS直接共有は未実施。**
- [x] コミット：`feat: export and share verdict cards`。

## T09：結合・性能・公開準備

**Files:** `.github/workflows/ci.yml`、`tests/e2e/journey.spec.ts`、`tests/e2e/accessibility.spec.ts`、`docs/qa/release-checks.md`、`docs/operations.md`を作成。前工程の問題がある箇所だけ変更。

**Interfaces:** T01〜T08の契約を維持。CIは `npm ci`、`npm run typecheck`、`npm test`、ローカルDBの `npm run test:db`、`npm run build`、`npx playwright test`、`python3 scripts/validate-docs.py` を実行する。必要なブラウザ・ローカルSupabaseの起動手順を同じ設定に含める。

- [x] `journey.spec.ts`に初回参加→提出→比較→画像→ホーム→再参加編集→1票置換の通し試験を書く。`result_lifetime`では直接結果URL・reload・ホーム後back・BFCache復帰から終了済み結果を復元せず、新たな提出なら表示できることを検証する。 **実施：実back・reloadとpersisted pageshowハンドラを検証。実際のpersisted BFCache復帰は未観測で、合格扱いにしない。**
- [x] `accessibility.spec.ts`に390px/844px、文字200%、キーボード、読み上げ用ラベル、reducedMotion、WebGL不可で投票完了できる `accessible_fallback_flow` を作る。ゲーム画面で横スクロールしないこと、44px操作領域、本文のコントラスト比4.5:1以上を確認する。
- [x] 試験を実行し、未対応の画面寿命・代替表示・操作の問題を再現する。再現した箇所だけ修正する。全機能の通し試験が初回から通る場合は失敗を人工的に作らず、合格結果を保存する。
- [ ] 性能をデザイン仕様の予算で測る。60秒×3回の描画、30分の画面遷移、同時送信20件のローカルDB整合性を確認する。ネットワーク・端末・ソフトウェアの条件を記録し、実ユーザー数の容量保証にはしない。画質低下・購読解除・GPU資源解放を調整する。 **進捗：標準・軽量各60秒×3回と実DB20並行送信は記録済み。変更前30分14.816秒・最終実装5分の観測は記録済みだが、最終実装の途切れない30分確認は未完了。実機性能は未確認。**
- [ ] iPhone Safariを優先し、Android Chrome・デスクトップChrome/Safariも操作確認する。端末が利用できない項目は未実施と記録し、模擬結果で実機合格としない。実機性能が未確認なら公開前の残作業として残す。 **進捗：Linux Chromium/WebKitの操作と模擬画面を確認済み。物理iPhone/Android、macOS Safari、VoiceOverは未実施として公開前記録へ残す。**
- [ ] 接続予定のSupabaseプロジェクトと公開URLを確認し、既存アプリのデータ・権限と混ぜない接続手順を書く。匿名Auth、CAPTCHA、Realtime集計表、必要なGRANT、公開キー、HTTPS、同一オリジン素材、バックアップ/復元、旧版と新版本文を混ぜない更新、投票受付停止と前版への戻し方を `operations.md` に残す。課金変更を前提にしない。 **進捗：operations.mdは作成済み。本番プロジェクト・公開URLの選定、CAPTCHA接続、Realtime実配信・復旧の実環境確認は未実施。**
- [x] セキュリティ助言・公開bundleの秘密値混入・DB権限・全試験・全画像を確認する。`release-checks.md`にコマンド、結果、端末条件、画像、未実施項目を記録する。 **進捗：ローカルの助言・bundle・権限・自動試験・画像確認とrelease-checks.md作成、長時間観測の集計を実施済み。実機・本番の未実施条件も記録した。**
- [x] コミット：`test: verify complete trial and release readiness`。実装PRへプレビューと画像を付け、マージ・本番公開は依頼の範囲を確認して進める。この文書作成だけで公開権限が与えられたとは扱わない。 **実施：`1262d91`とDraft PR #2。プレビューの起動手順・画像を添付し、マージ・本番公開は未実施。**

## 設計上の選択と着手時の確認

| 選択 | 理由・確認するタイミング |
| --- | --- |
| Vite + TypeScript + Three.jsを直接使用 | 4画面と固定20件のため、追加のUI/3Dフレームワークを初期必須にしない。T01で依存を固定 |
| 頂点変形の3Dモデル | 添付にある柔らかい形と軽い動きを、流体計算なしで表す。T03の比較画像で品質を判定 |
| 半透明に見えるアニメ塗りから開始 | モバイルの描画順と性能を優先する制作案。実透過の採否はT03で画質と計測を比べて決める |
| 匿名Auth + RPC +集計行 | 本人の編集権、不可分な更新、公開集計を分離する。T05/T06で実DB試験、T09で競合負荷を測る |
| 結果はメモリ、集計は固定snapshot | 後から個人結果を見ない方針と、画像の比較時点を両立する。T07/T09で確認 |

Supabase・Three.jsのAPIは実装開始時にも公式資料を確認する。[Supabase更新情報](https://supabase.com/changelog)、[匿名Auth](https://supabase.com/docs/guides/auth/auth-anonymous)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[Three.jsの材質](https://threejs.org/docs/pages/MeshToonMaterial.html)を起点にする。本計画の日時点で実在を確認した資料であり、特定バージョンを導入・動作確認済みという意味ではない。

## 計画の確認記録

要件の全節をT01〜T09へ対応付け、入力・計算・20件・10軸・判決・小説はT01、匿名保存と再送はT05/T06、画面と3DはT02〜T04、比較と更新はT07、画像はT08、端末と公開前品質はT09に含めた。5つのReview Focusは表に記した試験へ割り当てた。共通型と各工程のインターフェースを照合した。原計画の確認時点では将来ファイルを作成済みとして扱わず、今回の進捗更新では実装と証拠を確認できる項目だけをチェックした。

原計画は要件・参照デザイン・計画表をまとめたPR #1で提出した。別の実装依頼を受けてDraft PR #2を作成済み。未完了の端末・接続先・運用・長時間観測の条件は上記チェック欄と公開前検証記録で管理し、実装PRの提出を本番公開の完了とは扱わない。
