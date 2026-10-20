import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getImageBlob, getImageMeta, putCrop } from '../db/repo';
import type { ImageMeta } from '../db/types';
import {
  CROP_ASPECTS,
  aspectRatio,
  clampView,
  defaultView,
  maxScale,
  minScale,
  rectToView,
  viewToRect,
  zoomAt,
  type CropAspect,
  type CropRef,
  type CropView,
  type Frame,
} from '../lib/crop';
import { renderCropThumb, ImageProcessError } from '../lib/image';

interface Props {
  imageId: string;
  initial: CropRef | null | undefined;
  maxEdge: number;
  quality: number;
  /** アップロード直後に開いた場合は「あとで」と表示 */
  fromUpload?: boolean;
  onCancel: () => void;
  /** 決定（null はトリミング解除） */
  onDone: (crop: CropRef | null) => void;
}

type Pt = { x: number; y: number };

/**
 * サムネイル用トリミングの編集画面。
 * 枠は固定で、画像を指でドラッグ（移動）・2本指でピンチ（拡大縮小）して合わせる。
 * スライダーとボタンでも同じ操作ができる。
 */
export function CropEditor({ imageId, initial, maxEdge, quality, fromUpload, onCancel, onDone }: Props) {
  const [meta, setMeta] = useState<ImageMeta | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [aspect, setAspect] = useState<CropAspect>(initial?.aspect ?? '1:1');
  const [frame, setFrame] = useState<Frame | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Pt>());
  const lastRect = useRef(initial ? { x: initial.x, y: initial.y, w: initial.w, h: initial.h } : null);

  // 画像（保存用の軽量化画像）を読み込む
  useEffect(() => {
    let alive = true;
    let u: string | null = null;
    Promise.all([getImageMeta(imageId), getImageBlob(imageId, 'full')])
      .then(([m, b]) => {
        if (!alive) return;
        if (!m || !b) {
          setLoadError('画像データが見つかりません。');
          return;
        }
        u = URL.createObjectURL(b);
        setMeta(m);
        setBlob(b);
        setUrl(u);
      })
      .catch(() => alive && setLoadError('画像を読み込めませんでした。'));
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [imageId]);

  // 画面スクロール・iOSのページ拡大を止める
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    document.addEventListener('gesturechange', stop);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
    };
  }, []);

  // 枠の大きさ（画面に収まる最大の 1:1 / 3:4）
  const measure = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const W = el.clientWidth * 0.86;
    const H = el.clientHeight * 0.86;
    const r = aspectRatio(aspect);
    const fw = Math.floor(Math.min(W, H * r));
    setFrame({ fw, fh: Math.floor(fw / r) });
  }, [aspect]);
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, url]);

  // 枠や比率が変わったら、今の切り抜き範囲（の中心）をできるだけ保って表示し直す
  useEffect(() => {
    if (!meta || !frame) return;
    const W = meta.width;
    const H = meta.height;
    const r = lastRect.current;
    if (!r) {
      setView(defaultView(W, H, frame));
      return;
    }
    const sameAspect = Math.abs((r.w * W) / (r.h * H) - frame.fw / frame.fh) < 0.01;
    if (sameAspect) {
      setView(rectToView(r, W, H, frame));
      return;
    }
    const cx = (r.x + r.w / 2) * W;
    const cy = (r.y + r.h / 2) * H;
    const k = Math.min((r.w * W) / frame.fw, (r.h * H) / frame.fh);
    const scale = 1 / k;
    setView(clampView({ scale, tx: frame.fw / 2 - cx * scale, ty: frame.fh / 2 - cy * scale }, W, H, frame));
  }, [meta, frame]);

  useEffect(() => {
    if (meta && frame && view) lastRect.current = viewToRect(view, meta.width, meta.height, frame);
  }, [meta, frame, view]);

  if (loadError)
    return (
      <div className="crop-editor" role="dialog" aria-modal="true" aria-label="サムネイルの調整">
        <p className="viewer-msg">{loadError}</p>
        <button className="btn" onClick={onCancel}>
          閉じる
        </button>
      </div>
    );

  const W = meta?.width ?? 1;
  const H = meta?.height ?? 1;
  const apply = (fn: (v: CropView) => CropView) => setView((v) => (v && frame ? clampView(fn(v), W, H, frame) : v));

  // 枠の左上を原点にした座標
  const toFrame = (e: { clientX: number; clientY: number }): Pt => {
    const el = stageRef.current!.querySelector('.crop-frame')!.getBoundingClientRect();
    return { x: e.clientX - el.left, y: e.clientY - el.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 取得できない環境でも操作は続けられる */
    }
    pointers.current.set(e.pointerId, toFrame(e));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev || !frame) return;
    const cur = toFrame(e);
    if (map.size === 1) {
      apply((v) => ({ ...v, tx: v.tx + cur.x - prev.x, ty: v.ty + cur.y - prev.y }));
    } else {
      // 2本指：動いた指ともう1本の指の距離の変化で拡大縮小し、中点の移動で位置も動かす
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      const m0 = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const m1 = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
      if (d0 > 0) {
        apply((v) => {
          const z = zoomAt(v, v.scale * (d1 / d0), m0.x, m0.y, W, H, frame);
          return { ...z, tx: z.tx + m1.x - m0.x, ty: z.ty + m1.y - m0.y };
        });
      }
    }
    map.set(e.pointerId, cur);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!frame) return;
    const p = toFrame(e);
    apply((v) => zoomAt(v, v.scale * Math.exp(-e.deltaY * 0.002), p.x, p.y, W, H, frame));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    const map: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (map[e.key]) {
      e.preventDefault();
      apply((v) => ({ ...v, tx: v.tx + map[e.key][0], ty: v.ty + map[e.key][1] }));
    }
  };

  const zoomCenter = (scale: number) => frame && apply((v) => zoomAt(v, scale, frame.fw / 2, frame.fh / 2, W, H, frame));
  const minS = frame ? minScale(W, H, frame) : 1;
  const maxS = frame ? maxScale(W, H, frame) : 1;
  const zoomPct = view && maxS > minS ? Math.round(((view.scale - minS) / (maxS - minS)) * 100) : 0;

  const confirm = async () => {
    if (!meta || !blob || !frame || !view || busy) return;
    setBusy(true);
    setError('');
    try {
      const rect = viewToRect(view, W, H, frame);
      const crop = await renderCropThumb({ id: meta.id, blob, mime: meta.mime }, rect, aspect, { maxEdge, quality });
      await putCrop(crop);
      onDone({ id: crop.id, aspect, ...rect });
    } catch (e) {
      setError(e instanceof ImageProcessError ? e.message : (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="crop-editor" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="crop-top">
        <button className="btn btn-small crop-ghost" onClick={onCancel} disabled={busy}>
          {fromUpload ? 'あとで' : 'やめる'}
        </button>
        <h2 id="crop-title">サムネイルの調整</h2>
        <button className="btn btn-small btn-primary" onClick={confirm} disabled={busy || !view}>
          {busy ? '作成中…' : '決定'}
        </button>
      </div>

      <div
        ref={stageRef}
        className="crop-stage"
        tabIndex={0}
        aria-label="画像を指で動かして、枠の中に入れたい部分を合わせてください。2本指で拡大縮小できます。"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        {frame && (
          <div className="crop-frame" style={{ width: frame.fw, height: frame.fh }}>
            {url && view && (
              <img
                className="crop-img"
                src={url}
                alt=""
                draggable={false}
                style={{ width: W * view.scale, height: H * view.scale, transform: `translate3d(${view.tx}px, ${view.ty}px, 0)` }}
              />
            )}
            <div className="crop-grid" aria-hidden="true" />
          </div>
        )}
        {!url && <p className="viewer-msg">読み込み中…</p>}
      </div>

      <div className="crop-controls">
        <p className="crop-hint">指でドラッグして位置、2本指で大きさを調整。枠の中が一覧のサムネイルになります（元の画像はそのまま残ります）。</p>
        <div className="crop-row" role="group" aria-label="比率">
          {CROP_ASPECTS.map((a) => (
            <button key={a} className={`chip ${aspect === a ? 'on' : ''}`} aria-pressed={aspect === a} onClick={() => setAspect(a)} disabled={busy}>
              {a === '1:1' ? '正方形 1:1' : '縦長 3:4'}
            </button>
          ))}
        </div>
        <div className="crop-row">
          <button className="icon-btn light" aria-label="縮小" onClick={() => view && zoomCenter(view.scale / 1.15)} disabled={busy}>
            <span aria-hidden="true" className="crop-pm">−</span>
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={zoomPct}
            aria-label="拡大率"
            onChange={(e) => zoomCenter(minS + ((maxS - minS) * Number(e.target.value)) / 100)}
            disabled={busy}
          />
          <button className="icon-btn light" aria-label="拡大" onClick={() => view && zoomCenter(view.scale * 1.15)} disabled={busy}>
            <span aria-hidden="true" className="crop-pm">＋</span>
          </button>
        </div>
        <div className="crop-row">
          <button className="btn btn-small crop-ghost" onClick={() => frame && meta && setView(defaultView(W, H, frame))} disabled={busy}>
            最初の位置に戻す
          </button>
          <button className="btn btn-small crop-ghost" onClick={() => apply((v) => ({ ...v, ty: 0 }))} disabled={busy}>
            上端に合わせる
          </button>
          {initial && (
            <button className="btn btn-small crop-ghost danger" onClick={() => onDone(null)} disabled={busy}>
              トリミング解除
            </button>
          )}
        </div>
        {error && (
          <p className="crop-error" role="alert">
            {error}（記録の内容や元の画像は変わっていません）
          </p>
        )}
      </div>
    </div>
  );
}
