// navigator.storage の薄いラッパー。非対応環境では null を返す。

export interface StorageInfo {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  let persisted: boolean | null = null;
  let usage: number | null = null;
  let quota: number | null = null;
  try {
    if (s?.persisted) persisted = await s.persisted();
  } catch {
    /* 非対応 */
  }
  try {
    if (s?.estimate) {
      const e = await s.estimate();
      usage = e.usage ?? null;
      quota = e.quota ?? null;
    }
  } catch {
    /* 非対応 */
  }
  return { persisted, usage, quota };
}

/** 永続化を要求。結果は true/false、非対応なら null。true でも「絶対に消えない」保証ではない */
export async function requestPersist(): Promise<boolean | null> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* 非対応 */
  }
  return null;
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}
