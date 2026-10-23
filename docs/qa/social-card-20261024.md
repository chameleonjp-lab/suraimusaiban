# サムネイル更新の確認記録

2026-10-24（日本時間）。対象：[public/social-card-v3.png](../../public/social-card-v3.png)。

## 依頼と変更内容

- 画像内の文字は「スライム裁判」だけ。旧画像の説明文2つを削除し、丸く太いポップな書体へ変更。
- 添付された正面・部位資料を基準に、丸い淡青紫の体、藍色の縦長の目、頭の渦、後ろへ流れる体、しずくを3Dイラストで表現。口や眉、手足を追加していない。
- 温かい中世風の法廷背景を保つ。SNS向けのタイトル情報も「スライム裁判」に統一し、画像の説明文を新しい内容に合わせた。

内蔵の画像生成機能で既存画像を編集し、生成したPNGを再加工せず保存した。Three.jsモデルそのもののレンダリングではなく、添付のキャラクターデザインを参照した3D表現の画像である。

## 画像の確認

生成画像の寸法は1733×908、RGB形式の不透明PNG、2,064,711 bytes。旧画像は1732×908だったため、共有用の幅情報と既存の公開成果物検証も1733へ合わせた。高さは同じ。mainとの統合時に、画像の内容を保ったままファイル名を `social-card-v3.png` へ変更し、先に公開された画像のキャッシュを避けた。OGP・Twitter画像URL、公開成果物検査、ブラウザ検査も同じファイル名と寸法へ統一した。

出力画像を目視し、6文字の表記、余計な文章がないこと、文字とスライムの見切れ、参照資料との対応を確認した。PNGの形式・寸法・容量、生成出力とのバイト一致、ビルド後のコピー、共有用情報との整合も確認した。

| 確認 | 結果 |
| --- | --- |
| `npm run build` | PASS。型検査と公開用ビルドが完了 |
| `npm run check:publication` | PASS。1733×908、正式URL、サブパス、公開版情報を確認 |
| `python3 scripts/validate-docs.py` | PASS。文書内リンク95件を含む既存検証が合格 |
| ビルド後の画像・共有用情報 | PASS。PNGのバイト一致、タイトル、幅・高さを別途照合 |
| `git diff --check` | PASS |

SHA-256：`3de1b5ca1c4e1801f3487b9673ca40c870b9defdc0aee0ed0b1840bfa9814aba`。

ローカルブラウザで390pxの縮小表示も試みたが、Playwrightのブラウザ実行ファイルが未導入だったため、この確認は未実施。実機でのSNS投稿・表示キャッシュの更新確認も今回のローカル検証に含まない。ゲームの処理とDBは変更していない。

## 使用した参照画像

- 編集対象：更新前の `public/social-card.png`。
- 主な造形基準：[正面寄り](../references/slime/slime-front.jpeg)。
- 部位・質感の基準：[多方向の資料](../references/slime/slime-reference-sheet.jpeg)。

## 画像生成時のプロンプト

方式：内蔵の画像生成機能（API/CLIへの切替なし）。以下を指定し、出力画像の実測寸法に合わせて共有用の情報を設定した。

```text
Use case: precise-object-edit / stylized-concept.
Asset: the browser game's existing social sharing thumbnail public/social-card.png.
Input image 1 is the edit target and the source for the warm fantasy medieval courtroom background and wide composition.
Input image 2 is the PRIMARY character design reference.
Input image 3 is the PRIMARY multi-view character detail reference.
Edit image 1 into a finished, playful, polished game thumbnail.

TEXT: The ONLY visible lettering anywhere in the finished image must be exactly the six Japanese characters 「スライム裁判」, spelled ス・ラ・イ・ム・裁・判, without quotation marks, punctuation or any additional words. Delete both existing lines of smaller text and their caption plaque. Replace the current formal serif title with large, thick, rounded, bouncy Japanese display lettering, like a charming premium casual fantasy game logo. Give the letters soft rounded corners, a clear deep indigo outline and light cream / very pale lavender faces with a restrained soft dimensional shadow. The kanji 裁判 must be correctly formed and easily readable. Make the title joyful and prominent at thumbnail size; it may wrap into two balanced lines if useful. No subtitle, tagline, numbers, English, URLs, watermark, or tiny decorative writing on books.

CHARACTER: Replace image 1's generic simplified slime with a fully three-dimensional anime-style rendering of the EXACT creature designed in images 2 and 3. Preserve their broad rounded jelly body, pale icy blue / lavender translucent material, soft flowing internal highlights, two dark indigo vertical oval eyes, NO mouth, NO eyebrows, NO limbs, the soft S-shaped fluid crest with inward curled tip, the flowing rounded side/rear tail folds, and three small floating fluid droplets belonging to the same creature. Match the original silhouette and proportions rather than keeping image 1's tall stiff ribbon crest and angular opaque body. The character must convincingly have volume, soft contact shadows, smooth glossy white highlight patches, lavender-blue rim lighting and subtle translucency; not a flat illustration, not an origami shape, not a photograph of a toy. Keep the entire head curl and body tail in frame. Neutral, adorable, inscrutable expression; no smile, horns, halo, wings, gavel held by the slime or additional characters.

COMPOSITION: Preserve the wide warm medieval courtroom setting from image 1: stone arches, sunlit windows, wooden courtroom furniture and indigo/gold drapery. Simplify areas behind the title to keep the rounded lettering readable. Retain the title on the left and the single large slime on the right, with balanced spacing and generous safe margins. The slime and title are the two focal points. No UI buttons, charts, panels or caption ribbons.
OUTPUT: exactly 1732 pixels wide by 908 pixels tall, same approximately 1.91:1 landscape aspect ratio as input image 1, full-bleed opaque PNG. No border. Only change the title typography/remove captions and replace the slime as described; maintain the overall background atmosphere.
```

