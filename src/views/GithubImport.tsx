import { useState } from 'react';
import { fetchPublicRepos, importRepos, matchRepos, repoToRecord, type GithubRepo, type RepoMatch } from '../lib/github';
import { allRecords, saveSettings } from '../db/repo';
import { useSettings } from '../ui/hooks';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { goBack, navigate } from '../ui/router';

export function GithubImportView() {
  const settings = useSettings();
  const { toast } = useFeedback();
  const [user, setUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState<RepoMatch[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<'select' | 'preview'>('select');
  const [showForks, setShowForks] = useState(false);
  const username = user ?? settings.githubUser;

  const load = async () => {
    setBusy(true);
    setError('');
    setMatches(null);
    setSelected(new Set());
    setStep('select');
    try {
      const repos = await fetchPublicRepos(username);
      setMatches(matchRepos(repos, await allRecords()));
      if (username !== settings.githubUser) await saveSettings({ githubUser: username });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const visible = (matches ?? []).filter((m) => showForks || !m.repo.fork);
  const unregistered = visible.filter((m) => !m.existing);
  const chosen: GithubRepo[] = (matches ?? []).filter((m) => selected.has(m.repo.id) && !m.existing).map((m) => m.repo);

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const commit = async () => {
    setBusy(true);
    try {
      const res = await importRepos(chosen);
      toast(`${res.added.length}件をWebアプリに登録しました${res.skipped.length ? `（登録済み${res.skipped.length}件はスキップ）` : ''}`);
      navigate('/c/app', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="detail-top">
        <button className="icon-btn" onClick={() => goBack('/settings')} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1 className="page-title small">GitHubから一括登録</h1>
        <span />
      </div>
      <p className="hint">公開リポジトリの情報だけを、認証なしで取得します。登録するものは自分で選べます。既に登録済みのものは上書きしません。</p>
      <div className="inline-form">
        <input value={username} onChange={(e) => setUser(e.target.value.trim())} aria-label="GitHubユーザー名" autoCapitalize="off" autoCorrect="off" />
        <button className="btn btn-primary" onClick={load} disabled={busy || !username}>
          {busy && !matches ? '取得中…' : '取得'}
        </button>
      </div>
      {error && (
        <p className="msg-error" role="alert">
          {error}
        </p>
      )}

      {matches && step === 'select' && (
        <>
          <div className="list-toolbar">
            <span>
              {matches.length}件取得（未登録 {matches.filter((m) => !m.existing).length}件）
            </span>
            <label className="check-row small">
              <input type="checkbox" checked={showForks} onChange={(e) => setShowForks(e.target.checked)} /> フォークも表示
            </label>
          </div>
          <div className="list-toolbar">
            <button className="btn btn-small" onClick={() => setSelected(new Set(unregistered.map((m) => m.repo.id)))}>
              未登録をすべて選択
            </button>
            <button className="btn btn-small" onClick={() => setSelected(new Set())}>
              選択を解除
            </button>
          </div>
          <ul className="select-list">
            {visible.map((m) => (
              <li key={m.repo.id} className={m.existing ? 'is-dup' : ''}>
                <label>
                  <input type="checkbox" disabled={!!m.existing} checked={selected.has(m.repo.id)} onChange={() => toggle(m.repo.id)} />
                  <div>
                    <div className="row-title">
                      {m.repo.name}
                      {m.existing && <span className="badge badge-muted">登録済み</span>}
                      {m.repo.fork && <span className="badge badge-muted">フォーク</span>}
                      {m.repo.archived && <span className="badge badge-muted">アーカイブ</span>}
                    </div>
                    {m.repo.description && <div className="hint">{m.repo.description}</div>}
                    <div className="hint">
                      作成 {m.repo.createdAt.slice(0, 10)} ・ 更新 {(m.repo.pushedAt ?? m.repo.updatedAt).slice(0, 10)}
                      {m.existing && ` ・ 「${m.existing.title}」として登録済み`}
                    </div>
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <div className="save-bar">
            <div className="save-status">{chosen.length}件を選択中</div>
            <button className="btn btn-primary" disabled={chosen.length === 0} onClick={() => setStep('preview')}>
              内容を確認
            </button>
          </div>
        </>
      )}

      {matches && step === 'preview' && (
        <>
          <h2 className="section-title">登録内容のプレビュー（{chosen.length}件）</h2>
          <p className="hint">制作日とステータスは空欄で登録します（GitHubの作成日は「リポジトリ作成日」として別に保存）。公開URLは、GitHubにホームページURLが登録されている場合だけ入ります。</p>
          <ul className="stack">
            {chosen.map((repo) => {
              const r = repoToRecord(repo);
              return (
                <li key={repo.id} className="paper preview-item">
                  <div className="row-title">{r.title}</div>
                  <dl className="kv-list compact">
                    <div>
                      <dt>説明・用途</dt>
                      <dd>{r.fields.purpose || '（空欄）'}</dd>
                    </div>
                    <div>
                      <dt>GitHub URL</dt>
                      <dd className="mono">{r.fields.githubUrl}</dd>
                    </div>
                    <div>
                      <dt>公開URL</dt>
                      <dd className="mono">{r.fields.publicUrl || '（空欄：GitHubに未登録）'}</dd>
                    </div>
                    <div>
                      <dt>リポジトリ作成日</dt>
                      <dd>{r.fields.repoCreatedAt}</dd>
                    </div>
                  </dl>
                  {!r.fields.publicUrl && repo.hasPages && <p className="hint">※ GitHub Pagesが有効ですが、URLは推測で入れていません。必要なら登録後に編集してください。</p>}
                </li>
              );
            })}
          </ul>
          <div className="save-bar">
            <button className="btn" onClick={() => setStep('select')}>
              選び直す
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={commit}>
              {busy ? '登録中…' : `${chosen.length}件を登録`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
