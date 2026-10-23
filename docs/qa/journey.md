# 接続済みブラウザ試験

実施日：2026-10-23。ローカルの実際のPostgreSQL・Supabase Auth・PostgRESTへ接続し、画面の操作から匿名参加と投票を行った記録です。認証、投票、再送の応答をfixtureで成功扱いにはしていません。本番の公開先への接続・公開はしていません。

## 環境と再実行

- Linux 6.18.55 x86_64、Node 24.19.0、Playwright 1.64.1、headless Chromium 156.0.8078.4。
- 画面：390×844 CSS px、および844×390 CSS px。文字拡大はルートの`font-size:200%`、reduced motionはブラウザのメディア設定で適用。
- ローカルAPI：`http://127.0.0.1:54321`。PostgreSQL 17.11、GoTrue 2.197.0、PostgREST 16.5、Kong 2.8.1。DB担当の実行環境を使用。Realtimeコンテナはなく、更新は取得・ポーリングの経路を対象とする。
- Vite：`http://127.0.0.1:5174`。開発中のソース更新で審理画面が再読み込みされないようHMRを停止。
- グローバルな票数・集計版の増分を厳密に検査するため、実行中は別の接続済みブラウザ試験・DBリセット・負荷試験による書込を止める。

```sh
set -a
source /tmp/slime-trial-db/public.env
set +a
SLIME_DISABLE_HMR=1 npm run dev -- --port 5174
```

別のターミナルで実行します。`public.env`はローカル試験用の公開接続情報だけを含むファイルです。秘密の管理キーをViteへ渡しません。

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-browsers \
E2E_BASE_URL=http://127.0.0.1:5174 \
npx playwright test tests/e2e/journey.spec.ts tests/e2e/submit.spec.ts \
  tests/e2e/accessibility.spec.ts --output=/tmp/slime-journey-verified
```

接続設定がない場合、この6試験は理由を示してskipします。未接続プレビューの成功を投票の成功として扱いません。実際のDBを起動・設定してから、skipが0件であることも確認します。

## 検査する契約

| 試験 | 実際に行う操作と検査 |
| --- | --- |
| `connected_journey` | 新しい匿名IDで20件を画面から回答し提出。別参加者も画面から提出しても、開いている本人比較のHTML・集計版が変わらない。比較画像を保存し、PNG署名と1080×1350の寸法を検査。ホームから戻ると20回答が復元され、1回答の編集・再提出で本人票だけを置換する。 |
| `result_lifetime` | 直接の`#result`、再読み込み、ホーム後のbackから終了済み結果を復元しない。保存済み回答を確認して新たに提出すると新しい結果を表示できる。storageとHistory stateに集計・receipt・個人結果を保存しない。persisted pageshowのハンドラと、別文書への移動後の実際のbackを別々に検査する。 |
| `lost_response_retries_once` | 最初のRPCを`route.fetch()`で本当のDBへ到達させ、成功応答を読んだ後だけブラウザへの応答を中断。クライアントが同一のrequest ID・20回答・期待revisionで1回だけ再送する。再送receiptが最初と一致し、票数・集計版が1回分しか増えない。 |
| `stale_receipt_newer_vote` | 最初の実RPCをコミット後に保留。同じ匿名IDの別タブで最新の保存票から編集・置換した後、最初の応答を中断して古いrequest IDを再送させる。古いreceiptを結果表示せず、衝突の説明を出す。保存票を上書きせず、利用者が確認した新しい提出だけを受け付ける。 |
| `accessible_fallback_flow`（縦・横） | WebGL context取得だけを不可にし、2D Canvasの画像保存は実物を使う。静止背景、読み上げ用ラベル、10個の判断、キーボードのSpace/Enter、200%文字、reduced motionで20件を提出し、PNGを保存。ホーム・裁判・確認・結果に横スクロールがなく、表示中の操作が44×44px以上、本文・legendの計算上のコントラストが4.5:1以上であることを検査。 |

## 実行の記録

初回の実行で、ホーム本文の一部にコントラスト4.386:1を検出し、画面担当へ修正を依頼しました。修正後は両方向の拡大文字・代替表示の提出と画像保存まで通りました。開発中のHMRによる画面再読み込みは、HMRを止めたローカルサーバーで再実行して切り分けました。

WebKitでは200%文字の結果全文が画像の32767px制限を超えるため、末尾の証拠画像をviewport撮影に変更しています。横スクロールや操作・提出の検査範囲は変えていません。

最終の排他的実行はChromiumで**6件合格、0件失敗、0件skip、56.6秒、終了コード0**でした。上記の3ファイルを一括実行し、書込のない状態で票数・集計版の厳密な増分も確認しています。証拠は`/tmp/slime-journey-verified`にあります。

- 縦画面の証拠画像：`accessibility-accessible-f-fd7af-WebGL-still-submit-and-save-chromium/fallback-390-200pct.png`。
- 横画面の証拠画像：`accessibility-accessible-f-e5628-WebGL-still-submit-and-save-chromium/fallback-844-200pct.png`。
- BFCacheの実測：`journey-result-lifetime-di-a8e03-ot-recover-an-ended-receipt-chromium/bfcache-evidence.json`。`actualPersistedRestoration:false`、`syntheticPersistedHandlerPassed:true`でした。実際のbackではブラウザが文書を再読み込みして結果を消したことを確認できました。**実際のpersisted BFCache復帰はこの環境では観測できず未確認**です。擬似イベントの成功を実際のBFCache合格に置き換えていません。

別のLinux WebKit実行では、接続済みjourney・寿命・応答喪失・古いreceiptの4試験が通りました。2件の代替表示試験は、操作・提出・保存まで通った後、上記の全文撮影サイズ制限だけで失敗しました。撮影方法修正後のWebKit再実行結果は、全体の公開前QA記録で管理します。

## 未実施・対象外

実際のiPhoneとiPhone Safariは利用できず、実機検証は未実施です。上記の画面サイズとLinuxブラウザの成功を、iPhone実機合格とはしていません。実際のAndroid Chrome、macOS Safari、VoiceOverなどの読み上げソフトウェアによる操作も未実施です。アクセシブルネームの検査は実際の読み上げ結果を代替しません。

CPU/GPUの実機性能、30分の遷移、同時20送信、本番Realtime接続、CAPTCHAを含む運用設定、実際のX投稿はこの6試験の対象ではありません。それぞれ別のQA・運用記録で確認が必要です。WebGL不可はcontext取得不可を注入した代替経路の検査であり、実機GPU障害を測定した結果ではありません。

## 最終の追加確認

全体のChromium25件一括実行でも上記6件がskipなしで再度合格しました（13:20 UTC開始、全体1.2分）。撮影方法修正後のLinux WebKitは、上記6件を含む11件が一括で合格しました（13:22 UTC開始、2.0分）。最終コマンドと他の回帰試験は[公開前記録](release-checks.md)にまとめています。
