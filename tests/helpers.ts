import { NyuriDB, setDB } from '../src/db/db';
import { putImage } from '../src/db/repo';
import type { ImageMeta } from '../src/db/types';
import { sha256Hex, uuid } from '../src/lib/util';

let counter = 0;

/** テストごとに新しいDBを用意する */
export async function freshDB(): Promise<NyuriDB> {
  const db = new NyuriDB(`test-${Date.now()}-${counter++}`);
  await db.open();
  setDB(db);
  return db;
}

export function bytes(n: number, seed = 1): Uint8Array {
  const u = new Uint8Array(n);
  let x = seed * 2654435761;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    u[i] = x & 0xff;
  }
  return u;
}

/** 疑似的な画像（中身はランダムバイト）をDBへ登録 */
export async function fakeImage(size = 2000, seed = 1, createdAt = Date.now()): Promise<ImageMeta> {
  const full = bytes(size, seed);
  const thumb = bytes(Math.ceil(size / 10), seed + 100);
  const meta: ImageMeta = {
    id: uuid(),
    mime: 'image/jpeg',
    width: 100,
    height: 80,
    size: full.byteLength,
    thumbMime: 'image/jpeg',
    thumbSize: thumb.byteLength,
    hasOriginal: false,
    originalMime: null,
    originalSize: 0,
    originalName: `seed${seed}.jpg`,
    createdAt,
    sha256: await sha256Hex(full),
  };
  await putImage({ meta, full: full.buffer as ArrayBuffer, thumb: thumb.buffer as ArrayBuffer });
  return meta;
}

/** 疑似的な切り抜きサムネイルをDBへ登録 */
export async function fakeCrop(sourceId: string, seed = 1, createdAt = Date.now(), aspect: '1:1' | '3:4' = '1:1') {
  const { putCrop } = await import('../src/db/repo');
  const data = bytes(800 + seed, seed + 500);
  const crop = {
    id: uuid(),
    sourceId,
    aspect,
    x: 0.1,
    y: 0,
    w: 0.5,
    h: aspect === '1:1' ? 0.4 : 0.5,
    mime: 'image/jpeg',
    width: aspect === '1:1' ? 360 : 270,
    height: 360,
    size: data.byteLength,
    createdAt,
    sha256: await sha256Hex(data),
    data: data.buffer as ArrayBuffer,
  };
  await putCrop(crop);
  return crop;
}

export function cropRef(c: { id: string; aspect: '1:1' | '3:4'; x: number; y: number; w: number; h: number }) {
  return { id: c.id, aspect: c.aspect, x: c.x, y: c.y, w: c.w, h: c.h };
}
