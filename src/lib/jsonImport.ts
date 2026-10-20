import { getDB } from '../db/db';
import { toStorageError } from '../db/errors';
import { newRecord, normalizeRecord } from '../db/repo';
import type { LinkItem, RecordItem } from '../db/types';
import { CATEGORY_DEFS, normalizeCategory, type Category } from './categories';
import { isValidYmd, normalizeGithubUrl, normalizeText, normalizeUrl, safeUrl, uniqueTags } from './util';

export const IMPORT_FORMAT = 'nyuri-log';
export const IMPORT_SCHEMA_VERSION = 1;

/** items の各要素で使える共通キー（これ以外は extra.unknown に保持） */
export const COMMON_KEYS = ['category', 'title', 'body', 'madeDate', 'tags', 'status', 'favorite', 'urls', 'fields'] as const;

export interface ImportCandidate {
  index: number;
  record: RecordItem | null;
  errors: string[];
  warnings: string[];
  duplicateOf: RecordItem | null;
  duplicateInFile: number | null;
}

export interface ImportPreview {
  ok: boolean;
  fatal: string | null;
  candidates: ImportCandidate[];
  counts: Partial<Record<Category, number>>;
}

/** AIの出力にありがちな前置き・コードフェンスを取り除く */
export function extractJsonText(text: string): string {
  let t = text.replace(/^﻿/, '').trim();
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  if (!t.startsWith('{') && !t.startsWith('[')) {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
  }
  return t;
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return v.join('\n');
  return JSON.stringify(v, null, 2);
}

function parseUrls(v: unknown, warnings: string[]): LinkItem[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: LinkItem[] = [];
  for (const x of arr) {
    let label = '';
    let url = '';
    if (typeof x === 'string') url = x;
    else if (x && typeof x === 'object') {
      label = toText((x as Record<string, unknown>).label);
      url = toText((x as Record<string, unknown>).url);
    }
    if (!url.trim()) continue;
    const safe = safeUrl(url);
    if (!safe) {
      warnings.push(`URL「${url.slice(0, 60)}」は http/https ではないため取り込みません。`);
      continue;
    }
    out.push({ label, url: safe });
  }
  return out;
}

/** 1件分を検証して RecordItem にする（DBには書かない） */
export function itemToRecord(raw: unknown, index: number): ImportCandidate {
  const errors: string[] = [];
  const warnings: string[] = [];
  const base: ImportCandidate = { index, record: null, errors, warnings, duplicateOf: null, duplicateInFile: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('オブジェクト形式ではありません。');
    return base;
  }
  const o = raw as Record<string, unknown>;
  const category = normalizeCategory(o.category);
  if (!category) {
    errors.push(o.category === undefined ? 'category がありません。' : `category「${String(o.category)}」は使えません（memo / app / lora / nai / oc / other）。`);
    return base;
  }
  const def = CATEGORY_DEFS[category];
  const title = toText(o.title).trim();
  const body = toText(o.body);

  // カテゴリー専用項目
  const fields: Record<string, string> = {};
  const unknownFieldKeys: string[] = [];
  if (o.fields !== undefined && o.fields !== null) {
    if (typeof o.fields !== 'object' || Array.isArray(o.fields)) {
      errors.push('fields はオブジェクトで指定してください。');
      return base;
    }
    const known = new Set(def.fields.map((f) => f.key));
    for (const [k, v] of Object.entries(o.fields as Record<string, unknown>)) {
      const s = toText(v);
      if (!known.has(k)) unknownFieldKeys.push(k);
      if (s !== '') fields[k] = s;
    }
  }
  if (unknownFieldKeys.length) warnings.push(`このカテゴリーに無い項目（${unknownFieldKeys.join('、')}）は「その他の項目」として保持します。`);

  // URL系の専用項目を検証
  for (const f of def.fields.filter((x) => x.kind === 'url')) {
    if (fields[f.key] && !safeUrl(fields[f.key])) {
      warnings.push(`${f.label}「${fields[f.key].slice(0, 60)}」はURLとして正しくないため空欄にします。`);
      delete fields[f.key];
    }
  }

  let madeDate: string | null = null;
  if (o.madeDate !== undefined && o.madeDate !== null && o.madeDate !== '') {
    if (isValidYmd(o.madeDate)) madeDate = o.madeDate;
    else warnings.push(`madeDate「${String(o.madeDate)}」は YYYY-MM-DD 形式ではないため空欄にします。`);
  }

  let tags: string[] = [];
  if (Array.isArray(o.tags)) tags = uniqueTags(o.tags.map(toText));
  else if (typeof o.tags === 'string') tags = uniqueTags(o.tags.split(/[,、]/));
  else if (o.tags !== undefined && o.tags !== null) warnings.push('tags は文字列の配列で指定してください（無視しました）。');

  let status = typeof o.status === 'string' ? o.status.trim() : '';
  if (status && !def.statuses.includes(status)) warnings.push(`ステータス「${status}」は${def.label}の候補にありませんが、そのまま保持します。`);
  if (!status) status = def.defaultStatus;

  const urls = parseUrls(o.urls, warnings);

  if (!title && !body.trim() && Object.keys(fields).length === 0) {
    errors.push('title・body・fields のどれも入っていません。');
    return base;
  }

  const unknown: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!(COMMON_KEYS as readonly string[]).includes(k)) unknown[k] = v;
  if (Object.keys(unknown).length) warnings.push(`不明な項目（${Object.keys(unknown).join('、')}）はそのまま保持します。`);

  const record = normalizeRecord(
    newRecord(category, {
      title,
      body,
      madeDate,
      tags,
      status,
      favorite: o.favorite === true,
      urls,
      fields,
      source: { type: 'json', importedAt: Date.now() },
      extra: Object.keys(unknown).length ? { importUnknown: unknown } : {},
    }),
  );
  return { ...base, record };
}

function dupKeys(r: RecordItem): string[] {
  const keys: string[] = [];
  if (r.title) keys.push(`t:${r.category}:${normalizeText(r.title)}`);
  const gh = normalizeGithubUrl(r.fields.githubUrl);
  if (gh) keys.push(`g:${gh}`);
  for (const k of ['publicUrl', 'distributionUrl']) {
    const u = normalizeUrl(r.fields[k]);
    if (u) keys.push(`u:${u}`);
  }
  return keys;
}

/** JSONテキストを読み、検証結果と重複候補を返す（DBには書かない） */
export function previewImport(text: string, existing: RecordItem[]): ImportPreview {
  const fail = (msg: string): ImportPreview => ({ ok: false, fatal: msg, candidates: [], counts: {} });
  const t = extractJsonText(text);
  if (!t) return fail('JSONが空です。');
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch (e) {
    return fail(`JSONとして読み込めませんでした。カッコや引用符の閉じ忘れ、末尾のカンマがないか確認してください。（${(e as Error).message}）`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('一番外側は { "format": "nyuri-log", "schemaVersion": 1, "items": [...] } の形にしてください。');
  }
  const d = data as Record<string, unknown>;
  if (d.format !== IMPORT_FORMAT) return fail(`format が "${IMPORT_FORMAT}" ではありません。にゅりログ用の依頼文で作ったJSONか確認してください。`);
  if (Number(d.schemaVersion) !== IMPORT_SCHEMA_VERSION) {
    return fail(`schemaVersion ${String(d.schemaVersion)} には対応していません（対応：${IMPORT_SCHEMA_VERSION}）。`);
  }
  if (!Array.isArray(d.items)) return fail('items（配列）がありません。');
  if (d.items.length === 0) return fail('items が空です。');
  if (d.items.length > 2000) return fail('一度に取り込めるのは2000件までです。');

  const existingIndex = new Map<string, RecordItem>();
  for (const r of existing) if (!r.deletedAt) for (const k of dupKeys(r)) if (!existingIndex.has(k)) existingIndex.set(k, r);
  const inFile = new Map<string, number>();

  const candidates = d.items.map((raw, i) => {
    const c = itemToRecord(raw, i);
    if (c.record) {
      for (const k of dupKeys(c.record)) {
        if (!c.duplicateOf && existingIndex.has(k)) c.duplicateOf = existingIndex.get(k)!;
        if (c.duplicateInFile === null && inFile.has(k)) c.duplicateInFile = inFile.get(k)!;
      }
      for (const k of dupKeys(c.record)) if (!inFile.has(k)) inFile.set(k, i);
    }
    return c;
  });
  const counts: ImportPreview['counts'] = {};
  for (const c of candidates) if (c.record) counts[c.record.category] = (counts[c.record.category] ?? 0) + 1;
  return { ok: true, fatal: null, candidates, counts };
}

/** 選択した記録を追加登録する（既存データは削除・上書きしない） */
export async function commitImport(records: RecordItem[]): Promise<number> {
  const db = getDB();
  const now = Date.now();
  const toAdd = records.map((r, i) => ({ ...r, createdAt: now + i, updatedAt: now + i, rev: 1 }));
  try {
    await db.transaction('rw', [db.records, db.meta], async () => {
      await db.records.bulkAdd(toAdd);
      const st = (await db.meta.get('state'))?.value as Record<string, unknown> | undefined;
      await db.meta.put({ key: 'state', value: { ...(st ?? {}), changesSinceBackup: ((st?.changesSinceBackup as number) ?? 0) + toAdd.length } });
    });
  } catch (e) {
    throw toStorageError(e, 'インポート');
  }
  return toAdd.length;
}
