import { Zip, ZipDeflate, ZipPassThrough, unzipSync, strToU8, strFromU8 } from 'fflate';
import { z } from 'zod';
import { getDB, DB_SCHEMA_VERSION } from '../db/db';
import { toStorageError } from '../db/errors';
import { getSettings, getState, updateState } from '../db/repo';
import { DEFAULT_SETTINGS, type AppSettings, type HistoryEntry, type ImageCrop, type ImageMeta, type RecordItem } from '../db/types';
import { cropMetaSchema, historySchema, imageMetaSchema, recordSchema } from './schemas';
import { sha256Hex, uuid } from './util';

export const BACKUP_FORMAT = 'nyuri-log-backup';
/**
 * 形式の版。v1.1で crops.json と切り抜きサムネイルを「追加」したが、無ければ従来どおり読めるため版は上げない
 * （v1.0のアプリでも v1.1 のバックアップを復元でき、トリミング情報は無視されるだけ）。
 */
export const BACKUP_FORMAT_VERSION = 1;
export const APP_VERSION = '1.1.0';

export interface ManifestFileEntry {
  sha256: string;
  size: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  dbSchemaVersion: number;
  app: string;
  appVersion: string;
  createdAt: string;
  backupId: string;
  part: number;
  partCount: number;
  counts: {
    records: number;
    trashed: number;
    history: number;
    images: number;
    imagesInThisPart: number;
    /** v1.1〜 */
    crops?: number;
    cropsInThisPart?: number;
  };
  files: Record<string, ManifestFileEntry>;
}

export interface BackupPart {
  blob: Blob;
  filename: string;
  size: number;
  part: number;
  partCount: number;
}

function extOf(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/heic') return 'heic';
  return 'bin';
}

function imageEntryNames(m: ImageMeta) {
  return {
    full: `images/${m.id}.full.${extOf(m.mime)}`,
    thumb: `images/${m.id}.thumb.${extOf(m.thumbMime)}`,
    original: m.hasOriginal ? `images/${m.id}.orig.${extOf(m.originalMime ?? '')}` : null,
  };
}

function imageBytes(m: ImageMeta) {
  return m.size + m.thumbSize + (m.hasOriginal ? m.originalSize : 0);
}

function cropEntryName(c: Pick<ImageCrop, 'id' | 'mime'>) {
  return `images/${c.id}.crop.${extOf(c.mime)}`;
}

/** 切り抜きサムネイルの情報（画像本体を除く） */
export type CropMeta = Omit<ImageCrop, 'data'>;

/** 切り抜きサムネイルの一覧を、本体を保持せずに読む */
async function readCropMetas(): Promise<CropMeta[]> {
  const out: CropMeta[] = [];
  await getDB().imageCrop.each((c) => {
    const { data: _d, ...meta } = c;
    out.push(meta);
  });
  return out;
}

export interface BackupPlan {
  totalBytes: number;
  imageCount: number;
  recordCount: number;
  parts: string[][]; // パートごとの画像ID
  /** パートごとの切り抜きサムネイルID（元画像と同じパートに入れる） */
  cropParts: string[][];
  cropCount: number;
  partLimitBytes: number;
}

/** 推定サイズと分割案を作る（画像本体は読まない） */
export async function planBackup(partLimitMB?: number): Promise<BackupPlan> {
  const db = getDB();
  const settings = await getSettings();
  const limit = Math.max(20, partLimitMB ?? settings.splitBackupMB) * 1024 * 1024;
  const metas = await db.images.orderBy('createdAt').toArray();
  const recordCount = await db.records.count();
  const crops = await readCropMetas();
  const cropsBySource = new Map<string, CropMeta[]>();
  for (const c of crops) cropsBySource.set(c.sourceId, [...(cropsBySource.get(c.sourceId) ?? []), c]);
  const parts: string[][] = [[]];
  const cropParts: string[][] = [[]];
  let cur = 0;
  let total = 0;
  for (const m of metas) {
    const own = cropsBySource.get(m.id) ?? [];
    cropsBySource.delete(m.id);
    const b = imageBytes(m) + own.reduce((n, c) => n + c.size, 0);
    total += b;
    if (cur > 0 && cur + b > limit) {
      parts.push([]);
      cropParts.push([]);
      cur = 0;
    }
    parts[parts.length - 1].push(m.id);
    cropParts[cropParts.length - 1].push(...own.map((c) => c.id));
    cur += b;
  }
  // 元画像が無い切り抜き（通常は起きない）は最後のパートへ
  for (const rest of cropsBySource.values()) {
    for (const c of rest) {
      total += c.size;
      cropParts[cropParts.length - 1].push(c.id);
    }
  }
  return { totalBytes: total, imageCount: metas.length, recordCount, parts, cropParts, cropCount: crops.length, partLimitBytes: limit };
}

function zipToBlob(build: (zip: Zip) => Promise<void>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let failed = false;
    const zip = new Zip((err, chunk, final) => {
      if (failed) return;
      if (err) {
        failed = true;
        reject(err);
        return;
      }
      chunks.push(chunk);
      if (final) resolve(new Blob(chunks as BlobPart[], { type: 'application/zip' }));
    });
    build(zip)
      .then(() => zip.end())
      .catch((e) => {
        failed = true;
        try {
          zip.terminate();
        } catch {
          /* noop */
        }
        reject(e);
      });
  });
}

async function addFile(zip: Zip, files: Record<string, ManifestFileEntry>, name: string, data: Uint8Array, compress: boolean) {
  files[name] = { sha256: await sha256Hex(data), size: data.byteLength };
  const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
  zip.add(entry);
  entry.push(data, true);
}

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * バックアップZIPを作る。画像は1枚ずつDBから読み、パートごとにZIP化する（全画像を同時に読み込まない）。
 * 失敗時は例外を投げる。成功してもまだ「端末内に作っただけ」で、保管完了ではない。
 */
export async function createBackup(opts: { partLimitMB?: number; onProgress?: (msg: string) => void } = {}): Promise<BackupPart[]> {
  const db = getDB();
  const plan = await planBackup(opts.partLimitMB);
  const records = await db.records.toArray();
  const history = await db.history.toArray();
  const metas = await db.images.toArray();
  const metaById = new Map(metas.map((m) => [m.id, m]));
  const cropMetas = await readCropMetas();
  const settings = await getSettings();
  const state = await getState();
  const backupId = uuid();
  const created = new Date();
  const partCount = plan.parts.length;
  const out: BackupPart[] = [];

  const recordsJson = strToU8(JSON.stringify({ records, history }));
  const imagesJson = strToU8(JSON.stringify(metas));
  const cropsJson = strToU8(JSON.stringify(cropMetas));
  const settingsJson = strToU8(JSON.stringify({ settings, state: { lastBackupAt: state.lastBackupAt } }));

  for (let p = 0; p < partCount; p++) {
    const ids = plan.parts[p];
    const cropIds = plan.cropParts[p] ?? [];
    opts.onProgress?.(partCount > 1 ? `バックアップを作成中（${p + 1}/${partCount}）…` : 'バックアップを作成中…');
    const files: Record<string, ManifestFileEntry> = {};
    const blob = await zipToBlob(async (zip) => {
      await addFile(zip, files, 'records.json', recordsJson, true);
      await addFile(zip, files, 'images.json', imagesJson, true);
      await addFile(zip, files, 'settings.json', settingsJson, true);
      await addFile(zip, files, 'crops.json', cropsJson, true);
      for (const id of ids) {
        const m = metaById.get(id);
        if (!m) continue;
        const names = imageEntryNames(m);
        const full = await db.imageFull.get(id);
        const thumb = await db.imageThumb.get(id);
        if (!full || !thumb) throw new Error(`画像データが見つかりません（${id}）。データベースが破損している可能性があります。`);
        await addFile(zip, files, names.full, new Uint8Array(full.data), false);
        await addFile(zip, files, names.thumb, new Uint8Array(thumb.data), false);
        if (names.original) {
          const orig = await db.imageOriginal.get(id);
          if (orig) await addFile(zip, files, names.original, new Uint8Array(orig.data), false);
        }
      }
      for (const id of cropIds) {
        const c = await db.imageCrop.get(id);
        if (c) await addFile(zip, files, cropEntryName(c), new Uint8Array(c.data), false);
      }
      const manifest: BackupManifest = {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        dbSchemaVersion: DB_SCHEMA_VERSION,
        app: 'にゅりログ',
        appVersion: APP_VERSION,
        createdAt: created.toISOString(),
        backupId,
        part: p + 1,
        partCount,
        counts: {
          records: records.filter((r) => !r.deletedAt).length,
          trashed: records.filter((r) => r.deletedAt).length,
          history: history.length,
          images: metas.length,
          imagesInThisPart: ids.length,
          crops: cropMetas.length,
          cropsInThisPart: cropIds.length,
        },
        files,
      };
      // manifest 自身はチェックサム対象外（中身の一覧なので）
      const entry = new ZipDeflate('manifest.json', { level: 6 });
      zip.add(entry);
      entry.push(strToU8(JSON.stringify(manifest, null, 2)), true);
    });
    const suffix = partCount > 1 ? `_part${p + 1}of${partCount}` : '';
    out.push({ blob, filename: `nyuri-log-backup_${stamp(created)}${suffix}.zip`, size: blob.size, part: p + 1, partCount });
  }
  return out;
}

/** バックアップ作成の記録（生成した事実のみ。保管完了とは別） */
export async function markBackupCreated(filename: string) {
  await updateState({ lastBackupAt: Date.now(), lastBackupFile: filename, changesSinceBackup: 0, reminderSnoozedUntil: null });
}

// ---------- 共有・ダウンロード ----------

export type DeliverResult = 'shared' | 'downloaded' | 'cancelled';

export async function deliverFile(blob: Blob, filename: string): Promise<DeliverResult> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // 共有に失敗したらダウンロードに切り替える
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

// ---------- 復元 ----------

const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.number(),
  dbSchemaVersion: z.number(),
  createdAt: z.string(),
  backupId: z.string(),
  part: z.number(),
  partCount: z.number(),
  counts: z.object({ records: z.number(), trashed: z.number(), history: z.number(), images: z.number(), imagesInThisPart: z.number() }).passthrough(),
  files: z.record(z.string(), z.object({ sha256: z.string(), size: z.number() })),
});

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export interface ParsedBackup {
  fileName: string;
  manifest: BackupManifest;
  records: RecordItem[];
  history: HistoryEntry[];
  imageMetas: ImageMeta[];
  settings: AppSettings | null;
  /** このパートに含まれる画像データ */
  images: Map<string, { full: Uint8Array; thumb: Uint8Array; original: Uint8Array | null }>;
  /** このパートに含まれる切り抜きサムネイル（v1.1〜。古いバックアップでは空） */
  crops: Map<string, ImageCrop>;
}

/** ZIPを読み、形式・版・チェックサムを検査する。問題があれば BackupError */
export async function parseBackupZip(fileName: string, data: Uint8Array): Promise<ParsedBackup> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new BackupError(`${fileName}：ZIPとして読み込めませんでした。ファイルが壊れているか、ZIPではありません。`);
  }
  const mf = entries['manifest.json'];
  if (!mf) throw new BackupError(`${fileName}：にゅりログのバックアップではありません（manifest.json がありません）。`);
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(strFromU8(mf));
  } catch {
    throw new BackupError(`${fileName}：manifest.json が壊れています。`);
  }
  const parsedManifest = manifestSchema.safeParse(manifestRaw);
  if (!parsedManifest.success) throw new BackupError(`${fileName}：にゅりログのバックアップ形式ではありません。`);
  const manifest = manifestRaw as BackupManifest;
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError(`${fileName}：新しい版のにゅりログで作られたバックアップです（形式v${manifest.formatVersion}）。アプリを更新してから復元してください。`);
  }

  // チェックサム検査（一覧にある全ファイル）
  const bad: string[] = [];
  for (const [name, info] of Object.entries(manifest.files)) {
    const buf = entries[name];
    if (!buf) {
      bad.push(`${name}（ファイルがありません）`);
      continue;
    }
    if (buf.byteLength !== info.size || (await sha256Hex(buf)) !== info.sha256) bad.push(`${name}（内容が一致しません）`);
  }
  if (bad.length) {
    throw new BackupError(`${fileName}：整合性検査に失敗しました。${bad.slice(0, 5).join('、')}${bad.length > 5 ? ` ほか${bad.length - 5}件` : ''}`);
  }

  const readJson = (name: string): unknown => {
    if (!manifest.files[name] || !entries[name]) throw new BackupError(`${fileName}：${name} がありません。`);
    try {
      return JSON.parse(strFromU8(entries[name]));
    } catch {
      throw new BackupError(`${fileName}：${name} が壊れています。`);
    }
  };

  const rj = z.object({ records: z.array(z.unknown()), history: z.array(z.unknown()).catch([]) }).safeParse(readJson('records.json'));
  if (!rj.success) throw new BackupError(`${fileName}：records.json の形式が正しくありません。`);
  const records: RecordItem[] = [];
  const badRecords: string[] = [];
  for (const raw of rj.data.records) {
    const r = recordSchema.safeParse(raw);
    if (r.success) records.push(r.data as unknown as RecordItem);
    else badRecords.push((raw as { id?: string })?.id ?? '?');
  }
  if (badRecords.length) throw new BackupError(`${fileName}：形式が正しくない記録が${badRecords.length}件あります。`);
  const history: HistoryEntry[] = [];
  for (const raw of rj.data.history) {
    const h = historySchema.safeParse(raw);
    if (h.success) history.push(h.data as unknown as HistoryEntry);
  }

  const im = z.array(z.unknown()).safeParse(readJson('images.json'));
  if (!im.success) throw new BackupError(`${fileName}：images.json の形式が正しくありません。`);
  const imageMetas: ImageMeta[] = [];
  for (const raw of im.data) {
    const m = imageMetaSchema.safeParse(raw);
    if (!m.success) throw new BackupError(`${fileName}：画像情報の形式が正しくありません。`);
    imageMetas.push(m.data);
  }

  let settings: AppSettings | null = null;
  if (manifest.files['settings.json']) {
    const s = readJson('settings.json') as { settings?: Partial<AppSettings> };
    if (s && typeof s === 'object' && s.settings && typeof s.settings === 'object') settings = { ...DEFAULT_SETTINGS, ...s.settings };
  }

  const images: ParsedBackup['images'] = new Map();
  for (const m of imageMetas) {
    const names = imageEntryNames(m);
    if (manifest.files[names.full] && manifest.files[names.thumb]) {
      images.set(m.id, {
        full: entries[names.full],
        thumb: entries[names.thumb],
        original: names.original && manifest.files[names.original] ? entries[names.original] : null,
      });
    }
  }
  // 切り抜きサムネイル（v1.1〜）。無い・壊れている場合は従来のサムネイルで表示されるだけなので、復元は止めない
  const crops: ParsedBackup['crops'] = new Map();
  if (manifest.files['crops.json']) {
    const cj = z.array(z.unknown()).safeParse(readJson('crops.json'));
    if (cj.success) {
      for (const raw of cj.data) {
        const c = cropMetaSchema.safeParse(raw);
        if (!c.success) continue;
        const name = cropEntryName(c.data);
        if (!manifest.files[name] || !entries[name]) continue;
        crops.set(c.data.id, { ...c.data, data: toArrayBuffer(entries[name]) });
      }
    }
  }
  return { fileName, manifest, records, history, imageMetas, settings, images, crops };
}

export interface RestorePlan {
  backups: ParsedBackup[];
  backupId: string;
  createdAt: string;
  partsGiven: number[];
  partCount: number;
  records: RecordItem[];
  history: HistoryEntry[];
  imageMetas: ImageMeta[];
  settings: AppSettings | null;
  images: ParsedBackup['images'];
  newRecords: RecordItem[];
  duplicateRecords: { incoming: RecordItem; existing: RecordItem; same: boolean }[];
  newImages: string[];
  existingImages: string[];
  /** 記録から参照されているのに、選んだファイルにも端末にも無い画像 */
  missingImages: string[];
  crops: ParsedBackup['crops'];
  newCrops: string[];
  /** 見つからない切り抜きサムネイル（その画像は従来のサムネイルで表示される） */
  missingCrops: string[];
  trashedCount: number;
}

/** 複数パートをまとめて、既存データとの重複を調べる（DBには書かない） */
export async function buildRestorePlan(backups: ParsedBackup[]): Promise<RestorePlan> {
  if (!backups.length) throw new BackupError('バックアップファイルが選ばれていません。');
  const ids = new Set(backups.map((b) => b.manifest.backupId));
  if (ids.size > 1) throw new BackupError('別々のバックアップの分割ファイルが混ざっています。同じ日時のファイルだけを選んでください。');
  const first = backups[0];
  const parts = [...new Set(backups.map((b) => b.manifest.part))].sort((a, b) => a - b);
  const images: ParsedBackup['images'] = new Map();
  backups.forEach((b) => b.images.forEach((v, k) => images.set(k, v)));
  const crops: ParsedBackup['crops'] = new Map();
  backups.forEach((b) => b.crops.forEach((v, k) => crops.set(k, v)));

  const db = getDB();
  const existingRecords = new Map((await db.records.toArray()).map((r) => [r.id, r]));
  const existingImageIds = new Set(await db.images.toCollection().primaryKeys());
  const existingCropIds = new Set(await db.imageCrop.toCollection().primaryKeys());

  const newRecords: RecordItem[] = [];
  const duplicateRecords: RestorePlan['duplicateRecords'] = [];
  for (const r of first.records) {
    const ex = existingRecords.get(r.id);
    if (ex) duplicateRecords.push({ incoming: r, existing: ex, same: JSON.stringify({ ...ex, rev: 0 }) === JSON.stringify({ ...r, rev: 0 }) });
    else newRecords.push(r);
  }
  const referenced = new Set<string>();
  first.records.forEach((r) => r.images.forEach((i) => referenced.add(i.id)));
  first.history.forEach((h) => h.snapshot.images.forEach((i) => referenced.add(i.id)));
  const newImages = [...images.keys()].filter((id) => !existingImageIds.has(id));
  const existingImages = [...images.keys()].filter((id) => existingImageIds.has(id));
  const missingImages = [...referenced].filter((id) => !images.has(id) && !existingImageIds.has(id));
  const referencedCrops = new Set<string>();
  const addCrops = (list: RecordItem['images']) => list.forEach((i) => i.crop?.id && referencedCrops.add(i.crop.id));
  first.records.forEach((r) => addCrops(r.images));
  first.history.forEach((h) => addCrops(h.snapshot.images));
  const newCrops = [...crops.keys()].filter((id) => !existingCropIds.has(id));
  const missingCrops = [...referencedCrops].filter((id) => !crops.has(id) && !existingCropIds.has(id));

  return {
    backups,
    backupId: first.manifest.backupId,
    createdAt: first.manifest.createdAt,
    partsGiven: parts,
    partCount: first.manifest.partCount,
    records: first.records,
    history: first.history,
    imageMetas: first.imageMetas,
    settings: first.settings,
    images,
    newRecords,
    duplicateRecords,
    newImages,
    existingImages,
    missingImages,
    crops,
    newCrops,
    missingCrops,
    trashedCount: first.records.filter((r) => r.deletedAt).length,
  };
}

export interface RestoreResult {
  addedRecords: number;
  copiedRecords: number;
  skippedRecords: number;
  addedImages: number;
  addedHistory: number;
  addedCrops: number;
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

/**
 * 追加復元（既定）。既存データは消さず・上書きしない。
 * 同じIDの記録は「スキップ」か「別の記録として複製」。
 * すべてを1つのトランザクションで書き込み、途中で失敗したら何も書かれない。
 */
export async function applyMergeRestore(plan: RestorePlan, duplicates: 'skip' | 'copy' = 'skip'): Promise<RestoreResult> {
  const db = getDB();
  const metaById = new Map(plan.imageMetas.map((m) => [m.id, m]));
  const newRecordIds = new Set(plan.newRecords.map((r) => r.id));
  const histories = plan.history.filter((h) => newRecordIds.has(h.recordId));
  const copies: RecordItem[] =
    duplicates === 'copy'
      ? plan.duplicateRecords
          .filter((d) => !d.same)
          .map((d) => ({ ...d.incoming, id: uuid(), title: `${d.incoming.title}（復元）`, source: { type: 'backup' as const, importedAt: Date.now() } }))
      : [];
  // 画像データを先に用意（トランザクション内で非DB処理をしないため）
  const imageRows = plan.newImages
    .map((id) => ({ id, meta: metaById.get(id), data: plan.images.get(id) }))
    .filter((x): x is { id: string; meta: ImageMeta; data: NonNullable<typeof x.data> } => !!x.meta && !!x.data);

  const cropRows = plan.newCrops.map((id) => plan.crops.get(id)).filter((c): c is ImageCrop => !!c);

  try {
    await db.transaction('rw', [db.records, db.history, db.images, db.imageFull, db.imageThumb, db.imageOriginal, db.imageCrop, db.meta], async () => {
      for (const c of cropRows) {
        if (!(await db.imageCrop.get(c.id))) await db.imageCrop.add(c);
      }
      for (const row of imageRows) {
        if (await db.images.get(row.id)) continue;
        await db.images.add(row.meta);
        await db.imageFull.add({ id: row.id, data: toArrayBuffer(row.data.full) });
        await db.imageThumb.add({ id: row.id, data: toArrayBuffer(row.data.thumb) });
        if (row.data.original) await db.imageOriginal.add({ id: row.id, data: toArrayBuffer(row.data.original) });
      }
      for (const r of plan.newRecords) await db.records.add(r);
      for (const r of copies) await db.records.add(r);
      for (const h of histories) {
        if (!(await db.history.get(h.id))) await db.history.add(h);
      }
      const st = (await db.meta.get('state'))?.value as { changesSinceBackup?: number } | undefined;
      await db.meta.put({ key: 'state', value: { ...(st ?? {}), changesSinceBackup: (st?.changesSinceBackup ?? 0) + plan.newRecords.length + copies.length } });
    });
  } catch (e) {
    throw toStorageError(e, '復元');
  }
  return {
    addedRecords: plan.newRecords.length,
    copiedRecords: copies.length,
    skippedRecords: plan.duplicateRecords.length - copies.length,
    addedImages: imageRows.length,
    addedHistory: histories.length,
    addedCrops: cropRows.length,
  };
}

/**
 * 全置換復元。呼び出し前に必ず現在データのバックアップを作ること（UIで強制）。
 * 1トランザクションで「全削除→書き込み」を行うため、失敗すれば元のデータが残る。
 */
export async function applyReplaceRestore(plan: RestorePlan, opts: { restoreSettings: boolean }): Promise<RestoreResult> {
  if (plan.missingImages.length > 0 && plan.partsGiven.length < plan.partCount) {
    throw new BackupError('分割バックアップの全ファイルがそろっていないため、全置換はできません。');
  }
  const db = getDB();
  const metaById = new Map(plan.imageMetas.map((m) => [m.id, m]));
  const imageRows = [...plan.images.entries()]
    .map(([id, data]) => ({ id, data, meta: metaById.get(id) }))
    .filter((x): x is { id: string; data: typeof x.data; meta: ImageMeta } => !!x.meta);
  const prevState = await getState();
  try {
    await db.transaction('rw', [db.records, db.history, db.images, db.imageFull, db.imageThumb, db.imageOriginal, db.imageCrop, db.drafts, db.meta], async () => {
      await Promise.all([db.records.clear(), db.history.clear(), db.images.clear(), db.imageFull.clear(), db.imageThumb.clear(), db.imageOriginal.clear(), db.imageCrop.clear(), db.drafts.clear()]);
      if (plan.crops.size) await db.imageCrop.bulkAdd([...plan.crops.values()]);
      for (const row of imageRows) {
        await db.images.add(row.meta);
        await db.imageFull.add({ id: row.id, data: toArrayBuffer(row.data.full) });
        await db.imageThumb.add({ id: row.id, data: toArrayBuffer(row.data.thumb) });
        if (row.data.original) await db.imageOriginal.add({ id: row.id, data: toArrayBuffer(row.data.original) });
      }
      await db.records.bulkAdd(plan.records);
      await db.history.bulkAdd(plan.history);
      if (opts.restoreSettings && plan.settings) await db.meta.put({ key: 'settings', value: plan.settings });
      await db.meta.put({ key: 'state', value: { ...prevState, changesSinceBackup: 0 } });
    });
  } catch (e) {
    throw toStorageError(e, '全置換の復元');
  }
  return { addedRecords: plan.records.length, copiedRecords: 0, skippedRecords: 0, addedImages: imageRows.length, addedHistory: plan.history.length, addedCrops: plan.crops.size };
}
