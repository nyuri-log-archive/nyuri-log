import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from 'react';
import type { LinkItem } from '../db/types';
import { parseTags, safeUrl } from '../lib/util';
import { Icon } from './Icon';

/** 内容に合わせて高さが伸びるテキストエリア（長文プロンプト向け） */
export function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const { minRows = 3, ...rest } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 640)}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={minRows} {...rest} />;
}

/**
 * 入力欄と見出し。単一の入力要素なら id で関連付け、読み上げ名が見出しだけになるようにする。
 * 複合部品（タグ入力など）は部品側の aria-label を使う。
 */
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const id = useId();
  const single = isValidElement(children) && (typeof children.type !== 'string' ? children.type === AutoTextarea : ['input', 'select', 'textarea'].includes(children.type));
  return (
    <div className="field">
      {single ? (
        <label className="field-label" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      {single ? cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState('');
  const commit = (s = text) => {
    const add = parseTags(s);
    if (add.length) onChange(parseTags([...tags, ...add].join(',')));
    setText('');
  };
  return (
    <div className="tag-input">
      {tags.map((t) => (
        <span key={t} className="tag removable">
          #{t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`タグ「${t}」を外す`}>
            ×
          </button>
        </span>
      ))}
      <input
        value={text}
        placeholder={tags.length ? '' : 'タグを入力して改行'}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,、\n]$/.test(v)) commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => commit()}
        enterKeyHint="done"
        aria-label="タグを追加"
      />
    </div>
  );
}

export function UrlListInput({ urls, onChange }: { urls: LinkItem[]; onChange: (u: LinkItem[]) => void }) {
  const set = (i: number, patch: Partial<LinkItem>) => onChange(urls.map((u, j) => (j === i ? { ...u, ...patch } : u)));
  return (
    <div className="url-input">
      {urls.map((u, i) => {
        const bad = u.url.trim() !== '' && !safeUrl(u.url);
        return (
          <div key={i} className="url-row">
            <input value={u.label} placeholder="説明（任意）" onChange={(e) => set(i, { label: e.target.value })} aria-label={`URL${i + 1}の説明`} />
            <input value={u.url} placeholder="https://" inputMode="url" autoCapitalize="off" autoCorrect="off" onChange={(e) => set(i, { url: e.target.value })} className={bad ? 'invalid' : ''} aria-label={`URL${i + 1}`} />
            <button type="button" className="icon-btn small" onClick={() => onChange(urls.filter((_, j) => j !== i))} aria-label={`URL${i + 1}を削除`}>
              <Icon name="close" size={16} />
            </button>
            {bad && <span className="msg-error small">http:// か https:// で始まるURLにしてください（このままでも保存はできますが、リンクにはなりません）</span>}
          </div>
        );
      })}
      <button type="button" className="btn btn-small" onClick={() => onChange([...urls, { label: '', url: '' }])}>
        ＋ URLを追加
      </button>
    </div>
  );
}
