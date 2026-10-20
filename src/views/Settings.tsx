import { useEffect, useState } from 'react';
import { saveSettings, updateState } from '../db/repo';
import { useAppState, useRecords, useSettings } from '../ui/hooks';
import { getStorageInfo, isStandalone, requestPersist, type StorageInfo } from '../lib/storage';
import { buildAiPrompt } from '../lib/aiPrompt';
import { formatBytes, formatDateTime } from '../lib/util';
import { useCopy, useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { href } from '../ui/router';
import { APP_VERSION } from '../lib/backup';
import { DB_SCHEMA_VERSION } from '../db/db';
import type { AppSettings } from '../db/types';

export function SettingsView() {
  const settings = useSettings();
  const st = useAppState();
  const records = useRecords();
  const copy = useCopy();
  const { toast, confirm } = useFeedback();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const refresh = () => getStorageInfo().then(setInfo);
  useEffect(() => {
    refresh();
  }, []);

  const set = async (patch: Partial<AppSettings>) => {
    try {
      await saveSettings(patch);
      toast('設定を保存しました');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const persist = async () => {
    const r = await requestPersist();
    await updateState({ persistRequested: r });
    await refresh();
    if (r === true) toast('保存領域の保護（永続化）が許可されました。ただし完全に消えない保証ではありません。', 'info');
    else if (r === false) toast('このブラウザでは永続化が許可されませんでした。こまめなバックアップをおすすめします。', 'info');
    else toast('このブラウザは永続化の要求に対応していません。', 'info');
  };

  const trashCount = (records ?? []).filter((r) => r.deletedAt).length;

  return (
    <div className="page settings">
      <h1 className="page-title">設定</h1>

      <section className="panel">
        <h2>
          <Icon name="shield" size={18} /> データ保護
        </h2>
        <a className="menu-item" href={href('/backup')}>
          <span>
            バックアップと復元
            <small>{st?.lastBackupAt ? `最終作成 ${formatDateTime(st.lastBackupAt)}` : 'まだ作成していません'}</small>
          </span>
          <Icon name="right" size={18} />
        </a>
        <a className="menu-item" href={href('/trash')}>
          <span>
            ゴミ箱
            <small>{trashCount}件</small>
          </span>
          <Icon name="right" size={18} />
        </a>
        <div className="menu-item static">
          <span>
            端末の保存領域
            <small>
              {info?.usage != null ? `使用 ${formatBytes(info.usage)}` : '使用量は取得できません'}
              {info?.quota != null ? ` / 目安の上限 ${formatBytes(info.quota)}` : ''}
            </small>
            <small>
              保護（永続化）：{info?.persisted === true ? '許可済み' : info?.persisted === false ? '未許可' : '非対応または不明'}
            </small>
          </span>
          {info?.persisted !== true && (
            <button className="btn btn-small" onClick={persist}>
              要求する
            </button>
          )}
        </div>
        <p className="hint">永続化が許可されても、端末の容量不足・ブラウザのデータ消去・アプリの削除などでデータが消える可能性はあります。いちばん確実な対策はバックアップです。</p>
      </section>

      <section className="panel">
        <h2>
          <Icon name="upload" size={18} /> 一括登録
        </h2>
        <a className="menu-item" href={href('/import/github')}>
          <span>
            GitHubの公開リポジトリから登録
            <small>ユーザー名：{settings.githubUser}</small>
          </span>
          <Icon name="right" size={18} />
        </a>
        <a className="menu-item" href={href('/import/json')}>
          <span>
            JSONから登録
            <small>ChatGPT・Claudeで作ったJSONを貼り付け／ファイル選択</small>
          </span>
          <Icon name="right" size={18} />
        </a>
        <button className="menu-item" onClick={() => copy(buildAiPrompt(), 'ChatGPT用の依頼文')}>
          <span>
            ChatGPT用の依頼文をコピー
            <small>別の会話に貼ると、にゅりログ形式のJSONを出してもらえます</small>
          </span>
          <Icon name="copy" size={18} />
        </button>
      </section>

      <section className="panel">
        <h2>
          <Icon name="image" size={18} /> 画像の軽量化
        </h2>
        <NumberSetting label="保存用画像の長辺（px）" value={settings.imageMaxEdge} min={640} max={4096} step={10} onSave={(v) => set({ imageMaxEdge: v })} />
        <NumberSetting label="圧縮品質（0.5〜0.95）" value={settings.imageQuality} min={0.5} max={0.95} step={0.01} onSave={(v) => set({ imageQuality: v })} />
        <NumberSetting label="サムネイルの長辺（px）" value={settings.thumbMaxEdge} min={160} max={800} step={10} onSave={(v) => set({ thumbMaxEdge: v })} />
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.keepOriginal}
            onChange={async (e) => {
              if (e.target.checked) {
                const ok = await confirm({
                  title: '元画像も保存しますか？',
                  body: 'iPhoneの写真は1枚2〜5MB程度あります。軽量化した画像に加えて元画像も保存するため、使う容量が数倍〜10倍ほどに増え、バックアップZIPも大きくなります。これから追加する画像にだけ適用されます。',
                  okLabel: '元画像も保存する',
                });
                if (!ok) return;
              }
              set({ keepOriginal: e.target.checked });
            }}
          />
          元画像も保存する（容量が大きく増えます）
        </label>
        <p className="hint">変更はこれから追加する画像に適用されます。登録済みの画像は変わりません。</p>
      </section>

      <section className="panel">
        <h2>
          <Icon name="history" size={18} /> 履歴とお知らせ
        </h2>
        <NumberSetting label="変更履歴の保存数（記録ごと）" value={settings.historyLimit} min={1} max={100} step={1} onSave={(v) => set({ historyLimit: Math.round(v) })} />
        <NumberSetting label="バックアップの案内：前回から何日たったら" value={settings.reminderDays} min={1} max={90} step={1} onSave={(v) => set({ reminderDays: Math.round(v) })} />
        <NumberSetting label="バックアップの案内：何件変更したら" value={settings.reminderChanges} min={1} max={500} step={1} onSave={(v) => set({ reminderChanges: Math.round(v) })} />
        <NumberSetting label="分割バックアップの1ファイルの上限（MB）" value={settings.splitBackupMB} min={20} max={1000} step={10} onSave={(v) => set({ splitBackupMB: Math.round(v) })} />
      </section>

      <section className="panel">
        <h2>
          <Icon name="info" size={18} /> このアプリについて
        </h2>
        <a className="menu-item" href={href('/guide')}>
          <span>
            使い方・ホーム画面への追加
            <small>{isStandalone() ? 'ホーム画面アプリとして起動中' : 'ブラウザで開いています'}</small>
          </span>
          <Icon name="right" size={18} />
        </a>
        <p className="hint">
          にゅりログ v{APP_VERSION}（データ形式 v{DB_SCHEMA_VERSION}・ビルド {__BUILD_ID__.slice(0, 16)}）。データはこの端末のこのブラウザ内（IndexedDB）にだけ保存され、外部へ自動送信しません。通信するのはGitHubの公開情報を取得するときだけです。
        </p>
      </section>
    </div>
  );
}

function NumberSetting({ label, value, min, max, step, onSave }: { label: string; value: number; min: number; max: number; step: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v);
  const valid = Number.isFinite(n) && n >= min && n <= max;
  return (
    <label className="field inline">
      <span className="field-label">{label}</span>
      <span className="inline-form">
        <input type="number" inputMode="decimal" value={v} min={min} max={max} step={step} onChange={(e) => setV(e.target.value)} className={valid ? '' : 'invalid'} />
        <button type="button" className="btn btn-small" disabled={!valid || n === value} onClick={() => onSave(n)}>
          保存
        </button>
      </span>
    </label>
  );
}
