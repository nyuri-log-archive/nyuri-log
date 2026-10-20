import { useLiveQuery } from 'dexie-react-hooks';
import { getDB } from '../db/db';
import { DEFAULT_SETTINGS, DEFAULT_STATE, type AppSettings, type AppState, type RecordItem } from '../db/types';

/** 全記録（画像本体は含まない）。変更があれば自動で再描画 */
export function useRecords(): RecordItem[] | undefined {
  return useLiveQuery(() => getDB().records.toArray(), []);
}

export function useRecord(id: string | undefined): RecordItem | null | undefined {
  return useLiveQuery(async () => (id ? (await getDB().records.get(id)) ?? null : null), [id]);
}

export function useSettings(): AppSettings {
  const row = useLiveQuery(() => getDB().meta.get('settings'), []);
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
}

export function useAppState(): AppState | undefined {
  const row = useLiveQuery(async () => (await getDB().meta.get('state')) ?? null, []);
  if (row === undefined) return undefined;
  return { ...DEFAULT_STATE, ...((row?.value as Partial<AppState>) ?? {}) };
}

export function needsBackupReminder(st: AppState, s: AppSettings, recordCount: number, now = Date.now()): boolean {
  if (recordCount === 0) return false;
  if (st.reminderSnoozedUntil && now < st.reminderSnoozedUntil) return false;
  const days = st.lastBackupAt ? (now - st.lastBackupAt) / 86_400_000 : Infinity;
  if (!st.lastBackupAt) return st.changesSinceBackup >= 3 || recordCount >= 3;
  return days >= s.reminderDays || st.changesSinceBackup >= s.reminderChanges;
}
