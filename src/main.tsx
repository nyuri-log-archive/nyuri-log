import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { FeedbackProvider } from './components/Feedback';
import './styles/app.css';

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();
let needRefresh = false;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      listeners.forEach((l) => l());
    },
  });
}

function Root() {
  const [ready, setReady] = useState(needRefresh);
  useEffect(() => {
    const l = () => setReady(true);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <FeedbackProvider>
      <App updateReady={ready} applyUpdate={() => updateSW?.(true)} />
    </FeedbackProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
