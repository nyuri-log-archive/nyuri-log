import type { ImageCrop, ImageMeta } from '../db/types';
import { cropTargetSize, rectToPixels, type CropAspect, type CropRect } from './crop';
import type { StoredImageInput } from '../db/repo';
import { sha256Hex, uuid } from './util';

export class ImageProcessError extends Error {
  fileName: string;
  constructor(fileName: string, message: string) {
    super(message);
    this.name = 'ImageProcessError';
    this.fileName = fileName;
  }
}

export interface ImageOptions {
  maxEdge: number;
  quality: number;
  thumbEdge: number;
  keepOriginal: boolean;
}

/** 長辺を maxEdge 以下に収めた寸法（拡大はしない・縦横比は保つ） */
export function fitSize(w: number, h: number, maxEdge: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) throw new Error('invalid size');
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: Math.round(w), height: Math.round(h) };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

const ALPHA_CAPABLE = /^(image\/(png|webp|gif|avif|svg\+xml)|)$/i;

export function mayHaveAlpha(mime: string): boolean {
  return ALPHA_CAPABLE.test(mime);
}

/** 透過があれば WebP（非対応なら PNG）、なければ JPEG */
export function chooseOutputMime(hasAlpha: boolean, webpEncodable: boolean): string {
  if (!hasAlpha) return 'image/jpeg';
  return webpEncodable ? 'image/webp' : 'image/png';
}

export function guessMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp',
  };
  return map[ext] ?? '';
}

const MAX_SOURCE_PIXELS = 60_000_000; // これを超える画像は端末のメモリ不足を避けるため拒否

function loadImage(file: Blob, name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageProcessError(name, 'この画像を読み込めませんでした。'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), mime, quality);
    } catch {
      resolve(null);
    }
  });
}

/** 段階的に縮小して描画（大きな縮小率でのジャギーを抑える） */
function drawScaled(src: CanvasImageSource, sw: number, sh: number, tw: number, th: number): HTMLCanvasElement {
  let curW = sw;
  let curH = sh;
  let cur: CanvasImageSource = src;
  let tmp: HTMLCanvasElement | null = null;
  while (curW / 2 > tw && curH / 2 > th) {
    const nw = Math.round(curW / 2);
    const nh = Math.round(curH / 2);
    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, nw, nh);
    if (tmp) releaseCanvas(tmp);
    tmp = c;
    cur = c;
    curW = nw;
    curH = nh;
  }
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, tw, th);
  if (tmp) releaseCanvas(tmp);
  return out;
}

function releaseCanvas(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}

function canvasHasAlpha(c: HTMLCanvasElement): boolean {
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

async function encode(canvas: HTMLCanvasElement, hasAlpha: boolean, quality: number): Promise<Blob | null> {
  if (!hasAlpha) return canvasToBlob(canvas, 'image/jpeg', quality);
  const webp = await canvasToBlob(canvas, 'image/webp', quality);
  if (webp && webp.type === 'image/webp') return webp;
  return canvasToBlob(canvas, 'image/png', 1);
}

/**
 * 1枚の画像を軽量化して保存用データを作る（まだDBには書かない）。
 * 失敗したら ImageProcessError を投げる。呼び出し側のフォーム内容には一切触れない。
 */
export async function processImage(file: File, opts: ImageOptions): Promise<StoredImageInput> {
  const name = file.name || '画像';
  const mime = guessMime(file);
  if (mime && !mime.startsWith('image/')) throw new ImageProcessError(name, '画像ファイルではありません。');
  if (mime === 'image/svg+xml') throw new ImageProcessError(name, 'SVG画像は安全のため登録できません。PNGかJPEGに変換してください。');

  let img: HTMLImageElement;
  try {
    img = await loadImage(file, name);
  } catch {
    if (/hei[cf]/.test(mime) || /\.(heic|heif)$/i.test(name)) {
      throw new ImageProcessError(
        name,
        'HEIC形式をこの端末のブラウザで変換できませんでした。写真アプリから追加する（自動でJPEGになります）か、iPhoneの「設定 > カメラ > フォーマット」を「互換性優先」にして撮り直してください。',
      );
    }
    throw new ImageProcessError(name, 'この画像を読み込めませんでした。壊れているか、未対応の形式です。');
  }
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!sw || !sh) throw new ImageProcessError(name, '画像の大きさを読み取れませんでした。');
  if (sw * sh > MAX_SOURCE_PIXELS) throw new ImageProcessError(name, `画像が大きすぎます（${sw}×${sh}）。縮小してから追加してください。`);

  let full: HTMLCanvasElement | null = null;
  let thumb: HTMLCanvasElement | null = null;
  try {
    const fs = fitSize(sw, sh, opts.maxEdge);
    full = drawScaled(img, sw, sh, fs.width, fs.height);
    const ts = fitSize(fs.width, fs.height, opts.thumbEdge);
    thumb = drawScaled(full, fs.width, fs.height, ts.width, ts.height);
    const hasAlpha = mayHaveAlpha(mime) ? canvasHasAlpha(thumb) || canvasHasAlpha(full) : false;
    const fullBlob = await encode(full, hasAlpha, opts.quality);
    const thumbBlob = await encode(thumb, hasAlpha, Math.min(0.8, opts.quality));
    if (!fullBlob || !thumbBlob || fullBlob.size === 0) throw new ImageProcessError(name, '画像の変換に失敗しました（メモリ不足の可能性があります）。');
    const fullBuf = await fullBlob.arrayBuffer();
    const thumbBuf = await thumbBlob.arrayBuffer();
    const originalBuf = opts.keepOriginal ? await file.arrayBuffer() : null;
    const meta: ImageMeta = {
      id: uuid(),
      mime: fullBlob.type || 'image/jpeg',
      width: fs.width,
      height: fs.height,
      size: fullBuf.byteLength,
      thumbMime: thumbBlob.type || 'image/jpeg',
      thumbSize: thumbBuf.byteLength,
      hasOriginal: !!originalBuf,
      originalMime: originalBuf ? mime || 'application/octet-stream' : null,
      originalSize: originalBuf?.byteLength ?? 0,
      originalName: name,
      createdAt: Date.now(),
      sha256: await sha256Hex(fullBuf),
    };
    return { meta, full: fullBuf, thumb: thumbBuf, original: originalBuf };
  } catch (e) {
    if (e instanceof ImageProcessError) throw e;
    throw new ImageProcessError(name, '画像の変換に失敗しました（メモリ不足の可能性があります）。');
  } finally {
    if (full) releaseCanvas(full);
    if (thumb) releaseCanvas(thumb);
    img.src = '';
  }
}

// ---------- サムネイル用トリミング ----------

/**
 * 保存用画像（軽量化済み）から指定範囲を切り抜き、一覧用サムネイルを作る。
 * 元の画像データには一切手を加えない。DBへの書き込みは呼び出し側で行う。
 */
export async function renderCropThumb(
  source: { id: string; blob: Blob; mime: string },
  rect: CropRect,
  aspect: CropAspect,
  opts: { maxEdge: number; quality: number },
): Promise<ImageCrop> {
  const img = await loadImage(source.blob, '画像');
  let region: HTMLCanvasElement | null = null;
  let out: HTMLCanvasElement | null = null;
  try {
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (!W || !H) throw new ImageProcessError('画像', '画像の大きさを読み取れませんでした。');
    const { sx, sy, sw, sh } = rectToPixels(rect, W, H);
    region = document.createElement('canvas');
    region.width = sw;
    region.height = sh;
    const ctx = region.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    // 出力は比率どおりの寸法にそろえる（範囲の端数で 270×359 のようにずれないように）。
    // 切り抜き範囲が出力より小さいときは拡大しない（粗くなるだけなので）
    const { tw, th } = cropTargetSize(sw, aspect, opts.maxEdge);
    out = drawScaled(region, sw, sh, tw, th);
    const hasAlpha = mayHaveAlpha(source.mime) ? canvasHasAlpha(out) : false;
    const blob = await encode(out, hasAlpha, Math.min(0.85, opts.quality));
    if (!blob || blob.size === 0) throw new ImageProcessError('画像', 'サムネイルの作成に失敗しました（メモリ不足の可能性があります）。');
    const data = await blob.arrayBuffer();
    return {
      id: uuid(),
      sourceId: source.id,
      aspect,
      ...rect,
      mime: blob.type || 'image/jpeg',
      width: tw,
      height: th,
      size: data.byteLength,
      createdAt: Date.now(),
      sha256: await sha256Hex(data),
      data,
    };
  } catch (e) {
    if (e instanceof ImageProcessError) throw e;
    throw new ImageProcessError('画像', 'サムネイルの作成に失敗しました（メモリ不足の可能性があります）。');
  } finally {
    if (region) releaseCanvas(region);
    if (out) releaseCanvas(out);
    img.src = '';
  }
}
