import { useRecords } from '../ui/hooks';
import { deletePermanently, emptyTrash, restoreFromTrash } from '../db/repo';
import { useFeedback } from '../components/Feedback';
import { Thumb, coverRef } from '../components/Images';
import { CategoryBadge, displayTitle } from '../components/RecordCard';
import { formatDateTime } from '../lib/util';
import { href } from '../ui/router';

export function TrashView() {
  const records = useRecords();
  const { toast, confirm } = useFeedback();
  const trashed = (records ?? []).filter((r) => r.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const removeOne = async (id: string, title: string) => {
    const ok = await confirm({
      title: `「${title}」を完全に削除しますか？`,
      body: '本文・画像・変更履歴がすべて消え、元に戻せません（バックアップZIPに入っていれば、そこから復元できます）。',
      okLabel: '完全に削除',
      danger: true,
    });
    if (ok) run(() => deletePermanently([id]), '完全に削除しました');
  };

  const removeAll = async () => {
    const ok = await confirm({
      title: `ゴミ箱の${trashed.length}件をすべて完全に削除しますか？`,
      body: '本文・画像・変更履歴がすべて消え、元に戻せません。',
      okLabel: 'すべて完全に削除',
      danger: true,
      typeToConfirm: '削除',
    });
    if (ok) run(() => emptyTrash(), 'ゴミ箱を空にしました');
  };

  return (
    <div className="page">
      <h1 className="page-title">ゴミ箱</h1>
      <p className="hint">ゴミ箱の記録は自動では消えません。本文・画像・変更履歴もまとめて保持しています。</p>
      {trashed.length === 0 ? (
        <p className="empty">ゴミ箱は空です。</p>
      ) : (
        <>
          <div className="stack">
            {trashed.map((r) => (
              <div key={r.id} className="row trash-row">
                <Thumb img={coverRef(r)} category={r.category} alt={displayTitle(r)} small />
                <div className="row-main">
                  <a className="row-title" href={href(`/r/${r.id}`)}>
                    {displayTitle(r)}
                  </a>
                  <div className="card-meta">
                    <CategoryBadge r={r} />
                    <span className="card-date">削除 {formatDateTime(r.deletedAt)}</span>
                  </div>
                  <div className="row-actions">
                    <button className="btn btn-small btn-primary" onClick={() => run(() => restoreFromTrash(r.id), '元に戻しました')}>
                      元に戻す
                    </button>
                    <button className="btn btn-small btn-ghost-danger" onClick={() => removeOne(r.id, displayTitle(r))}>
                      完全に削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost-danger wide" onClick={removeAll}>
            ゴミ箱を空にする
          </button>
        </>
      )}
    </div>
  );
}
