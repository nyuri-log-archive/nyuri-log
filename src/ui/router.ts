import { useEffect, useState } from 'react';

// ハッシュ方式のルーター（GitHub Pagesのサブパスや別ホストでも404にならない）

type Guard = () => boolean; // false を返すと遷移を中止
let guard: Guard | null = null;

export function setNavigationGuard(g: Guard | null) {
  guard = g;
}

function parse(): string[] {
  const h = window.location.hash.replace(/^#\/?/, '');
  return h.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(path: string, opts: { replace?: boolean; force?: boolean } = {}) {
  if (!opts.force && guard && !guard()) return;
  const target = '#' + (path.startsWith('/') ? path : '/' + path);
  if (opts.replace) window.location.replace(target);
  else window.location.hash = target;
}

export function goBack(fallback = '/') {
  if (guard && !guard()) return;
  if (window.history.length > 1) {
    window.history.back();
  } else {
    navigate(fallback, { force: true });
  }
}

export function href(path: string) {
  return '#' + (path.startsWith('/') ? path : '/' + path);
}
