export type StorageErrorKind = 'quota' | 'blocked' | 'unavailable' | 'unknown';

export class StorageError extends Error {
  kind: StorageErrorKind;
  cause?: unknown;
  constructor(kind: StorageErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageError';
    this.kind = kind;
    this.cause = cause;
  }
}

function names(err: unknown): string[] {
  const out: string[] = [];
  let e: unknown = err;
  for (let i = 0; i < 5 && e && typeof e === 'object'; i++) {
    const o = e as { name?: string; inner?: unknown; cause?: unknown; message?: string };
    if (o.name) out.push(o.name);
    if (o.message && /quota/i.test(o.message)) out.push('QuotaExceededError');
    e = o.inner ?? o.cause;
  }
  return out;
}

/** IndexedDB/Dexie の例外を、利用者に伝わる言葉に変換する */
export function toStorageError(err: unknown, action = '保存'): StorageError {
  if (err instanceof StorageError) return err;
  const ns = names(err);
  if (ns.includes('QuotaExceededError')) {
    return new StorageError(
      'quota',
      `端末の保存容量が足りず、${action}できませんでした。不要な画像やゴミ箱の記録を整理するか、バックアップを取ってから容量を空けてください。`,
      err,
    );
  }
  if (ns.includes('InvalidStateError') || ns.includes('MissingAPIError') || ns.includes('OpenFailedError')) {
    return new StorageError(
      'unavailable',
      `データベースを開けないため${action}できませんでした。プライベートブラウズ中でないか確認し、アプリを再起動してください。`,
      err,
    );
  }
  if (ns.includes('VersionError') || ns.includes('DatabaseClosedError')) {
    return new StorageError('blocked', `別のタブや古い版のアプリが開いているため${action}できませんでした。ほかのタブを閉じて再読み込みしてください。`, err);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new StorageError('unknown', `${action}に失敗しました（${msg}）`, err);
}
