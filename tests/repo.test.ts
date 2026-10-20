import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { freshDB, fakeImage } from './helpers';
import {
  changeCategory,
  deletePermanently,
  emptyTrash,
  gcImages,
  getDraft,
  getRecord,
  getState,
  listHistory,
  moveToTrash,
  newRecord,
  restoreFromTrash,
  restoreVersion,
  saveDraft,
  saveRecord,
  saveSettings,
  ORPHAN_GRACE_MS,
} from '../src/db/repo';
import { CATEGORIES, CATEGORY_DEFS } from '../src/lib/categories';
import { NyuriDB, setDB, getDB } from '../src/db/db';
import { StorageError } from '../src/db/errors';

beforeEach(async () => {
  await freshDB();
});

describe('6カテゴリーの登録・編集・削除・復元', () => {
  for (const cat of CATEGORIES) {
    it(`${CATEGORY_DEFS[cat].label}`, async () => {
      const fields = Object.fromEntries(CATEGORY_DEFS[cat].fields.map((f) => [f.key, `${f.label}の値`]));
      const r = await saveRecord(newRecord(cat, { title: `${cat}の記録`, body: '本文', fields, tags: ['a', 'b', 'a'] }));
      expect(r.rev).toBe(1);
      expect(r.tags).toEqual(['a', 'b']);
      const got = await getRecord(r.id);
      expect(got?.fields).toEqual(fields);

      const edited = await saveRecord({ ...r, title: '編集後' });
      expect(edited.title).toBe('編集後');
      expect(edited.rev).toBe(2);
      expect(await listHistory(r.id)).toHaveLength(1);

      await moveToTrash(r.id);
      expect((await getRecord(r.id))?.deletedAt).toBeTypeOf('number');
      await restoreFromTrash(r.id);
      expect((await getRecord(r.id))?.deletedAt).toBeNull();
    });
  }
});

describe('クイックメモ', () => {
  it('本文だけで保存でき、仮タイトルが付く', async () => {
    const r = await saveRecord(newRecord('memo', { body: '\n  ねこ耳の騎士団が出てくる話を考えたい。長い長い長い長い長い長いメモ\n2行目' }));
    expect(r.title.startsWith('ねこ耳の騎士団')).toBe(true);
    expect(r.title.endsWith('…')).toBe(true);
    expect(r.madeDate).toBeNull();
  });

  it('カテゴリーを変えても本文・画像・専用項目は失われない', async () => {
    const img = await fakeImage();
    const memo = await saveRecord(newRecord('memo', { body: 'OC案：銀髪の司書', images: [{ id: img.id, caption: '' }] }));
    const asOc = await saveRecord(changeCategory({ ...memo, fields: { personality: '物静か' } }, 'oc'));
    expect(asOc.category).toBe('oc');
    expect(asOc.status).toBe(CATEGORY_DEFS.oc.defaultStatus);
    expect(asOc.extra.previousStatus).toBe('未整理');
    const asApp = await saveRecord(changeCategory(asOc, 'app'));
    expect(asApp.body).toBe('OC案：銀髪の司書');
    expect(asApp.images.map((i) => i.id)).toEqual([img.id]);
    expect(asApp.fields.personality).toBe('物静か'); // 非表示でも保持
    const hist = await listHistory(memo.id);
    expect(hist[hist.length - 1].reason).toBe('category-change');
  });
});

describe('日本語長文・改行・特殊文字', () => {
  it('そのまま保存・再読み込みできる', async () => {
    const special = '𠮷野家🍣「」『』〜　全角スペース\t<script>alert(1)</script> & " \' \\ ​ ゼロ幅\r\n改行\n'.repeat(500);
    const r = await saveRecord(newRecord('nai', { title: '特殊文字', body: special, fields: { positivePrompt: special } }));
    // 別インスタンスで開き直す（再読み込み相当）
    const name = getDB().name;
    getDB().close();
    const db2 = new NyuriDB(name);
    setDB(db2);
    const got = await getRecord(r.id);
    expect(got?.body).toBe(special);
    expect(got?.fields.positivePrompt).toBe(special);
    expect(got?.body.length).toBeGreaterThan(30000);
  });
});

describe('変更履歴', () => {
  it('意味のある変更だけ版を増やし、上限を超えたら古い版から消す', async () => {
    await saveSettings({ historyLimit: 20 });
    let r = await saveRecord(newRecord('memo', { body: 'v0' }));
    r = await saveRecord({ ...r }); // 変更なし
    expect(await listHistory(r.id)).toHaveLength(0);
    for (let i = 1; i <= 25; i++) r = await saveRecord({ ...r, body: `v${i}` });
    const h = await listHistory(r.id);
    expect(h).toHaveLength(20);
    expect(h[0].snapshot.body).toBe('v24'); // 新しい順
    expect(h[h.length - 1].snapshot.body).toBe('v5');
  });

  it('以前の版へ復元でき、復元前の内容も履歴に残る', async () => {
    let r = await saveRecord(newRecord('lora', { title: 'A', fields: { triggerWords: 'old' } }));
    r = await saveRecord({ ...r, title: 'B', fields: { triggerWords: 'new' } });
    const [h] = await listHistory(r.id);
    const restored = await restoreVersion(h.id);
    expect(restored.title).toBe('A');
    expect(restored.fields.triggerWords).toBe('old');
    const hs = await listHistory(r.id);
    expect(hs[0].snapshot.title).toBe('B');
    expect(hs[0].reason).toBe('restore');
  });
});

describe('画像参照の保護', () => {
  it('編集で外した画像は履歴が参照している間は消えず、履歴から復元できる', async () => {
    const a = await fakeImage(1000, 1);
    const b = await fakeImage(1000, 2);
    let r = await saveRecord(newRecord('oc', { title: 'ミナ', images: [{ id: a.id, caption: '立ち絵' }, { id: b.id, caption: '' }] }));
    r = await saveRecord({ ...r, images: [{ id: b.id, caption: '' }] });
    await gcImages({ candidates: [a.id] });
    expect(await getDB().images.get(a.id)).toBeTruthy();
    expect(await getDB().imageFull.get(a.id)).toBeTruthy();
    const [h] = await listHistory(r.id);
    const back = await restoreVersion(h.id);
    expect(back.images.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(back.coverImageId).toBe(a.id);
  });

  it('履歴の上限で版が消えると、どこからも参照されない画像だけ整理される', async () => {
    await saveSettings({ historyLimit: 1 });
    const a = await fakeImage(500, 1);
    const shared = await fakeImage(500, 3);
    const other = await saveRecord(newRecord('nai', { images: [{ id: shared.id, caption: '' }] }));
    let r = await saveRecord(newRecord('nai', { title: 'x', images: [{ id: a.id, caption: '' }, { id: shared.id, caption: '' }] }));
    r = await saveRecord({ ...r, images: [] }); // 履歴1件（a, shared を参照）
    r = await saveRecord({ ...r, title: 'y' }); // 古い履歴が消える
    expect(await getDB().images.get(a.id)).toBeUndefined();
    expect(await getDB().imageThumb.get(a.id)).toBeUndefined();
    expect(await getDB().images.get(shared.id)).toBeTruthy(); // 別の記録が使っている
    expect(other.images[0].id).toBe(shared.id);
  });

  it('完全削除で画像も消えるが、他の記録と共有している画像は残る', async () => {
    const own = await fakeImage(500, 1);
    const shared = await fakeImage(500, 2);
    const keep = await saveRecord(newRecord('oc', { images: [{ id: shared.id, caption: '' }] }));
    const del = await saveRecord(newRecord('oc', { images: [{ id: own.id, caption: '' }, { id: shared.id, caption: '' }] }));
    await expect(deletePermanently([del.id])).rejects.toThrow(); // ゴミ箱を経由しないと消せない
    await moveToTrash(del.id);
    await deletePermanently([del.id]);
    expect(await getRecord(del.id)).toBeUndefined();
    expect(await listHistory(del.id)).toHaveLength(0);
    expect(await getDB().images.get(own.id)).toBeUndefined();
    expect(await getDB().images.get(shared.id)).toBeTruthy();
    expect(await getRecord(keep.id)).toBeTruthy();
  });

  it('孤立画像の整理は24時間たったものだけ。下書きが参照していれば残す', async () => {
    const old = await fakeImage(100, 1, Date.now() - ORPHAN_GRACE_MS - 1000);
    const recent = await fakeImage(100, 2);
    const inDraft = await fakeImage(100, 3, Date.now() - ORPHAN_GRACE_MS - 1000);
    await saveDraft('new', { record: { images: [{ id: inDraft.id }] } });
    const n = await gcImages();
    expect(n).toBe(1);
    expect(await getDB().images.get(old.id)).toBeUndefined();
    expect(await getDB().images.get(recent.id)).toBeTruthy();
    expect(await getDB().images.get(inDraft.id)).toBeTruthy();
  });

  it('ゴミ箱を空にする', async () => {
    const a = await saveRecord(newRecord('memo', { body: '1' }));
    const b = await saveRecord(newRecord('memo', { body: '2' }));
    await moveToTrash(a.id);
    expect(await emptyTrash()).toBe(1);
    expect(await getRecord(a.id)).toBeUndefined();
    expect(await getRecord(b.id)).toBeTruthy();
  });
});

describe('下書き・変更カウンター', () => {
  it('下書きを保存・取得できる', async () => {
    await saveDraft('new', { record: { body: '書きかけ' } });
    expect(((await getDraft('new'))?.form as { record: { body: string } }).record.body).toBe('書きかけ');
  });
  it('保存のたびにバックアップ後の変更数が増える', async () => {
    const r = await saveRecord(newRecord('memo', { body: 'a' }));
    await saveRecord({ ...r, body: 'b' });
    await moveToTrash(r.id);
    expect((await getState()).changesSinceBackup).toBe(3);
  });
});

describe('保存容量不足', () => {
  it('QuotaExceededError を利用者向けエラーとして返し、既存データは壊れない', async () => {
    const ok = await saveRecord(newRecord('memo', { body: '既存' }));
    const db = getDB();
    const spy = vi.spyOn(db.records, 'put').mockImplementation(() => {
      const e = new DOMException('quota', 'QuotaExceededError');
      return Dexie.Promise.reject(e) as never;
    });
    const err = await saveRecord({ ...ok, body: '更新しようとした' }).catch((e) => e);
    spy.mockRestore();
    expect(err).toBeInstanceOf(StorageError);
    expect((err as StorageError).kind).toBe('quota');
    expect((err as StorageError).message).toContain('容量');
    // ロールバックされて、履歴も本文も元のまま
    expect((await getRecord(ok.id))?.body).toBe('既存');
    expect(await listHistory(ok.id)).toHaveLength(0);
  });
});

describe('DBスキーマの更新', () => {
  it('新しい版のスキーマで開き直しても既存データが残る', async () => {
    const r = await saveRecord(newRecord('app', { title: '既存アプリ' }));
    const name = getDB().name;
    getDB().close();
    // 将来の version(3)：索引を追加し、upgradeで項目を補完するだけ（非破壊）
    class FutureDB extends NyuriDB {
      constructor() {
        super(name);
        this.version(3)
          .stores({ records: 'id, category, createdAt, updatedAt, source.githubRepoId, favorite' })
          .upgrade(async (tx) => {
            await tx.table('records').toCollection().modify((x: Record<string, unknown>) => {
              if (!('links' in x)) x.links = [];
            });
          });
      }
    }
    const db2 = new FutureDB();
    await db2.open();
    setDB(db2);
    const got = await getRecord(r.id);
    expect(got?.title).toBe('既存アプリ');
    expect(db2.verno).toBe(3);
  });
});
