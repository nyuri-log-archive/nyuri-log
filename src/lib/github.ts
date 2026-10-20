import { getDB } from '../db/db';
import { toStorageError } from '../db/errors';
import { newRecord, normalizeRecord } from '../db/repo';
import type { RecordItem } from '../db/types';
import { normalizeGithubUrl, safeUrl } from './util';

export interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  htmlUrl: string;
  homepage: string | null;
  createdAt: string;
  updatedAt: string;
  pushedAt: string | null;
  fork: boolean;
  archived: boolean;
  hasPages: boolean;
}

export class GithubError extends Error {
  kind: 'not-found' | 'rate-limit' | 'network' | 'http' | 'invalid';
  resetAt?: number;
  constructor(kind: GithubError['kind'], message: string, resetAt?: number) {
    super(message);
    this.name = 'GithubError';
    this.kind = kind;
    this.resetAt = resetAt;
  }
}

export function isValidGithubUser(u: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(u);
}

/** Link ヘッダーから次ページのURLを取り出す */
export function nextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

function toRepo(x: Record<string, unknown>): GithubRepo | null {
  if (typeof x.id !== 'number' || typeof x.name !== 'string' || typeof x.html_url !== 'string') return null;
  const homepage = typeof x.homepage === 'string' ? safeUrl(x.homepage) : null;
  return {
    id: x.id,
    name: x.name,
    fullName: typeof x.full_name === 'string' ? x.full_name : x.name,
    description: typeof x.description === 'string' ? x.description : '',
    htmlUrl: x.html_url,
    homepage,
    createdAt: typeof x.created_at === 'string' ? x.created_at : '',
    updatedAt: typeof x.updated_at === 'string' ? x.updated_at : '',
    pushedAt: typeof x.pushed_at === 'string' ? x.pushed_at : null,
    fork: x.fork === true,
    archived: x.archived === true,
    hasPages: x.has_pages === true,
  };
}

/**
 * 公開リポジトリ一覧を取得（認証なし・全ページ）。
 * 通信の失敗はローカルデータに一切影響しない。
 */
export async function fetchPublicRepos(user: string, fetchImpl: typeof fetch = fetch, maxPages = 30): Promise<GithubRepo[]> {
  const u = user.trim();
  if (!isValidGithubUser(u)) throw new GithubError('invalid', 'GitHubユーザー名の形式が正しくありません。');
  let url: string | null = `https://api.github.com/users/${encodeURIComponent(u)}/repos?per_page=100&type=owner&sort=created&direction=desc`;
  const out: GithubRepo[] = [];
  for (let page = 0; url && page < maxPages; page++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, referrerPolicy: 'no-referrer' });
    } catch {
      throw new GithubError('network', 'GitHubに接続できませんでした。通信状態を確認してください（登録済みのデータには影響ありません）。');
    }
    if (res.status === 404) throw new GithubError('not-found', `GitHubユーザー「${u}」が見つかりません。`);
    const remaining = res.headers.get('x-ratelimit-remaining');
    if ((res.status === 403 || res.status === 429) && (remaining === '0' || res.status === 429)) {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 || undefined;
      const when = reset ? new Date(reset).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : 'しばらく';
      throw new GithubError('rate-limit', `GitHub APIの利用回数の上限に達しました。${when}以降にもう一度お試しください。`, reset);
    }
    if (!res.ok) throw new GithubError('http', `GitHubから取得できませんでした（HTTP ${res.status}）。`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new GithubError('http', 'GitHubからの応答を読み取れませんでした。');
    }
    if (!Array.isArray(json)) throw new GithubError('http', 'GitHubからの応答が想定と違います。');
    for (const x of json) {
      const r = toRepo(x as Record<string, unknown>);
      if (r) out.push(r);
    }
    url = nextLink(res.headers.get('link'));
  }
  return out;
}

export interface RepoMatch {
  repo: GithubRepo;
  existing: RecordItem | null;
}

/** 既存の記録と照合（リポジトリID → 正規化GitHub URL の順） */
export function matchRepos(repos: GithubRepo[], records: RecordItem[]): RepoMatch[] {
  const byId = new Map<number, RecordItem>();
  const byUrl = new Map<string, RecordItem>();
  for (const r of records) {
    if (r.source?.githubRepoId) byId.set(r.source.githubRepoId, r);
    const n = normalizeGithubUrl(r.fields.githubUrl);
    if (n) byUrl.set(n, r);
    for (const u of r.urls) {
      const nu = normalizeGithubUrl(u.url);
      if (nu && !byUrl.has(nu)) byUrl.set(nu, r);
    }
  }
  return repos.map((repo) => ({
    repo,
    existing: byId.get(repo.id) ?? byUrl.get(normalizeGithubUrl(repo.htmlUrl) ?? '') ?? null,
  }));
}

/** リポジトリ情報から登録内容を作る。推測で埋めない（制作日・ステータス・公開URL推測なし） */
export function repoToRecord(repo: GithubRepo): RecordItem {
  return normalizeRecord(
    newRecord('app', {
      title: repo.name,
      status: '',
      madeDate: null,
      fields: {
        purpose: repo.description,
        githubUrl: repo.htmlUrl,
        publicUrl: repo.homepage ?? '',
        repoCreatedAt: repo.createdAt.slice(0, 10),
        repoUpdatedAt: (repo.pushedAt ?? repo.updatedAt).slice(0, 10),
      },
      source: { type: 'github', githubRepoId: repo.id, githubFullName: repo.fullName, importedAt: Date.now() },
    }),
  );
}

/**
 * 選んだリポジトリを一括登録。既に登録済みのものは（allowDuplicates が無い限り）登録しない。
 * 既存の記録は一切変更しない。1トランザクションで書き込む。
 */
export async function importRepos(repos: GithubRepo[], opts: { allowDuplicates?: boolean } = {}): Promise<{ added: RecordItem[]; skipped: GithubRepo[] }> {
  const db = getDB();
  const added: RecordItem[] = [];
  const skipped: GithubRepo[] = [];
  try {
    await db.transaction('rw', [db.records, db.meta], async () => {
      const records = await db.records.toArray();
      const matches = matchRepos(repos, records);
      const seen = new Set<number>();
      for (const m of matches) {
        if (seen.has(m.repo.id) || (m.existing && !opts.allowDuplicates)) {
          skipped.push(m.repo);
          continue;
        }
        seen.add(m.repo.id);
        const rec = { ...repoToRecord(m.repo), rev: 1 };
        await db.records.add(rec);
        added.push(rec);
      }
      const st = (await db.meta.get('state'))?.value as Record<string, unknown> | undefined;
      await db.meta.put({ key: 'state', value: { ...(st ?? {}), changesSinceBackup: ((st?.changesSinceBackup as number) ?? 0) + added.length } });
    });
  } catch (e) {
    throw toStorageError(e, 'GitHubからの登録');
  }
  return { added, skipped };
}
