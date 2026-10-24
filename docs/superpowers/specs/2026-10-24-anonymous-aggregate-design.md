# 匿名・集計加算方式

ユーザーの指定は、固有名の登録と後日の見返しをなくし、その時の回答を匿名で集計に加える方式に変えること。対象はスライム裁判。共有Supabaseの別アプリのプロフィールや権限はこの変更で操作しない。

## 挙動

- Supabase Authを呼ばない。名前、参加者ID、個別回答、個人の履歴をDBに保存しない。
- 回答・現在の結果・送信中の要求はブラウザのメモリだけに置く。再読込、画面離脱、戻る操作、bfcache復帰から個別結果や下書きを復元しない。旧 `slime-trial:` 保存キーだけを消す。
- 同じ人が最初から回答し直して提出した分は新しい回答として加算する。表示は「回答数」「回答回数」とし、「人数」「同じ人の票の置換」「1人1票」と説明しない。
- 表示中の本人結果からX投稿・画像生成を行う。サイトに結果の再表示URLや履歴は作らない。
- 送信連打・通信応答喪失の再試行は同じrequest IDで処理し、24時間以内は同じ要求を再加算しない。回答を変更した別要求には新しいIDを使う。
- 閲覧用の公開集計は10回答ごとに更新する。公開前は「集計準備中」を表示し、内部の未公開分を件数・時刻・Realtime・送信応答から出さない。本人結果の比較も最後の公開集計と行う。

## 構成と境界

既存Vite/Three.jsとランキング用Supabaseを継続する。個人の保存をやめるため匿名Authをなくし、公開Edge Function `slime-trial-submit` が集計専用RPCを呼ぶ。公開キーは読取とゲートウェイ呼出に使う。管理キーはEdgeの環境にだけあり、ブラウザ・成果物・ログへ出さない。

検討した方式は、匿名Authのまま保存を短命化する方式と、Authなしの集計専用ゲートウェイ。後者はAuthアカウントを残さず、共有Authの設定変更も不要になるため採用する。ユーザー指定による方針決定であり、バッチ数と短期保持期間は実装上の選択。

- `public.slime_trial_content_versions`: 既存の本文/計算版。公開読取のみ。
- `public.slime_trial_aggregate_snapshots`: 10回答単位の公開スナップショット。匿名の読取とRealtimeだけ。
- `slime_trial_private.aggregate_totals`: 正確な内部集計のみ。個別回答・参加者IDを持たない。
- `slime_trial_private.request_receipts`: ランダムrequest UUIDと受付時刻のみ。24時間経過分を定期削除。回答の原文・回答ハッシュ・本人IDを持たない。
- `slime_trial_private.request_limits`: 時間で変わるネットワーク由来HMACキーと短期回数制限。生IPを保存しない。IP由来情報は長期識別子にしない。
- 旧個別票・旧送信履歴・旧本人別制限表と、旧提出RPCは廃止する。公開済みの集計数は維持する。共有Authのユーザーを削除しない。

## API契約

`POST /functions/v1/slime-trial-submit` の本文は `{version:"v1",requestId:UUID,answers:[{caseId,score}, ...20件]}` の3キーのみ。

成功は `{accepted:true,duplicate:boolean,snapshot:Snapshot}`。snapshotは最後に公開した集計であり、内部集計ではない。本人の結果をEdge/DBから返さず、ブラウザが今送った回答から算出する。

DB RPC `public.slime_trial_collect_response(p_version text,p_answers jsonb,p_request_id uuid,p_source_key text,p_previous_source_key text default null,p_next_source_key text default null)` はservice_roleだけ実行可能。内部のSECURITY DEFINER関数は非公開schema、固定search_path、完全修飾名で動かす。anon/authenticatedからの直接DML・旧RPC・内部表のSELECTは拒否する。Edgeは現在・前・次の時刻のHMACを渡し、時刻境界で到着順が逆転しても10分間の制限を引き継ぐ。

Edgeは8KB上限、厳密な本文形・20件・case ID・整数の許可値、Origin、公開キー、HTTP methodを検証する。生IP/回答/秘密キーをログへ書かない。ネットワークキーはサーバー秘密値から用途を分けたHMACで生成し、時間ごとに変える。転送ヘッダによる制限は最善努力であり本人認証ではない。集計RPCがネットワークごと30件/10分、全体120件/分の受付上限を原子的に適用する。重複再試行は受付数を増やさない。

CAPTCHAなしの匿名公開受付で1人1回の保証はしない。ネットワーク変更、ボット、集計バッチ内の推測、ホスティングの通常アクセスログのリスクは残る。短期の受付時刻からrequest UUIDとネットワークHMACを管理者が関連付けられる場合があるため、完全な追跡不能性は保証しない。アプリの個別回答・生IP・Authアカウントは保存しない。特に共有DBの既存の別アプリ権限問題は別途修正が必要。

## 検証と公開

再送・並行送信・不正入力・公開バッチの全経路・権限・短期記録削除を実DBで確認する。ブラウザではAuth呼出と永続保存がないこと、再読込後の復元なし、送信応答喪失後の二重計上なし、X/PNG、画面サイズと3Dの既存動作を確認する。

本番の個別票数を確認し、既存の集計を維持して移行する。移行とEdgeはこのゲームの専用オブジェクトだけを変更する。匿名Authが無効でも公開確認が通るように公開ジョブを変更する。PRの検証後にマージ・Pages配備し、公開SHAとサムネイル・公開集計・実送信ゲートの動作を確認する。
