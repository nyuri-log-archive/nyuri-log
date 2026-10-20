import type { RecordItem } from '../db/types';
import { CATEGORY_DEFS, type Category } from './categories';
import { normalizeText } from './util';

export type SortKey = 'newest' | 'oldest' | 'updated';

export interface Query {
  text: string;
  category: Category | 'all';
  favoritesOnly: boolean;
  status: string; // '' = すべて
  tag: string; // '' = すべて
  sort: SortKey;
  includeTrash?: boolean;
}

export const DEFAULT_QUERY: Query = { text: '', category: 'all', favoritesOnly: false, status: '', tag: '', sort: 'newest' };

/** 検索対象の文字列（タイトル・タグ・本文・カテゴリー専用項目・URL・画像説明） */
export function haystack(r: RecordItem): string {
  const parts = [r.title, r.body, r.tags.join(' '), ...Object.values(r.fields), ...r.urls.map((u) => `${u.label} ${u.url}`), ...r.images.map((i) => i.caption)];
  return normalizeText(parts.join('\n'));
}

/** 「の日付」：制作日があればそれ、なければ登録日 */
export function sortDate(r: RecordItem): number {
  return r.createdAt;
}

export function matches(r: RecordItem, q: Query): boolean {
  if (!q.includeTrash && r.deletedAt) return false;
  if (q.category !== 'all' && r.category !== q.category) return false;
  if (q.favoritesOnly && !r.favorite) return false;
  if (q.status && r.status !== q.status) return false;
  if (q.tag) {
    const t = normalizeText(q.tag);
    if (!r.tags.some((x) => normalizeText(x) === t)) return false;
  }
  const terms = normalizeText(q.text).split(' ').filter(Boolean);
  if (terms.length) {
    const h = haystack(r);
    for (const term of terms) {
      const tagTerm = term.replace(/^[#＃]/, '');
      if (term !== tagTerm) {
        if (!r.tags.some((x) => normalizeText(x) === tagTerm)) return false;
      } else if (!h.includes(term)) return false;
    }
  }
  return true;
}

export function sortRecords(list: RecordItem[], sort: SortKey): RecordItem[] {
  const arr = [...list];
  if (sort === 'newest') arr.sort((a, b) => b.createdAt - a.createdAt);
  else if (sort === 'oldest') arr.sort((a, b) => a.createdAt - b.createdAt);
  else arr.sort((a, b) => b.updatedAt - a.updatedAt);
  return arr;
}

export function search(list: RecordItem[], q: Query): RecordItem[] {
  return sortRecords(list.filter((r) => matches(r, q)), q.sort);
}

/** 絞り込み用：対象カテゴリーのステータス候補 */
export function statusOptions(category: Category | 'all'): string[] {
  if (category !== 'all') return CATEGORY_DEFS[category].statuses;
  const set = new Set<string>();
  Object.values(CATEGORY_DEFS).forEach((d) => d.statuses.forEach((s) => set.add(s)));
  return [...set];
}

export function allTags(list: RecordItem[]): { tag: string; count: number }[] {
  const m = new Map<string, { tag: string; count: number }>();
  for (const r of list) {
    if (r.deletedAt) continue;
    for (const t of r.tags) {
      const k = normalizeText(t);
      const cur = m.get(k);
      if (cur) cur.count++;
      else m.set(k, { tag: t, count: 1 });
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
}
