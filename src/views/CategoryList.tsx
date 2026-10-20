import { useMemo, useState } from 'react';
import { CATEGORY_DEFS, type Category } from '../lib/categories';
import { useRecords } from '../ui/hooks';
import { DEFAULT_QUERY, search, type Query } from '../lib/search';
import { CardGrid } from '../components/RecordCard';
import { Icon } from '../components/Icon';
import { navigate } from '../ui/router';

export function FilterBar({ q, setQ, statuses, placeholder }: { q: Query; setQ: (q: Query) => void; statuses: string[]; placeholder: string }) {
  return (
    <div className="filters">
      <div className="search-box">
        <Icon name="search" size={18} />
        <input type="search" value={q.text} placeholder={placeholder} onChange={(e) => setQ({ ...q, text: e.target.value })} enterKeyHint="search" aria-label="検索語" />
      </div>
      <div className="filter-row">
        <select value={q.sort} onChange={(e) => setQ({ ...q, sort: e.target.value as Query['sort'] })} aria-label="並び順">
          <option value="newest">新しい順</option>
          <option value="oldest">古い順</option>
          <option value="updated">更新順</option>
        </select>
        <select value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })} aria-label="ステータス">
          <option value="">すべてのステータス</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className={`toggle ${q.favoritesOnly ? 'on' : ''}`} onClick={() => setQ({ ...q, favoritesOnly: !q.favoritesOnly })} aria-pressed={q.favoritesOnly}>
          <Icon name="star" size={15} filled={q.favoritesOnly} /> お気に入り
        </button>
      </div>
    </div>
  );
}

export function CategoryList({ category }: { category: Category }) {
  const def = CATEGORY_DEFS[category];
  const records = useRecords();
  const [q, setQ] = useState<Query>({ ...DEFAULT_QUERY, category });
  const list = useMemo(() => search(records ?? [], { ...q, category }), [records, q, category]);
  const total = (records ?? []).filter((r) => r.category === category && !r.deletedAt).length;

  return (
    <div className="page">
      <div className="page-head" style={{ ['--cat' as string]: def.color, ['--cat-strong' as string]: def.colorStrong }}>
        <h1 className="cat-title">
          <Icon name={def.icon} size={20} /> {def.label}
          <span className="count">{total}</span>
        </h1>
      </div>
      <FilterBar q={q} setQ={setQ} statuses={def.statuses} placeholder={`${def.shortLabel}の中を検索`} />
      {records === undefined ? (
        <p className="empty">読み込み中…</p>
      ) : list.length === 0 ? (
        <div className="empty">
          <p>{total === 0 ? `${def.label}の記録はまだありません。` : '条件に合う記録がありません。'}</p>
          {total === 0 && (
            <button className="btn btn-primary" onClick={() => navigate(`/new/${category}`)}>
              ＋ {def.label}を記録する
            </button>
          )}
        </div>
      ) : (
        <CardGrid list={list} />
      )}
    </div>
  );
}
