import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { freshDB, fakeImage } from './helpers';
import { getRecord, listHistory, newRecord, saveRecord, saveSettings, moveToTrash, getSettings } from '../src/db/repo';
import { getDB } from '../src/db/db';
import {
  applyMergeRestore,
  applyReplaceRestore,
  buildRestorePlan,
  createBackup,
  parseBackupZip,
  planBackup,
  BackupError,
} from '../src/lib/backup';
import { sha256Hex } from '../src/lib/util';

async function blobBytes(b: Blob) {
  return new Uint8Array(await b.arrayBuffer());
}

async function seed() {
  const imgs = [await fakeImage(30_000, 1), await fakeImage(40_000, 2), await fakeImage(50_000, 3)];
  const oc = await saveRecord(newRecord('oc', { title: 'ミナ', body: '銀髪の司書\n改行あり', images: imgs.map((i) => ({ id: i.id, caption: '立ち絵' })), tags: ['和風'] }));
  await saveRecord({ ...oc, body: '更新後' }); // 履歴1件
  await saveRecord(newRecord('nai', { title: '水彩', fields: { positivePrompt: 'watercolor, {{masterpiece}}' } }));
  const trash = await saveRecord(newRecord('memo', { body: 'ゴミ箱の中' }));
  await moveToTrash(trash.id);
  return { imgs, oc };
}

beforeEach(async () => {
  await freshDB();
});

describe('ZIPバックアップの作成', () => {
  it('manifest・records・images・settings が入り、チェックサムが一致する', async () => {
    await seed();
    const [part] = await createBackup();
    expect(part.filename).toMatch(/^nyuri-log-backup_\d{8}-\d{4}\.zip$/);
    const entries = unzipSync(await blobBytes(part.blob));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.format).toBe('nyuri-log-backup');
    expect(manifest.counts).toMatchObject({ records: 2, trashed: 1, history: 1, images: 3, imagesInThisPart: 3 });
    expect(Object.keys(entries).filter((k) => k.startsWith('images/'))).toHaveLength(6);
    for (const [name, info] of Object.entries(manifest.files as Record<string, { sha256: string }>)) {
      expect(await sha256Hex(entries[name])).toBe(info.sha256);
    }
  });
});

describe('ZIPからの復元', () => {
  it('空の端末へ完全に復元でき、画像のバイト列が一致する', async () => {
    const { imgs, oc } = await seed();
    const [part] = await createBackup();
    const zip = await blobBytes(part.blob);
    await freshDB(); // 別の端末・消えた状態を想定
    const parsed = await parseBackupZip(part.filename, zip);
    const plan = await buildRestorePlan([parsed]);
    expect(plan.newRecords).toHaveLength(3);
    expect(plan.missingImages).toHaveLength(0);
    const res = await applyMergeRestore(plan);
    expect(res).toMatchObject({ addedRecords: 3, addedImages: 3, addedHistory: 1 });
    const got = await getRecord(oc.id);
    expect(got?.body).toBe('更新後');
    expect(got?.images.map((i) => i.caption)).toEqual(['立ち絵', '立ち絵', '立ち絵']);
    expect(await listHistory(oc.id)).toHaveLength(1);
    for (const m of imgs) {
      const full = await getDB().imageFull.get(m.id);
      expect(await sha256Hex(full!.data)).toBe(m.sha256);
      expect(await getDB().imageThumb.get(m.id)).toBeTruthy();
    }
    const trashed = (await getDB().records.toArray()).filter((r) => r.deletedAt);
    expect(trashed).toHaveLength(1);
  });

  it('追加復元は既存データを消さず、同じIDは初期状態でスキップする', async () => {
    const { oc } = await seed();
    const [part] = await createBackup();
    await saveRecord({ ...(await getRecord(oc.id))!, body: '端末側で編集した最新' });
    const mine = await saveRecord(newRecord('memo', { body: 'バックアップ後に書いたメモ' }));
    const plan = await buildRestorePlan([await parseBackupZip(part.filename, await blobBytes(part.blob))]);
    expect(plan.duplicateRecords).toHaveLength(3);
    expect(plan.duplicateRecords.find((d) => d.incoming.id === oc.id)?.same).toBe(false);
    await applyMergeRestore(plan, 'skip');
    expect((await getRecord(oc.id))?.body).toBe('端末側で編集した最新');
    expect(await getRecord(mine.id)).toBeTruthy();
    // 複製を選ぶと、内容が違う記録だけ別IDで追加
    const res = await applyMergeRestore(plan, 'copy');
    expect(res.copiedRecords).toBe(1);
    const copies = (await getDB().records.toArray()).filter((r) => r.title.endsWith('（復元）'));
    expect(copies).toHaveLength(1);
    expect(copies[0].body).toBe('更新後');
  });

  it('全置換は1トランザクションで入れ替え、設定も戻せる', async () => {
    await seed();
    await saveSettings({ githubUser: 'from-backup' });
    const [part] = await createBackup();
    await saveSettings({ githubUser: 'current' });
    const extra = await saveRecord(newRecord('memo', { body: '置換で消える' }));
    const plan = await buildRestorePlan([await parseBackupZip(part.filename, await blobBytes(part.blob))]);
    await applyReplaceRestore(plan, { restoreSettings: true });
    expect(await getRecord(extra.id)).toBeUndefined();
    expect(await getDB().records.count()).toBe(3);
    expect((await getSettings()).githubUser).toBe('from-backup');
  });
});

describe('分割バックアップ', () => {
  it('上限を超えると複数ZIPに分かれ、全部選ぶと完全に戻る。一部だけなら不足画像を報告する', async () => {
    const imgs = [];
    for (let i = 0; i < 4; i++) imgs.push(await fakeImage(9 * 1024 * 1024, i + 1)); // 9MB×4
    await saveRecord(newRecord('lora', { title: 'L', images: imgs.map((m) => ({ id: m.id, caption: '' })) }));
    const plan = await planBackup(20);
    expect(plan.parts.length).toBe(2);
    const parts = await createBackup({ partLimitMB: 20 });
    expect(parts).toHaveLength(2);
    expect(parts[1].filename).toContain('_part2of2');
    const bytes = await Promise.all(parts.map((p) => blobBytes(p.blob)));

    await freshDB();
    const only1 = await buildRestorePlan([await parseBackupZip(parts[0].filename, bytes[0])]);
    expect(only1.missingImages.length).toBeGreaterThan(0);
    await expect(applyReplaceRestore(only1, { restoreSettings: false })).rejects.toThrow(BackupError);
    await applyMergeRestore(only1);
    // 後から残りのパートを追加復元すると画像がそろう
    const p2 = await buildRestorePlan([await parseBackupZip(parts[1].filename, bytes[1])]);
    expect(p2.newRecords).toHaveLength(0);
    await applyMergeRestore(p2);
    for (const m of imgs) {
      const f = await getDB().imageFull.get(m.id);
      expect(await sha256Hex(f!.data)).toBe(m.sha256);
    }
  }, 60_000);
});

describe('壊れたバックアップと復元失敗', () => {
  it('ZIPではないファイルを拒否する', async () => {
    await expect(parseBackupZip('x.zip', strToU8('hello'))).rejects.toThrow(/ZIP/);
  });

  it('manifest が無いZIPを拒否する', async () => {
    await expect(parseBackupZip('x.zip', zipSync({ 'a.txt': strToU8('a') }))).rejects.toThrow(/manifest/);
  });

  it('中身が改ざん・破損していればチェックサムで検出する', async () => {
    await seed();
    const [part] = await createBackup();
    const entries = unzipSync(await blobBytes(part.blob));
    const imgName = Object.keys(entries).find((k) => k.endsWith('.full.jpg'))!;
    entries[imgName] = entries[imgName].slice();
    entries[imgName][10] ^= 0xff;
    await expect(parseBackupZip('bad.zip', zipSync(entries))).rejects.toThrow(/整合性/);
  });

  it('新しい形式のバックアップは読み込まない', async () => {
    await seed();
    const [part] = await createBackup();
    const entries = unzipSync(await blobBytes(part.blob));
    const m = JSON.parse(strFromU8(entries['manifest.json']));
    m.formatVersion = 99;
    entries['manifest.json'] = strToU8(JSON.stringify(m));
    await expect(parseBackupZip('new.zip', zipSync(entries))).rejects.toThrow(/新しい版/);
  });

  it('復元中に書き込みが失敗しても既存データはそのまま残り、途中までの復元も残らない', async () => {
    await seed();
    const [part] = await createBackup();
    const zip = await blobBytes(part.blob);
    await freshDB();
    const before = await saveRecord(newRecord('memo', { body: '守るべき既存データ' }));
    const plan = await buildRestorePlan([await parseBackupZip(part.filename, zip)]);
    const db = getDB();
    const orig = db.history.add.bind(db.history);
    const spy = vi.spyOn(db.history, 'add').mockImplementation(() => Dexie.Promise.reject(new DOMException('quota', 'QuotaExceededError')) as never);
    await expect(applyMergeRestore(plan)).rejects.toMatchObject({ kind: 'quota' });
    spy.mockRestore();
    void orig;
    expect(await db.records.count()).toBe(1);
    expect((await getRecord(before.id))?.body).toBe('守るべき既存データ');
    expect(await db.images.count()).toBe(0);
    expect(await db.imageFull.count()).toBe(0);

    // 全置換の失敗でも元データが残る
    const spy2 = vi.spyOn(db.records, 'bulkAdd').mockImplementation(() => Dexie.Promise.reject(new Error('boom')) as never);
    await expect(applyReplaceRestore(plan, { restoreSettings: false })).rejects.toThrow();
    spy2.mockRestore();
    expect((await getRecord(before.id))?.body).toBe('守るべき既存データ');
    expect(await db.records.count()).toBe(1);
  });

  it('別々のバックアップの分割ファイルを混ぜると拒否する', async () => {
    await seed();
    const [a] = await createBackup();
    const [b] = await createBackup();
    const pa = await parseBackupZip(a.filename, await blobBytes(a.blob));
    const pb = await parseBackupZip(b.filename, await blobBytes(b.blob));
    await expect(buildRestorePlan([pa, pb])).rejects.toThrow(/混ざって/);
  });
});
