import { useEffect, useRef, useState } from 'react';
import { getImageBlob, getListThumbBlob } from '../db/repo';
import type { ImageRef } from '../db/types';
import { CATEGORY_DEFS, type Category } from '../lib/categories';
import { Icon } from './Icon';

/** 画像Blobを読み込み、表示中だけオブジェクトURLを保持する */
export function useImageUrl(id: string | null | undefined, kind: 'thumb' | 'full', enabled = true): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ url: string | null; missing: boolean }>({ url: null, missing: false });
  useEffect(() => {
    if (!id || !enabled) return;
    let alive = true;
    let url: string | null = null;
    getImageBlob(id, kind)
      .then((b) => {
        if (!alive) return;
        if (!b) {
          setState({ url: null, missing: true });
          return;
        }
        url = URL.createObjectURL(b);
        setState({ url, missing: false });
      })
      .catch(() => alive && setState({ url: null, missing: true }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, kind, enabled]);
  return state;
}

function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    if (!('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

export function Placeholder({ category, small }: { category: Category; small?: boolean }) {
  const d = CATEGORY_DEFS[category];
  return (
    <div className={`placeholder ${small ? 'small' : ''}`} style={{ background: d.color, color: d.colorStrong }}>
      <Icon name={d.icon} size={small ? 22 : 34} />
    </div>
  );
}

/** 一覧用のサムネイルURL。トリミングがあれば切り抜き版、無ければ従来の縮小版 */
function useListThumbUrl(img: Pick<ImageRef, 'id' | 'crop'> | null, enabled: boolean): { url: string | null; missing: boolean; cropped: boolean } {
  const [state, setState] = useState<{ url: string | null; missing: boolean; cropped: boolean }>({ url: null, missing: false, cropped: false });
  const id = img?.id;
  const cropId = img?.crop?.id;
  useEffect(() => {
    if (!id || !enabled) return;
    let alive = true;
    let url: string | null = null;
    getListThumbBlob({ id, crop: cropId ? ({ id: cropId } as ImageRef['crop']) : null })
      .then(({ blob, cropped }) => {
        if (!alive) return;
        if (!blob) {
          setState({ url: null, missing: true, cropped: false });
          return;
        }
        url = URL.createObjectURL(blob);
        setState({ url, missing: false, cropped });
      })
      .catch(() => alive && setState({ url: null, missing: true, cropped: false }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, cropId, enabled]);
  return state;
}

/** 記録の代表画像の参照 */
export function coverRef(r: { images: ImageRef[]; coverImageId: string | null }): ImageRef | null {
  return r.images.find((i) => i.id === r.coverImageId) ?? r.images[0] ?? null;
}

/**
 * 一覧用サムネイル（画面に入ったときだけ読み込む）。
 * shape="auto" のときは、トリミングの比率（1:1 / 3:4）に合わせた枠で表示する。
 */
export function Thumb({ img, category, alt, small, shape = 'square' }: { img: ImageRef | null; category: Category; alt: string; small?: boolean; shape?: 'square' | 'auto' }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const { url, missing, cropped } = useListThumbUrl(img, seen);
  const tall = shape === 'auto' && img?.crop?.aspect === '3:4';
  return (
    <div ref={ref} className={`thumb ${small ? 'small' : ''} ${tall ? 'tall' : ''}`} data-cropped={cropped ? '1' : undefined}>
      {img && url ? <img src={url} alt={alt} draggable={false} /> : <Placeholder category={category} small={small} />}
      {img && missing && <span className="thumb-missing">画像なし</span>}
    </div>
  );
}

/** 画像全体（保存用画像）を、切り抜かずに表示する。詳細画面用 */
export function FullImage({ id, alt, category }: { id: string; alt: string; category: Category }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const { url, missing } = useImageUrl(id, 'full', seen);
  return (
    <div ref={ref} className="full-image">
      {url ? <img src={url} alt={alt} draggable={false} /> : missing ? <Placeholder category={category} /> : <div className="full-image-loading" />}
    </div>
  );
}

/** 全画面ビューア（表示中の1枚だけフル解像度を読み込む） */
export function ImageViewer({ images, index, onClose, onIndex }: { images: ImageRef[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const cur = images[index];
  const { url, missing } = useImageUrl(cur?.id, 'full');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [index, images.length, onClose, onIndex]);
  const touch = useRef<number | null>(null);
  if (!cur) return null;
  return (
    <div
      className="viewer"
      role="dialog"
      aria-label="画像の拡大表示"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        touch.current = null;
        if (dx > 60 && index > 0) onIndex(index - 1);
        if (dx < -60 && index < images.length - 1) onIndex(index + 1);
      }}
    >
      <div className="viewer-top">
        <span>
          {index + 1} / {images.length}
        </span>
        <button className="icon-btn light" onClick={onClose} aria-label="閉じる">
          <Icon name="close" />
        </button>
      </div>
      <div className="viewer-stage" onClick={onClose}>
        {url ? <img src={url} alt={cur.caption || `画像${index + 1}`} onClick={(e) => e.stopPropagation()} /> : <p className="viewer-msg">{missing ? '画像データが見つかりません' : '読み込み中…'}</p>}
      </div>
      {cur.caption && <p className="viewer-caption">{cur.caption}</p>}
      {images.length > 1 && (
        <div className="viewer-nav">
          <button className="icon-btn light" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="前の画像">
            <Icon name="left" />
          </button>
          <button className="icon-btn light" disabled={index === images.length - 1} onClick={() => onIndex(index + 1)} aria-label="次の画像">
            <Icon name="right" />
          </button>
        </div>
      )}
    </div>
  );
}
