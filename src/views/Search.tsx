import { useMemo, useState } from 'react';
import { CATEGORIES, CATEGORY_DEFS } from '../lib/categories';
import { DEFAULT_QUERY, allTags, search, statusOptions, type Query } from '../lib/search';
import { useRecords } from '../ui/hooks';
import { CardGrid } from '../components/RecordCard';
import { FilterBar } from './CategoryList';

export function SearchView({ initialTag }: { initialTag?: string }) {
  const records = useRecords();
  const [q, setQ] = useState<Query>({ ...DEFAULT_QUERY, tag: initialTag ?? '' });
  const list = useMemo(() => search(records ?? [], q), [records, q]);
  const tags = useMemo(() => allTags(records ?? []).slice(0, 30), [records]);
  const active = !!(q.text || q.tag || q.favoritesOnly || q.status || q.category !== 'all');

  return (
    <div className="page">
      <h1 className="page-title">検索</h1>
      <FilterBar q={q} setQ={setQ} statuses={statusOptions(q.category)} placeholder="タイトル・タグ・本文・プロンプトなど" />
      <div className="chips" role="group" aria-label="カテゴリーで絞り込み">
        <button className={`chip ${q.category === 'all' ? 'on' : ''}`} onClick={() => setQ({ ...q, category: 'all', status: '' })}>
          すべて
        </button>
        {CATEGORIES.map((c) => (
          <button key={c} className={`chip ${q.category === c ? 'on' : ''}`} style={{ ['--cat' as string]: CATEGORY_DEFS[c].color, ['--cat-strong' as string]: CATEGORY_DEFS[c].colorStrong }} onClick={() => setQ({ ...q, category: c, status: '' })}>
            {CATEGORY_DEFS[c].shortLabel}
          </button>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="chips tags-cloud" role="group" aria-label="タグ">
          {tags.map((t) => (
            <button key={t.tag} className={`chip tag-chip ${q.tag === t.tag ? 'on' : ''}`} onClick={() => setQ({ ...q, tag: q.tag === t.tag ? '' : t.tag })}>
              #{t.tag} <small>{t.count}</small>
            </button>
          ))}
        </div>
      )}
      <p className="result-count">{records === undefined ? '読み込み中…' : `${list.length}件${active ? '' : '（すべて）'}`}</p>
      {list.length === 0 && records !== undefined ? <p className="empty">見つかりませんでした。</p> : <CardGrid list={list} showCategory />}
    </div>
  );
}
