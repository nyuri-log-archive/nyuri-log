import { useState } from 'react';
import { commitImport, previewImport, type ImportPreview } from '../lib/jsonImport';
import { buildAiPrompt } from '../lib/aiPrompt';
import { allRecords } from '../db/repo';
import { CATEGORY_DEFS, type Category } from '../lib/categories';
import { useCopy, useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { AutoTextarea } from '../components/FormParts';
import { goBack, navigate } from '../ui/router';

export function JsonImportView() {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { toast } = useFeedback();
  const copy = useCopy();

  const check = async (src = text) => {
    setError('');
    const p = previewImport(src, await allRecords());
    setPreview(p);
    if (p.ok) setSelected(new Set(p.candidates.filter((c) => c.record && !c.duplicateOf && c.duplicateInFile === null).map((c) => c.index)));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setError('ファイルが大きすぎます（20MBまで）。');
      return;
    }
    const t = await f.text();
    setText(t);
    check(t);
  };

  const commit = async () => {
    if (!preview) return;
    const recs = preview.candidates.filter((c) => c.record && selected.has(c.index)).map((c) => c.record!);
    setBusy(true);
    try {
      const n = await commitImport(recs);
      toast(`${n}件を登録しました`);
      navigate('/search', { replace: true });
    } catch (e) {
      setError(`登録できませんでした。何も登録されていません。（${(e as Error).message}）`);
    } finally {
      setBusy(false);
    }
  };

  const valid = preview?.candidates.filter((c) => c.record) ?? [];
  const invalid = preview?.candidates.filter((c) => !c.record) ?? [];
  const dups = valid.filter((c) => c.duplicateOf || c.duplicateInFile !== null);
  const selCounts: Partial<Record<Category, number>> = {};
  valid.filter((c) => selected.has(c.index)).forEach((c) => (selCounts[c.record!.category] = (selCounts[c.record!.category] ?? 0) + 1));

  return (
    <div className="page">
      <div className="detail-top">
        <button className="icon-btn" onClick={() => goBack('/settings')} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1 className="page-title small">JSONから一括登録</h1>
        <span />
      </div>
      <p className="hint">ChatGPTやClaudeに書き出してもらったにゅりログ形式のJSONを取り込みます。取り込みは追加だけで、既存の記録は変更しません。</p>
      <button className="btn btn-small" onClick={() => copy(buildAiPrompt(), 'AI用の依頼文')}>
        <Icon name="copy" size={15} /> ChatGPT用の依頼文をコピー
      </button>

      <AutoTextarea value={text} onChange={(e) => setText(e.target.value)} placeholder='{ "format": "nyuri-log", "schemaVersion": 1, "items": [ … ] }' minRows={6} className="prompt" autoCapitalize="off" spellCheck={false} aria-label="JSONテキスト" />
      <div className="list-toolbar">
        <label className="btn btn-small">
          JSONファイルを選ぶ
          <input type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = '';
          }} />
        </label>
        <button className="btn btn-primary btn-small" disabled={!text.trim()} onClick={() => check()}>
          検証する
        </button>
      </div>
      {error && (
        <p className="msg-error" role="alert">
          {error}
        </p>
      )}

      {preview && !preview.ok && (
        <div className="banner banner-error" role="alert">
          {preview.fatal}
        </div>
      )}

      {preview?.ok && (
        <>
          <div className="paper">
            <dl className="kv-list">
              <div>
                <dt>読み込んだ件数</dt>
                <dd>{preview.candidates.length}件</dd>
              </div>
              <div>
                <dt>登録できる</dt>
                <dd>
                  {valid.length}件（
                  {Object.entries(preview.counts)
                    .map(([c, n]) => `${CATEGORY_DEFS[c as Category].shortLabel} ${n}`)
                    .join('・')}
                  ）
                </dd>
              </div>
              <div>
                <dt>重複候補</dt>
                <dd>{dups.length}件（初期状態で選択を外しています）</dd>
              </div>
              <div>
                <dt>不正なデータ</dt>
                <dd>{invalid.length}件（登録できません）</dd>
              </div>
            </dl>
          </div>
          <ul className="select-list">
            {preview.candidates.map((c) => (
              <li key={c.index} className={!c.record ? 'is-error' : c.duplicateOf || c.duplicateInFile !== null ? 'is-dup' : ''}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!c.record}
                    checked={selected.has(c.index)}
                    onChange={() =>
                      setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(c.index)) n.delete(c.index);
                        else n.add(c.index);
                        return n;
                      })
                    }
                  />
                  <div>
                    <div className="row-title">
                      <span className="muted">#{c.index + 1}</span> {c.record ? c.record.title || '（無題）' : '登録できないデータ'}
                      {c.record && <span className="badge" style={{ background: CATEGORY_DEFS[c.record.category].color }}>{CATEGORY_DEFS[c.record.category].shortLabel}</span>}
                    </div>
                    {c.errors.map((e, i) => (
                      <div key={i} className="msg-error small">
                        {e}
                      </div>
                    ))}
                    {c.duplicateOf && <div className="msg-warn small">既存の「{c.duplicateOf.title}」と重複している可能性があります</div>}
                    {c.duplicateInFile !== null && <div className="msg-warn small">このJSON内の #{c.duplicateInFile + 1} と重複している可能性があります</div>}
                    {c.warnings.map((w, i) => (
                      <div key={i} className="msg-warn small">
                        {w}
                      </div>
                    ))}
                  </div>
                </label>
              </li>
            ))}
          </ul>
          <div className="save-bar">
            <div className="save-status">
              {selected.size}件を選択中
              {selected.size > 0 &&
                `（${Object.entries(selCounts)
                  .map(([c, n]) => `${CATEGORY_DEFS[c as Category].shortLabel}${n}`)
                  .join('・')}）`}
            </div>
            <button className="btn btn-primary" disabled={busy || selected.size === 0} onClick={commit}>
              {busy ? '登録中…' : `${selected.size}件を登録`}
            </button>
          </div>
          <p className="hint">画像はJSONに含まれません。登録後、各記録の編集画面から追加してください。</p>
        </>
      )}
    </div>
  );
}
