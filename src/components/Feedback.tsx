import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

// ---------- トースト（成功・失敗の通知） ----------

type ToastKind = 'ok' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** この文字列を入力しないとOKを押せない（重大な操作用） */
  typeToConfirm?: string;
}

interface Ctx {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (o: ConfirmOptions) => Promise<boolean>;
}

const FeedbackCtx = createContext<Ctx | null>(null);

export function useFeedback(): Ctx {
  const c = useContext(FeedbackCtx);
  if (!c) throw new Error('FeedbackProvider missing');
  return c;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const idRef = useRef(0);

  const toast = useCallback((text: string, kind: ToastKind = 'ok') => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6500 : 2600);
  }, []);

  const confirm = useCallback((o: ConfirmOptions) => {
    setTyped('');
    return new Promise<boolean>((resolve) => setDialog({ ...o, resolve }));
  }, []);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  const okDisabled = !!dialog?.typeToConfirm && typed.trim() !== dialog.typeToConfirm;

  return (
    <FeedbackCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            {t.kind === 'ok' ? '✓ ' : t.kind === 'error' ? '⚠ ' : ''}
            {t.text}
          </div>
        ))}
      </div>
      {dialog && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="dlg-title">{dialog.title}</h2>
            {dialog.body && <div className="modal-body">{dialog.body}</div>}
            {dialog.typeToConfirm && (
              <label className="field">
                <span className="field-label">確認のため「{dialog.typeToConfirm}」と入力してください</span>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
              </label>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => close(false)}>
                {dialog.cancelLabel ?? 'やめる'}
              </button>
              <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} disabled={okDisabled} onClick={() => close(true)}>
                {dialog.okLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackCtx.Provider>
  );
}

// ---------- コピー ----------

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下の方法を試す */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function useCopy() {
  const { toast } = useFeedback();
  return async (text: string, label = '内容') => {
    if (!text) {
      toast(`${label}が空のため、コピーしませんでした。`, 'info');
      return;
    }
    const ok = await copyText(text);
    if (ok) toast(`${label}をコピーしました`);
    else toast(`${label}をコピーできませんでした。長押しして手動でコピーしてください。`, 'error');
  };
}
