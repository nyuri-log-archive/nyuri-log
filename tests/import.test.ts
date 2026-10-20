import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');
import { freshDB } from './helpers';
import { allRecords, getRecord, newRecord, saveRecord } from '../src/db/repo';
import { commitImport, extractJsonText, previewImport } from '../src/lib/jsonImport';
import { buildAiPrompt, buildJsonSpecMarkdown, SAMPLE_IMPORT } from '../src/lib/aiPrompt';
import { CATEGORIES, CATEGORY_DEFS } from '../src/lib/categories';
import { fetchPublicRepos, importRepos, matchRepos, nextLink, GithubError, type GithubRepo } from '../src/lib/github';

beforeEach(async () => {
  await freshDB();
});

const sample = read('samples/import-sample.json');
const invalid = read('samples/import-invalid-sample.json');

describe('JSON一括インポート', () => {
  it('サンプルの6カテゴリーをすべて取り込める', async () => {
    const p = previewImport(sample, []);
    expect(p.ok).toBe(true);
    expect(p.candidates.every((c) => c.record && !c.errors.length)).toBe(true);
    expect(p.counts).toEqual({ memo: 1, app: 1, lora: 1, nai: 1, oc: 1, other: 1 });
    const n = await commitImport(p.candidates.map((c) => c.record!));
    expect(n).toBe(6);
    const all = await allRecords();
    const memo = all.find((r) => r.category === 'memo')!;
    expect(memo.title).toBe('雨の日だけ開く古書店の話。'); // 仮タイトル
    expect(memo.madeDate).toBeNull();
    const nai = all.find((r) => r.category === 'nai')!;
    expect(nai.fields.positivePrompt).toContain('{{watercolor}}');
    expect(all.find((r) => r.category === 'app')!.fields.features).toBe('検索\nお気に入り\nコピー');
  });

  it('AIの前置きやコードフェンス付きでも読める', () => {
    const wrapped = `はい、変換しました！\n\n\`\`\`json\n${sample}\n\`\`\`\n\n以上です。`;
    expect(extractJsonText(wrapped).startsWith('{')).toBe(true);
    expect(previewImport(wrapped, []).ok).toBe(true);
  });

  it('不正なデータを件ごとに報告し、正しい要素は警告付きで取り込める', () => {
    const p = previewImport(invalid, []);
    expect(p.ok).toBe(true);
    const [a, b, c, d, e] = p.candidates;
    expect(a.errors[0]).toContain('novel');
    expect(b.errors[0]).toContain('category');
    expect(c.errors[0]).toContain('どれも入っていません');
    expect(d.errors[0]).toContain('オブジェクト');
    expect(e.record).toBeTruthy();
    expect(e.record!.madeDate).toBeNull();
    expect(e.record!.status).toBe('ベータ版');
    expect(e.record!.urls).toEqual([{ label: '', url: 'https://example.com/ok' }]);
    expect(e.record!.fields.publicUrl).toBeUndefined();
    expect(e.record!.fields.version).toBe('2');
    expect(e.record!.fields.unknownKey).toBe('保持される');
    expect(e.record!.extra.importUnknown).toEqual({ rating: 5 });
    expect(e.warnings.length).toBeGreaterThanOrEqual(5);
  });

  it('全体の形が違うJSONは理由つきで拒否する', () => {
    expect(previewImport('{ "a": ', []).fatal).toContain('JSONとして読み込めません');
    expect(previewImport('[1,2]', []).fatal).toContain('一番外側');
    expect(previewImport('{"format":"other","schemaVersion":1,"items":[]}', []).fatal).toContain('format');
    expect(previewImport('{"format":"nyuri-log","schemaVersion":2,"items":[]}', []).fatal).toContain('schemaVersion');
    expect(previewImport('{"format":"nyuri-log","schemaVersion":1}', []).fatal).toContain('items');
    expect(previewImport('', []).fatal).toBeTruthy();
  });

  it('既存データやファイル内の重複候補を検出し、取り込みは既存を上書きしない', async () => {
    const ex = await saveRecord(newRecord('lora', { title: '水彩にじみLoRA', body: '既存のメモ' }));
    const p = previewImport(sample, await allRecords());
    const dup = p.candidates.find((c) => c.record?.category === 'lora')!;
    expect(dup.duplicateOf?.id).toBe(ex.id);
    const twice = JSON.stringify({ ...JSON.parse(sample), items: [...JSON.parse(sample).items, JSON.parse(sample).items[1]] });
    const p2 = previewImport(twice, []);
    expect(p2.candidates[6].duplicateInFile).toBe(1);
    await commitImport([dup.record!]);
    expect((await getRecord(ex.id))?.body).toBe('既存のメモ');
    expect((await allRecords()).length).toBe(2);
  });
});

describe('AI用依頼文と仕様の一致', () => {
  it('依頼文に全カテゴリー・全項目キー・ステータス候補が含まれる', () => {
    const prompt = buildAiPrompt();
    for (const c of CATEGORIES) {
      expect(prompt).toContain(`"${c}"`);
      for (const f of CATEGORY_DEFS[c].fields.filter((x) => !x.readonly)) expect(prompt).toContain(`${f.key}：`);
      for (const s of CATEGORY_DEFS[c].statuses) expect(prompt).toContain(s);
    }
    expect(prompt).toContain('"format": "nyuri-log"');
  });

  it('依頼文に載せた出力例は、そのまま検証を通る', () => {
    const p = previewImport(JSON.stringify(SAMPLE_IMPORT), []);
    expect(p.ok).toBe(true);
    expect(p.candidates.every((c) => c.record && c.warnings.length === 0)).toBe(true);
  });

  it('docs/json-import-spec.md は最新の定義から生成されている', () => {
    const doc = read('docs/json-import-spec.md');
    expect(doc).toBe(buildJsonSpecMarkdown());
  });
});

function repo(id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    full_name: `nyuriwossan/${name}`,
    description: `${name}の説明`,
    html_url: `https://github.com/nyuriwossan/${name}`,
    homepage: '',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-03-04T00:00:00Z',
    pushed_at: '2026-03-05T00:00:00Z',
    fork: false,
    archived: false,
    has_pages: true,
    ...extra,
  };
}

function mockFetch(pages: unknown[][], opts: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const headers = new Headers(opts.headers ?? {});
    if (page < pages.length) headers.set('link', `<https://api.github.com/user/1/repos?per_page=100&page=${page + 1}>; rel="next", <https://api.github.com/user/1/repos?per_page=100&page=${pages.length}>; rel="last"`);
    return new Response(JSON.stringify(pages[page - 1] ?? []), { status: opts.status ?? 200, headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('GitHub一括インポート', () => {
  it('ページネーションをたどって全件取得する', async () => {
    const p1 = Array.from({ length: 100 }, (_, i) => repo(i + 1, `repo-${i + 1}`));
    const p2 = Array.from({ length: 100 }, (_, i) => repo(i + 101, `repo-${i + 101}`));
    const p3 = [repo(201, 'last-one', { homepage: 'https://nyuriwossan.github.io/last-one/' })];
    const { f, calls } = mockFetch([p1, p2, p3]);
    const repos = await fetchPublicRepos('nyuriwossan', f);
    expect(repos).toHaveLength(201);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('/users/nyuriwossan/repos');
    expect(repos[200].homepage).toBe('https://nyuriwossan.github.io/last-one/');
  });

  it('Linkヘッダーの解析', () => {
    expect(nextLink('<https://x/?page=2>; rel="next", <https://x/?page=5>; rel="last"')).toBe('https://x/?page=2');
    expect(nextLink('<https://x/?page=1>; rel="prev"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });

  it('レート制限・ユーザー不在・通信失敗・不正なユーザー名を区別して伝える', async () => {
    const rl = mockFetch([[]], { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 600) } });
    await expect(fetchPublicRepos('a', rl.f)).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(fetchPublicRepos('a', mockFetch([[]], { status: 404 }).f)).rejects.toMatchObject({ kind: 'not-found' });
    const net = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchPublicRepos('a', net)).rejects.toMatchObject({ kind: 'network' });
    await expect(fetchPublicRepos('bad user/../x', net)).rejects.toBeInstanceOf(GithubError);
  });

  it('推測で埋めない：制作日・ステータスは空、ホームページ未登録なら公開URLも空', async () => {
    const { f } = mockFetch([[repo(1, 'idea-gacha')]]);
    const [r] = await fetchPublicRepos('nyuriwossan', f);
    const { added } = await importRepos([r]);
    const rec = added[0];
    expect(rec.category).toBe('app');
    expect(rec.madeDate).toBeNull();
    expect(rec.status).toBe('');
    expect(rec.fields.publicUrl ?? '').toBe('');
    expect(rec.fields.repoCreatedAt).toBe('2026-01-02');
    expect(rec.fields.githubUrl).toBe('https://github.com/nyuriwossan/idea-gacha');
    expect(rec.source?.githubRepoId).toBe(1);
  });

  it('リポジトリIDまたは正規化URLで重複を判定し、既存の記録を上書きしない', async () => {
    const { f } = mockFetch([[repo(1, 'A'), repo(2, 'B'), repo(3, 'C')]]);
    const repos: GithubRepo[] = await fetchPublicRepos('nyuriwossan', f);
    await importRepos([repos[0]]);
    // 手で登録済みのアプリ（URL表記ゆれあり）
    const manual = await saveRecord(newRecord('app', { title: '手動のB', body: '大事なメモ', fields: { githubUrl: 'https://www.GitHub.com/NyuriWossan/b.git/' } }));
    const matches = matchRepos(repos, await allRecords());
    expect(matches.map((m) => !!m.existing)).toEqual([true, true, false]);
    const res = await importRepos(repos);
    expect(res.added.map((r) => r.title)).toEqual(['C']);
    expect(res.skipped.map((r) => r.name)).toEqual(['A', 'B']);
    const after = await getRecord(manual.id);
    expect(after?.body).toBe('大事なメモ');
    expect(after?.title).toBe('手動のB');
    expect((await allRecords()).length).toBe(3);
  });
});
