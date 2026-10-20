# データ構造と保存方式

## 保存先

すべてのデータは端末のブラウザ内の **IndexedDB**（データベース名 `nyuri-log`）に保存します。ライブラリは Dexie 4 を使っています。サーバーには何も送りません。

## テーブル（object store）

| テーブル | キー | 索引 | 中身 |
|---|---|---|---|
| `records` | `id` | category, createdAt, updatedAt, source.githubRepoId | 記録（下記 RecordItem）。ゴミ箱の記録も `deletedAt` 付きでここにある |
| `history` | `id` | recordId, savedAt | 変更履歴。保存で上書きされる直前の記録を丸ごと保存（snapshot） |
| `images` | `id` | createdAt | 画像のメタ情報（形式・大きさ・SHA-256など） |
| `imageFull` | `id` | | 軽量化した画像本体（ArrayBuffer） |
| `imageThumb` | `id` | | 一覧用サムネイル（ArrayBuffer） |
| `imageOriginal` | `id` | | 元画像（設定でオンにした場合のみ） |
| `drafts` | `key` | | 編集途中の下書き（`edit:<記録ID>`、`new:<カテゴリー>`、`quick-memo`） |
| `meta` | `key` | | `settings`（設定）、`state`（バックアップ日時・変更件数など） |

画像本体を記録から分けているのは、一覧表示でサムネイルだけを読み、全画像を同時にフル解像度で読み込まないためです。

## RecordItem（全カテゴリー共通）

```ts
{
  id: string;              // UUID
  category: 'memo' | 'app' | 'lora' | 'nai' | 'oc' | 'other';
  title: string;           // 空ならメモ本文の先頭から仮タイトル
  body: string;            // 本文・自由メモ
  madeDate: string | null; // 制作日・着想日 YYYY-MM-DD。不明なら null（自動補完しない）
  createdAt: number;       // 登録日時（ミリ秒）
  updatedAt: number;       // 最終更新日時（保存ごとに必ず増える）
  tags: string[];
  status: string;          // '' は未設定
  favorite: boolean;
  urls: { label: string; url: string }[];       // 関連URL
  images: { id: string; caption: string }[];    // 画像参照（並び順を保持）
  coverImageId: string | null;                  // 代表画像
  fields: Record<string, string>;               // カテゴリー専用項目
  source: { type: 'github' | 'json' | 'backup'; githubRepoId?: number; githubFullName?: string; importedAt?: number } | null;
  links: { type: string; targetId: string }[];  // 将来用（OCと使用LoRAの紐づけ、相互リンクなど）
  extra: Record<string, unknown>;               // インポート時の不明項目など
  deletedAt: number | null;                     // ゴミ箱に入れた日時
  rev: number;                                  // 保存回数
}
```

カテゴリー専用項目のキーは `src/lib/categories.ts` で定義しています（一覧は [json-import-spec.md](json-import-spec.md)）。

### カテゴリー変更

`fields` はカテゴリーを変えても消しません。今のカテゴリーに無い項目は編集画面では隠れますが、データとしては残り、詳細画面の「その他の項目」に表示されます。ステータスが新しいカテゴリーの候補に無い場合は既定値にし、元の値は `extra.previousStatus` に残します。

## 保存の流れ

1. 編集中は0.7秒ごと＋画面を離れる瞬間に `drafts` へ下書きを保存
2. 「保存」で1つのトランザクションを開き、
   - 既存の記録と比べて内容が変わっていれば、上書き前の記録を `history` に追加
   - 履歴が上限（既定20版）を超えたら古い版から削除
   - `records` に書き込み、`meta.state.changesSinceBackup` を1増やす
3. トランザクションが成功した時点で「保存しました」。失敗したら何も書き込まれず、入力は画面に残り「再試行」できる
4. 成功後に下書きを削除

容量不足（QuotaExceededError）などの例外は `src/db/errors.ts` で利用者向けの文に変換します。

## 画像の参照管理

画像は記録・履歴・下書きの3か所から参照されます。**どこか1か所でも参照していれば消しません。**

- 編集で画像を外す → 履歴の版が参照しているので残る → 履歴から戻すと画像も戻る
- 完全削除・履歴の整理 → そのとき外れた画像のうち、どこからも参照されなくなったものを即時削除
- 編集を中断して残った画像 → 起動時に、作成から24時間以上たった孤立画像だけを削除

同じ画像を複数の版で共有するため、履歴のたびに画像を複製することはありません。

## 画像の軽量化

| 項目 | 既定値（設定で変更可） |
|---|---|
| 保存用画像の長辺 | 1600px（拡大はしない） |
| 圧縮品質 | 0.82 |
| サムネイルの長辺 | 360px |
| 形式 | 透過あり → WebP（書き出せなければPNG）／透過なし → JPEG |
| 元画像 | 保存しない（オンにすると容量が数倍〜10倍） |

EXIFの向きは読み込み時に反映し、再エンコードでメタデータ（位置情報など）は残りません。

## スキーマの版と移行

- `DB_SCHEMA_VERSION = 1`（`src/db/db.ts`）
- 構造を変えるときは `this.version(2).stores({...}).upgrade(...)` を**追加**し、既存の `version(1)` は消さない
- `upgrade()` では項目の補完・変換だけを行い、データを削除しない
- テスト `tests/repo.test.ts` の「DBスキーマの更新」で、新しい版で開き直しても既存データが残ることを確認しています

## バックアップZIPの形式

| ファイル | 内容 |
|---|---|
| `manifest.json` | `format: "nyuri-log-backup"`、`formatVersion: 1`、`dbSchemaVersion`、作成日時、`backupId`、分割番号、件数、**各ファイルのSHA-256とサイズ** |
| `records.json` | `{ records: RecordItem[], history: HistoryEntry[] }`（ゴミ箱の記録も含む） |
| `images.json` | 全画像のメタ情報 |
| `settings.json` | 設定 |
| `images/<id>.full.jpg` など | 軽量化画像・サムネイル・元画像（あれば） |

分割バックアップでは、`records.json`・`images.json`・`settings.json` を全パートに入れ、画像だけを振り分けます。どのパートからでも記録は復元でき、残りのパートを後から追加復元すると画像がそろいます。

復元時は、ZIPとして読めるか → `manifest.json` の形式 → 形式の版 → 全ファイルのチェックサム → 各JSONのスキーマ、の順に検査し、1つでも合わなければ何も書き込みません。
