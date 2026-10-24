# 接続・公開・復旧手順

2026-10-24の変更で、スライム裁判はAuthを使わない匿名回答の集計方式へ移行します。正式URLは `https://chameleonjp-lab.github.io/suraimusaiban/`、接続先はランキングと同じ `chameleonJP-Lab`（`mlpnjgezrnhdxsxolyzj`）です。公開用の接続情報とリリース識別子は `config/production.json`、SNS画像は `public/social-card-v3.png` にあります。

## 保存する情報

| 保存先 | 内容と公開範囲 |
| --- | --- |
| ブラウザのメモリ | 現在の20回答・結果・送信中の要求。移動・再読込・ページ離脱で破棄。永続保存・履歴復元なし。 |
| `public.slime_trial_content_versions` | 20件ID、計算式、判決境界、内容版、正式URL、受付状態。公開読取のみ。 |
| `slime_trial_private.aggregate_totals` | 回答数、合計点、20件の分布、10軸の合計、11判決の分布。正確な内部集計だけ。非公開。 |
| `public.slime_trial_aggregate_snapshots` | 10回答ごとに公開する集計。公開読取とRealtimeのみ。 |
| `slime_trial_private.request_receipts` | ランダムrequest UUID・受付時刻だけ。24時間経過分を定期削除。回答原文・回答ハッシュ・参加者IDなし。 |
| `slime_trial_private.request_limits` | 時間で変わるネットワークHMAC・全体の受付時刻。生IPなし。1時間以上更新されない行を定期削除。 |

個別回答表・以前の本人票の提出RPC・匿名ID・下書きの復元は廃止します。旧 `slime-trial:` 保存キーだけを起動時に消します。他のアプリの保存キーや共有Authユーザーは操作しません。利用者が明示的に保存したPNG・X投稿は利用者の管理となり、サイトに再表示用URLを作りません。

集計は人数ではなく回答回数です。同じ人が初めから回答し直すと別の回答として加算されます。同じrequest UUIDの再試行は24時間以内には二重加算しません。本人確認や1人1回答を保証する仕組みではありません。

## 送信経路と権限

ブラウザは公開Edge Function `slime-trial-submit` へ `{version,requestId,answers}` をPOSTします。Auth登録・セッション・JWTの取得は不要です。`Allow anonymous sign-ins` の有効化も不要です。

Edgeは公開キー・許可Origin・本文8KB上限・20件の入力を検証し、サーバーの秘密キーで `public.slime_trial_collect_response` を実行します。RPCの引数は版・回答・UUID・現在/前/次時刻のネットワークHMACです。service_roleだけが実行でき、anon/authenticatedは内部表・集計の直接DML・提出RPCを操作できません。管理キーをVITE変数・public.env・成果物へ置かないでください。

Edge環境はSupabase管理の `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_ANON_KEY`、`SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY` を使います。新しいsecretキーはapikeyへ、旧JWT型だけAuthorizationにも設定します。関数は `verify_jwt=false` とし、利用者のAuthを要求しません。公開キーとOriginは本人認証にはなりません。

許可Originは `https://chameleonjp-lab.github.io`。Edgeは末尾の転送アドレスから時間で変わるHMACを作り、生IP・回答・秘密キーをログへ出しません。RPCはネットワークごと30件/10分、全体120件/分を原子的に制限します。時刻境界では前・次のHMACも検査し、到着順が逆転した場合も制限を引き継ぎます。転送ヘッダの信頼はゲートウェイに依存し、ネットワーク変更やボットを完全には排除できません。

## 公開集計と残るリスク

正確な内部集計は公開せず、10回答が集まるごとに公開用スナップショットを更新します。提出RPCの返り値もこの公開版だけです。未公開分の件数・revision・日時を公開せず、結果画面は最後の公開集計との比較になります。最初の公開まで平均・割合・小説・比較画像を出しません。

10回答単位への変更は差分推測を減らしますが、完全な回答秘匿を保証しません。複数回答の作成や既知の回答との組合せで推測できる場合があります。また、非公開の短期記録の時刻からrequest UUIDとネットワークHMACを一時的に関連付けられる場合があり、完全な追跡不能性は保証しません。ホスティングの標準アクセスログはアプリDBとは別です。

共有DBの別アプリにある既存のアクセス権限の課題は、この移行の対象外です。別アプリのデータ移行とクライアント対応が必要であり、スライム裁判の名前登録や個別保存の廃止だけで解消するとは扱いません。

## 短期記録の削除

追加migrationは、Supabaseで利用できる `pg_cron` を有効化し、`slime-trial-anonymous-retention-v1` を5分間隔で登録します。処理は `slime_trial_private.cleanup_requests()` だけです。既存の他のジョブ・権限は変更しません。保存期間の目安は、受付記録24時間とジョブ間隔、制限記録の最終更新1時間とジョブ間隔です。

公開後は `cron.job` の対象ジョブのactiveと、`cron.job_run_details` の成功状況を確認します。ジョブが失敗すると短期記録が残るため、失敗率・匿名API呼出数・DB使用量と合わせて監視します。保守時には管理者が `select slime_trial_private.cleanup_requests();` を実行できます。pg_cronを削除すると他のジョブも消えるため、拡張全体を停止する復旧方法は使いません。

## ローカル起動と検証

Node.js24以上とDockerを使います。未接続の `npm run dev` は未送信プレビューです。実送信を検証する場合は次を実行します。

```sh
npm ci
node scripts/test-db-local.mjs start
node scripts/test-db-local.mjs migrate
npm run test:db
set -a
. /tmp/slime-trial-db/public.env
set +a
SLIME_DISABLE_HMR=1 npm run dev
```

ローカルはPostgreSQL・PostgREST・実際のEdgeハンドラを使うNodeゲートウェイです。Authサービスは起動しません。DB54322・REST54324・ゲートウェイ54321は127.0.0.1のみです。service JWTは `/tmp/slime-trial-db/server.json` にだけ置き、public.envには公開キーだけを書きます。試験は接続先がloopback以外なら書込を拒否します。ブラウザ試験とDB試験は同じ使い捨てDBを書き換えるため同時に実行しません。

```sh
npm run typecheck
npm test
npm run test:db
npm run build
npm run check:publication
npx playwright test
python3 scripts/validate-docs.py
node scripts/test-db-local.mjs stop
```

軽量なローカルDBにはpg_cronがないため定期ジョブの作成を省略し、削除関数を直接試験します。本番でのジョブ登録・実行は別途確認します。

## GitHub Pagesと自動反映

mainへのマージで `Verify slime trial` が成功すると、`Publish GitHub Pages` が検証したSHAを配備します。古いmainやPRのCIで公開を上書きしません。公開HTMLの `chameleonjp-commit` と `release.json` から配備SHAを確認できます。

公開前と公開後のブラウザ確認で、正式URL・サブパス・サムネイル・公開集計・送信ゲートの入力拒否・Auth呼出0件を検査します。この本番確認は回答を加算しません。SNS画像を差し替える際は画像URLも変更し、OGP/Twitterと公開成果物の検証を更新します。

今後のスキーマ変更は新しいmigrationを追加し、ローカル検証・レビュー後に対象だけを本番へ適用してからクライアントをマージします。本番で `db reset` は実行しません。受付停止は `public.slime_trial_content_versions.active=false` で行い、公開集計は残します。個別票に依存する旧版へのロールバックはできないため、旧票テーブルを復元するのではなく修正migrationで復旧します。
