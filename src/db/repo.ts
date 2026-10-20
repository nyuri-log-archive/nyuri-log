import { getDB } from './db';
import { toStorageError } from './errors';
import {
  DEFAULT_SETTINGS,
  DEFAULT_STATE,
  type AppSettings,
  type AppState,
  type HistoryEntry,
  type ImageCrop,
  type ImageMeta,
  type ImageRef,
  type RecordItem,
} from './types';
import { CATEGORY_DEFS, type Category } from '../lib/categories';
import { isValidCropRef, normalizeRect } from '../lib/crop';
import { autoTitle, uniqueTags, uuid } from '../lib/util';

// ---------- 記録の生成 ----------

export function newRecord(category: Category, partial: Partial<RecordItem> = {}): RecordItem {
  const now = Date.now();
  return {
    id: uuid(),
    category,
    title: '',
    body: '',
    madeDate: null,
    createdAt: now,
    updatedAt: now,
    tags: [],
    status: CATEGORY_DEFS[category].defaultStatus,
    favorite: false,
    urls: [],
    images: [],
    coverImageId: null,
    fields: {},
    source: null,
    links: [],
    extra: {},
    deletedAt: null,
    rev: 0,
    ...partial,
  };
}

/** 保存前の整形（タグの重複除去、空URL除去、代表画像の整合など） */
export function normalizeRecord(r: RecordItem): RecordItem {
  const images = r.images
    .filter((im, i, arr) => im && im.id && arr.findIndex((x) => x.id === im.id) === i)
    .map((im) => {
      // 不正なトリミング情報は捨てて、従来のサムネイル表示に戻す（画像そのものは残す）
      if (im.crop === undefined) return im;
      const { crop, ...rest } = im;
      return isValidCropRef(crop) ? { ...rest, crop: { ...crop, ...normalizeRect(crop) } } : rest;
    });
  const cover = r.coverImageId && images.some((im) => im.id === r.coverImageId) ? r.coverImageId : images[0]?.id ?? null;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.fields ?? {})) {
    if (v === undefined || v === null) continue;
    fields[k] = typeof v === 'string' ? v : String(v);
  }
  let title = r.title.trim();
  if (!title && r.body.trim()) title = autoTitle(r.body);
  return {
    ...r,
    title,
    tags: uniqueTags(r.tags),
    urls: r.urls.filter((u) => u.url.trim() || u.label.trim()).map((u) => ({ label: u.label.trim(), url: u.url.trim() })),
    images,
    coverImageId: cover,
    fields,
    links: r.links ?? [],
    extra: r.extra ?? {},
  };
}

/** 履歴に残すべき「意味のある変更」かどうか */
function contentKey(r: RecordItem): string {
  const { updatedAt: _u, rev: _r, deletedAt: _d, ...rest } = r;
  return JSON.stringify(rest);
}

export function hasMeaningfulChange(a: RecordItem, b: RecordItem): boolean {
  return contentKey(a) !== contentKey(b);
}

// ---------- 設定・状態 ----------

export async function getSettings(): Promise<AppSettings> {
  const row = await getDB().meta.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = getDB();
  try {
    return await db.transaction('rw', db.meta, async () => {
      const cur = await getSettings();
      const next = { ...cur, ...patch };
      await db.meta.put({ key: 'settings', value: next });
      return next;
    });
  } catch (e) {
    throw toStorageError(e, '設定を保存');
  }
}

export async function getState(): Promise<AppState> {
  const row = await getDB().meta.get('state');
  return { ...DEFAULT_STATE, ...((row?.value as Partial<AppState>) ?? {}) };
}

export async function updateState(patch: Partial<AppState>): Promise<AppState> {
  const db = getDB();
  try {
    return await db.transaction('rw', db.meta, async () => {
      const cur = await getState();
      const next = { ...cur, ...patch };
      await db.meta.put({ key: 'state', value: next });
      return next;
    });
  } catch (e) {
    throw toStorageError(e, '状態を保存');
  }
}

async function bumpChangeCounter(n = 1) {
  const db = getDB();
  const cur = await getState();
  await db.meta.put({ key: 'state', value: { ...cur, changesSinceBackup: cur.changesSinceBackup + n } });
}

// ---------- 保存・履歴 ----------

export interface SaveOptions {
  reason?: HistoryEntry['reason'];
  /** 履歴を残さない（新規作成時など） */
  skipHistory?: boolean;
}

/**
 * 記録を保存する。IndexedDBのトランザクションが成功した時点で完了とみなす。
 * 既存の記録を上書きする場合は、上書き前の版を履歴に残す（1回の保存＝1版）。
 */
export async function saveRecord(input: RecordItem, opts: SaveOptions = {}): Promise<RecordItem> {
  const db = getDB();
  const settings = await getSettings();
  let prunedImageIds: string[] = [];
  let saved: RecordItem;
  try {
    saved = await db.transaction('rw', [db.records, db.history, db.meta], async () => {
      const prev = await db.records.get(input.id);
      // 同じミリ秒に連続保存しても版の前後が崩れないよう、更新日時は必ず増やす
      const now = Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1);
      const next = normalizeRecord({
        ...input,
        createdAt: prev?.createdAt ?? input.createdAt ?? now,
        updatedAt: now,
        rev: (prev?.rev ?? 0) + 1,
      });
      if (prev && !hasMeaningfulChange(prev, next) && prev.deletedAt === next.deletedAt) {
        return prev; // 変更なし：版を増やさない
      }
      if (prev && !opts.skipHistory) {
        await db.history.add({
          id: uuid(),
          recordId: prev.id,
          savedAt: prev.updatedAt,
          reason: opts.reason ?? (prev.category !== next.category ? 'category-change' : 'edit'),
          snapshot: prev,
        });
        prunedImageIds = await pruneHistory(prev.id, settings.historyLimit);
      }
      await db.records.put(next);
      await bumpChangeCounter();
      return next;
    });
  } catch (e) {
    throw toStorageError(e, '保存');
  }
  if (prunedImageIds.length) await gcImages({ candidates: prunedImageIds }).catch(() => undefined);
  return saved;
}

/** 古い履歴を削除し、削除した版が参照していた画像IDを返す（実際の画像削除はGCが判断） */
async function pruneHistory(recordId: string, limit: number): Promise<string[]> {
  const db = getDB();
  const all = await db.history.where('recordId').equals(recordId).sortBy('savedAt');
  const excess = all.length - Math.max(1, limit);
  if (excess <= 0) return [];
  const remove = all.slice(0, excess);
  await db.history.bulkDelete(remove.map((h) => h.id));
  return remove.flatMap((h) => imageRefIds(h.snapshot.images));
}

export async function listHistory(recordId: string): Promise<HistoryEntry[]> {
  const list = await getDB().history.where('recordId').equals(recordId).sortBy('savedAt');
  return list.reverse();
}

/** 以前の版を現在の内容として復元する（現在の内容も履歴に残す） */
export async function restoreVersion(historyId: string): Promise<RecordItem> {
  const db = getDB();
  const h = await db.history.get(historyId);
  if (!h) throw new Error('指定した履歴が見つかりません。');
  const cur = await db.records.get(h.recordId);
  const base = cur ?? h.snapshot;
  const restored: RecordItem = {
    ...h.snapshot,
    id: base.id,
    createdAt: base.createdAt,
    deletedAt: cur ? cur.deletedAt : null,
  };
  if (!cur) {
    return saveRecord(restored, { skipHistory: true });
  }
  return saveRecord(restored, { reason: 'restore' });
}

// ---------- ゴミ箱 ----------

export async function moveToTrash(id: string): Promise<void> {
  const db = getDB();
  try {
    await db.transaction('rw', [db.records, db.meta], async () => {
      const r = await db.records.get(id);
      if (!r) throw new Error('記録が見つかりません。');
      if (r.deletedAt) return;
      await db.records.put({ ...r, deletedAt: Date.now() });
      await bumpChangeCounter();
    });
  } catch (e) {
    throw toStorageError(e, 'ゴミ箱へ移動');
  }
}

export async function restoreFromTrash(id: string): Promise<void> {
  const db = getDB();
  try {
    await db.transaction('rw', [db.records, db.meta], async () => {
      const r = await db.records.get(id);
      if (!r) throw new Error('記録が見つかりません。');
      await db.records.put({ ...r, deletedAt: null });
      await bumpChangeCounter();
    });
  } catch (e) {
    throw toStorageError(e, '復元');
  }
}

/** 完全削除（記録・その履歴・どこからも参照されなくなった画像） */
export async function deletePermanently(ids: string[]): Promise<void> {
  const db = getDB();
  let candidates: string[] = [];
  try {
    await db.transaction('rw', [db.records, db.history, db.meta], async () => {
      for (const id of ids) {
        const r = await db.records.get(id);
        if (!r) continue;
        if (!r.deletedAt) throw new Error('ゴミ箱に入っていない記録は完全削除できません。');
        const hs = await db.history.where('recordId').equals(id).toArray();
        candidates.push(...imageRefIds(r.images), ...hs.flatMap((h) => imageRefIds(h.snapshot.images)));
        await db.history.bulkDelete(hs.map((h) => h.id));
        await db.records.delete(id);
      }
      await bumpChangeCounter(ids.length);
    });
  } catch (e) {
    throw toStorageError(e, '完全削除');
  }
  candidates = [...new Set(candidates)];
  if (candidates.length) await gcImages({ candidates });
}

export async function emptyTrash(): Promise<number> {
  const trashed = (await getDB().records.toArray()).filter((r) => r.deletedAt);
  await deletePermanently(trashed.map((r) => r.id));
  return trashed.length;
}

// ---------- 画像の参照管理 ----------

/** 画像参照から、画像IDと切り抜きサムネイルIDをすべて取り出す */
export function imageRefIds(images: ImageRef[] | undefined | null): string[] {
  const out: string[] = [];
  for (const i of images ?? []) {
    if (!i?.id) continue;
    out.push(i.id);
    if (i.crop?.id) out.push(i.crop.id);
  }
  return out;
}

/** いずれかの記録・履歴・下書きから参照されている画像ID・切り抜きサムネイルID */
export async function referencedImageIds(): Promise<Set<string>> {
  const db = getDB();
  const set = new Set<string>();
  const add = (images: ImageRef[] | undefined | null) => imageRefIds(images).forEach((id) => set.add(id));
  await db.records.each((r) => add(r.images));
  await db.history.each((h) => add(h.snapshot.images));
  await db.drafts.each((d) => {
    const f = d.form as { record?: { images?: ImageRef[] } } | null;
    add(f?.record?.images);
  });
  return set;
}

export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * 参照されていない画像・切り抜きサムネイルを消す。
 * - candidates を指定した場合：その中で参照が無くなったものだけ消す
 * - 指定しない場合：作成から24時間以上たった孤立データだけ消す（編集途中のデータを守るため）
 * 元画像を消すときは、その画像から作った切り抜きサムネイルも一緒に消す。
 */
export async function gcImages(opts: { candidates?: string[]; now?: number } = {}): Promise<number> {
  const db = getDB();
  try {
    return await db.transaction(
      'rw',
      [db.records, db.history, db.drafts, db.images, db.imageFull, db.imageThumb, db.imageOriginal, db.imageCrop],
      async () => {
        const refs = await referencedImageIds();
        let imageTargets: string[];
        let cropTargets: string[];
        if (opts.candidates) {
          const unref = [...new Set(opts.candidates)].filter((id) => !refs.has(id));
          const imgSet = new Set(await db.images.where('id').anyOf(unref).primaryKeys());
          imageTargets = unref.filter((id) => imgSet.has(id));
          cropTargets = unref.filter((id) => !imgSet.has(id));
        } else {
          const now = opts.now ?? Date.now();
          const metas = await db.images.toArray();
          imageTargets = metas.filter((m) => !refs.has(m.id) && now - m.createdAt > ORPHAN_GRACE_MS).map((m) => m.id);
          const crops = await db.imageCrop.toCollection().toArray();
          cropTargets = crops.filter((c) => !refs.has(c.id) && now - c.createdAt > ORPHAN_GRACE_MS).map((c) => c.id);
        }
        if (imageTargets.length) {
          const derived = await db.imageCrop.where('sourceId').anyOf(imageTargets).primaryKeys();
          cropTargets.push(...derived.filter((id) => !refs.has(id)));
          await db.images.bulkDelete(imageTargets);
          await db.imageFull.bulkDelete(imageTargets);
          await db.imageThumb.bulkDelete(imageTargets);
          await db.imageOriginal.bulkDelete(imageTargets);
        }
        cropTargets = [...new Set(cropTargets)];
        if (cropTargets.length) await db.imageCrop.bulkDelete(cropTargets);
        return imageTargets.length + cropTargets.length;
      },
    );
  } catch (e) {
    throw toStorageError(e, '画像の整理');
  }
}

export interface StoredImageInput {
  meta: ImageMeta;
  full: ArrayBuffer;
  thumb: ArrayBuffer;
  original?: ArrayBuffer | null;
}

export async function putImage(input: StoredImageInput): Promise<void> {
  const db = getDB();
  try {
    await db.transaction('rw', [db.images, db.imageFull, db.imageThumb, db.imageOriginal], async () => {
      await db.images.put(input.meta);
      await db.imageFull.put({ id: input.meta.id, data: input.full });
      await db.imageThumb.put({ id: input.meta.id, data: input.thumb });
      if (input.original) await db.imageOriginal.put({ id: input.meta.id, data: input.original });
    });
  } catch (e) {
    throw toStorageError(e, '画像を保存');
  }
}

export async function getImageMeta(id: string) {
  return getDB().images.get(id);
}

export async function getImageBlob(id: string, kind: 'thumb' | 'full' | 'original'): Promise<Blob | null> {
  const db = getDB();
  const meta = await db.images.get(id);
  if (!meta) return null;
  const table = kind === 'thumb' ? db.imageThumb : kind === 'full' ? db.imageFull : db.imageOriginal;
  const row = await table.get(id);
  if (!row) return null;
  const mime = kind === 'thumb' ? meta.thumbMime : kind === 'full' ? meta.mime : meta.originalMime ?? 'application/octet-stream';
  return new Blob([row.data], { type: mime });
}

/** 切り抜きサムネイルを保存する（記録の保存とは別。記録を保存しなければ24時間後に整理される） */
export async function putCrop(crop: ImageCrop): Promise<void> {
  try {
    await getDB().imageCrop.put(crop);
  } catch (e) {
    throw toStorageError(e, 'サムネイルを保存');
  }
}

export async function getCropBlob(id: string): Promise<Blob | null> {
  const row = await getDB().imageCrop.get(id);
  return row ? new Blob([row.data], { type: row.mime }) : null;
}

/**
 * 一覧用のサムネイル。トリミングがあれば切り抜き版、無い・見つからなければ従来の縮小版。
 * （古いデータや、切り抜き版を含まないバックアップから復元したデータでも表示できる）
 */
export async function getListThumbBlob(ref: Pick<ImageRef, 'id' | 'crop'>): Promise<{ blob: Blob | null; cropped: boolean }> {
  if (ref.crop?.id) {
    const b = await getCropBlob(ref.crop.id);
    if (b) return { blob: b, cropped: true };
  }
  return { blob: await getImageBlob(ref.id, 'thumb'), cropped: false };
}

// ---------- 下書き ----------

export async function saveDraft(key: string, form: unknown): Promise<void> {
  try {
    await getDB().drafts.put({ key, savedAt: Date.now(), form });
  } catch (e) {
    throw toStorageError(e, '下書きを保存');
  }
}

export async function getDraft(key: string) {
  return getDB().drafts.get(key);
}

export async function deleteDraft(key: string) {
  await getDB().drafts.delete(key);
}

// ---------- 読み出し ----------

export async function getRecord(id: string) {
  return getDB().records.get(id);
}

export async function allRecords(): Promise<RecordItem[]> {
  return getDB().records.toArray();
}

/** カテゴリー変更（内容は保持し、ステータスだけ新カテゴリーに無い場合は既定値に） */
export function changeCategory(r: RecordItem, to: Category): RecordItem {
  if (r.category === to) return r;
  const def = CATEGORY_DEFS[to];
  const status = def.statuses.includes(r.status) || r.status === '' ? r.status : def.defaultStatus;
  return { ...r, category: to, status, extra: { ...r.extra, previousStatus: r.status !== status ? r.status : r.extra?.previousStatus } };
}
