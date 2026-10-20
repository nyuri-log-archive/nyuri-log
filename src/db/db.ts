import Dexie, { type Table } from 'dexie';
import type { Draft, HistoryEntry, ImageData, ImageMeta, RecordItem, SettingRow } from './types';

export const DB_NAME = 'nyuri-log';
/**
 * データベースのスキーマ版。
 * 構造を変えるときは version(n+1) を「追加」し、既存の version 定義は消さない。
 * upgrade() では既存データを変換・補完するだけにし、削除はしない（非破壊移行）。
 */
export const DB_SCHEMA_VERSION = 1;

export class NyuriDB extends Dexie {
  records!: Table<RecordItem, string>;
  history!: Table<HistoryEntry, string>;
  images!: Table<ImageMeta, string>;
  imageFull!: Table<ImageData, string>;
  imageThumb!: Table<ImageData, string>;
  imageOriginal!: Table<ImageData, string>;
  drafts!: Table<Draft, string>;
  meta!: Table<SettingRow, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      records: 'id, category, createdAt, updatedAt, source.githubRepoId',
      history: 'id, recordId, savedAt',
      images: 'id, createdAt',
      imageFull: 'id',
      imageThumb: 'id',
      imageOriginal: 'id',
      drafts: 'key',
      meta: 'key',
    });
  }
}

let current: NyuriDB | null = null;

export function getDB(): NyuriDB {
  if (!current) current = new NyuriDB();
  return current;
}

/** テスト用：DBを差し替える */
export function setDB(db: NyuriDB | null) {
  current = db;
}

export const ALL_TABLES = ['records', 'history', 'images', 'imageFull', 'imageThumb', 'imageOriginal', 'drafts', 'meta'] as const;
