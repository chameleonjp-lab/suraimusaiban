# Xシェア・共有Supabase・公開準備の検証

2026-10-23。既存のゲームを保ち、ホームと結果のX投稿を分け、SNSサムネイルとGitHub Pagesへの自動配備を追加しました。

## 実装と証拠

- ホームの「このゲームをXでシェア」は20件の裁判への紹介文。結果の「今回の判決をXでシェア」は本人の判決・符号付き合計点を含みます。どちらも正式URLだけを使い、クエリ・回答ID・参加者IDを投稿リンクへ入れません。
- [SNS画像](../../public/social-card-v2.png)はユーザー指定画像を1280×670の不透明PNG（約1.2MB）で保存したものです。元画像から画素を変更せず、タイトル・構図をそのまま使用しています。OGP・Twitter `summary_large_image`・日本語altを更新し、画像URLも変更して旧サムネイルのキャッシュを避けています。
- [ホームの追加ボタン](screenshots/home-share.png)を縦390pxで確認しました。画像保存・端末共有・投稿文コピーも本人結果に合わせています。
- `config/production.json` はランキングと同じSupabase URL・publishable keyを使います。管理キーは含みません。共有プロジェクトへ専用名の表・RPC・非公開schemaを作り、元のランキング表と権限を変更していません。
- ローカルの型検査、単体84件、実PostgreSQL/Auth/RESTのDB17件、Chromium27件（1.1分）が合格しました。DB試験には、他ゲームのprivate schema権限を保ったまま導入できることを追加しています。
- `npm run build` と `npm run check:publication` で、サブディレクトリ配信・正式URL・サムネイル寸法・公開版JSONを検査しました。

## 本番Supabase

プロジェクト `mlpnjgezrnhdxsxolyzj` へ `slime_trial_schema` / `slime_trial_submit` / `slime_trial_realtime` を適用しました。公開集計を実際のpublishable keyで取得し、0票・20件の分布・10軸・11判決を確認しました。Realtime publicationには集計表だけを追加しています。

本番DB上で `authenticated` ロールとテスト用JWT subjectを使うロールバック付きトランザクションを実行し、初回提出・同一送信の再送・本人票の置換・別人の読取拒否・直接DML拒否を検証しました。終了後は0票・本人票0件・再送記録0件へ戻り、検証票を残していません。この検証は実際の匿名サインインを代替しません。

セキュリティadvisorsで本ゲームに関するWARN/ERRORはありません。非公開2表のINFO「RLS enabled / no policy」は、クライアントの直接操作を拒否する設計どおりです。

## 自動公開

mainへのpushで `Verify slime trial` が成功すると、`Publish GitHub Pages` が検証したSHAを配備します。通常のPRやforkのCI成功を公開トリガーにせず、古いコミットがmainの現行版を上書きしないよう確認します。公開HTMLの `chameleonjp-commit` と `release.json` にSHAを記録します。

CIは、本番用buildをブラウザで開いて正式URL・サブパス素材・実Supabaseの公開集計も確認します。この試験では票を書きません。公開ジョブは、本番の匿名サインインが有効なことも確認してから配備します。

## 現時点の設定待ち・確認範囲

本番Authの `/auth/v1/settings` は `external.anonymous_users: false` でした。接続ツールにAuth設定変更の機能がないため、ダッシュボードで「Allow anonymous sign-ins」を有効にする必要があります。有効化と本番確認が済むまでは、投票可能な公開が完了したとは扱いません。

ローカルの本番接続ブラウザ試験は、環境プロキシ証明書の信頼エラーで集計取得まで進めませんでした。NSS証明書DBへの信頼追加は自動承認審査で却下されたため実施していません。通常のTLS検証が使えるGitHub Actionsで同じ公開成果物を検証します。curlの公開API確認、ローカルAuthへの接続試験、実DBのロールバック検証はそれぞれ実施済みです。

実機SafariやXの実際の投稿確定は今回の自動試験に含みません。Xへのボタンは投稿内容を開き、最終的な投稿は利用者が確定します。
