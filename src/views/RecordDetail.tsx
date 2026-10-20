import { useState } from 'react';
import { useRecord } from '../ui/hooks';
import { CATEGORY_DEFS, fieldLabel } from '../lib/categories';
import { formatDateTime, formatYmd, safeUrl } from '../lib/util';
import { moveToTrash, restoreFromTrash, saveRecord } from '../db/repo';
import { Icon } from '../components/Icon';
import { FullImage, ImageViewer, Thumb } from '../components/Images';
import { CategoryBadge, StatusBadge, displayTitle } from '../components/RecordCard';
import { useCopy, useFeedback } from '../components/Feedback';
import { goBack, href, navigate } from '../ui/router';

export function SafeLink({ url, label }: { url: string; label?: string }) {
  const safe = safeUrl(url);
  if (!safe) return <span className="muted">{url}（無効なURL）</span>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className="ext-link">
      <Icon name="link" size={15} />
      <span>{label || safe}</span>
    </a>
  );
}

export function RecordDetail({ id }: { id: string }) {
  const r = useRecord(id);
  const copy = useCopy();
  const { toast, confirm } = useFeedback();
  const [viewer, setViewer] = useState<number | null>(null);

  if (r === undefined) return <div className="page"><p className="empty">読み込み中…</p></div>;
  if (r === null)
    return (
      <div className="page">
        <p className="empty">この記録は見つかりません（完全削除された可能性があります）。</p>
        <a className="btn" href={href('/')}>ホームへ</a>
      </div>
    );

  const def = CATEGORY_DEFS[r.category];
  const knownKeys = new Set(def.fields.map((f) => f.key));
  const unknownFields = Object.entries(r.fields).filter(([k, v]) => !knownKeys.has(k) && v);

  const toggleFav = async () => {
    try {
      await saveRecord({ ...r, favorite: !r.favorite });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const trash = async () => {
    const ok = await confirm({ title: 'ゴミ箱に移動しますか？', body: '本文・画像・履歴はゴミ箱からいつでも元に戻せます。', okLabel: 'ゴミ箱へ移動', danger: true });
    if (!ok) return;
    try {
      await moveToTrash(r.id);
      toast('ゴミ箱に移動しました');
      navigate('/', { replace: true });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="page detail" style={{ ['--cat' as string]: def.color, ['--cat-strong' as string]: def.colorStrong }}>
      <div className="detail-top">
        <button className="icon-btn" onClick={() => goBack()} aria-label="戻る">
          <Icon name="back" />
        </button>
        <div className="detail-top-actions">
          <button className={`icon-btn ${r.favorite ? 'fav-on' : ''}`} onClick={toggleFav} aria-label={r.favorite ? 'お気に入りを外す' : 'お気に入りにする'} aria-pressed={r.favorite}>
            <Icon name="star" filled={r.favorite} />
          </button>
          <a className="btn btn-small btn-primary" href={href(`/edit/${r.id}`)}>
            <Icon name="edit" size={16} /> 編集
          </a>
        </div>
      </div>

      {r.deletedAt && (
        <div className="banner banner-warn">
          この記録はゴミ箱にあります（{formatDateTime(r.deletedAt)}に移動）。
          <button className="btn btn-small" onClick={() => restoreFromTrash(r.id).then(() => toast('元に戻しました'))}>
            元に戻す
          </button>
        </div>
      )}

      {r.images.length > 0 && (
        <div className="gallery">
          {/* 詳細画面では切り抜かず、画像全体を表示する */}
          <button className="gallery-main" onClick={() => setViewer(Math.max(0, r.images.findIndex((i) => i.id === r.coverImageId)))} aria-label="代表画像を拡大">
            <FullImage id={r.coverImageId ?? r.images[0].id} category={r.category} alt={displayTitle(r)} />
          </button>
          {r.images.length > 1 && (
            <div className="gallery-strip">
              {r.images.map((im, i) => (
                <button key={im.id} className="gallery-item" onClick={() => setViewer(i)} aria-label={`画像${i + 1}を拡大`}>
                  <Thumb img={im} category={r.category} alt={im.caption || `画像${i + 1}`} small />
                  {im.caption && <span className="gallery-cap">{im.caption}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="paper">
        <div className="card-meta">
          <CategoryBadge r={r} />
          <StatusBadge r={r} />
        </div>
        <h1 className="detail-title">{displayTitle(r)}</h1>
        <dl className="dates">
          <div>
            <dt>{def.dateLabel}</dt>
            <dd>{r.madeDate ? formatYmd(r.madeDate) : '未設定'}</dd>
          </div>
          <div>
            <dt>登録</dt>
            <dd>{formatDateTime(r.createdAt)}</dd>
          </div>
          <div>
            <dt>更新</dt>
            <dd>{formatDateTime(r.updatedAt)}</dd>
          </div>
        </dl>
        {r.tags.length > 0 && (
          <div className="card-tags">
            {r.tags.map((t) => (
              <a key={t} className="tag" href={href(`/search/${encodeURIComponent(t)}`)}>
                #{t}
              </a>
            ))}
          </div>
        )}
      </div>

      {def.fields.map((f) => {
        const v = r.fields[f.key];
        if (!v) return null;
        return (
          <section key={f.key} className="field-view">
            <div className="field-view-head">
              <h3>{f.label}</h3>
              {(f.copyable || f.kind === 'url') && (
                <button className="copy-btn" onClick={() => copy(v, f.label)}>
                  <Icon name="copy" size={15} /> コピー
                </button>
              )}
            </div>
            {f.kind === 'url' ? <SafeLink url={v} /> : <p className={`pre ${f.kind === 'prompt' ? 'prompt' : ''}`}>{v}</p>}
          </section>
        );
      })}

      {r.body && (
        <section className="field-view">
          <div className="field-view-head">
            <h3>{def.bodyLabel}</h3>
            <button className="copy-btn" onClick={() => copy(r.body, def.bodyLabel)}>
              <Icon name="copy" size={15} /> コピー
            </button>
          </div>
          <p className="pre">{r.body}</p>
        </section>
      )}

      {r.urls.length > 0 && (
        <section className="field-view">
          <div className="field-view-head">
            <h3>関連URL</h3>
          </div>
          <ul className="url-list">
            {r.urls.map((u, i) => (
              <li key={i}>
                <SafeLink url={u.url} label={u.label} />
                <button className="copy-btn" onClick={() => copy(u.url, 'URL')} aria-label="URLをコピー">
                  <Icon name="copy" size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unknownFields.length > 0 && (
        <section className="field-view">
          <div className="field-view-head">
            <h3>その他の項目</h3>
          </div>
          <p className="hint">別カテゴリーやインポートで入った項目です。消さずに保持しています。</p>
          {unknownFields.map(([k, v]) => (
            <div key={k} className="kv">
              <span className="kv-k">{fieldLabel(k)}</span>
              <span className="pre">{v}</span>
            </div>
          ))}
        </section>
      )}

      <div className="detail-actions">
        <a className="btn" href={href(`/history/${r.id}`)}>
          <Icon name="history" size={16} /> 変更履歴
        </a>
        {!r.deletedAt && (
          <button className="btn btn-ghost-danger" onClick={trash}>
            <Icon name="trash" size={16} /> ゴミ箱へ
          </button>
        )}
      </div>

      {viewer !== null && <ImageViewer images={r.images} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
