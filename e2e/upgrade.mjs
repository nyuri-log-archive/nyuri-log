// v1.0 → v1.1 の更新テスト（既存データにトリミング情報が無くても表示でき、データが失われないこと）
// 使い方：node e2e/upgrade.mjs <v1.0のdistフォルダ> [v1.1で作ったバックアップZIP]（v1.1 は ./dist を使う。先に npm run build && npm run e2e）
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const oldDist = process.argv[2];
if (!oldDist) {
  console.error('v1.0 の dist フォルダを指定してください');
  process.exit(2);
}
const out = resolve(root, 'e2e/output');
mkdirSync(out, { recursive: true });
const BASE = 'http://127.0.0.1:4790/nyuri-log/';
const rootRef = { dir: resolve(oldDist) };
const server = await startServer(rootRef, 4790);
const browser = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => a !== '--single-process' && a !== '--no-zygote'), headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const dbState = () =>
  page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('nyuri-log');
        r.onsuccess = () => {
          const db = r.result;
          const stores = [...db.objectStoreNames];
          const tx = db.transaction(['records', 'imageFull'], 'readonly');
          const q1 = tx.objectStore('records').getAll();
          const q2 = tx.objectStore('imageFull').getAllKeys();
          tx.oncomplete = () => {
            const out = { version: db.version, stores, records: q1.result, fullIds: q2.result };
            db.close();
            res(out);
          };
        };
      }),
  );

try {
  // 0) 下位互換：v1.1 で作ったバックアップ（切り抜き入り）を v1.0 のアプリで復元できるか
  const newZip = process.argv[3];
  if (newZip) {
    const c0 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
    const p0 = await c0.newPage();
    p0.setDefaultTimeout(20000);
    await p0.goto(BASE);
    await p0.getByRole('button', { name: 'わかった、はじめる' }).click();
    await p0.goto(`${BASE}#/backup`);
    await p0.locator('input[type=file][accept^=".zip"]').setInputFiles(resolve(newZip));
    await p0.getByText('チェックサムの検査に合格しました').waitFor({ timeout: 30000 });
    await p0.getByRole('button', { name: '追加復元する（既存データは残す）' }).click();
    await p0.getByRole('button', { name: '復元する', exact: true }).click();
    const msg = await p0.getByText(/復元しました：/).textContent({ timeout: 30000 });
    await p0.goto(`${BASE}#/c/oc`);
    await p0.locator('.card', { hasText: 'ミナ' }).first().locator('.thumb img').waitFor();
    console.log(`✓ 下位互換：v1.1 のバックアップを v1.0 で復元できる（${msg.trim()}。トリミングは無視され従来のサムネイルで表示）`);
    await c0.close();
  }

  // 1) v1.0 で記録と画像を登録
  await page.goto(BASE);
  await page.getByRole('button', { name: 'わかった、はじめる' }).click();
  await page.goto(`${BASE}#/new/oc`);
  await page.getByLabel('キャラクター名').fill('v1.0のOC');
  await page.locator('input[type=file][accept^="image"]').setInputFiles([resolve(root, 'e2e/fixtures/photo-rotated.jpg')]);
  await page.getByText('1枚の画像を追加しました').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL(/#\/r\//);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const before = await dbState();
  assert(before.version === 10 || before.stores.length === 8, `v1.0 のDB構造 ${JSON.stringify({ v: before.version, s: before.stores })}`);
  assert(!before.stores.includes('imageCrop'), 'v1.0 に imageCrop がある');

  // 2) v1.1 を配信 → 更新
  rootRef.dir = resolve(root, 'dist');
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  await page.getByText('新しいバージョンがあります').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: '更新する' }).click();
  await page.waitForFunction(() => document.querySelector('meta[name=build]')?.getAttribute('content') !== 'v1.0-e2e', null, { timeout: 30000 });

  // 3) 一覧が既存データ（トリミング情報なし）のまま表示できる
  await page.goto(`${BASE}#/c/oc`);
  const card = page.locator('.card', { hasText: 'v1.0のOC' });
  await card.locator('.thumb img').waitFor();
  assert((await card.locator('.thumb[data-cropped="1"]').count()) === 0, 'トリミングしていないのに切り抜き扱い');
  const after = await dbState();
  assert(after.stores.includes('imageCrop'), 'imageCrop テーブルが追加されていない');
  assert(JSON.stringify(after.records) === JSON.stringify(before.records), '既存の記録が変わった');
  assert(JSON.stringify(after.fullIds) === JSON.stringify(before.fullIds), '既存の画像が変わった');

  // 4) 既存画像にあとからトリミングを設定できる
  await page.goto(`${BASE}#/edit/${before.records[0].id}`);
  await page.getByRole('button', { name: /サムネイルを調整/ }).click();
  await page.locator('.crop-img').waitFor();
  await page.getByRole('dialog', { name: 'サムネイルの調整' }).getByRole('button', { name: '決定' }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL(/#\/r\//);
  await page.goto(`${BASE}#/c/oc`);
  await page.locator('.card', { hasText: 'v1.0のOC' }).locator('.thumb[data-cropped="1"] img').waitFor();
  assert(errors.length === 0, `ページエラー: ${errors.join(' / ')}`);
  console.log('✓ v1.0 → v1.1 更新：既存データ保持、トリミング情報なしで表示、あとからトリミング設定');
  await browser.close();
  server.close();
  process.exit(0);
} catch (e) {
  console.log('✗ v1.0 → v1.1 更新\n   ', e.message);
  await page.screenshot({ path: resolve(out, 'upgrade-fail.png'), fullPage: true });
  await browser.close();
  server.close();
  process.exit(1);
}
