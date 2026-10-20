import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// 公開先に合わせて BASE_PATH を変えられる。既定は相対パス（GitHub Pagesのサブパス・別ホスト名どちらでも動く）。
const base = process.env.BASE_PATH ?? './';
// ビルドの識別子（更新の確認用）。データには影響しない
const buildId = process.env.BUILD_MARK ?? new Date().toISOString();

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    {
      name: 'build-id',
      transformIndexHtml: (html) => html.replace('</head>', `  <meta name="build" content="${buildId}" />\n  </head>`),
    },
    VitePWA({
      registerType: 'prompt', // 編集中に勝手に再読み込みしないよう、更新は利用者が選んで適用する
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'にゅりログ',
        short_name: 'にゅりログ',
        description: '自分専用の創作管理手帳',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fffdf7',
        theme_color: '#fffdf7',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体（HTML/JS/CSS/アイコン）だけをキャッシュ。IndexedDBのデータには触れない。
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // GitHub API などの外部通信はキャッシュしない
        runtimeCaching: [],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
