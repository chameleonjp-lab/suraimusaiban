# Xシェア・Supabase接続・自動公開

Goal: ホームと結果のX投稿を分け、SNSサムネイルを設定し、既存ランキング用Supabaseへ回答を保存してGitHub Pagesで公開する。

採用する構成は既存Vite/Three.jsとGitHub Pages。正式URLは既存Pages設定の `https://chameleonjp-lab.github.io/suraimusaiban/`。PR #2は既にマージ済みのため、mainから作った `feat/share-and-publish` で変更する。

- [x] ホームは紹介文、結果は判決名・合計点・ハッシュタグを含むX Web Intent。投稿リンクは正式URLに固定し、回答や匿名IDをURLへ出さない。
- [x] 完成スライムに基づくSNS画像を生成し、OGP・Twitterカード・日本語altをHTMLへ設定する。
- [x] サブディレクトリ配信に対応するbaseと素材URL、公開版の識別情報を設定する。
- [x] ランキングと同じSupabaseプロジェクト・publishable keyを利用する。共有private schemaに既存ゲームがあるため、裁判専用のschema/table/RPC名を使う。既存ランキングの権限を変更しない。
- [x] 20回答・本人票revision・送信識別子・送信時刻と、人数・件別分布・10軸合計・判決分布を原子的に保存する。本人票だけのSELECT、公開集計、再送/競合保護を維持する。
- [x] 単体、実DB、ブラウザ、サブパスbuild、サムネイルを検証する。
- [x] mainへのpushで検証後にPagesへ配備するActionsを追加する。PRでは検証を行い、マージ後に公開が更新される。
- [ ] 本番DBへ適用し、PRを作成・CI確認後にマージして配備する。公開URL・素材・メタデータ・実投票/集計と自動配備の対応SHAを確認する。

公開は今回の依頼で許可されている。Supabaseには他ゲームの稼働データがあるため、作成対象だけを追加し、共有Authの既存設定と公開キーを確認して進める。Xへの実際の投稿は利用者が確定する。

検証：型検査、単体84件、DB17件、Chromium27件、公開成果物検査が合格。本番DDL・集計読取・ロールバック付き送信/RLS検証済み。匿名Auth設定の有効化を待ち、公開はその後に行う。
