# 公開前の検証記録

2026-10-23。ゲーム本体を実装し、ローカルで検証しています。本番Supabase・公開URLは未指定で、リモートmigrationと本番公開は行っていません。

## 自動検証

| 対象 | 実施条件・結果 |
| --- | --- |
| 型検査・ビルド | Node24 / TypeScript7 / Vite8。型検査とproduction buildを確認。 |
| 計算・状態 | Vitest。20件本文、11本各300文字、厳密なBigInt判決、100組×10軸、下書き分離、匿名ID再利用、固定結果、通信復旧、チャートを検証。 |
| DB | [DB記録](database.md)。PostgreSQL17と実際の匿名Auth JWT・PostgRESTでRLS/RPC/再送/同時更新/ロールバックを検証。 |
| Chromium通し操作 | [操作記録](journey.md)。実DB提出、比較、保存、再投票置換、応答喪失、古い再送の拒否、結果の寿命。 |
| WebKit | Linux WebKitのiPhone13エミュレーション。実DB通し操作と3種PNGのダウンロード/再表示を確認。実機iPhoneではない。 |
| 3D・性能 | [モデル記録](slime-model.md)。5方向、回転、待機動画、静止代替、非表示停止・解放、SwiftShaderの条件付き測定。 |
| 画面 | [縦横・文字拡大](courtroom.md)。390×844、844×390、desktop、200%文字。本文4.5:1、44px操作領域、3Dなしでも操作。 |
| 文書・素材 | `python3 scripts/validate-docs.py`：参照原本のhash、本文、判決表、リンクを検証。 |

最終の型検査とproduction buildは成功しました。単体80件、実DB14件＋publication設定2件、Chromium全体25件＋実シーン停止の追加1件が合格しています。接続済みブラウザ試験のskipは0件です。長時間測定とWebKitの最終集計は実行終了後に追記します。

[独立レビュー](implementation-review.md)は致命的0件・重要2件・軽微1件。重要2件（匿名ID切替時の所有者・認証固定、動きの停止状態の維持）を修正し、回帰試験が通っています。軽微な「最新状況の更新で詳細の開閉・フォーカスが失われる」点は延期しています。

ビルドのJavaScriptは約871KB（gzip約232KB）で、Viteの500KBチャンク警告が残ります。外部3D素材・実行時文章生成はありません。CIはローカルと同じDB/Auth・単体・Chromium試験を実行する構成です。

## 実見した成果物

- [ホーム](screenshots/home-desktop.png)、[縦の裁判](screenshots/trial-portrait.png)、[横の裁判](screenshots/trial-landscape.png)、[200%文字](screenshots/trial-text-200.png)
- [人物傾向PNG](cards/personality.png)、[全体比較PNG](cards/comparison.png)、[判決記録PNG](cards/verdict.png)
- [正面スライム](scene/front.png)、[背面](scene/rear.png)、[回転一覧](scene/turntable.png)、[10秒動画](scene/idle-10s.webm)

PNGは不透明、人物傾向/比較1080×1350、判決記録1080×1920。元の固定receiptと同じ10軸・20件・日本時間を表示し、匿名IDや公開結果URLを含めません。サンプルのexample.testは検証用のURLです。実際の保存は起動中のゲームURLを使います。

## 公開前に残る確認

- 物理iPhone Safari、Android Chrome、macOS Safari、VoiceOverでの操作。Linux Chromium/WebKitと画面模擬で実機合格とはしません。
- 実機GPUで安定30fps以上/p95 33.3ms以下。SwiftShaderはソフトウェア描画であり、実機性能の代替測定ではありません。
- 本番プロジェクト、公開URL、CAPTCHAプロバイダ/ウィジェット、Auth作成制限、Realtime実配信、バックアップ/復元を含む[運用手順](../operations.md)。
- 実際のOS共有シートからXへの画像受け渡し。非対応時のPNG保存・コピーと、共有取消処理は検証済みです。

初期のローカル同時書込測定を公開後の容量保証にはしません。公開準備が整うまではレビュー用PRとローカルプレビューで確認します。
