export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // 古い環境向けの代替（RFC4122 v4）
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

export function formatYmd(ymd: string | null): string {
  if (!ymd) return '';
  return ymd.replace(/-/g, '/');
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** http/https だけを安全なURLとして扱う。それ以外（javascript: 等）は null */
export function safeUrl(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** GitHubのURLを比較用に正規化（大文字小文字・末尾スラッシュ・.git・www を吸収） */
export function normalizeGithubUrl(s: string | null | undefined): string | null {
  const u = safeUrl(s ?? '');
  if (!u) return null;
  try {
    const x = new URL(u);
    const host = x.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'github.com') return null;
    const parts = x.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0].toLowerCase();
    const repo = parts[1].toLowerCase().replace(/\.git$/, '');
    return `https://github.com/${owner}/${repo}`;
  } catch {
    return null;
  }
}

/** 一般URLの比較用正規化 */
export function normalizeUrl(s: string | null | undefined): string | null {
  const u = safeUrl(s ?? '');
  if (!u) return null;
  const x = new URL(u);
  x.hash = '';
  let out = `${x.protocol}//${x.hostname.toLowerCase()}${x.port ? ':' + x.port : ''}${x.pathname}${x.search}`;
  out = out.replace(/\/+$/, '');
  return out;
}

export function normalizeText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 本文の先頭から仮タイトルを作る */
export function autoTitle(body: string, max = 24): string {
  const line = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const chars = [...line];
  return chars.length > max ? chars.slice(0, max).join('') + '…' : line;
}

export function parseTags(input: string): string[] {
  return uniqueTags(input.split(/[,、，\s#＃]+/));
}

export function uniqueTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const v = t.trim().replace(/^[#＃]/, '');
    if (!v) continue;
    const k = v.normalize('NFKC').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export function todayYmd(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
