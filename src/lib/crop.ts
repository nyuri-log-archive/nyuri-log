// サムネイル用トリミングの計算（DOMに依存しない純粋関数。テスト対象）

export const CROP_ASPECTS = ['1:1', '3:4'] as const;
export type CropAspect = (typeof CROP_ASPECTS)[number];

/** 元画像（軽量化済みの保存用画像）に対する切り抜き範囲。0〜1の割合で持つので画像の再縮小にも強い */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 画像参照に付くトリミング情報 */
export interface CropRef extends CropRect {
  /** 切り抜き済みサムネイルのID（imageCrop テーブル） */
  id: string;
  aspect: CropAspect;
}

export function aspectRatio(a: CropAspect): number {
  return a === '3:4' ? 3 / 4 : 1;
}

/** 長辺を maxEdge にした切り抜きサムネイルの寸法 */
export function cropOutputSize(a: CropAspect, maxEdge: number): { width: number; height: number } {
  const r = aspectRatio(a);
  return r >= 1 ? { width: maxEdge, height: Math.round(maxEdge / r) } : { width: Math.round(maxEdge * r), height: maxEdge };
}

/** 切り抜き範囲の幅 sw（画素）から、実際に書き出す寸法を決める。比率は常に正確、拡大はしない */
export function cropTargetSize(sw: number, a: CropAspect, maxEdge: number): { tw: number; th: number } {
  const target = cropOutputSize(a, maxEdge);
  if (sw >= target.width) return { tw: target.width, th: target.height };
  const tw = Math.max(1, Math.round(sw));
  return { tw, th: Math.max(1, Math.round(tw / aspectRatio(a))) };
}

/** 編集画面での表示状態：画像の拡大率と、枠の左上から見た画像左上の位置（CSSピクセル） */
export interface CropView {
  scale: number;
  tx: number;
  ty: number;
}

export interface Frame {
  fw: number;
  fh: number;
}

/** 枠を必ず画像で覆える最小の拡大率 */
export function minScale(imgW: number, imgH: number, f: Frame): number {
  return Math.max(f.fw / imgW, f.fh / imgH);
}

/** 拡大しすぎると切り抜きが粗くなるので上限を設ける（最小倍率の8倍、または切り抜き幅64px相当まで） */
export function maxScale(imgW: number, imgH: number, f: Frame): number {
  return Math.max(minScale(imgW, imgH, f), Math.min(minScale(imgW, imgH, f) * 8, f.fw / 64));
}

/** 枠の外に余白ができないよう位置と倍率を補正する */
export function clampView(v: CropView, imgW: number, imgH: number, f: Frame): CropView {
  const s = Math.min(Math.max(v.scale, minScale(imgW, imgH, f)), maxScale(imgW, imgH, f));
  const minTx = f.fw - imgW * s;
  const minTy = f.fh - imgH * s;
  return {
    scale: s,
    tx: Math.min(0, Math.max(minTx, v.tx)),
    ty: Math.min(0, Math.max(minTy, v.ty)),
  };
}

/** 表示状態 → 切り抜き範囲（割合） */
export function viewToRect(v: CropView, imgW: number, imgH: number, f: Frame): CropRect {
  const c = clampView(v, imgW, imgH, f);
  const r = {
    x: -c.tx / c.scale / imgW,
    y: -c.ty / c.scale / imgH,
    w: f.fw / c.scale / imgW,
    h: f.fh / c.scale / imgH,
  };
  return normalizeRect(r);
}

/** 切り抜き範囲 → 表示状態（再編集時） */
export function rectToView(r: CropRect, imgW: number, imgH: number, f: Frame): CropView {
  const scale = f.fw / (r.w * imgW);
  return clampView({ scale, tx: -r.x * imgW * scale, ty: -r.y * imgH * scale }, imgW, imgH, f);
}

/**
 * 初期表示：縦長の画像（全身絵など）は顔が入りやすいよう上端に合わせ、それ以外は中央。
 */
export function defaultView(imgW: number, imgH: number, f: Frame): CropView {
  const s = minScale(imgW, imgH, f);
  const tx = (f.fw - imgW * s) / 2;
  const ty = imgH > imgW ? 0 : (f.fh - imgH * s) / 2;
  return clampView({ scale: s, tx, ty }, imgW, imgH, f);
}

/** 指2本の拡大縮小：画面上の点 (px,py)（枠基準）の下にある画像上の点を固定したまま倍率を変える */
export function zoomAt(v: CropView, nextScale: number, px: number, py: number, imgW: number, imgH: number, f: Frame): CropView {
  const k = nextScale / v.scale;
  return clampView({ scale: nextScale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k }, imgW, imgH, f);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 誤差や不正値を補正。範囲外・ゼロ幅なら null */
export function normalizeRect(r: CropRect): CropRect {
  const w = clamp01(r.w);
  const h = clamp01(r.h);
  const x = Math.min(clamp01(r.x), 1 - w);
  const y = Math.min(clamp01(r.y), 1 - h);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

export function isValidCropRef(c: unknown): c is CropRef {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  const nums = ['x', 'y', 'w', 'h'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
  if (!nums || typeof o.id !== 'string' || !o.id) return false;
  if (!(CROP_ASPECTS as readonly string[]).includes(o.aspect as string)) return false;
  const { x, y, w, h } = o as unknown as CropRect;
  return w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= 1.000001 && y + h <= 1.000001;
}

/** 元画像のピクセル単位の切り抜き範囲 */
export function rectToPixels(r: CropRect, imgW: number, imgH: number) {
  const sx = Math.round(r.x * imgW);
  const sy = Math.round(r.y * imgH);
  const sw = Math.max(1, Math.min(imgW - sx, Math.round(r.w * imgW)));
  const sh = Math.max(1, Math.min(imgH - sy, Math.round(r.h * imgH)));
  return { sx, sy, sw, sh };
}
