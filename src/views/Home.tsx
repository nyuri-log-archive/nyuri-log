import { useEffect, useRef, useState } from 'react';
import { newRecord, saveRecord, updateState, getDraft, saveDraft, deleteDraft } from '../db/repo';
import { useAppState, useRecords, useSettings, needsBackupReminder } from '../ui/hooks';
import { RecordRow } from '../components/RecordCard';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { href } from '../ui/router';
import { formatDateTime } from '../lib/util';
import { sortRecords } from '../lib/search';

const QUICK_KEY = 'quick-memo';

export function Home() {
  const records = useRecords();
  const state = useAppState();
  const settings = useSettings();
  const live = (records ?? []).filter((r) => !r.deletedAt);
  const recent = sortRecords(live, 'updated').slice(0, 6);
  const unsorted = sortRecords(live.filter((r) => r.category === 'memo' && r.status === '未整理'), 'newest');
  const others = sortRecords(live.filter((r) => r.category === 'other'), 'updated');
  const showReminder = state && needsBackupReminder(state, settings, live.length);

  return (
    <div className="page home">
      {showReminder && <BackupReminder lastBackupAt={state!.lastBackupAt} changes={state!.changesSinceBackup} />}
      <QuickMemo />

      <Section title="未整理のアイデア" count={unsorted.length} more={unsorted.length > 5 ? '/c/memo' : undefined}>
        {unsorted.length === 0 ? <p className="empty small">未整理のメモはありません。</p> : unsorted.slice(0, 5).map((r) => <RecordRow key={r.id} r={r} showCategory={false} />)}
      </Section>

      <Section title="最近の記録" count={recent.length} more="/search">
        {records === undefined ? <p className="empty small">読み込み中…</p> : recent.length === 0 ? <p className="empty small">まだ記録がありません。上の欄か「記録する」から始めましょう。</p> : recent.map((r) => <RecordRow key={r.id} r={r} />)}
      </Section>

      <Section title="その他" count={others.length} more="/c/other">
        {others.length === 0 ? <p className="empty small">「その他」カテゴリーの記録はまだありません。</p> : others.slice(0, 4).map((r) => <RecordRow key={r.id} r={r} showCategory={false} />)}
      </Section>

      <div className="home-links">
        <a className="chip-link" href={href('/c/memo')}>
          <Icon name="memo" size={16} /> メモをすべて見る
        </a>
        <a className="chip-link" href={href('/c/other')}>
          <Icon name="other" size={16} /> その他をすべて見る
        </a>
      </div>

      <BackupStatus />
    </div>
  );
}

function Section({ title, count, more, children }: { title: string; count: number; more?: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>
          {title}
          <span className="count">{count}</span>
        </h2>
        {more && (
          <a className="link" href={href(more)}>
            もっと見る
          </a>
        )}
      </div>
      <div className="stack">{children}</div>
    </section>
  );
}

function QuickMemo() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState('');
  const { toast } = useFeedback();
  const loaded = useRef(false);

  // 書きかけのクイックメモを下書きとして保護
  useEffect(() => {
    getDraft(QUICK_KEY).then((d) => {
      const t = (d?.form as { text?: string } | undefined)?.text;
      if (t) setText(t);
      loaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    const h = setTimeout(() => {
      (text ? saveDraft(QUICK_KEY, { text }) : deleteDraft(QUICK_KEY)).catch(() => undefined);
    }, 500);
    return () => clearTimeout(h);
  }, [text]);

  const save = async () => {
    if (!text.trim() || status === 'saving') return;
    setStatus('saving');
    setError('');
    try {
      await saveRecord(newRecord('memo', { body: text }));
      setText('');
      await deleteDraft(QUICK_KEY);
      setStatus('idle');
      toast('メモを保存しました');
    } catch (e) {
      setStatus('error');
      setError((e as Error).message);
    }
  };

  return (
    <section className="quick sticky-note">
      <label htmlFor="quick" className="quick-label">
        クイックメモ
      </label>
      <textarea
        id="quick"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="思いついたことをそのまま書く…"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      {status === 'error' && (
        <p className="msg-error" role="alert">
          保存できませんでした：{error}（入力内容は残っています）
        </p>
      )}
      <div className="quick-actions">
        <span className="hint">{text ? '下書きは自動で保護されます' : '本文だけで保存できます'}</span>
        <button className="btn btn-primary" disabled={!text.trim() || status === 'saving'} onClick={save}>
          {status === 'saving' ? '保存中…' : status === 'error' ? '再試行' : '保存'}
        </button>
      </div>
    </section>
  );
}

function BackupReminder({ lastBackupAt, changes }: { lastBackupAt: number | null; changes: number }) {
  const days = lastBackupAt ? Math.floor((Date.now() - lastBackupAt) / 86_400_000) : null;
  return (
    <div className="reminder">
      <Icon name="shield" size={18} />
      <div className="reminder-text">
        {days === null ? 'まだバックアップがありません。' : `前回のバックアップから${days}日、${changes}件の変更があります。`}
        <a href={href('/backup')}>バックアップする</a>
      </div>
      <button className="icon-btn small" aria-label="3日後まで表示しない" onClick={() => updateState({ reminderSnoozedUntil: Date.now() + 3 * 86_400_000 })}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

function BackupStatus() {
  const st = useAppState();
  if (!st) return null;
  return (
    <a className="backup-status" href={href('/backup')}>
      <Icon name="shield" size={16} />
      <span>
        バックアップ：{st.lastBackupAt ? `${formatDateTime(st.lastBackupAt)}に作成` : '未作成'}
        {st.lastBackupAt && !st.lastBackupConfirmedAt ? '（保存先は未確認）' : ''}
        {' ・ '}その後の変更 {st.changesSinceBackup}件
      </span>
    </a>
  );
}
