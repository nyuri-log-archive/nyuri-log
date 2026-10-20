// カテゴリーと入力項目の定義。
// 登録フォーム・JSONインポートの検証・AI用依頼文・仕様書はすべてここを参照する（唯一の出典）。

export const CATEGORIES = ['memo', 'app', 'lora', 'nai', 'oc', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

export type FieldKind = 'text' | 'textarea' | 'prompt' | 'url' | 'number';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  /** ワンタップコピーのボタンを出す */
  copyable?: boolean;
  placeholder?: string;
  /** AI用依頼文に添える説明 */
  hint?: string;
  /** 設定画面などから自動で入る参考情報（フォームでは読み取り専用表示） */
  readonly?: boolean;
}

export interface CategoryDef {
  id: Category;
  label: string;
  shortLabel: string;
  /** タイトル欄の呼び名（アプリ名・LoRA名など） */
  titleLabel: string;
  /** 本文欄の呼び名 */
  bodyLabel: string;
  /** 日付欄の呼び名 */
  dateLabel: string;
  statuses: string[];
  defaultStatus: string;
  fields: FieldDef[];
  /** 画像欄の呼び名 */
  imageLabel: string;
  color: string;
  colorStrong: string;
  icon: string;
}

export const CATEGORY_DEFS: Record<Category, CategoryDef> = {
  memo: {
    id: 'memo',
    label: '思いつきメモ',
    shortLabel: 'メモ',
    titleLabel: 'タイトル',
    bodyLabel: 'メモ本文',
    dateLabel: '着想日',
    statuses: ['未整理', '整理済み', '保留'],
    defaultStatus: '未整理',
    fields: [],
    imageLabel: '画像',
    color: '#fff6c9',
    colorStrong: '#e8c75a',
    icon: 'memo',
  },
  app: {
    id: 'app',
    label: 'Webアプリ',
    shortLabel: 'アプリ',
    titleLabel: 'アプリ名',
    bodyLabel: '自由メモ',
    dateLabel: '制作日',
    statuses: ['構想中', '制作中', '公開済み', '改修中', '保留'],
    defaultStatus: '構想中',
    fields: [
      { key: 'purpose', label: '説明・用途', kind: 'textarea' },
      { key: 'publicUrl', label: '公開URL', kind: 'url', copyable: true, placeholder: 'https://' },
      { key: 'githubUrl', label: 'GitHub URL', kind: 'url', copyable: true, placeholder: 'https://github.com/…' },
      { key: 'version', label: 'バージョン', kind: 'text', placeholder: '例：v1.2.0' },
      { key: 'features', label: '主な機能', kind: 'textarea' },
      { key: 'todo', label: '改善予定・不具合メモ', kind: 'textarea' },
      { key: 'repoCreatedAt', label: 'リポジトリ作成日（GitHub）', kind: 'text', readonly: true, hint: '分かる場合のみ。制作日とは別' },
      { key: 'repoUpdatedAt', label: 'リポジトリ最終更新日（GitHub）', kind: 'text', readonly: true, hint: '分かる場合のみ' },
    ],
    imageLabel: 'スクリーンショット',
    color: '#dcebfb',
    colorStrong: '#6f9fd8',
    icon: 'app',
  },
  lora: {
    id: 'lora',
    label: 'LoRA',
    shortLabel: 'LoRA',
    titleLabel: 'LoRA名',
    bodyLabel: '自由メモ',
    dateLabel: '作成日',
    statuses: ['構想中', '学習中', '検証中', '公開済み', '保留'],
    defaultStatus: '構想中',
    fields: [
      { key: 'baseModel', label: '対応モデル', kind: 'text' },
      { key: 'triggerWords', label: 'トリガーワード', kind: 'prompt', copyable: true },
      { key: 'weight', label: '推奨強度', kind: 'text', placeholder: '例：0.6〜0.8' },
      { key: 'trainingNotes', label: '学習・設定メモ', kind: 'textarea' },
      { key: 'distributionUrl', label: '公開・配布URL', kind: 'url', copyable: true, placeholder: 'https://' },
      { key: 'verification', label: '検証結果・注意点', kind: 'textarea' },
    ],
    imageLabel: 'サンプル画像',
    color: '#ebe4fb',
    colorStrong: '#9b87d6',
    icon: 'lora',
  },
  nai: {
    id: 'nai',
    label: 'NAI画風・プロンプト',
    shortLabel: 'NAI',
    titleLabel: 'プロンプト名・画風名',
    bodyLabel: '自由メモ',
    dateLabel: '作成日',
    statuses: ['実験中', '完成', '保留'],
    defaultStatus: '実験中',
    fields: [
      { key: 'model', label: '使用モデル', kind: 'text' },
      { key: 'positivePrompt', label: 'ポジティブプロンプト', kind: 'prompt', copyable: true },
      { key: 'negativePrompt', label: 'ネガティブプロンプト', kind: 'prompt', copyable: true },
      { key: 'styleTags', label: '追加画風タグ', kind: 'prompt', copyable: true },
      { key: 'steps', label: 'Steps', kind: 'text' },
      { key: 'cfg', label: 'CFG（Guidance）', kind: 'text' },
      { key: 'sampler', label: 'Sampler', kind: 'text' },
      { key: 'seed', label: 'Seed', kind: 'text' },
      { key: 'otherSettings', label: 'その他の生成設定', kind: 'textarea' },
      { key: 'reproNotes', label: '再現条件・実験メモ', kind: 'textarea' },
    ],
    imageLabel: '生成画像',
    color: '#fde3ea',
    colorStrong: '#e48aa5',
    icon: 'nai',
  },
  oc: {
    id: 'oc',
    label: 'OC',
    shortLabel: 'OC',
    titleLabel: 'キャラクター名',
    bodyLabel: '自由メモ',
    dateLabel: '着想日',
    statuses: ['構想中', '設定中', '完成', '保留'],
    defaultStatus: '構想中',
    fields: [
      { key: 'aliases', label: '別名', kind: 'text' },
      { key: 'age', label: '年齢', kind: 'text' },
      { key: 'gender', label: '性別', kind: 'text' },
      { key: 'appearance', label: '外見', kind: 'textarea' },
      { key: 'personality', label: '性格', kind: 'textarea' },
      { key: 'background', label: '背景設定', kind: 'textarea' },
      { key: 'world', label: '世界観・所属', kind: 'textarea' },
      { key: 'profileFull', label: 'キャラクタープロフィール全文', kind: 'prompt', copyable: true },
    ],
    imageLabel: '立ち絵・表情差分・衣装差分',
    color: '#ddf1e2',
    colorStrong: '#6fb487',
    icon: 'oc',
  },
  other: {
    id: 'other',
    label: 'その他',
    shortLabel: 'その他',
    titleLabel: 'タイトル',
    bodyLabel: '本文・自由メモ',
    dateLabel: '制作日・着想日',
    statuses: ['未整理', '進行中', '完了', '保留'],
    defaultStatus: '未整理',
    fields: [],
    imageLabel: '画像',
    color: '#efece4',
    colorStrong: '#a59d89',
    icon: 'other',
  },
};

/** 下部タブに出すカテゴリー（その他はホーム内で管理） */
export const TAB_CATEGORIES: Category[] = ['memo', 'app', 'lora', 'nai', 'oc'];

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}

/** JSONインポートで受け付けるカテゴリーの別名（AIの揺れ対策） */
export const CATEGORY_ALIASES: Record<string, Category> = {
  memo: 'memo', note: 'memo', idea: 'memo', 'メモ': 'memo', '思いつきメモ': 'memo',
  app: 'app', webapp: 'app', 'web-app': 'app', web_app: 'app', 'webアプリ': 'app', 'アプリ': 'app',
  lora: 'lora',
  nai: 'nai', novelai: 'nai', prompt: 'nai', 'nai画風・プロンプト': 'nai',
  oc: 'oc', character: 'oc', 'キャラクター': 'oc',
  other: 'other', 'その他': 'other',
};

export function normalizeCategory(v: unknown): Category | null {
  if (typeof v !== 'string') return null;
  const k = v.trim().toLowerCase();
  return CATEGORY_ALIASES[k] ?? null;
}

/** OC画像の説明文の候補 */
export const IMAGE_CAPTION_PRESETS: Partial<Record<Category, string[]>> = {
  oc: ['立ち絵', '表情差分', '衣装差分'],
  app: ['トップ画面', '操作画面'],
  nai: ['生成例'],
  lora: ['サンプル'],
};

/** 項目キー → 表示名（他カテゴリーの項目を「その他の項目」として表示する時に使う） */
export function fieldLabel(key: string): string {
  for (const d of Object.values(CATEGORY_DEFS)) {
    const f = d.fields.find((x) => x.key === key);
    if (f) return `${f.label}（${d.shortLabel}）`;
  }
  return key;
}
