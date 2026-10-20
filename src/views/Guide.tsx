import { updateState } from '../db/repo';
import { isIOS, isStandalone, requestPersist } from '../lib/storage';
import { Icon } from '../components/Icon';
import { goBack, href } from '../ui/router';

function GuideContent() {
  const standalone = isStandalone();
  return (
    <>
      <section className="guide-step">
        <h3>1. ホーム画面に追加する</h3>
        {standalone ? (
          <p>今はホーム画面アプリとして開いています。これからも、ホーム画面のアイコンから開いてください。</p>
        ) : (
          <ol>
            <li>iPhoneの <strong>Safari</strong> でこのページを開く</li>
            <li>
              画面下の <strong>共有ボタン</strong>（四角から矢印が出たアイコン）を押す
            </li>
            <li>
              <strong>「ホーム画面に追加」</strong>を選び、「追加」を押す
            </li>
            <li>以後はホーム画面の「にゅりログ」から開く</li>
          </ol>
        )}
      </section>
      <section className="guide-step">
        <h3>2. Safariとホーム画面アプリは「別の引き出し」</h3>
        <p>
          iPhoneでは、Safariで開いたにゅりログと、ホーム画面から開いたにゅりログで、保存場所が分かれることがあります。片方で記録したものが、もう片方には見えない場合があります。
        </p>
        <p>
          <strong>ふだんはホーム画面のアイコンからだけ開く</strong>ようにしてください。Safariで記録したものを移したいときは、Safari側でバックアップを作り、ホーム画面アプリ側で復元します。
        </p>
      </section>
      <section className="guide-step">
        <h3>3. バックアップがいちばんの保険</h3>
        <p>
          データはiPhoneの中にだけ保存されます。容量不足やブラウザのデータ削除、アプリの削除で消える可能性があります。定期的に「設定 → バックアップと復元」からZIPを作り、「ファイル」アプリ（iCloud Driveなど）に保存してください。
        </p>
        <p>前回のバックアップから日数や変更件数がたまると、ホームに控えめな案内が出ます。</p>
      </section>
      {isIOS() && !standalone && <p className="hint">※ iPhoneのSafari以外のブラウザでは「ホーム画面に追加」が使えない場合があります。</p>}
    </>
  );
}

export function Onboarding() {
  const finish = async () => {
    await requestPersist().then((r) => updateState({ onboardingDone: true, persistRequested: r }));
  };
  return (
    <div className="modal-backdrop">
      <div className="modal onboarding" role="dialog" aria-modal="true" aria-labelledby="ob-title">
        <h2 id="ob-title">
          <span className="brand-mark" aria-hidden="true" /> にゅりログへようこそ
        </h2>
        <p className="hint">自分専用の創作管理手帳です。はじめに3つだけ確認してください。</p>
        <GuideContent />
        <button className="btn btn-primary wide" onClick={finish}>
          わかった、はじめる
        </button>
      </div>
    </div>
  );
}

export function GuideView() {
  return (
    <div className="page">
      <div className="detail-top">
        <button className="icon-btn" onClick={() => goBack('/settings')} aria-label="戻る">
          <Icon name="back" />
        </button>
        <h1 className="page-title small">使い方</h1>
        <span />
      </div>
      <GuideContent />
      <section className="guide-step">
        <h3>4. 基本の使い方</h3>
        <ul>
          <li>ホームのクイックメモに書いて「保存」。あとで編集画面からカテゴリーを変えられます（内容は消えません）。</li>
          <li>下のタブでカテゴリーごとの一覧、右上の虫めがねで全体検索。「#タグ名」でタグ検索もできます。</li>
          <li>削除はまずゴミ箱へ。編集のたびに前の版が「変更履歴」に残ります。</li>
          <li>プロンプトやトリガーワードは、詳細画面の「コピー」ボタンでワンタップコピー。</li>
          <li>一覧のサムネイルは、編集画面の画像ごとの「✂ サムネイル調整」で切り抜き位置を変えられます（元の画像はそのまま。正方形と縦長3:4）。</li>
        </ul>
        <a className="btn" href={href('/backup')}>
          バックアップ画面へ
        </a>
      </section>
    </div>
  );
}
