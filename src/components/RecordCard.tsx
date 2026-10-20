import type { RecordItem } from '../db/types';
import { CATEGORY_DEFS } from '../lib/categories';
import { formatDate, formatYmd } from '../lib/util';
import { href } from '../ui/router';
import { Icon } from './Icon';
import { Thumb } from './Images';

export function StatusBadge({ r }: { r: RecordItem }) {
  if (!r.status) return <span className="badge badge-muted">未設定</span>;
  return <span className="badge">{r.status}</span>;
}

export function CategoryBadge({ r }: { r: RecordItem }) {
  const d = CATEGORY_DEFS[r.category];
  return (
    <span className="badge cat-badge" style={{ background: d.color, borderColor: d.colorStrong }}>
      {d.shortLabel}
    </span>
  );
}

export function displayTitle(r: RecordItem) {
  return r.title || '（無題）';
}

/** 画像つきカード（グリッド用） */
export function RecordCard({ r, showCategory }: { r: RecordItem; showCategory?: boolean }) {
  const d = CATEGORY_DEFS[r.category];
  return (
    <a className="card" href={href(`/r/${r.id}`)} style={{ ['--cat' as string]: d.color, ['--cat-strong' as string]: d.colorStrong }}>
      <Thumb id={r.coverImageId} category={r.category} alt={displayTitle(r)} />
      <div className="card-body">
        <div className="card-title">
          {r.favorite && <Icon name="star" size={14} filled className="fav-mark" />}
          <span>{displayTitle(r)}</span>
        </div>
        <div className="card-meta">
          {showCategory && <CategoryBadge r={r} />}
          <StatusBadge r={r} />
          <span className="card-date">{r.madeDate ? formatYmd(r.madeDate) : formatDate(r.createdAt)}</span>
        </div>
        {r.tags.length > 0 && (
          <div className="card-tags">
            {r.tags.slice(0, 3).map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
            {r.tags.length > 3 && <span className="tag more">+{r.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </a>
  );
}

/** 本文の抜粋。タイトルが本文1行目から自動生成されている場合はその行を除く */
function snippet(r: RecordItem): string {
  const lines = r.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = r.title.replace(/…$/, '');
  if (lines.length && head && lines[0].startsWith(head)) lines.shift();
  return lines.join(' ').slice(0, 80);
}

/** 付箋風の行（メモ・最近の記録用） */
export function RecordRow({ r, showCategory = true }: { r: RecordItem; showCategory?: boolean }) {
  const d = CATEGORY_DEFS[r.category];
  return (
    <a className="row" href={href(`/r/${r.id}`)} style={{ ['--cat' as string]: d.color, ['--cat-strong' as string]: d.colorStrong }}>
      <Thumb id={r.coverImageId} category={r.category} alt={displayTitle(r)} small />
      <div className="row-main">
        <div className="row-title">
          {r.favorite && <Icon name="star" size={13} filled className="fav-mark" />}
          {displayTitle(r)}
        </div>
        {r.category === 'memo' && snippet(r) && <div className="row-snippet">{snippet(r)}</div>}
        <div className="card-meta">
          {showCategory && <CategoryBadge r={r} />}
          <StatusBadge r={r} />
          <span className="card-date">{formatDate(r.updatedAt)}</span>
        </div>
      </div>
    </a>
  );
}

export function CardGrid({ list, showCategory }: { list: RecordItem[]; showCategory?: boolean }) {
  return (
    <div className="grid">
      {list.map((r) => (
        <RecordCard key={r.id} r={r} showCategory={showCategory} />
      ))}
    </div>
  );
}
