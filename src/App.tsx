import { useEffect, useState, type ReactNode } from 'react';
import { CATEGORY_DEFS, TAB_CATEGORIES, isCategory, type Category } from './lib/categories';
import { Icon } from './components/Icon';
import { href, navigate, useRoute } from './ui/router';
import { Home } from './views/Home';
import { CategoryList } from './views/CategoryList';
import { RecordDetail } from './views/RecordDetail';
import { RecordEditor } from './views/RecordEditor';
import { SearchView } from './views/Search';
import { SettingsView } from './views/Settings';
import { TrashView } from './views/Trash';
import { HistoryView } from './views/History';
import { BackupView } from './views/Backup';
import { GithubImportView } from './views/GithubImport';
import { JsonImportView } from './views/JsonImport';
import { GuideView, Onboarding } from './views/Guide';
import { useAppState } from './ui/hooks';
import { gcImages } from './db/repo';

export function App({ updateReady, applyUpdate }: { updateReady: boolean; applyUpdate: () => void }) {
  const route = useRoute();
  const state = useAppState();
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    // 24時間以上どこからも参照されていない画像（編集を中断した時の残りなど）を整理
    gcImages().catch((e) => setDbError(e?.message ?? 'データベースを開けませんでした。'));
  }, []);

  const [head, a, b] = route;
  let view: ReactNode;
  let activeTab: Category | null = null;
  let showFab = true;

  if (!head) {
    view = <Home />;
    activeTab = 'memo';
  } else if (head === 'c' && isCategory(a)) {
    view = <CategoryList category={a} />;
    activeTab = a === 'other' ? 'memo' : a;
  } else if (head === 'r' && a) {
    view = <RecordDetail id={a} />;
  } else if (head === 'edit' && a) {
    view = <RecordEditor key={`edit-${a}`} id={a} />;
    showFab = false;
  } else if (head === 'new') {
    view = <RecordEditor key={`new-${a ?? ''}`} newCategory={isCategory(a) ? a : 'memo'} />;
    showFab = false;
  } else if (head === 'search') {
    view = <SearchView initialTag={a} />;
  } else if (head === 'settings') {
    view = <SettingsView />;
  } else if (head === 'trash') {
    view = <TrashView />;
  } else if (head === 'history' && a) {
    view = <HistoryView id={a} />;
  } else if (head === 'backup') {
    view = <BackupView />;
    showFab = false;
  } else if (head === 'import' && a === 'github') {
    view = <GithubImportView />;
    showFab = false;
  } else if (head === 'import' && a === 'json') {
    view = <JsonImportView />;
    showFab = false;
  } else if (head === 'guide') {
    view = <GuideView />;
  } else {
    view = (
      <div className="page">
        <p className="empty">ページが見つかりません。</p>
        <a className="btn" href={href('/')}>
          ホームへ
        </a>
      </div>
    );
  }
  void b;

  const fabCategory: Category = activeTab && activeTab !== 'memo' ? activeTab : head === 'c' && a === 'other' ? 'other' : 'memo';

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={href('/')} aria-label="にゅりログ ホーム">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">にゅりログ</span>
        </a>
        <div className="topbar-actions">
          <a className="icon-btn" href={href('/search')} aria-label="検索">
            <Icon name="search" />
          </a>
          <a className="icon-btn" href={href('/settings')} aria-label="設定">
            <Icon name="settings" />
          </a>
        </div>
      </header>

      {dbError && <div className="banner banner-error">{dbError}</div>}
      {updateReady && (
        <div className="banner banner-info">
          新しいバージョンがあります。保存したデータはそのまま残ります。
          <button className="btn btn-small btn-primary" onClick={applyUpdate}>
            更新する
          </button>
        </div>
      )}

      <main className="main">{view}</main>

      {showFab && (
        <button className="fab" onClick={() => navigate(`/new/${fabCategory}`)} aria-label="記録する">
          <Icon name="plus" size={20} />
          <span>記録する</span>
        </button>
      )}

      <nav className="tabbar" aria-label="カテゴリーのタブ">
        {TAB_CATEGORIES.map((c) => {
          const d = CATEGORY_DEFS[c];
          const active = activeTab === c;
          return (
            <a key={c} className={`tab ${active ? 'active' : ''}`} href={href(c === 'memo' ? '/' : `/c/${c}`)} style={{ ['--cat' as string]: d.color, ['--cat-strong' as string]: d.colorStrong }} aria-current={active ? 'page' : undefined}>
              <Icon name={d.icon} size={21} />
              <span>{d.shortLabel}</span>
            </a>
          );
        })}
      </nav>

      {state && !state.onboardingDone && <Onboarding />}
    </div>
  );
}
