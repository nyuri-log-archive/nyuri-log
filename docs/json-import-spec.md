# にゅりログ JSONインポート仕様書（schemaVersion 1）

> このファイルは `src/lib/categories.ts` の定義から自動生成しています（`npm run docs:json`）。
> アプリ内「ChatGPT用の依頼文をコピー」も同じ定義から作られるため、両者の内容は一致します。

## 全体の形

```json
{
  "format": "nyuri-log",
  "schemaVersion": 1,
  "items": [ { "category": "memo", "body": "…" } ]
}
```

- `format` は必ず `"nyuri-log"`。違う場合は取り込みません。
- `schemaVersion` は `1`。それ以外は取り込みません。
- `items` は1〜2000件の配列。
- 前後の説明文や ```json のコードフェンスは自動で取り除きます（AIの出力をそのまま貼れるように）。

## items の共通項目

| キー | 必須 | 型 | 説明 |
|---|---|---|---|
| `category` | ○ | 文字列 | `memo` / `app` / `lora` / `nai` / `oc` / `other`。表記ゆれ（`webapp`、`メモ` など）も一部受け付けます |
| `title` | | 文字列 | タイトル（カテゴリーで意味が変わる） |
| `body` | | 文字列 | 本文・自由メモ |
| `madeDate` | | 文字列 or null | 制作日・着想日（`YYYY-MM-DD`）。形式が違えば空欄にして警告 |
| `tags` | | 文字列の配列 | 重複は除去。カンマ区切りの文字列も可 |
| `status` | | 文字列 | 省略時はカテゴリーの既定値。候補外の値は警告付きで保持 |
| `favorite` | | 真偽値 | お気に入り |
| `urls` | | 配列 | `[{ "label": "…", "url": "https://…" }]`。文字列の配列も可。http/https 以外は取り込まない |
| `fields` | | オブジェクト | カテゴリー専用項目（下表）。値は文字列。数値・配列は文字列に変換 |

- `title`・`body`・`fields` のすべてが空の要素は「不正なデータ」として取り込みません。
- 欠けている項目は空欄として扱います。
- 上の表に無いキーは `extra.importUnknown` に、カテゴリーに無い `fields` のキーは `fields` にそのまま保持します（詳細画面の「その他の項目」に表示）。
- 画像は含めません。取り込み後にアプリで追加します。

## カテゴリー専用項目（fields）

### `memo`：思いつきメモ

- title の意味：タイトル
- status の候補：未整理 / 整理済み / 保留（既定：未整理）

| キー | 項目 | 型 |
|---|---|---|
| （なし） | title と body を使う | |

### `app`：Webアプリ

- title の意味：アプリ名
- status の候補：構想中 / 制作中 / 公開済み / 改修中 / 保留（既定：構想中）

| キー | 項目 | 型 |
|---|---|---|
| `purpose` | 説明・用途 | 文字列 |
| `publicUrl` | 公開URL | URL（http/https） |
| `githubUrl` | GitHub URL | URL（http/https） |
| `version` | バージョン | 文字列 |
| `features` | 主な機能 | 文字列 |
| `todo` | 改善予定・不具合メモ | 文字列 |
| `repoCreatedAt` | リポジトリ作成日（GitHub） | 文字列（GitHubインポートで入る参考情報） |
| `repoUpdatedAt` | リポジトリ最終更新日（GitHub） | 文字列（GitHubインポートで入る参考情報） |

### `lora`：LoRA

- title の意味：LoRA名
- status の候補：構想中 / 学習中 / 検証中 / 公開済み / 保留（既定：構想中）

| キー | 項目 | 型 |
|---|---|---|
| `baseModel` | 対応モデル | 文字列 |
| `triggerWords` | トリガーワード | 文字列 |
| `weight` | 推奨強度 | 文字列 |
| `trainingNotes` | 学習・設定メモ | 文字列 |
| `distributionUrl` | 公開・配布URL | URL（http/https） |
| `verification` | 検証結果・注意点 | 文字列 |

### `nai`：NAI画風・プロンプト

- title の意味：プロンプト名・画風名
- status の候補：実験中 / 完成 / 保留（既定：実験中）

| キー | 項目 | 型 |
|---|---|---|
| `model` | 使用モデル | 文字列 |
| `positivePrompt` | ポジティブプロンプト | 文字列 |
| `negativePrompt` | ネガティブプロンプト | 文字列 |
| `styleTags` | 追加画風タグ | 文字列 |
| `steps` | Steps | 文字列 |
| `cfg` | CFG（Guidance） | 文字列 |
| `sampler` | Sampler | 文字列 |
| `seed` | Seed | 文字列 |
| `otherSettings` | その他の生成設定 | 文字列 |
| `reproNotes` | 再現条件・実験メモ | 文字列 |

### `oc`：OC

- title の意味：キャラクター名
- status の候補：構想中 / 設定中 / 完成 / 保留（既定：構想中）

| キー | 項目 | 型 |
|---|---|---|
| `aliases` | 別名 | 文字列 |
| `age` | 年齢 | 文字列 |
| `gender` | 性別 | 文字列 |
| `appearance` | 外見 | 文字列 |
| `personality` | 性格 | 文字列 |
| `background` | 背景設定 | 文字列 |
| `world` | 世界観・所属 | 文字列 |
| `profileFull` | キャラクタープロフィール全文 | 文字列 |

### `other`：その他

- title の意味：タイトル
- status の候補：未整理 / 進行中 / 完了 / 保留（既定：未整理）

| キー | 項目 | 型 |
|---|---|---|
| （なし） | title と body を使う | |

## 重複候補の判定

次のいずれかが既存の記録（ゴミ箱を除く）またはファイル内の他の要素と一致すると「重複候補」として表示し、初期状態では選択を外します。

- 同じカテゴリーで、タイトルが同じ（全角半角・大文字小文字・空白の違いは無視）
- `fields.githubUrl` が同じリポジトリを指す
- `fields.publicUrl` または `fields.distributionUrl` が同じ

## 取り込み時の安全策

- 取り込みは「追加」だけです。既存の記録を削除・上書きしません。
- 選択した全件を1回のトランザクションで登録し、途中で失敗した場合は1件も登録されません。

## サンプル

`samples/import-sample.json`（全カテゴリーを含む例）と `samples/import-invalid-sample.json`（エラー・警告の例）を参照してください。
