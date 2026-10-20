// ブラウザでの通し動作テスト（Chromium・iPhone相当の画面サイズ）
// 実行：npm run build && npm run e2e
// ※ これは Chromium での確認です。iPhone の Safari（WebKit）での動作確認にはなりません。
import chromium from '@sparticuz/chromium';
import { chromium as pw } from 'playwright-core';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'e2e/output');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const fx = (n) => resolve(root, 'e2e/fixtures', n);
const BASE = 'http://127.0.0.1:4789/nyuri-log/';

// 「更新前」と「更新後」の2つのビルドを用意（アプリ更新でデータが残るかの確認用）
const v1 = resolve(out, 'site-v1');
const v2 = resolve(out, 'site-v2');
cpSync(resolve(root, 'dist'), v1, { recursive: true });
// v2 は識別子だけ違う本物の再ビルド（サービスワーカーの更新検知も含めて再現）
execSync(`npx vite build --outDir "${v2}" --emptyOutDir`, { cwd: root, env: { ...process.env, BUILD_MARK: 'v2-e2e' }, stdio: 'ignore' });

const rootRef = { dir: v1 };
const server = await startServer(rootRef);
const browser = await pw.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => a !== '--single-process' && a !== '--no-zygote'), headless: true });

const results = [];
let failed = 0;
async function step(name, fn) {
  const t = Date.now();
  try {
    console.log(`… ${name}`);
    await fn();
    results.push(`✓ ${name} (${Date.now() - t}ms)`);
    console.log(results[results.length - 1]);
  } catch (e) {
    failed++;
    results.push(`✗ ${name}\n    ${String(e?.stack ?? e).split('\n').slice(0, 4).join('\n    ')}`);
    console.log(results[results.length - 1]);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP', acceptDownloads: true };

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => results.push(`  [pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && results.push(`  [console.error] ${m.text()}`));
  return page;
}

/** IndexedDB の内容（画像本体を除く）を読む */
async function readDb(page) {
  return page.evaluate(
    () =>
      new Promise((res, rej) => {
        const r = indexedDB.open('nyuri-log');
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(['records', 'images', 'history', 'imageFull', 'imageThumb'], 'readonly');
          const get = (s) => new Promise((ok) => { const q = tx.objectStore(s).getAll(); q.onsuccess = () => ok(q.result); });
          Promise.all([get('records'), get('images'), get('history'), get('imageFull'), get('imageThumb')]).then(async ([records, images, history, full, thumb]) => {
            const hash = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((x) => x.toString(16).padStart(2, '0')).join('');
            const fullHashes = {};
            for (const f of full) fullHashes[f.id] = await hash(f.data);
            const thumbSizes = {};
            for (const t of thumb) thumbSizes[t.id] = t.data.byteLength;
            db.close();
            res({ records, images, history, fullHashes, thumbSizes });
          });
        };
      }),
  );
}

async function dismissOnboarding(page) {
  const btn = page.getByRole('button', { name: 'わかった、はじめる' });
  await btn.waitFor({ timeout: 8000 });
  await page.screenshot({ path: resolve(out, '00-onboarding.png') });
  await btn.click();
  await btn.waitFor({ state: 'detached' });
}

const ctx = await browser.newContext(device);
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4789' });
const page = await newPage(ctx);
page.setDefaultTimeout(15000);
console.log('browser ready');
let memoId = null;
let ocId = null;

await step('初回起動：案内が出てメモ画面（ホーム）が初期表示', async () => {
  await page.goto(BASE);
  await dismissOnboarding(page);
  await page.getByText('クイックメモ').waitFor();
  assert(await page.locator('.tab.active').innerText().then((t) => t.includes('メモ')), 'メモタブが選択されていない');
});

await step('クイックメモ：本文だけで保存、未整理・最近の記録に出る', async () => {
  await page.locator('#quick').fill('雨の日だけ開く古書店\n店主は猫かもしれない');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('メモを保存しました').waitFor();
  assert((await page.locator('#quick').inputValue()) === '', '入力欄が空にならない');
  await page.locator('.row', { hasText: '雨の日だけ開く古書店' }).first().waitFor();
  const db = await readDb(page);
  assert(db.records.length === 1 && db.records[0].title === '雨の日だけ開く古書店', '仮タイトルが付かない');
  assert(db.records[0].madeDate === null, '制作日が勝手に補完された');
  memoId = db.records[0].id;
  await page.screenshot({ path: resolve(out, '01-home.png'), fullPage: true });
});

await step('メモ→OCにカテゴリー変更、項目入力、画像3枚追加（軽量化・透過・向き）', async () => {
  await page.goto(`${BASE}#/edit/${memoId}`);
  await page.getByLabel('カテゴリー', { exact: true }).selectOption('oc');
  await page.getByText('本文・画像・入力済みの項目は消えずに保持').waitFor();
  await page.getByLabel('キャラクター名').fill('ミナ');
  await page.getByLabel('性格').fill('物静か。観察好き。');
  await page.getByLabel('キャラクタープロフィール全文').fill('名前：ミナ\n年齢：24\n「本は嘘をつかない」');
  const tagInput = page.getByLabel('タグを追加');
  await tagInput.fill('和風');
  await tagInput.press('Enter');
  await tagInput.fill('司書');
  await tagInput.press('Enter');
  await page.locator('input[type=file][accept^="image"]').setInputFiles([fx('photo-rotated.jpg'), fx('transparent.png'), fx('screenshot.png')]);
  await page.getByText('3枚の画像を追加しました').waitFor({ timeout: 30000 });
  await page.getByLabel('画像2の説明').fill('表情差分');
  await page.locator('.img-edit').nth(1).getByRole('button', { name: '代表にする' }).click();
  await page.locator('.img-edit').nth(2).getByRole('button', { name: '前へ' }).click();
  await page.screenshot({ path: resolve(out, '02-editor.png'), fullPage: true });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL(/#\/r\//);
  const db = await readDb(page);
  const r = db.records.find((x) => x.id === memoId);
  ocId = r.id;
  assert(r.category === 'oc' && r.title === 'ミナ', 'カテゴリー変更・タイトルが保存されていない');
  assert(r.body.startsWith('雨の日だけ'), '本文が失われた');
  assert(r.images.length === 3, '画像参照が3件でない');
  assert(r.images[2].caption === '表情差分' && r.images[1].caption === '', '並び替え後の説明文の位置が違う');
  const metas = Object.fromEntries(db.images.map((m) => [m.originalName, m]));
  const photo = metas['photo-rotated.jpg'];
  const png = metas['transparent.png'];
  const shot = metas['screenshot.png'];
  assert(photo.width === 1200 && photo.height === 1600, `写真の向き・縮小が違う ${photo.width}x${photo.height}`);
  assert(photo.mime === 'image/jpeg' && photo.size < 600_000, `写真が軽量化されていない ${photo.mime} ${photo.size}`);
  assert(png.mime === 'image/webp' || png.mime === 'image/png', `透過画像の形式 ${png.mime}`);
  assert(shot.mime === 'image/jpeg' && shot.height === 1600, `スクショの処理 ${shot.mime} ${shot.width}x${shot.height}`);
  assert(Math.max(...Object.values(db.thumbSizes)) < 80_000, 'サムネイルが大きすぎる');
  assert(db.images.every((m) => !m.hasOriginal), '元画像が保存されている');
  assert(r.coverImageId === png.id, '代表画像の指定が保存されていない');
  results.push(`    写真 4032x3024(EXIF回転) → ${photo.width}x${photo.height} ${photo.mime} ${(photo.size / 1024).toFixed(0)}KB / 透過PNG → ${png.mime} / スクショ → ${shot.width}x${shot.height}`);
});

await step('詳細画面：プロフィール全文のワンタップコピーと通知', async () => {
  await page.goto(`${BASE}#/r/${ocId}`);
  await page.getByRole('heading', { name: 'ミナ' }).waitFor();
  await page.screenshot({ path: resolve(out, '03-detail.png'), fullPage: true });
  const sec = page.locator('.field-view', { hasText: 'キャラクタープロフィール全文' });
  await sec.getByRole('button', { name: 'コピー' }).click();
  await page.getByText('キャラクタープロフィール全文をコピーしました').waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip === '名前：ミナ\n年齢：24\n「本は嘘をつかない」', `クリップボードの内容が違う: ${clip}`);
});

await step('画像の拡大表示（フル画像は開いた1枚だけ読み込む）', async () => {
  await page.locator('.gallery-main').click();
  await page.locator('.viewer img').waitFor();
  const n = await page.locator('.viewer img').count();
  assert(n === 1, 'ビューアの画像が1枚でない');
  await page.screenshot({ path: resolve(out, '04-viewer.png') });
  await page.getByRole('button', { name: '閉じる' }).click();
});

await step('不正なHEICは明確なエラー、入力中の本文は消えない', async () => {
  await page.goto(`${BASE}#/new/nai`);
  await page.getByLabel('プロンプト名・画風名').fill('水彩テスト');
  await page.getByLabel('ポジティブプロンプト').fill('1girl, {{watercolor}}, pastel');
  await page.locator('input[type=file][accept^="image"]').setInputFiles([fx('broken.heic')]);
  await page.getByText(/HEIC形式をこの端末のブラウザで変換できませんでした/).first().waitFor({ timeout: 15000 });
  assert((await page.getByLabel('ポジティブプロンプト').inputValue()) === '1girl, {{watercolor}}, pastel', '入力内容が消えた');
  await page.getByLabel('ネガティブプロンプト').fill('lowres');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL(/#\/r\//);
});

await step('下書き保護：保存せずに再読み込みしても下書きを復元できる', async () => {
  await page.goto(`${BASE}#/new/lora`);
  await page.getByLabel('LoRA名').fill('下書きLoRA');
  await page.getByLabel('トリガーワード').fill('draft trigger');
  await page.waitForTimeout(1200);
  page.once('dialog', (d) => d.accept());
  await page.reload();
  await page.getByText('保存していない下書きがあります').waitFor();
  await page.getByRole('button', { name: '下書きを復元' }).click();
  assert((await page.getByLabel('LoRA名').inputValue()) === '下書きLoRA', '下書きが復元されない');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL(/#\/r\//);
});

await step('JSON一括インポート（貼り付け→検証→重複候補→登録）', async () => {
  await page.goto(`${BASE}#/import/json`);
  await page.getByLabel('JSONテキスト').fill(readFileSync(resolve(root, 'samples/import-sample.json'), 'utf8'));
  await page.getByRole('button', { name: '検証する' }).click();
  await page.getByText('読み込んだ件数').waitFor();
  await page.screenshot({ path: resolve(out, '05-json-import.png'), fullPage: true });
  // 既存のOC「ミナ」と同名のサンプルは重複候補として選択が外れている
  const dupRow = page.locator('.select-list li.is-dup', { hasText: 'ミナ' });
  await dupRow.getByText('既存の「ミナ」と重複').waitFor();
  assert(!(await dupRow.getByRole('checkbox').isChecked()), '重複候補が選択されている');
  await page.getByRole('button', { name: '5件を登録' }).click();
  await page.getByText('5件を登録しました').waitFor();
  const db = await readDb(page);
  assert(db.records.filter((r) => !r.deletedAt).length === 8, `件数 ${db.records.length}`);
});

await step('GitHub一括取得（API応答を模擬）：ページネーション・選択・重複防止', async () => {
  const mk = (i, name, extra = {}) => ({ id: 1000 + i, name, full_name: `nyuriwossan/${name}`, description: `${name}の説明`, html_url: `https://github.com/nyuriwossan/${name}`, homepage: '', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-02-01T00:00:00Z', pushed_at: '2026-02-03T00:00:00Z', fork: false, archived: false, has_pages: true, ...extra });
  const pages = [Array.from({ length: 100 }, (_, i) => mk(i, `repo-${i}`)), [mk(100, 'tag-dictionary', { homepage: 'https://nyuriwossan.github.io/tag-dictionary/' }), mk(101, 'forked', { fork: true })]];
  let calls = 0;
  await page.route('https://api.github.com/**', (route) => {
    calls++;
    const u = new URL(route.request().url());
    const p = Number(u.searchParams.get('page') ?? '1');
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Link' };
    if (p === 1) headers.link = '<https://api.github.com/user/1/repos?per_page=100&page=2>; rel="next"';
    route.fulfill({ status: 200, headers, body: JSON.stringify(pages[p - 1]) });
  });
  await page.goto(`${BASE}#/import/github`);
  await page.getByRole('button', { name: '取得' }).click();
  await page.getByText('102件取得').waitFor();
  assert(calls === 2, `APIの呼び出し回数 ${calls}`);
  await page.locator('.select-list li', { hasText: 'tag-dictionary' }).getByRole('checkbox').check();
  await page.locator('.select-list li', { hasText: 'repo-5' }).first().getByRole('checkbox').check();
  await page.getByRole('button', { name: '内容を確認' }).click();
  await page.getByText('登録内容のプレビュー（2件）').waitFor();
  await page.screenshot({ path: resolve(out, '06-github-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '2件を登録' }).click();
  await page.waitForURL(/#\/c\/app/);
  // もう一度取得すると登録済みとして区別され、選べない
  await page.goto(`${BASE}#/import/github`);
  await page.getByRole('button', { name: '取得' }).click();
  await page.getByText('未登録 100件').waitFor();
  const cb = page.locator('.select-list li', { hasText: 'tag-dictionary' }).getByRole('checkbox');
  assert(await cb.isDisabled(), '登録済みが選択できてしまう');
  const db = await readDb(page);
  const rec = db.records.find((r) => r.title === 'tag-dictionary');
  assert(rec.fields.publicUrl === 'https://nyuriwossan.github.io/tag-dictionary/' && rec.madeDate === null && rec.status === '', 'GitHub登録内容が不適切');
  const r5 = db.records.find((r) => r.title === 'repo-5');
  assert(!r5.fields.publicUrl, '公開URLを推測で入れている');
  await page.unroute('https://api.github.com/**');
});

await step('検索・絞り込み・並び替え', async () => {
  await page.goto(`${BASE}#/search`);
  await page.getByLabel('検索語').fill('watercolor');
  await page.getByText(/^3件/).waitFor(); // NAI2件＋LoRAのトリガーワード1件
  await page.getByLabel('検索語').fill('#和風'); // タグ完全一致（「和風ファンタジー」は含まない）
  await page.getByText(/^1件/).waitFor();
  await page.getByLabel('検索語').fill('');
  await page.getByRole('button', { name: /お気に入り/ }).click();
  await page.getByText(/^0件/).waitFor();
  await page.getByRole('button', { name: /お気に入り/ }).click();
  await page.locator('.chips button', { hasText: 'OC' }).click();
  await page.getByText(/^1件/).waitFor();
  await page.getByLabel('ステータス').selectOption('設定中');
  await page.getByText(/^0件/).waitFor();
  await page.getByLabel('ステータス').selectOption('構想中');
  await page.getByText(/^1件/).waitFor();
  await page.locator('.chips button', { hasText: 'すべて' }).click();
  await page.getByLabel('並び順').selectOption('oldest');
  const firstOld = await page.locator('.card .card-title').first().innerText();
  assert(firstOld.includes('ミナ'), `古い順の先頭 ${firstOld}`);
  await page.getByLabel('並び順').selectOption('updated');
  await page.screenshot({ path: resolve(out, '07-search.png'), fullPage: true });
});

await step('変更履歴から以前の版に戻す（画像も戻る）', async () => {
  await page.goto(`${BASE}#/edit/${ocId}`);
  await page.locator('.img-edit').first().getByRole('button', { name: '画像を外す' }).click();
  await page.getByRole('button', { name: '外す', exact: true }).click();
  await page.getByLabel('性格').fill('明るい（変更後）');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForURL(/#\/r\//);
  let db = await readDb(page);
  assert(db.records.find((r) => r.id === ocId).images.length === 2, '画像が外れていない');
  await page.goto(`${BASE}#/history/${ocId}`);
  await page.locator('.history-head').first().click();
  await page.screenshot({ path: resolve(out, '08-history.png'), fullPage: true });
  await page.getByRole('button', { name: 'この版に戻す' }).click();
  await page.getByRole('button', { name: 'この版に戻す' }).last().click();
  await page.getByText('以前の版に戻しました').waitFor();
  db = await readDb(page);
  const r = db.records.find((x) => x.id === ocId);
  assert(r.images.length === 3 && r.fields.personality === '物静か。観察好き。', '以前の版に戻っていない');
  assert(r.images.every((i) => db.fullHashes[i.id]), '画像本体が消えている');
});

await step('ゴミ箱へ移動・復元、再読み込み後も残る', async () => {
  await page.goto(`${BASE}#/r/${ocId}`);
  await page.getByRole('button', { name: 'ゴミ箱へ' }).click();
  await page.getByRole('button', { name: 'ゴミ箱へ移動' }).click();
  await page.getByText('ゴミ箱に移動しました').waitFor();
  await page.goto(`${BASE}#/trash`);
  await page.getByText('ミナ').waitFor();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await page.getByText('元に戻しました').waitFor();
  await page.reload();
  await page.goto(`${BASE}#/c/oc`);
  await page.locator('.card', { hasText: 'ミナ' }).waitFor();
  await page.screenshot({ path: resolve(out, '09-oc-list.png'), fullPage: true });
});

let backupPath = null;
let beforeBackup = null;
await step('ZIPバックアップの作成とダウンロード', async () => {
  await page.goto(`${BASE}#/backup`);
  await page.getByRole('button', { name: 'バックアップZIPを作成' }).click();
  await page.getByText('ZIPファイルを作成しました').waitFor({ timeout: 30000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '保存・共有' }).click()]);
  backupPath = resolve(out, dl.suggestedFilename());
  await dl.saveAs(backupPath);
  await page.getByText('「ファイル」アプリで確認した').waitFor();
  await page.screenshot({ path: resolve(out, '10-backup.png'), fullPage: true });
  beforeBackup = await readDb(page);
  assert(beforeBackup.images.length === 3, '画像数');
});

await step('オフライン：アプリ起動・閲覧・編集・保存ができる', async () => {
  await page.goto(BASE);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await ctx.setOffline(true);
  await page.reload();
  await page.getByText('クイックメモ').waitFor();
  await page.goto(`${BASE}#/r/${ocId}`);
  await page.getByRole('heading', { name: 'ミナ' }).waitFor();
  await page.locator('#quick').count();
  await page.goto(BASE);
  await page.locator('#quick').fill('オフラインで書いたメモ');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByText('メモを保存しました').waitFor();
  await ctx.setOffline(false);
});

await step('アプリ更新：新しい版を配信しても登録データが残る', async () => {
  const before = await readDb(page);
  rootRef.dir = v2;
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));
  await page.getByText('新しいバージョンがあります').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '更新する' }).click();
  await page.waitForFunction(() => document.querySelector('meta[name=build]')?.getAttribute('content') === 'v2-e2e', null, { timeout: 20000 });
  const after = await readDb(page);
  assert(after.records.length === before.records.length, `記録数が変わった ${before.records.length}→${after.records.length}`);
  assert(JSON.stringify(after.fullHashes) === JSON.stringify(before.fullHashes), '画像が変わった');
});

await step('別の端末を想定：空のブラウザにZIPから復元し、画像のバイト列が一致', async () => {
  const ctx2 = await browser.newContext(device);
  const p2 = await newPage(ctx2);
  await p2.goto(BASE);
  await dismissOnboarding(p2);
  await p2.goto(`${BASE}#/backup`);
  await p2.locator('input[type=file][accept^=".zip"]').setInputFiles(backupPath);
  await p2.getByText('チェックサムの検査に合格しました').waitFor({ timeout: 30000 });
  await p2.screenshot({ path: resolve(out, '11-restore-preview.png'), fullPage: true });
  await p2.getByRole('button', { name: '追加復元する（既存データは残す）' }).click();
  await p2.getByRole('button', { name: '復元する', exact: true }).click();
  await p2.getByText(/復元しました：/).waitFor({ timeout: 30000 });
  const after = await readDb(p2);
  assert(after.records.length === beforeBackup.records.length, `記録数 ${after.records.length} != ${beforeBackup.records.length}`);
  assert(after.history.length === beforeBackup.history.length, '履歴数が違う');
  for (const [id, h] of Object.entries(beforeBackup.fullHashes)) assert(after.fullHashes[id] === h, `画像 ${id} が一致しない`);
  for (const r of beforeBackup.records) {
    const x = after.records.find((y) => y.id === r.id);
    assert(x && JSON.stringify(x) === JSON.stringify(r), `記録 ${r.title} が一致しない`);
  }
  await p2.goto(`${BASE}#/r/${ocId}`);
  await p2.locator('.gallery-main img').waitFor();
  await ctx2.close();
});

await step('壊れたZIPは検査で止まり、既存データは変わらない', async () => {
  const buf = readFileSync(backupPath);
  const bad = Buffer.from(buf);
  // 画像データ部分の途中を1バイト壊す
  bad[Math.floor(bad.length * 0.5)] ^= 0xff;
  const badPath = resolve(out, 'broken-backup.zip');
  writeFileSync(badPath, bad);
  const before = await readDb(page);
  await page.goto(`${BASE}#/backup`);
  await page.locator('input[type=file][accept^=".zip"]').setInputFiles(badPath);
  await page.locator('.msg-error').waitFor({ timeout: 15000 });
  const msg = await page.locator('.msg-error').innerText();
  assert(/整合性|ZIP|壊れて/.test(msg), `エラーメッセージ: ${msg}`);
  const after = await readDb(page);
  assert(after.records.length === before.records.length, '既存データが変わった');
});

await step('iPhoneサイズのレイアウト：横スクロールなし・タブとボタンが44px以上', async () => {
  for (const path of ['', '#/c/oc', '#/search', '#/settings', `#/edit/${ocId}`]) {
    await page.goto(BASE + path);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `${path || 'ホーム'} で横にはみ出し ${overflow}px`);
  }
  const tabH = await page.locator('.tab').first().evaluate((e) => e.getBoundingClientRect().height);
  assert(tabH >= 44, `タブの高さ ${tabH}`);
  await page.goto(`${BASE}#/settings`);
  await page.screenshot({ path: resolve(out, '12-settings.png'), fullPage: true });
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.startsWith('✓')).length} passed, ${failed} failed`);
writeFileSync(resolve(root, 'e2e/last-result.txt'), results.join('\n') + `\n\n${results.filter((r) => r.startsWith('✓')).length} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
void execSync;
