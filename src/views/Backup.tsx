import { useEffect, useState } from 'react';
import {
  applyMergeRestore,
  applyReplaceRestore,
  buildRestorePlan,
  createBackup,
  deliverFile,
  markBackupCreated,
  parseBackupZip,
  planBackup,
  type BackupPart,
  type BackupPlan,
  type DeliverResult,
  type RestorePlan,
} from '../lib/backup';
import { updateState } from '../db/repo';
import { useAppState, useSettings } from '../ui/hooks';
import { formatBytes, formatDateTime } from '../lib/util';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { goBack } from '../ui/router';

const WARN_TOTAL_BYTES = 600 * 1024 * 1024;

export function BackupView() {
  return (
    <div className="page">
      <div className="detail-top">
        <button className="icon-btn" onClick={() => goBack('/settings')} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1 className="page-title small">バックアップと復元</h1>
        <span />
      </div>
      <CreateBackup />
      <RestoreBackup />
    </div>
  );
}

function CreateBackup() {
  const st = useAppState();
  const settings = useSettings();
  const { toast } = useFeedback();
  const [plan, setPlan] = useState<BackupPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [parts, setParts] = useState<BackupPart[]>([]);
  const [delivered, setDelivered] = useState<Record<number, DeliverResult>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    planBackup().then(setPlan).catch(() => undefined);
  }, [settings.splitBackupMB]);

  const create = async () => {
    setError('');
    setParts([]);
    setDelivered({});
    try {
      const ps = await createBackup({ onProgress: setBusy });
      setParts(ps);
    } catch (e) {
      setError(`バックアップを作成できませんでした：${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const deliver = async (p: BackupPart) => {
    try {
      const res = await deliverFile(p.blob, p.filename);
      const next = { ...delivered, [p.part]: res };
      setDelivered(next);
      if (res === 'cancelled') {
        toast('共有がキャンセルされました。ファイルはまだ保存されていません。', 'info');
        return;
      }
      // すべてのパートを渡し終えたら「バックアップ作成済み」として記録（保管の確認は別）
      if (parts.every((x) => next[x.part] && next[x.part] !== 'cancelled')) await markBackupCreated(p.filename);
    } catch (e) {
      toast(`ファイルを渡せませんでした：${(e as Error).message}`, 'error');
    }
  };

  const allHandedOver = parts.length > 0 && parts.every((p) => delivered[p.part] && delivered[p.part] !== 'cancelled');

  return (
    <section className="panel">
      <h2>
        <Icon name="download" size={18} /> バックアップを作る
      </h2>
      <p>全記録・画像・変更履歴・設定を1つのZIPにまとめ、iPhoneの「ファイル」アプリ（iCloud Driveなど）に保存します。</p>
      {st && (
        <dl className="kv-list">
          <div>
            <dt>最後にZIPを作成</dt>
            <dd>{st.lastBackupAt ? formatDateTime(st.lastBackupAt) : 'まだありません'}</dd>
          </div>
          <div>
            <dt>保存先を確認</dt>
            <dd>{st.lastBackupConfirmedAt ? formatDateTime(st.lastBackupConfirmedAt) : '未確認'}</dd>
          </div>
          <div>
            <dt>その後の変更</dt>
            <dd>{st.changesSinceBackup}件</dd>
          </div>
        </dl>
      )}
      {plan && (
        <p className="hint">
          記録{plan.recordCount}件・画像{plan.imageCount}枚、推定 {formatBytes(plan.totalBytes)}
          {plan.parts.length > 1 && ` → ${plan.parts.length}個のZIPに分割（1個あたり最大${settings.splitBackupMB}MB）`}
        </p>
      )}
      {plan && plan.totalBytes > WARN_TOTAL_BYTES && (
        <div className="banner banner-warn">画像の合計が大きいため、作成に時間がかかり、iPhoneのメモリが足りなくなる可能性があります。分割サイズを小さくすると（設定画面）安全です。</div>
      )}
      <button className="btn btn-primary wide" onClick={create} disabled={!!busy}>
        {busy ?? 'バックアップZIPを作成'}
      </button>
      {error && (
        <p className="msg-error" role="alert">
          {error}
        </p>
      )}
      {parts.length > 0 && (
        <div className="backup-result">
          <p className="ok-text">
            ✓ ZIPファイルを作成しました（まだ端末のどこにも保存されていません）。下のボタンから「ファイルに保存」を選んでください。
          </p>
          {parts.map((p) => (
            <div key={p.part} className="part-row">
              <div>
                <div className="mono">{p.filename}</div>
                <div className="hint">
                  {formatBytes(p.size)}
                  {delivered[p.part] === 'shared' && ' ・ 共有シートに渡しました'}
                  {delivered[p.part] === 'downloaded' && ' ・ ダウンロードを開始しました'}
                  {delivered[p.part] === 'cancelled' && ' ・ キャンセルされました'}
                </div>
              </div>
              <button className="btn btn-small btn-primary" onClick={() => deliver(p)}>
                {delivered[p.part] && delivered[p.part] !== 'cancelled' ? 'もう一度' : '保存・共有'}
              </button>
            </div>
          ))}
          {allHandedOver && (
            <div className="banner banner-info">
              <div>
                このアプリからは、iCloud Drive などに実際に保存できたかを確認できません。「ファイル」アプリで <span className="mono">{parts[0].filename}</span> があることを確かめてから、下のボタンを押してください。
              </div>
              <button
                className="btn btn-small"
                onClick={async () => {
                  await updateState({ lastBackupConfirmedAt: Date.now() });
                  toast('保存を確認済みとして記録しました');
                }}
              >
                「ファイル」アプリで確認した
              </button>
            </div>
          )}
        </div>
      )}
      <p className="hint">ZIPは暗号化されていません。パスワードなどの秘密情報を保存する用途には向きません。</p>
    </section>
  );
}

function RestoreBackup() {
  const { toast, confirm } = useFeedback();
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dupMode, setDupMode] = useState<'skip' | 'copy'>('skip');
  const [done, setDone] = useState('');
  const [replaceBackupDone, setReplaceBackupDone] = useState(false);
  const [restoreSettings, setRestoreSettings] = useState(true);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setPlan(null);
    setDone('');
    setReplaceBackupDone(false);
    try {
      const parsed = [];
      for (const f of [...files]) {
        setBusy(`${f.name} を検査しています…`);
        parsed.push(await parseBackupZip(f.name, new Uint8Array(await f.arrayBuffer())));
      }
      setBusy('既存データと照合しています…');
      setPlan(await buildRestorePlan(parsed));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const merge = async () => {
    if (!plan) return;
    const ok = await confirm({
      title: '追加復元を実行しますか？',
      body: (
        <>
          <p>新しい記録 {plan.newRecords.length}件・画像 {plan.newImages.length}枚を追加します。</p>
          <p>今ある記録は削除・上書きしません。{plan.duplicateRecords.length > 0 && (dupMode === 'skip' ? `同じ記録 ${plan.duplicateRecords.length}件はスキップします。` : `内容が違う同じ記録は「（復元）」付きの別記録として追加します。`)}</p>
        </>
      ),
      okLabel: '復元する',
    });
    if (!ok) return;
    setBusy('復元しています…');
    try {
      const res = await applyMergeRestore(plan, dupMode);
      setDone(`復元しました：記録 ${res.addedRecords + res.copiedRecords}件、画像 ${res.addedImages}枚、履歴 ${res.addedHistory}件（スキップ ${res.skippedRecords}件）`);
      toast('復元しました');
      setPlan(null);
    } catch (e) {
      setError(`復元できませんでした。既存のデータは変更されていません。（${(e as Error).message}）`);
    } finally {
      setBusy(null);
    }
  };

  const backupBeforeReplace = async () => {
    setBusy('置き換え前のバックアップを作成中…');
    try {
      const parts = await createBackup({ onProgress: setBusy });
      let handed = 0;
      for (const p of parts) {
        const res = await deliverFile(p.blob, p.filename);
        if (res !== 'cancelled') handed++;
      }
      if (handed === parts.length) {
        await markBackupCreated(parts[parts.length - 1].filename);
        setReplaceBackupDone(true);
        toast('現在のデータのバックアップを渡しました。保存できたか確認してから進んでください。', 'info');
      } else {
        toast('バックアップの保存がキャンセルされました。全置換は実行できません。', 'error');
      }
    } catch (e) {
      setError(`置き換え前のバックアップに失敗しました。全置換は実行できません。（${(e as Error).message}）`);
    } finally {
      setBusy(null);
    }
  };

  const replace = async () => {
    if (!plan || !replaceBackupDone) return;
    const first = await confirm({
      title: '本当に全置換しますか？',
      body: '今この端末にある記録・画像・履歴・下書きをすべて消し、バックアップの内容に置き換えます。',
      okLabel: '次へ',
      danger: true,
    });
    if (!first) return;
    const second = await confirm({
      title: '最終確認',
      body: `置き換え後：記録 ${plan.records.length}件・画像 ${plan.images.size}枚。置き換え前のバックアップZIPが「ファイル」アプリに保存されていることを確認しましたか？`,
      okLabel: '全置換を実行',
      danger: true,
      typeToConfirm: '置き換える',
    });
    if (!second) return;
    setBusy('全置換しています…');
    try {
      await applyReplaceRestore(plan, { restoreSettings });
      setDone('全置換が完了しました。');
      setPlan(null);
      toast('全置換が完了しました');
    } catch (e) {
      setError(`全置換できませんでした。元のデータはそのまま残っています。（${(e as Error).message}）`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel">
      <h2>
        <Icon name="upload" size={18} /> バックアップから復元
      </h2>
      <p>にゅりログのバックアップZIPを選んでください。分割されている場合は、同じ日時のファイルをまとめて選べます。</p>
      <label className={`btn wide ${busy ? 'disabled' : ''}`}>
        {busy ?? 'ZIPファイルを選ぶ'}
        <input type="file" accept=".zip,application/zip" multiple hidden disabled={!!busy} onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }} />
      </label>
      {error && (
        <p className="msg-error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="ok-text">✓ {done}</p>}

      {plan && (
        <div className="restore-preview">
          <h3>復元内容の確認</h3>
          <p className="ok-text">✓ 形式・バージョン・チェックサムの検査に合格しました</p>
          <dl className="kv-list">
            <div>
              <dt>作成日時</dt>
              <dd>{formatDateTime(Date.parse(plan.createdAt))}</dd>
            </div>
            <div>
              <dt>ファイル</dt>
              <dd>
                {plan.partCount > 1 ? `分割 ${plan.partsGiven.join('・')} / 全${plan.partCount}` : '1個'}
              </dd>
            </div>
            <div>
              <dt>記録</dt>
              <dd>
                {plan.records.length}件（うちゴミ箱 {plan.trashedCount}件）
              </dd>
            </div>
            <div>
              <dt>新しく追加</dt>
              <dd>
                記録 {plan.newRecords.length}件・画像 {plan.newImages.length}枚
              </dd>
            </div>
            <div>
              <dt>既にある記録</dt>
              <dd>
                {plan.duplicateRecords.length}件（うち内容が違う {plan.duplicateRecords.filter((d) => !d.same).length}件）
              </dd>
            </div>
          </dl>
          {plan.missingImages.length > 0 && (
            <div className="banner banner-warn">
              {plan.missingImages.length}枚の画像が、選んだファイルにも端末にもありません。
              {plan.partsGiven.length < plan.partCount ? '残りの分割ファイルも選ぶか、あとで追加復元してください（あとから足せます）。' : 'バックアップ作成時点で画像が欠けていた可能性があります。'}
            </div>
          )}
          {plan.duplicateRecords.length > 0 && (
            <fieldset className="radio-group">
              <legend>同じIDの記録の扱い</legend>
              <label>
                <input type="radio" checked={dupMode === 'skip'} onChange={() => setDupMode('skip')} /> スキップする（端末の内容を優先・推奨）
              </label>
              <label>
                <input type="radio" checked={dupMode === 'copy'} onChange={() => setDupMode('copy')} /> 内容が違うものは別の記録として追加する
              </label>
            </fieldset>
          )}
          <button className="btn btn-primary wide" onClick={merge} disabled={!!busy}>
            追加復元する（既存データは残す）
          </button>

          <details className="danger-zone">
            <summary>全置換で復元する（上級者向け）</summary>
            <p>端末の全データを消して、バックアップの内容に置き換えます。実行前に、今のデータのバックアップを必ず作ります。</p>
            {plan.settings && (
              <label className="check-row">
                <input type="checkbox" checked={restoreSettings} onChange={(e) => setRestoreSettings(e.target.checked)} /> 設定もバックアップの内容に戻す
              </label>
            )}
            <ol className="steps">
              <li>
                <button className="btn btn-small" onClick={backupBeforeReplace} disabled={!!busy || replaceBackupDone}>
                  {replaceBackupDone ? '✓ 今のデータのバックアップを渡しました' : '今のデータをバックアップして保存'}
                </button>
              </li>
              <li>
                <button className="btn btn-small btn-danger" onClick={replace} disabled={!!busy || !replaceBackupDone}>
                  全置換を実行
                </button>
              </li>
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}
