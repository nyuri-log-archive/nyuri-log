import { describe, expect, it } from 'vitest';
import { newRecord } from '../src/db/repo';
import { DEFAULT_QUERY, allTags, search } from '../src/lib/search';
import { chooseOutputMime, fitSize, guessMime, mayHaveAlpha } from '../src/lib/image';
import { autoTitle, normalizeGithubUrl, parseTags, safeUrl, isValidYmd } from '../src/lib/util';

const t0 = 1_700_000_000_000;
const recs = [
  newRecord('memo', { title: '雨の古書店', body: '店主はネコ', tags: ['プロット'], createdAt: t0, updatedAt: t0 + 500 }),
  newRecord('oc', { title: 'ミナ', body: '', tags: ['和風', 'プロット'], favorite: true, status: '設定中', fields: { personality: '物静か' }, createdAt: t0 + 100, updatedAt: t0 + 100 }),
  newRecord('nai', { title: '水彩', fields: { positivePrompt: 'Watercolor, {{masterpiece}}' }, createdAt: t0 + 200, updatedAt: t0 + 300 }),
  newRecord('app', { title: 'ガチャ', status: '公開済み', createdAt: t0 + 300, updatedAt: t0 + 150 }),
  newRecord('memo', { title: '削除済み', body: 'ネコ', deletedAt: t0 + 999, createdAt: t0 + 400, updatedAt: t0 + 400 }),
];

describe('検索・絞り込み・並び替え', () => {
  it('全カテゴリー横断でタイトル・本文・専用項目を探し、ゴミ箱は除く', () => {
    expect(search(recs, { ...DEFAULT_QUERY, text: 'ネコ' }).map((r) => r.title)).toEqual(['雨の古書店']);
    expect(search(recs, { ...DEFAULT_QUERY, text: 'watercolor' }).map((r) => r.title)).toEqual(['水彩']);
    expect(search(recs, { ...DEFAULT_QUERY, text: '物静か' }).map((r) => r.title)).toEqual(['ミナ']);
    expect(search(recs, { ...DEFAULT_QUERY, text: 'ＷＡＴＥＲ' })).toHaveLength(1); // 全角も一致
  });
  it('タグ・カテゴリー内・お気に入り・ステータス', () => {
    expect(search(recs, { ...DEFAULT_QUERY, text: '#プロット' })).toHaveLength(2);
    expect(search(recs, { ...DEFAULT_QUERY, tag: '和風' }).map((r) => r.title)).toEqual(['ミナ']);
    expect(search(recs, { ...DEFAULT_QUERY, category: 'memo' }).map((r) => r.title)).toEqual(['雨の古書店']);
    expect(search(recs, { ...DEFAULT_QUERY, favoritesOnly: true }).map((r) => r.title)).toEqual(['ミナ']);
    expect(search(recs, { ...DEFAULT_QUERY, status: '公開済み' }).map((r) => r.title)).toEqual(['ガチャ']);
    expect(search(recs, { ...DEFAULT_QUERY, text: 'ミナ 物静か' })).toHaveLength(1); // AND検索
  });
  it('新しい順・古い順・更新順', () => {
    expect(search(recs, { ...DEFAULT_QUERY, sort: 'newest' }).map((r) => r.title)).toEqual(['ガチャ', '水彩', 'ミナ', '雨の古書店']);
    expect(search(recs, { ...DEFAULT_QUERY, sort: 'oldest' }).map((r) => r.title)).toEqual(['雨の古書店', 'ミナ', '水彩', 'ガチャ']);
    expect(search(recs, { ...DEFAULT_QUERY, sort: 'updated' }).map((r) => r.title)).toEqual(['雨の古書店', '水彩', 'ガチャ', 'ミナ']);
  });
  it('タグ一覧は件数順', () => {
    expect(allTags(recs)[0]).toEqual({ tag: 'プロット', count: 2 });
  });
});

describe('画像の軽量化ロジック', () => {
  it('長辺を上限に収め、縦横比を保ち、拡大しない', () => {
    expect(fitSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(1170, 2532, 1600)).toEqual({ width: 739, height: 1600 });
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1600, 1, 360)).toEqual({ width: 360, height: 1 });
  });
  it('透過がある画像は WebP（非対応なら PNG）、ない画像は JPEG', () => {
    expect(chooseOutputMime(false, true)).toBe('image/jpeg');
    expect(chooseOutputMime(true, true)).toBe('image/webp');
    expect(chooseOutputMime(true, false)).toBe('image/png');
    expect(mayHaveAlpha('image/png')).toBe(true);
    expect(mayHaveAlpha('image/jpeg')).toBe(false);
  });
  it('拡張子から形式を推定（iPhoneのファイルアプリはtypeが空のことがある）', () => {
    expect(guessMime(new File([], 'IMG_0001.HEIC'))).toBe('image/heic');
    expect(guessMime(new File([], 'a.png', { type: 'image/png' }))).toBe('image/png');
  });
});

describe('入力の安全性', () => {
  it('http/https 以外のURLは無効', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<b>x</b>')).toBeNull();
    expect(safeUrl(' https://example.com/a b ')).toBe('https://example.com/a%20b');
  });
  it('GitHub URL の正規化', () => {
    expect(normalizeGithubUrl('https://www.github.com/Nyuri/Repo.git/')).toBe('https://github.com/nyuri/repo');
    expect(normalizeGithubUrl('https://gitlab.com/a/b')).toBeNull();
  });
  it('タグ・日付・仮タイトル', () => {
    expect(parseTags('#和風、 OC,oc  検証')).toEqual(['和風', 'OC', '検証']);
    expect(isValidYmd('2026-02-30')).toBe(false);
    expect(isValidYmd('2026-02-28')).toBe(true);
    expect(autoTitle('\n\n  一行目\n二行目')).toBe('一行目');
  });
});
