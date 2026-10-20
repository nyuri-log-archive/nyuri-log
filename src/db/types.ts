import type { Category } from '../lib/categories';
import type { CropAspect, CropRef } from '../lib/crop';

export interface ImageRef {
  id: string;
  caption: string;
  /** サムネイル用トリミング（v1.1〜）。無ければ従来の縮小サムネイルを使う */
  crop?: CropRef | null;
}

export interface LinkItem {
  label: string;
  url: string;
}

/** すべてのカテゴリー共通の記録データ */
export interface RecordItem {
  id: string; // UUID
  category: Category;
  title: string;
  body: string;
  /** 制作日・着想日（YYYY-MM-DD）。不明なら null。登録日などで自動補完しない */
  madeDate: string | null;
  createdAt: number; // 登録日時（ms）
  updatedAt: number; // 最終更新日時（ms）
  tags: string[];
  /** ステータス。'' は未設定 */
  status: string;
  favorite: boolean;
  urls: LinkItem[];
  /** 画像参照（並び順を保持）。画像本体は別テーブル */
  images: ImageRef[];
  coverImageId: string | null;
  /** カテゴリー専用データ。カテゴリーを変えても消さずに保持する */
  fields: Record<string, string>;
  /** 由来（GitHubインポートなど）。重複判定に使う */
  source: RecordSource | null;
  /** 将来拡張用の関連リンク（OCと使用LoRAなど）。v1.0では保存のみ */
  links: RecordLink[];
  /** インポート時の不明項目などを保持する */
  extra: Record<string, unknown>;
  deletedAt: number | null;
  /** 保存回数（楽観的な版番号） */
  rev: number;
}

export interface RecordSource {
  type: 'github' | 'json' | 'backup';
  githubRepoId?: number;
  githubFullName?: string;
  importedAt?: number;
}

export interface RecordLink {
  type: string; // 例：'uses-lora', 'related'
  targetId: string;
}

export interface HistoryEntry {
  id: string;
  recordId: string;
  /** この版が保存されていた時点（＝上書きされた時刻） */
  savedAt: number;
  reason: 'edit' | 'restore' | 'category-change' | 'import-merge';
  snapshot: RecordItem;
}

export interface ImageMeta {
  id: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  thumbMime: string;
  thumbSize: number;
  hasOriginal: boolean;
  originalMime: string | null;
  originalSize: number;
  originalName: string;
  createdAt: number;
  /** 内容のSHA-256（重複・整合性確認用） */
  sha256: string;
}

/** 切り抜き済みサムネイル。編集のたびに新しいIDで作り直す（履歴の版ごとに保持するため不変） */
export interface ImageCrop {
  id: string;
  /** 元画像（images テーブル）のID */
  sourceId: string;
  aspect: CropAspect;
  x: number;
  y: number;
  w: number;
  h: number;
  mime: string;
  width: number;
  height: number;
  size: number;
  createdAt: number;
  sha256: string;
  data: ArrayBuffer;
}

export interface ImageData {
  id: string;
  data: ArrayBuffer;
}

export interface Draft {
  key: string; // 'new' or record id
  savedAt: number;
  form: unknown;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface AppSettings {
  githubUser: string;
  imageMaxEdge: number;
  imageQuality: number;
  thumbMaxEdge: number;
  keepOriginal: boolean;
  historyLimit: number;
  reminderDays: number;
  reminderChanges: number;
  splitBackupMB: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  githubUser: 'nyuriwossan',
  imageMaxEdge: 1600,
  imageQuality: 0.82,
  thumbMaxEdge: 360,
  keepOriginal: false,
  historyLimit: 20,
  reminderDays: 7,
  reminderChanges: 10,
  splitBackupMB: 150,
};

/** 設定以外のアプリ内状態（バックアップ日時など） */
export interface AppState {
  lastBackupAt: number | null;
  lastBackupFile: string | null;
  /** 利用者が「ファイルアプリ等への保存を確認した」と押した日時（アプリ側では保管を確認できないため） */
  lastBackupConfirmedAt: number | null;
  changesSinceBackup: number;
  reminderSnoozedUntil: number | null;
  onboardingDone: boolean;
  persistRequested: boolean | null;
}

export const DEFAULT_STATE: AppState = {
  lastBackupAt: null,
  lastBackupFile: null,
  lastBackupConfirmedAt: null,
  changesSinceBackup: 0,
  reminderSnoozedUntil: null,
  onboardingDone: false,
  persistRequested: null,
};
