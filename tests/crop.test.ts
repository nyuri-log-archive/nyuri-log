import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { freshDB, fakeImage, fakeCrop, cropRef } from './helpers';
import {
  clampView,
  cropOutputSize,
  cropTargetSize,
  defaultView,
  isValidCropRef,
  maxScale,
  minScale,
  rectToPixels,
  rectToView,
  viewToRect,
  zoomAt,
} from '../src/lib/crop';
import { gcImages, getListThumbBlob, getRecord, listHistory, newRecord, restoreVersion, saveDraft, saveRecord, saveSettings, moveToTrash, deletePermanently, ORPHAN_GRACE_MS } from '../src/db/repo';
import { NyuriDB, getDB, setDB, DB_NAME } from '../src/db/db';
import { applyMergeRestore, applyReplaceRestore, buildRestorePlan, createBackup, parseBackupZip, planBackup } from '../src/lib/backup';
import { sha256Hex } from '../src/lib/util';

const blobBytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

beforeEach(async () => {
  await freshDB();
});

describe('トリミングの計算', () => {
  const F = { fw: 300, fh: 300 }; // 1:1 の枠
  const F34 = { fw: 300, fh: 400 }; // 3:4 の枠

  it('全身絵（縦長）の初期位置は上端・左右中央', () => {
    const v = defaultView(1200, 1600, F); // 縦長
    expect(v.scale).toBeCloseTo(0.25);
    expect(v.ty).toBe(0);
    const r = viewToRect(v, 1200, 1600, F);
    expect(r).toMatchObject({ x: 0, y: 0, w: 1, h: 0.75 });
  });

  it('横長の初期位置は中央', () => {
    const r = viewToRect(defaultView(1600, 1200, F), 1600, 1200, F);
    expect(r.x).toBeCloseTo(0.125);
    expect(r.y).toBe(0);
    expect(r.w).toBeCloseTo(0.75);
  });

  it('枠の外に余白が出ないよう、位置と倍率を補正する', () => {
    const c = clampView({ scale: 0.01, tx: 500, ty: -9999 }, 1200, 1600, F);
    expect(c.scale).toBeCloseTo(minScale(1200, 1600, F));
    expect(c.tx).toBe(0);
    expect(c.ty).toBeCloseTo(300 - 1600 * c.scale);
    const big = clampView({ scale: 999, tx: 0, ty: 0 }, 1200, 1600, F);
    expect(big.scale).toBe(maxScale(1200, 1600, F));
  });

  it('切り抜き範囲 ⇄ 表示状態 の往復で同じ範囲に戻る（再編集できる）', () => {
    for (const f of [F, F34]) {
      const v = zoomAt(defaultView(1200, 1600, f), 0.6, 150, 80, 1200, 1600, f);
      const r = viewToRect({ ...v, tx: v.tx - 37, ty: v.ty - 91 }, 1200, 1600, f);
      const back = viewToRect(rectToView(r, 1200, 1600, f), 1200, 1600, f);
      expect(back.x).toBeCloseTo(r.x, 5);
      expect(back.y).toBeCloseTo(r.y, 5);
      expect(back.w).toBeCloseTo(r.w, 5);
      expect(back.h).toBeCloseTo(r.h, 5);
      expect(r.w / r.h).toBeCloseTo((f.fw / f.fh) * (1600 / 1200), 4); // 画像比を考慮した枠の比
    }
  });

  it('ピンチ：指の中心の下にある画像の点は動かない', () => {
    const v0 = defaultView(1200, 1600, F);
    const px = 120;
    const py = 90;
    const before = { x: (px - v0.tx) / v0.scale, y: (py - v0.ty) / v0.scale };
    const v1 = zoomAt(v0, v0.scale * 2, px, py, 1200, 1600, F);
    expect((px - v1.tx) / v1.scale).toBeCloseTo(before.x, 6);
    expect((py - v1.ty) / v1.scale).toBeCloseTo(before.y, 6);
  });

  it('出力サイズと画素範囲', () => {
    expect(cropOutputSize('1:1', 360)).toEqual({ width: 360, height: 360 });
    expect(cropOutputSize('3:4', 360)).toEqual({ width: 270, height: 360 });
    expect(rectToPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, 1200, 1600)).toEqual({ sx: 300, sy: 800, sw: 600, sh: 800 });
    // 端数があっても比率どおり（3:4 → 270×360）。小さい範囲は拡大しない
    expect(cropTargetSize(799, '3:4', 360)).toEqual({ tw: 270, th: 360 });
    expect(cropTargetSize(268.6, '3:4', 360)).toEqual({ tw: 269, th: 359 });
    expect(cropTargetSize(200, '1:1', 360)).toEqual({ tw: 200, th: 200 });
  });

  it('不正なトリミング情報を判定する', () => {
    expect(isValidCropRef({ id: 'a', aspect: '1:1', x: 0, y: 0, w: 1, h: 1 })).toBe(true);
    expect(isValidCropRef({ id: 'a', aspect: '16:9', x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    expect(isValidCropRef({ id: 'a', aspect: '1:1', x: 0.5, y: 0, w: 0.8, h: 1 })).toBe(false);
    expect(isValidCropRef({ id: '', aspect: '1:1', x: 0, y: 0, w: 1, h: 1 })).toBe(false);
    expect(isValidCropRef(null)).toBe(false);
  });
});

describe('DBの移行（v1 → v2）', () => {
  it('v1.0のデータベースを開いても既存データはそのまま、トリミング用テーブルが追加される', async () => {
    const name = `migrate-${Date.now()}`;
    class V1 extends Dexie {
      constructor() {
        super(name);
        this.version(1).stores({
          records: 'id, category, createdAt, updatedAt, source.githubRepoId',
          history: 'id, recordId, savedAt',
          images: 'id, createdAt',
          imageFull: 'id',
          imageThumb: 'id',
          imageOriginal: 'id',
          drafts: 'key',
          meta: 'key',
        });
      }
    }
    const old = new V1();
    await old.open();
    const rec = newRecord('oc', { title: 'v1の記録', images: [{ id: 'img-1', caption: '立ち絵' }] });
    await old.table('records').add(rec);
    old.close();

    const db = new NyuriDB(name);
    await db.open();
    setDB(db);
    expect(db.verno).toBe(2);
    expect(await db.imageCrop.count()).toBe(0);
    const got = await getRecord(rec.id);
    expect(got?.title).toBe('v1の記録');
    expect(got?.images[0].crop).toBeUndefined();
    expect(DB_NAME).toBe('nyuri-log');
  });
});

describe('記録とトリミング情報', () => {
  it('トリミング情報つきで保存でき、不正な情報は捨てて画像は残す', async () => {
    const img = await fakeImage();
    const c = await fakeCrop(img.id);
    const r = await saveRecord(newRecord('oc', { images: [{ id: img.id, caption: '', crop: cropRef(c) }] }));
    expect(r.images[0].crop?.id).toBe(c.id);
    const bad = await saveRecord({ ...r, images: [{ id: img.id, caption: 'x', crop: { id: c.id, aspect: '1:1', x: 0.9, y: 0, w: 0.5, h: 0.5 } }] });
    expect(bad.images[0].id).toBe(img.id);
    expect(bad.images[0].crop).toBeUndefined();
  });

  it('一覧用サムネイルは切り抜き版、無ければ従来の縮小版（古いデータでも表示できる）', async () => {
    const img = await fakeImage(1000, 7);
    const c = await fakeCrop(img.id, 3);
    const withCrop = await getListThumbBlob({ id: img.id, crop: cropRef(c) });
    expect(withCrop.cropped).toBe(true);
    expect(await sha256Hex(await blobBytes(withCrop.blob!))).toBe(c.sha256);
    const plain = await getListThumbBlob({ id: img.id });
    expect(plain.cropped).toBe(false);
    expect(plain.blob!.size).toBe(img.thumbSize);
    const lost = await getListThumbBlob({ id: img.id, crop: { ...cropRef(c), id: 'missing' } });
    expect(lost.cropped).toBe(false);
    expect(lost.blob).toBeTruthy();
  });

  it('トリミングを変えると前の切り抜きは履歴が参照する間は残り、履歴から戻すとトリミングも戻る', async () => {
    const img = await fakeImage();
    const c1 = await fakeCrop(img.id, 1);
    let r = await saveRecord(newRecord('oc', { title: 'ミナ', images: [{ id: img.id, caption: '', crop: cropRef(c1) }] }));
    const c2 = await fakeCrop(img.id, 2, Date.now(), '3:4');
    r = await saveRecord({ ...r, images: [{ id: img.id, caption: '', crop: cropRef(c2) }] });
    await gcImages({ candidates: [c1.id] });
    expect(await getDB().imageCrop.get(c1.id)).toBeTruthy();
    const [h] = await listHistory(r.id);
    const back = await restoreVersion(h.id);
    expect(back.images[0].crop?.id).toBe(c1.id);
    expect(back.images[0].crop?.aspect).toBe('1:1');
    // 元画像はトリミングで変化しない
    expect(await sha256Hex((await getDB().imageFull.get(img.id))!.data)).toBe(img.sha256);
  });

  it('履歴の上限で古い版が消えると、使われなくなった切り抜きだけ整理される', async () => {
    await saveSettings({ historyLimit: 1 });
    const img = await fakeImage();
    const c1 = await fakeCrop(img.id, 1);
    const c2 = await fakeCrop(img.id, 2);
    let r = await saveRecord(newRecord('oc', { images: [{ id: img.id, caption: '', crop: cropRef(c1) }] }));
    r = await saveRecord({ ...r, images: [{ id: img.id, caption: '', crop: cropRef(c2) }] }); // 履歴：c1
    r = await saveRecord({ ...r, title: '別の変更' }); // 履歴：c2 のみ → c1 は不要に
    expect(await getDB().imageCrop.get(c1.id)).toBeUndefined();
    expect(await getDB().imageCrop.get(c2.id)).toBeTruthy();
    expect(await getDB().images.get(img.id)).toBeTruthy();
  });

  it('トリミングを解除すると切り抜き参照が外れ、表示は従来の縮小版に戻る', async () => {
    const img = await fakeImage();
    const c = await fakeCrop(img.id);
    let r = await saveRecord(newRecord('lora', { images: [{ id: img.id, caption: '', crop: cropRef(c) }] }));
    r = await saveRecord({ ...r, images: [{ id: img.id, caption: '' }] });
    expect(r.images[0].crop).toBeUndefined();
    expect((await getListThumbBlob(r.images[0])).cropped).toBe(false);
  });

  it('完全削除で元画像と、そこから作った切り抜きも消える', async () => {
    const img = await fakeImage();
    const c = await fakeCrop(img.id);
    const r = await saveRecord(newRecord('nai', { images: [{ id: img.id, caption: '', crop: cropRef(c) }] }));
    await moveToTrash(r.id);
    await deletePermanently([r.id]);
    expect(await getDB().images.get(img.id)).toBeUndefined();
    expect(await getDB().imageCrop.get(c.id)).toBeUndefined();
  });

  it('編集を中断した切り抜きは24時間後に整理、下書きが参照していれば残す', async () => {
    const img = await fakeImage();
    await saveRecord(newRecord('oc', { images: [{ id: img.id, caption: '' }] }));
    const stale = await fakeCrop(img.id, 1, Date.now() - ORPHAN_GRACE_MS - 1000);
    const fresh = await fakeCrop(img.id, 2);
    const drafted = await fakeCrop(img.id, 3, Date.now() - ORPHAN_GRACE_MS - 1000);
    await saveDraft('edit:x', { record: { images: [{ id: img.id, crop: { id: drafted.id } }] } });
    await gcImages();
    expect(await getDB().imageCrop.get(stale.id)).toBeUndefined();
    expect(await getDB().imageCrop.get(fresh.id)).toBeTruthy();
    expect(await getDB().imageCrop.get(drafted.id)).toBeTruthy();
    expect(await getDB().images.get(img.id)).toBeTruthy();
  });

  it('切り抜きの保存に失敗しても、記録と元画像は壊れない', async () => {
    const img = await fakeImage();
    const r = await saveRecord(newRecord('oc', { title: '既存', images: [{ id: img.id, caption: '' }] }));
    const { putCrop } = await import('../src/db/repo');
    const spy = vi.spyOn(getDB().imageCrop, 'put').mockImplementation(() => Dexie.Promise.reject(new DOMException('q', 'QuotaExceededError')) as never);
    const err = await putCrop({ ...(await fakeCropData(img.id)) }).catch((e) => e);
    spy.mockRestore();
    expect(err.kind).toBe('quota');
    expect((await getRecord(r.id))?.images).toEqual([{ id: img.id, caption: '' }]);
    expect(await sha256Hex((await getDB().imageFull.get(img.id))!.data)).toBe(img.sha256);
  });
});

async function fakeCropData(sourceId: string) {
  const data = new Uint8Array([1, 2, 3]);
  return { id: 'tmp', sourceId, aspect: '1:1' as const, x: 0, y: 0, w: 1, h: 1, mime: 'image/jpeg', width: 1, height: 1, size: 3, createdAt: Date.now(), sha256: '', data: data.buffer as ArrayBuffer };
}

async function seedWithCrops() {
  const a = await fakeImage(20_000, 1);
  const b = await fakeImage(20_000, 2);
  const ca = await fakeCrop(a.id, 1);
  const cb = await fakeCrop(b.id, 2, Date.now(), '3:4');
  const r = await saveRecord(newRecord('oc', { title: 'ミナ', images: [{ id: a.id, caption: '立ち絵', crop: cropRef(ca) }, { id: b.id, caption: '', crop: cropRef(cb) }] }));
  return { a, b, ca, cb, r };
}

describe('バックアップ・復元とトリミング', () => {
  it('切り抜きサムネイルがZIPに入り、空の端末へ復元するとバイト列まで一致する', async () => {
    const { ca, cb, r } = await seedWithCrops();
    const [part] = await createBackup();
    const entries = unzipSync(await blobBytes(part.blob));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.counts).toMatchObject({ crops: 2, cropsInThisPart: 2 });
    expect(Object.keys(entries).filter((k) => k.includes('.crop.'))).toHaveLength(2);
    expect(JSON.parse(strFromU8(entries['crops.json']))[0].data).toBeUndefined(); // 本体はJSONに入れない

    await freshDB();
    const plan = await buildRestorePlan([await parseBackupZip(part.filename, await blobBytes(part.blob))]);
    expect(plan.newCrops).toHaveLength(2);
    expect(plan.missingCrops).toHaveLength(0);
    const res = await applyMergeRestore(plan);
    expect(res.addedCrops).toBe(2);
    for (const c of [ca, cb]) expect(await sha256Hex((await getDB().imageCrop.get(c.id))!.data)).toBe(c.sha256);
    const got = await getRecord(r.id);
    expect(got?.images.map((i) => i.crop?.aspect)).toEqual(['1:1', '3:4']);
  });

  it('v1.0形式（切り抜きなし）のバックアップも復元でき、従来のサムネイルで表示される', async () => {
    const { a, ca, r } = await seedWithCrops();
    const [part] = await createBackup();
    const entries = unzipSync(await blobBytes(part.blob));
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    for (const k of Object.keys(entries)) if (k.includes('.crop.') || k === 'crops.json') delete entries[k];
    for (const k of Object.keys(manifest.files)) if (k.includes('.crop.') || k === 'crops.json') delete manifest.files[k];
    delete manifest.counts.crops;
    delete manifest.counts.cropsInThisPart;
    manifest.appVersion = '1.0.0';
    manifest.dbSchemaVersion = 1;
    entries['manifest.json'] = strToU8(JSON.stringify(manifest));

    await freshDB();
    const plan = await buildRestorePlan([await parseBackupZip('old.zip', zipSync(entries))]);
    expect(plan.missingCrops).toContain(ca.id);
    await applyMergeRestore(plan);
    const got = await getRecord(r.id);
    const thumb = await getListThumbBlob(got!.images[0]);
    expect(thumb.cropped).toBe(false);
    expect(thumb.blob!.size).toBe(a.thumbSize);
  });

  it('分割バックアップでは、切り抜きは元画像と同じZIPに入る', async () => {
    const imgs = [];
    for (let i = 0; i < 3; i++) imgs.push(await fakeImage(9 * 1024 * 1024, i + 1));
    const crops = await Promise.all(imgs.map((m, i) => fakeCrop(m.id, i + 10)));
    await saveRecord(newRecord('lora', { images: imgs.map((m, i) => ({ id: m.id, caption: '', crop: cropRef(crops[i]) })) }));
    const plan = await planBackup(20);
    expect(plan.parts.length).toBe(2);
    plan.parts.forEach((ids, p) => {
      const expected = crops.filter((c) => ids.includes(c.sourceId)).map((c) => c.id).sort();
      expect([...plan.cropParts[p]].sort()).toEqual(expected);
    });
  }, 60_000);

  it('全置換でも切り抜きが入れ替わり、失敗すれば元のまま', async () => {
    await seedWithCrops();
    const [part] = await createBackup();
    const zip = await blobBytes(part.blob);
    await freshDB();
    const mine = await fakeImage(500, 9);
    const myCrop = await fakeCrop(mine.id, 9);
    const plan = await buildRestorePlan([await parseBackupZip(part.filename, zip)]);

    const spy = vi.spyOn(getDB().records, 'bulkAdd').mockImplementation(() => Dexie.Promise.reject(new Error('boom')) as never);
    await expect(applyReplaceRestore(plan, { restoreSettings: false })).rejects.toThrow();
    spy.mockRestore();
    expect(await getDB().imageCrop.get(myCrop.id)).toBeTruthy();
    expect(await getDB().imageCrop.count()).toBe(1);

    await applyReplaceRestore(plan, { restoreSettings: false });
    expect(await getDB().imageCrop.get(myCrop.id)).toBeUndefined();
    expect(await getDB().imageCrop.count()).toBe(2);
  });

  it('追加復元の途中で失敗したら、切り抜きも含めて何も書き込まれない', async () => {
    await seedWithCrops();
    const [part] = await createBackup();
    const zip = await blobBytes(part.blob);
    await freshDB();
    const plan = await buildRestorePlan([await parseBackupZip(part.filename, zip)]);
    const spy = vi.spyOn(getDB().records, 'add').mockImplementation(() => Dexie.Promise.reject(new DOMException('q', 'QuotaExceededError')) as never);
    await expect(applyMergeRestore(plan)).rejects.toMatchObject({ kind: 'quota' });
    spy.mockRestore();
    expect(await getDB().imageCrop.count()).toBe(0);
    expect(await getDB().images.count()).toBe(0);
  });
});
