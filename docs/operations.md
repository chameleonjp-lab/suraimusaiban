# 接続・公開・復旧手順

この実装は静的なViteアプリと、Supabaseの匿名Auth・Postgres・Realtimeを使用します。本番プロジェクトや公開URLは未指定です。既存アプリへの接続、リモートmigration、本番公開は行っていません。

## ローカル起動

Node.js 24以上とnpmを使います。

```sh
npm ci
npm run dev
```

接続用の環境変数が空なら、ホームと20件の裁判・未送信の仮判決を確認できます。実投票数や保存済み結果を模造しません。3Dが利用できなければ完成モデルの静止画を表示します。

実際の匿名参加・投票を確認する場合は、[ローカルDB手順](qa/database.md)を使用します。Dockerを用意し、以下を実行します。

```sh
node scripts/test-db-local.mjs start
node scripts/test-db-local.mjs migrate
npm run test:db
set -a
. /tmp/slime-trial-db/public.env
set +a
npm run dev
```

検証用のDB・Auth・REST・ゲートウェイは127.0.0.1だけに公開されます。固定パスワードと署名用文字列は、この使い捨て環境専用です。検証用ゲートウェイと設定を本番へ配備しないでください。検証が終わったら `node scripts/test-db-local.mjs stop` でこの作業用コンテナを停止します。`reset` はローカルの回答を削除します。

公式Supabase CLIを使用する場合は `npx supabase start`、`npx supabase db reset` を実行し、CLIのローカル公開キーとURLを設定します。この環境では公式DBイメージの展開容量を確保できなかったため、SQL/Auth/RESTは軽量な実サービス構成で検証しています。公式CLI一式の起動は別途確認が必要です。

## 公開先を選ぶとき

1. このゲーム専用のSupabaseプロジェクトと、HTTPSで配信するURLを決めます。既存アプリのDB・RLS・匿名認証設定を流用しません。課金プランの変更は不要な前提です。
2. migrationを検証用プロジェクトに適用し、バックアップと復旧方法を確認します。CLIの `--help` で使用中のバージョンの引数を確認し、接続先project refを読み合わせてから適用します。本番の `db reset` は実行しません。
3. Authで匿名サインインを有効にします。Site URLを公開URLにし、匿名作成のレート制限を確認します。ローカルconfigの高い匿名作成上限を本番へコピーしません。
4. CAPTCHAを有効にする場合は、Supabase対応プロバイダのウィジェットと `signInAnonymously({options:{captchaToken}})` を参加開始画面へ接続してから公開します。現在の初期実装にはウィジェットがないため、CAPTCHAを有効にした本番環境でそのまま参加可能とはしていません。公開前にプロバイダ・サイトキー・許可ホストを決め、実際の匿名参加を検証します。
5. Data APIの公開schemaは `public` のみにします。`private` は公開しません。migrationのGRANT/RLSを維持し、通常の匿名JWTで本人だけのSELECTとRPCを検査します。本人票・内部送信記録・送信制限・集計表への直接DMLは許可しません。
6. Realtimeのpublicationへ **aggregate_snapshotsだけ** を登録します。ballotsやAuth情報は通知対象にしません。migrationはpublicationが存在する場合に集計表を追加します。通知障害時の30秒polling、画面復帰・手動更新を実環境でも確認します。
7. `.env.example` を参考に `VITE_SUPABASE_URL` と `VITE_SUPABASE_PUBLISHABLE_KEY` をビルド環境へ設定します。公開用publishableキー（互換用anonキーも可）だけを使います。service_role・secretキーをVITE変数やソースへ設定しません。
8. `npm run build` の `dist/` をHTTPSで配信します。画像は同一オリジンの `slime-fallback.webp` を使用します。独自ドメインのルート以外で配信する場合はViteのbaseと素材URLをそろえて再検証します。ルート配信を標準構成とします。

## 公開前のチェック

```sh
npm run typecheck
npm test
npm run test:db
npm run build
npx playwright test
python3 scripts/validate-docs.py
```

DB試験はローカル専用であり、テストごとに投票を初期化します。ブラウザ試験と同時に実行しません。ブラウザ試験の実投票シナリオは接続設定がないとskipになります。CIは実際のローカルAuth/DBを起動して接続し、skipで代用しません。

[公開前検証記録](qa/release-checks.md)と[3D記録](qa/slime-model.md)の未実施項目を確認します。実機iPhone Safariで縦横、文字拡大、低速回線、再読込、別タブ競合、画像保存後の再表示、共有取消を確認します。WebKitエミュレーションは実機Safariの代わりにはしません。画像共有が非対応ならPNG保存と投稿文コピーを使い、Xで画像を添付して本人が投稿を確定します。

CSPを使う場合は同一オリジンのscript/style/image、blob画像、対象Supabaseのhttps/wss接続を許可して検証します。Canvas内の外部画像は使いません。Authの保存領域が使えない場合はタブのメモリで続けます。恒久保存できないことをUIで案内します。

## 運用と版の変更

内容v1は20件・10軸・11判決・小説・計算式を一体として固定します。意味や式を変えるときは新しい版を追加し、クライアントとSQLの両方を更新します。旧票を新しい本文で計算したり、旧版の下書きを復元したりしません。誤字だけの変更は判断への影響を確認して同一PRに本文とデータを同期します。

集計は同一版の一行をロックして更新します。初期の20並行書込試験は実ユーザー容量保証ではありません。ロック待ち、RPC失敗率、匿名作成件数、DBサイズを監視し、必要になってから構造を変更します。個別投票や匿名IDを公開ログ・アクセス解析・画像へ流しません。

バックアップはプロジェクトの契約機能に合わせ、DBのスキーマ・票・集計・再送記録・Auth識別情報の整合を保つ方法で取得します。復旧試験は別の検証プロジェクトで実施し、有効票数と各件/判決分布の合計が一致することを確認します。Authを含まない回答だけの復元では編集権を復元できない点に注意してください。

受付を止める場合は、管理者が対象版の `content_versions.active` をfalseへ変更します。クライアントはVERSION_CHANGEDを表示し、途中回答を維持します。集計閲覧は続けられます。再開時は対応するクライアント・SQLの版を確認してactiveへ戻します。

前版へ戻す場合は、まず受付を停止し、動作確認済みの静的成果物へ切り替えます。データを破壊するdown migrationは行わず、現行スキーマが前版を扱えることを検証します。SQLの修正が必要なら追加migrationを作り、バックアップと検証を経て適用します。すでに更新された一票を古い値で黙って上書きする復旧方法は取りません。
