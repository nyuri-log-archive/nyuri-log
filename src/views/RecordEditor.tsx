import { useCallback, useEffect, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_DEFS, IMAGE_CAPTION_PRESETS, type Category } from '../lib/categories';
import { changeCategory, deleteDraft, getDraft, getRecord, newRecord, putImage, saveDraft, saveRecord } from '../db/repo';
import type { ImageRef, RecordItem } from '../db/types';
import { processImage, ImageProcessError } from '../lib/image';
import { formatDateTime } from '../lib/util';
import { useSettings } from '../ui/hooks';
import { goBack, navigate, setNavigationGuard } from '../ui/router';
import { AutoTextarea, Field, TagInput, UrlListInput } from '../components/FormParts';
import { Thumb } from '../components/Images';
import { Icon } from '../components/Icon';
import { useFeedback } from '../components/Feedback';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface DraftForm {
  record: RecordItem;
  baseUpdatedAt: number | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function RecordEditor({ id, newCategory }: { id?: string; newCategory?: Category }) {
  const settings = useSettings();
  const { toast, confirm } = useFeedback();
  const draftKey = id ? `edit:${id}` : `new:${newCategory ?? 'memo'}`;

  const [original, setOriginal] = useState<RecordItem | null>(null);
  const [rec, setRec] = useState<RecordItem | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [draftOffer, setDraftOffer] = useState<{ form: DraftForm; savedAt: number; conflict: boolean } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [imgBusy, setImgBusy] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<string[]>([]);
  const [draftState, setDraftState] = useState<'none' | 'saved' | 'error'>('none');

  const dirty = !!rec && !!original && !same(rec, original);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty || saveState === 'saving' || imgBusy !== null;
  const recRef = useRef(rec);
  recRef.current = rec;

  // 読み込み
  useEffect(() => {
    let alive = true;
    (async () => {
      const base = id ? await getRecord(id) : newRecord(newCategory ?? 'memo');
      if (!alive) return;
      if (!base) {
        setNotFound(true);
        return;
      }
      setOriginal(base);
      setRec(base);
      const d = await getDraft(draftKey);
      const form = d?.form as DraftForm | undefined;
      if (alive && d && form?.record && !same(form.record, base)) {
        setDraftOffer({ form, savedAt: d.savedAt, conflict: !!id && form.baseUpdatedAt !== base.updatedAt });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, newCategory, draftKey]);

  // 下書きの自動保存（入力が止まって0.7秒後）
  useEffect(() => {
    if (!rec || !original || draftOffer) return;
    if (!dirty) return;
    const h = setTimeout(() => {
      saveDraft(draftKey, { record: rec, baseUpdatedAt: id ? original.updatedAt : null } satisfies DraftForm)
        .then(() => setDraftState('saved'))
        .catch(() => setDraftState('error'));
    }, 700);
    return () => clearTimeout(h);
  }, [rec, original, dirty, draftKey, id, draftOffer]);

  // 画面を離れる前の確認
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    setNavigationGuard(() => !dirtyRef.current || window.confirm('保存していない変更があります。\n下書きは端末に残るので、次にこの画面を開くと復元できます。\n移動しますか？'));
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      setNavigationGuard(null);
    };
  }, []);

  // 画面を閉じる瞬間にも下書きを確実に書く
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && recRef.current) saveDraft(draftKey, { record: recRef.current, baseUpdatedAt: id ? original?.updatedAt ?? null : null }).catch(() => undefined);
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [draftKey, id, original]);

  const update = useCallback((patch: Partial<RecordItem>) => {
    setRec((r) => (r ? { ...r, ...patch } : r));
    setSaveState((s) => (s === 'saved' ? 'idle' : s));
  }, []);
  const setField = (key: string, value: string) => setRec((r) => (r ? { ...r, fields: { ...r.fields, [key]: value } } : r));

  if (notFound) return <div className="page"><p className="empty">編集する記録が見つかりません。</p></div>;
  if (!rec || !original) return <div className="page"><p className="empty">読み込み中…</p></div>;

  const def = CATEGORY_DEFS[rec.category];
  const statuses = def.statuses.includes(rec.status) || !rec.status ? def.statuses : [...def.statuses, rec.status];

  const save = async () => {
    if (saveState === 'saving' || imgBusy) return;
    setSaveState('saving');
    setSaveError('');
    try {
      const saved = await saveRecord(rec);
      await deleteDraft(draftKey).catch(() => undefined);
      setOriginal(saved);
      setRec(saved);
      setSaveState('saved');
      dirtyRef.current = false;
      toast('保存しました');
      navigate(`/r/${saved.id}`, { replace: true, force: true });
    } catch (e) {
      setSaveState('error');
      setSaveError((e as Error).message);
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = [...files];
    const errors: string[] = [];
    let added = 0;
    for (let i = 0; i < list.length; i++) {
      setImgBusy(`画像を軽量化しています（${i + 1}/${list.length}）…`);
      try {
        const processed = await processImage(list[i], { maxEdge: settings.imageMaxEdge, quality: settings.imageQuality, thumbEdge: settings.thumbMaxEdge, keepOriginal: settings.keepOriginal });
        await putImage(processed);
        const ref: ImageRef = { id: processed.meta.id, caption: '' };
        setRec((r) => (r ? { ...r, images: [...r.images, ref], coverImageId: r.coverImageId ?? ref.id } : r));
        added++;
      } catch (e) {
        errors.push(e instanceof ImageProcessError ? `${e.fileName}：${e.message}` : `${list[i].name}：${(e as Error).message}`);
      }
    }
    setImgBusy(null);
    setImgErrors(errors);
    if (added) toast(`${added}枚の画像を追加しました（記録の「保存」で確定します）`, 'info');
    if (errors.length) toast(`${errors.length}枚の画像を追加できませんでした。入力内容はそのままです。`, 'error');
  };

  const moveImage = (i: number, d: -1 | 1) => {
    const arr = [...rec.images];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    update({ images: arr });
  };

  const removeImage = async (im: ImageRef) => {
    const ok = await confirm({ title: 'この画像を記録から外しますか？', body: '保存するまでは「やめる」で元に戻せます。保存後も、変更履歴から以前の版に戻せば画像も戻ります。', okLabel: '外す', danger: true });
    if (!ok) return;
    const images = rec.images.filter((x) => x.id !== im.id);
    update({ images, coverImageId: rec.coverImageId === im.id ? images[0]?.id ?? null : rec.coverImageId });
  };

  const restoreDraft = () => {
    if (!draftOffer) return;
    setRec({ ...draftOffer.form.record, id: rec.id });
    setDraftOffer(null);
    toast('下書きを復元しました。「保存」で確定します。', 'info');
  };
  const discardDraft = async () => {
    const ok = await confirm({ title: '下書きを破棄しますか？', body: '保存していない入力内容が消えます。', okLabel: '破棄する', danger: true });
    if (!ok) return;
    await deleteDraft(draftKey);
    setDraftOffer(null);
  };

  return (
    <div className="page editor" style={{ ['--cat' as string]: def.color, ['--cat-strong' as string]: def.colorStrong }}>
      <div className="detail-top">
        <button className="icon-btn" onClick={() => goBack(id ? `/r/${id}` : '/')} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1 className="page-title small">{id ? '記録を編集' : '新しく記録する'}</h1>
        <span />
      </div>

      {draftOffer && (
        <div className="banner banner-warn">
          <div>
            保存していない下書きがあります（{formatDateTime(draftOffer.savedAt)}）。
            {draftOffer.conflict && <strong> 下書きの後に記録が別の画面で更新されています。復元すると今の内容を下書きで上書きします（保存前なら取り消せます）。</strong>}
          </div>
          <div className="banner-actions">
            <button className="btn btn-small btn-primary" onClick={restoreDraft}>
              下書きを復元
            </button>
            <button className="btn btn-small" onClick={discardDraft}>
              破棄
            </button>
          </div>
        </div>
      )}

      <Field label="カテゴリー" hint={rec.category !== original.category ? 'カテゴリーを変えても、本文・画像・入力済みの項目は消えずに保持されます。' : undefined}>
        <select value={rec.category} onChange={(e) => setRec(changeCategory(rec, e.target.value as Category))}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_DEFS[c].label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={def.titleLabel}>
        <input value={rec.title} onChange={(e) => update({ title: e.target.value })} placeholder={rec.category === 'memo' ? '空欄なら本文の先頭から自動で付けます' : ''} />
      </Field>

      {def.fields
        .filter((f) => !f.readonly || rec.fields[f.key])
        .map((f) => (
          <Field key={f.key} label={f.label} hint={f.readonly ? 'GitHubから取り込んだ参考情報です（制作日とは別）' : undefined}>
            {f.kind === 'textarea' || f.kind === 'prompt' ? (
              <AutoTextarea className={f.kind === 'prompt' ? 'prompt' : ''} value={rec.fields[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} minRows={f.kind === 'prompt' ? 4 : 3} autoCapitalize="off" spellCheck={f.kind !== 'prompt'} />
            ) : (
              <input
                value={rec.fields[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                readOnly={f.readonly}
                inputMode={f.kind === 'url' ? 'url' : undefined}
                autoCapitalize={f.kind === 'url' ? 'off' : undefined}
                className={f.kind === 'url' && rec.fields[f.key] && !/^https?:\/\//i.test(rec.fields[f.key].trim()) ? 'invalid' : ''}
              />
            )}
          </Field>
        ))}

      <Field label={def.bodyLabel}>
        <AutoTextarea value={rec.body} onChange={(e) => update({ body: e.target.value })} minRows={rec.category === 'memo' ? 6 : 3} />
      </Field>

      <section className="field">
        <span className="field-label">
          {def.imageLabel}
          <span className="count">{rec.images.length}</span>
        </span>
        <div className="img-edit-list">
          {rec.images.map((im, i) => (
            <div key={im.id} className={`img-edit ${rec.coverImageId === im.id ? 'is-cover' : ''}`}>
              <Thumb id={im.id} category={rec.category} alt={im.caption || `画像${i + 1}`} small />
              <div className="img-edit-main">
                <input value={im.caption} placeholder="説明（任意）" onChange={(e) => update({ images: rec.images.map((x) => (x.id === im.id ? { ...x, caption: e.target.value } : x)) })} aria-label={`画像${i + 1}の説明`} />
                <div className="img-edit-actions">
                  {(IMAGE_CAPTION_PRESETS[rec.category] ?? []).map((p) => (
                    <button key={p} type="button" className="chip tiny" onClick={() => update({ images: rec.images.map((x) => (x.id === im.id ? { ...x, caption: p } : x)) })}>
                      {p}
                    </button>
                  ))}
                </div>
                <div className="img-edit-actions">
                  <button type="button" className={`chip tiny ${rec.coverImageId === im.id ? 'on' : ''}`} onClick={() => update({ coverImageId: im.id })}>
                    {rec.coverImageId === im.id ? '★ 代表画像' : '代表にする'}
                  </button>
                  <button type="button" className="icon-btn small" disabled={i === 0} onClick={() => moveImage(i, -1)} aria-label="前へ">
                    <Icon name="left" size={16} />
                  </button>
                  <button type="button" className="icon-btn small" disabled={i === rec.images.length - 1} onClick={() => moveImage(i, 1)} aria-label="後ろへ">
                    <Icon name="right" size={16} />
                  </button>
                  <button type="button" className="icon-btn small danger" onClick={() => removeImage(im)} aria-label="画像を外す">
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <label className={`btn add-image ${imgBusy ? 'disabled' : ''}`}>
          <Icon name="image" size={18} /> {imgBusy ?? '画像を追加（写真・ファイル）'}
          <input type="file" accept="image/*,.heic,.heif" multiple hidden disabled={!!imgBusy} onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }} />
        </label>
        <span className="hint">
          長辺{settings.imageMaxEdge}px・品質{settings.imageQuality}に自動で軽量化して保存します{settings.keepOriginal ? '（元画像も保存する設定です）' : '（元画像は保存しません）'}。
        </span>
        {imgErrors.length > 0 && (
          <ul className="msg-error" role="alert">
            {imgErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
      </section>

      <Field label="タグ">
        <TagInput tags={rec.tags} onChange={(tags) => update({ tags })} />
      </Field>

      <div className="two-col">
        <Field label="ステータス">
          <select value={rec.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">未設定</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label={def.dateLabel}>
          <div className="date-row">
            <input type="date" aria-label={def.dateLabel} value={rec.madeDate ?? ''} onChange={(e) => update({ madeDate: e.target.value || null })} />
            {rec.madeDate && (
              <button type="button" className="icon-btn small" onClick={() => update({ madeDate: null })} aria-label="日付をクリア">
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        </Field>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={rec.favorite} onChange={(e) => update({ favorite: e.target.checked })} />
        <Icon name="star" size={16} filled={rec.favorite} /> お気に入り
      </label>

      <Field label="関連URL">
        <UrlListInput urls={rec.urls} onChange={(urls) => update({ urls })} />
      </Field>

      {id && (
        <p className="hint meta-line">
          登録 {formatDateTime(original.createdAt)} ・ 最終更新 {formatDateTime(original.updatedAt)}
        </p>
      )}

      <div className="save-bar">
        <div className="save-status" aria-live="polite">
          {saveState === 'saving' && '保存中…'}
          {saveState === 'saved' && '保存済み'}
          {saveState === 'error' && <span className="msg-error">保存に失敗しました</span>}
          {saveState === 'idle' && (dirty ? (draftState === 'error' ? '未保存（下書きの保護に失敗）' : '未保存の変更あり（下書き保護中）') : '変更なし')}
        </div>
        <button className="btn" onClick={() => goBack(id ? `/r/${id}` : '/')}>
          やめる
        </button>
        <button className="btn btn-primary" onClick={save} disabled={saveState === 'saving' || !!imgBusy || (!dirty && saveState !== 'error')}>
          {saveState === 'error' ? '再試行' : saveState === 'saving' ? '保存中…' : '保存'}
        </button>
      </div>
      {saveState === 'error' && (
        <div className="banner banner-error" role="alert">
          {saveError}
          <br />
          入力内容は消えていません。もう一度「再試行」を押してください。
        </div>
      )}
    </div>
  );
}
