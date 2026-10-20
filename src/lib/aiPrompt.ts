import { CATEGORIES, CATEGORY_DEFS } from './categories';
import { IMPORT_FORMAT, IMPORT_SCHEMA_VERSION } from './jsonImport';

// AI用依頼文とJSON仕様書は、どちらも categories.ts の定義から自動生成する。
// そのため、実装したスキーマと依頼文の内容が食い違わない。

function fieldList(): string {
  return CATEGORIES.map((c) => {
    const d = CATEGORY_DEFS[c];
    const fs = d.fields.filter((f) => !f.readonly);
    const lines = fs.length ? fs.map((f) => `    - ${f.key}：${f.label}${f.hint ? `（${f.hint}）` : ''}`).join('\n') : '    （専用項目なし。title と body を使う）';
    return `- "${c}" … ${d.label}\n  - title の意味：${d.titleLabel}\n  - status の候補：${d.statuses.join(' / ')}\n  - fields：\n${lines}`;
  }).join('\n');
}

export const SAMPLE_IMPORT = {
  format: IMPORT_FORMAT,
  schemaVersion: IMPORT_SCHEMA_VERSION,
  items: [
    {
      category: 'app',
      title: '創作アイデアガチャ',
      body: '',
      madeDate: null,
      tags: ['創作', 'ツール'],
      status: '公開済み',
      urls: [],
      fields: {
        purpose: 'ランダムに創作のお題を出すWebアプリ',
        publicUrl: 'https://example.com/idea-gacha/',
        githubUrl: 'https://github.com/example/idea-gacha',
        version: 'v1.0',
        features: 'ガチャ、履歴、コピー',
        todo: '',
      },
    },
    {
      category: 'oc',
      title: 'ミナ',
      body: '',
      madeDate: '2026-05-01',
      tags: ['和風ファンタジー'],
      status: '設定中',
      fields: {
        aliases: '書庫の番人',
        age: '24',
        gender: '女性',
        appearance: '銀髪、灰色の目',
        personality: '物静かで観察好き',
        background: '',
        world: '',
        profileFull: '',
      },
    },
  ],
};

export function buildAiPrompt(): string {
  return `次の情報を、にゅりログ（私の創作管理アプリ）に取り込めるJSONに変換してください。

# 出力ルール
- JSONだけを、コードブロック1つで出力してください。説明文は不要です。
- 一番外側は次の形にします：
  { "format": "${IMPORT_FORMAT}", "schemaVersion": ${IMPORT_SCHEMA_VERSION}, "items": [ … ] }
- items の各要素は1件の記録です。複数件をまとめて入れて構いません。
- 分からない項目は "" にするか、省略してください。推測で埋めないでください。
- 特に URL・日付は、私が書いた情報にあるものだけを入れてください。存在しそうなURLを作らないでください。
- 画像は含めないでください（取り込み後にアプリで追加します）。
- 文字列の中の改行は \\n で表してください。

# items の共通項目
- category（必須）："memo" / "app" / "lora" / "nai" / "oc" / "other" のどれか
- title：タイトル（カテゴリーによって意味が変わります。下記参照）
- body：本文・自由メモ
- madeDate：制作日・着想日。"YYYY-MM-DD" 形式。分からなければ null
- tags：タグの配列（例：["和風", "検証中"]）
- status：ステータス（カテゴリーごとの候補から選ぶ。分からなければ省略）
- favorite：お気に入りなら true
- urls：その他の関連URLの配列。[{ "label": "説明", "url": "https://…" }]
- fields：カテゴリー専用項目（下記のキー名をそのまま使う。値はすべて文字列）

# カテゴリーと fields のキー
${fieldList()}

# 出力例
\`\`\`json
${JSON.stringify(SAMPLE_IMPORT, null, 2)}
\`\`\`

# 変換してほしい情報
（ここに制作物の情報を貼ってください）
`;
}

export function buildJsonSpecMarkdown(): string {
  const tables = CATEGORIES.map((c) => {
    const d = CATEGORY_DEFS[c];
    const rows = d.fields.length
      ? d.fields.map((f) => `| \`${f.key}\` | ${f.label} | ${f.kind === 'url' ? 'URL（http/https）' : '文字列'}${f.readonly ? '（GitHubインポートで入る参考情報）' : ''} |`).join('\n')
      : '| （なし） | title と body を使う | |';
    return `### \`${c}\`：${d.label}\n\n- title の意味：${d.titleLabel}\n- status の候補：${d.statuses.join(' / ')}（既定：${d.defaultStatus}）\n\n| キー | 項目 | 型 |\n|---|---|---|\n${rows}\n`;
  }).join('\n');

  return `# にゅりログ JSONインポート仕様書（schemaVersion ${IMPORT_SCHEMA_VERSION}）

> このファイルは \`src/lib/categories.ts\` の定義から自動生成しています（\`npm run docs:json\`）。
> アプリ内「ChatGPT用の依頼文をコピー」も同じ定義から作られるため、両者の内容は一致します。

## 全体の形

\`\`\`json
{
  "format": "${IMPORT_FORMAT}",
  "schemaVersion": ${IMPORT_SCHEMA_VERSION},
  "items": [ { "category": "memo", "body": "…" } ]
}
\`\`\`

- \`format\` は必ず \`"${IMPORT_FORMAT}"\`。違う場合は取り込みません。
- \`schemaVersion\` は \`${IMPORT_SCHEMA_VERSION}\`。それ以外は取り込みません。
- \`items\` は1〜2000件の配列。
- 前後の説明文や \`\`\`json のコードフェンスは自動で取り除きます（AIの出力をそのまま貼れるように）。

## items の共通項目

| キー | 必須 | 型 | 説明 |
|---|---|---|---|
| \`category\` | ○ | 文字列 | \`memo\` / \`app\` / \`lora\` / \`nai\` / \`oc\` / \`other\`。表記ゆれ（\`webapp\`、\`メモ\` など）も一部受け付けます |
| \`title\` | | 文字列 | タイトル（カテゴリーで意味が変わる） |
| \`body\` | | 文字列 | 本文・自由メモ |
| \`madeDate\` | | 文字列 or null | 制作日・着想日（\`YYYY-MM-DD\`）。形式が違えば空欄にして警告 |
| \`tags\` | | 文字列の配列 | 重複は除去。カンマ区切りの文字列も可 |
| \`status\` | | 文字列 | 省略時はカテゴリーの既定値。候補外の値は警告付きで保持 |
| \`favorite\` | | 真偽値 | お気に入り |
| \`urls\` | | 配列 | \`[{ "label": "…", "url": "https://…" }]\`。文字列の配列も可。http/https 以外は取り込まない |
| \`fields\` | | オブジェクト | カテゴリー専用項目（下表）。値は文字列。数値・配列は文字列に変換 |

- \`title\`・\`body\`・\`fields\` のすべてが空の要素は「不正なデータ」として取り込みません。
- 欠けている項目は空欄として扱います。
- 上の表に無いキーは \`extra.importUnknown\` に、カテゴリーに無い \`fields\` のキーは \`fields\` にそのまま保持します（詳細画面の「その他の項目」に表示）。
- 画像は含めません。取り込み後にアプリで追加します。

## カテゴリー専用項目（fields）

${tables}
## 重複候補の判定

次のいずれかが既存の記録（ゴミ箱を除く）またはファイル内の他の要素と一致すると「重複候補」として表示し、初期状態では選択を外します。

- 同じカテゴリーで、タイトルが同じ（全角半角・大文字小文字・空白の違いは無視）
- \`fields.githubUrl\` が同じリポジトリを指す
- \`fields.publicUrl\` または \`fields.distributionUrl\` が同じ

## 取り込み時の安全策

- 取り込みは「追加」だけです。既存の記録を削除・上書きしません。
- 選択した全件を1回のトランザクションで登録し、途中で失敗した場合は1件も登録されません。

## サンプル

\`samples/import-sample.json\`（全カテゴリーを含む例）と \`samples/import-invalid-sample.json\`（エラー・警告の例）を参照してください。
`;
}
