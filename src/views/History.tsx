import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { listHistory, restoreVersion } from '../db/repo';
import type { HistoryEntry, RecordItem } from '../db/types';
import { useRecord, useSettings } from '../ui/hooks';
import { CATEGORY_DEFS, fieldLabel } from '../lib/categories';
import { formatDateTime } from '../lib/util';
import { useFeedback } from '../components/Feedback';
import { Thumb } from '../components/Images';
import { goBack, navigate } from '../ui/router';
import { Icon } from '../components/Icon';

const REASON: Record<HistoryEntry['reason'], string> = {
  edit: '編集前',
  restore: '復元前',
  'category-change': 'カテゴリー変更前',
  'import-merge': '取り込み前',
};

/** 2つの版の違いを項目名で列挙 */
function diffKeys(a: RecordItem, b: RecordItem): string[] {
  const out: string[] = [];
  if (a.category !== b.category) out.push('カテゴリー');
  if (a.title !== b.title) out.push('タイトル');
  if (a.body !== b.body) out.push('本文');
  if (a.status !== b.status) out.push('ステータス');
  if (a.madeDate !== b.madeDate) out.push('日付');
  if (JSON.stringify(a.tags) !== JSON.stringify(b.tags)) out.push('タグ');
  if (a.favorite !== b.favorite) out.push('お気に入り');
  if (JSON.stringify(a.urls) !== JSON.stringify(b.urls)) out.push('URL');
  if (JSON.stringify(a.images) !== JSON.stringify(b.images) || a.coverImageId !== b.coverImageId) out.push('画像');
  const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  for (const k of keys) if ((a.fields[k] ?? '') !== (b.fields[k] ?? '')) out.push(fieldLabel(k).replace(/（.+）$/, ''));
  return out;
}

export function HistoryView({ id }: { id: string }) {
  const r = useRecord(id);
  const settings = useSettings();
  const list = useLiveQuery(() => listHistory(id), [id]);
  const { toast, confirm } = useFeedback();
  const [open, setOpen] = useState<string | null>(null);

  if (r === undefined || list === undefined) return <div className="page"><p className="empty">読み込み中…</p></div>;

  const restore = async (h: HistoryEntry) => {
    const ok = await confirm({
      title: `${formatDateTime(h.savedAt)} の版に戻しますか？`,
      body: '今の内容も履歴に残るので、あとから再び戻せます。',
      okLabel: 'この版に戻す',
    });
    if (!ok) return;
    try {
      await restoreVersion(h.id);
      toast('以前の版に戻しました');
      navigate(`/r/${id}`, { replace: true });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="detail-top">
        <button className="icon-btn" onClick={() => goBack(`/r/${id}`)} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1 className="page-title small">変更履歴</h1>
        <span />
      </div>
      {r && <p className="hint">「{r.title || '（無題）'}」の保存前の版を新しい順に表示します（直近{settings.historyLimit}版まで保持）。</p>}
      {list.length === 0 ? (
        <p className="empty">まだ履歴はありません。保存し直すと、保存前の内容がここに残ります。</p>
      ) : (
        <ol className="history">
          {list.map((h, i) => {
            const newer = i === 0 ? r : list[i - 1].snapshot;
            const changed = newer ? diffKeys(h.snapshot, newer) : [];
            const s = h.snapshot;
            return (
              <li key={h.id} className="history-item">
                <button className="history-head" onClick={() => setOpen(open === h.id ? null : h.id)} aria-expanded={open === h.id}>
                  <span className="history-date">{formatDateTime(h.savedAt)}</span>
                  <span className="badge">{REASON[h.reason]}</span>
                  {changed.length > 0 && <span className="history-diff">変更：{changed.slice(0, 4).join('・')}{changed.length > 4 ? ' ほか' : ''}</span>}
                </button>
                {open === h.id && (
                  <div className="history-body">
                    <p>
                      <strong>{s.title || '（無題）'}</strong>（{CATEGORY_DEFS[s.category].label}・{s.status || '未設定'}）
                    </p>
                    {s.images.length > 0 && (
                      <div className="gallery-strip">
                        {s.images.map((im) => (
                          <Thumb key={im.id} id={im.id} category={s.category} alt={im.caption} small />
                        ))}
                      </div>
                    )}
                    {s.body && <p className="pre">{s.body}</p>}
                    {Object.entries(s.fields)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k} className="kv">
                          <span className="kv-k">{fieldLabel(k)}</span>
                          <span className="pre">{v}</span>
                        </div>
                      ))}
                    <button className="btn btn-primary" onClick={() => restore(h)}>
                      <Icon name="undo" size={16} /> この版に戻す
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
