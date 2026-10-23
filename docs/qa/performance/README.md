# ライフサイクル観測

画面を実時間で切り替え、WebGL APIの作成・削除ハンドル、明示的なcontext loss、DOMノード数、JS heapを観測します。負荷試験や実機GPUメモリ測定ではありません。

## 証拠の区別

| 記録 | ソースと条件 | 状態 |
| --- | --- | --- |
| [30分の基準観測](lifecycle-30min.json) | 2026-10-23 13:03:08 UTC開始。**Supabase未接続プレビュー**の`5175`で先行ソースをブラウザに読み込んだ観測。最初の約2分にHMRによる文書再読み込みがあり、その後は安定。courtroom batchingを含む最終ソースの30分観測とは扱わない。 | 完了。実時間1,814,816ms（30分14.816秒）、360標本、page error 0件。 |
| [最終ソースの5分観測](lifecycle-final-5min.json) | 13:24:37 UTC開始。接続済み`5173`、HMR停止、owner/motion修正とbatched courtroomを含むdirty branch。対象ファイルのSHA-256をJSONへ記録。 | 完了。実時間300,008ms、63標本、未捕捉page error 0件、投票提出0件。 |

基準観測の初期再読み込みは、累積context数が48,628msと131,400msで減少していることからも確認できます。読み込み済みの旧ソースを含む記録を、後から最終ソースの記録として再分類しません。

## 最終ソースの5分の結果

2026-10-23 13:24:37.488〜13:29:37.496 UTCに、各画面21標本ずつ、合計63標本を取得しました。開始・終了時の対象ソースのハッシュは一致し、context累積カウンターの途中リセットはありませんでした。

| 画面 | buffer / texture / programの観測数 | DOMノード数 | 結果 |
| --- | --- | --- | --- |
| trial | 全21標本で103 / 5 / 6 | 全標本84 | 同じ画面へ戻った際のAPIハンドル数に増加は観測されなかった。 |
| status | 全21標本で0 / 0 / 0 | 全標本1205 | 毎回の遷移後、明示的context lossを経て観測集合が空になった。 |
| home | 全21標本で103 / 5 / 6 | 全標本79 | 同じ画面へ戻った際のAPIハンドル数に増加は観測されなかった。 |

最後のstatus標本ではcontext作成累積42回、明示的context loss累積42回でした。観測終了はhome画面なので、最後の標本は作成累積43回・loss累積42回で、稼働中の一画面分のハンドルを含みます。JS heapは10,691,856〜17,119,500 bytesでした。これは5分間の標本範囲で、強制GCやGPUドライバーの回収測定を行った値ではありません。

## 再実行

`scripts/measure-lifecycle.mjs`は`trial → status → home`を繰り返し、各画面を最大4.5秒待ってから標本を保存します。実時間を短縮する時計操作は行いません。最後の画面は残り時間に応じて短くなる場合があります。匿名参加の初期化と集計読取は行いますが、回答・投票の提出は行いません。JSONの`submitRequests`でも0件を確認します。

HMRを止めた開発サーバーを起動して、別のターミナルから実行します。

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers \
LIFECYCLE_ORIGIN=http://127.0.0.1:5173 \
LIFECYCLE_DURATION_MS=300000 \
LIFECYCLE_OUTPUT=docs/qa/performance/lifecycle-final-5min.json \
LIFECYCLE_SOURCE_LABEL='final owner/motion fix + batched courtroom (dirty branch)' \
LIFECYCLE_CONDITION='Managed Linux x86_64; headless Chromium; SwiftShader software WebGL; 390x844 CSS px; connected local Supabase; HMR disabled; no ballot submission' \
node scripts/measure-lifecycle.mjs
```

既定値はoriginが`http://127.0.0.1:5173`、時間が1,800,000ms、出力が`docs/qa/performance/lifecycle-30min.json`です。既存の証拠を上書きしないよう、別の観測では必ず別の出力先を指定してください。`--origin`、`--duration-ms`、`--output`、`--source-label`、`--condition`でも指定できます。`--help`で対応する環境変数と条件を確認できます。

## 数値の読み方と限界

- `contexts`はこの文書で観測したcontextの累積数であり、同時に生存するGPU context数ではありません。
- `buffers`、`textures`、`programs`は`create*`・`delete*`で追跡するAPIハンドル集合のサイズです。`WEBGL_lose_context.loseContext()`を明示的に呼ぶ際、観測用の集合も消去します。**0件は観測器が持つハンドルが0件という意味で、GPUドライバーがメモリを回収した量を測定した値ではありません。**
- `explicitContextLosses`はこの明示的なcontext loss呼出しの回数です。観測器自体もcontextごとのカウンターを保持します。
- `heap`はChromium CDPの`JSHeapUsedSize`です。強制GCは行っておらず、値の一時的な増減をそのままメモリリークや回収量と断定しません。
- `nodes`と`sceneStates`は標本を取った時点のDOM・canvas状態です。`navigations`はPlaywrightのmain-frameナビゲーションイベントで、SPAのhash変更も含みます。この件数だけで文書の再読み込み回数とは判断しません。基準観測の再読み込みはcontext累積カウンターのリセットと合わせて区別します。
- `sourceFilesAtStart`と`sourceFilesAtSample`はディスク上の対象ソースのハッシュです。ブラウザは先に読み込んだモジュールを使い続けるため、途中でソースが変わった場合も条件として区別する必要があります。

条件はLinux x86_64、headless Chromium 156.0.8078.4、390×844 CSS px、SwiftShaderによるソフトウェアWebGLです。実際のiPhone Safari、モバイルGPU、温度上昇、電池消費、実ユーザー数の容量は検証していません。最終ソースの5分観測を、最終ソースの30分観測や実機性能の合格へ置き換えません。

## 30分の基準観測の結果

実時間1,814,816ms、360標本で終了しました。page errorは0件。150秒経過後は、ホーム111標本で287 buffers / 5 textures / 6 programs、裁判110標本で295 / 5 / 6、最新状況110標本で0 / 0 / 0と一定でした。DOMノード数は同じ順で81 / 85 / 31、全標本のJS heapは10,076,056〜17,379,668 bytesです。未接続プレビューなので投票処理やRealtimeの長期動作は測定していません。

初期のHMR再読み込みと変更前ソースを含む基準観測です。最終コードでは別途5分の観測で、ホーム・裁判とも103 buffers / 5 textures / 6 programs、最新状況で0 / 0 / 0を確認しました。最終コードの途切れない30分観測と実機の性能確認は公開前の残作業です。
