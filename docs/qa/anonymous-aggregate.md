# 匿名・集計のみへの移行検証

対象: `suraimusaiban-20261024-03`。名前登録・個別回答の永続保存・後日の結果復元を廃止し、回答回数だけを加算する変更。

## ローカル検証

- TypeScript（画面とEdgeハンドラ）、単体131件（Edge47件を含む）、実DB23件が成功。
- Chromium E2E30件が成功。新規回答、再送、離脱、再読込、集計準備中、結果画像・X共有を検証。
- 本番ビルド、公開成果物、文書の整合性、差分の空白検査が成功。
- DB検証はloopbackの使い捨てPostgreSQLに限定。本番の個別回答は作成しない。

## Supabase本番での確認

接続先: ランキングと同じ `mlpnjgezrnhdxsxolyzj`。

- migration `20261024205153_slime_trial_anonymous_aggregate` と `20261024205204_slime_trial_cleanup_schedule` を適用。ローカルのファイル名も本番履歴に合わせた。
- 旧個別回答表・提出RPCを削除。内部集計・短期の再送防止UUID・時間で変わるHMAC制限だけを保存する。
- anon/authenticatedの内部schema参照・提出RPC実行・公開集計の直接書込は不可。公開集計のSELECTのみ許可。
- service_roleで10回の受付・10件未満の非公開・同一UUIDの二重加算防止を検証し、トランザクションを全てROLLBACK。公開・内部集計・受付記録が0件に戻ることを確認。
- 新Edge Function `slime-trial-submit` を配備。許可OriginでOPTIONS204、不正本文400を確認。受付を一時停止した状態で正しい本文を送って `VERSION_CHANGED` を確認し、Edgeからservice-only RPCへの経路を検証。受付状態を元へ復帰し、回答の追加は0件。
- 5分間隔の削除ジョブ `slime-trial-anonymous-retention-v1` がactive。2026-10-24 20:55 UTCの実行成功を確認。他アプリの表・ポリシー・関数の指紋は移行前後で一致。
- 当アプリのSecurity Advisorは、非公開3表に意図的な「RLS有効・公開ポリシーなし」のINFOのみ。

## 公開と残る制約

mainへのマージ後、CIが成功した同じSHAをPagesへ配備する。公開前・公開後のブラウザ確認は、本番の集計読取・Origin/CORS・Auth呼出0件・SNS画像・配備SHAを確認し、回答を加算しない。実行結果はGitHub Actionsのログと `test-results/production-readiness.json` に出力する。

回答数は人数ではない。10件単位の公開は差分推測を減らすが、既知の回答を組み合わせた推測やボットを完全には防げない。短期の技術情報や基盤の標準ログが残る可能性もある。利用者が保存したPNG・X投稿はサイト外で管理される。

共有DBの別アプリ `wakaranjan_learning_profiles` の全件読み書き許可は既存の別問題であり、この変更では操作していない。運用と保存期間の詳細は [operations.md](../operations.md) を参照。
