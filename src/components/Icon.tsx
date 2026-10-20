// 外部依存なしの線画アイコン
const P: Record<string, string> = {
  memo: 'M6 3h9l4 4v14H6z M15 3v4h4 M9 11h7 M9 15h7',
  app: 'M4 5h16v14H4z M4 9h16 M7 7h.01 M10 7h.01',
  lora: 'M12 3l2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L12 15.4 7 18.2l1.2-5.6L4 8.8l5.6-.6z',
  nai: 'M4 20l5-5 M14 4l6 6-9 9-6-6z M12 6l6 6',
  oc: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  other: 'M5 12h.01 M12 12h.01 M19 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14 M5 12h14',
  back: 'M15 5l-7 7 7 7',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  edit: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 2-2 5 5 M15 9h.01',
  close: 'M6 6l12 12 M18 6L6 18',
  up: 'M12 19V5 M6 11l6-6 6 6',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  check: 'M5 12l5 5 9-10',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  upload: 'M12 20V9 M7 14l5-5 5 5 M5 4h14',
  github: 'M9 19c-4 1.5-4-2-6-2.5 M15 21v-3.5a3 3 0 0 0-.9-2.4c2.9-.3 5.9-1.4 5.9-6.4a5 5 0 0 0-1.4-3.5 4.6 4.6 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.5 0C5.9 1.4 4.8 1.7 4.8 1.7a4.6 4.6 0 0 0-.1 3.5A5 5 0 0 0 3.3 8.7c0 5 3 6.1 5.9 6.4a3 3 0 0 0-.9 2.4V21',
  json: 'M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1 M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01',
  tag: 'M3 12V4h8l10 10-8 8z M7.5 7.5h.01',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
};

export function Icon({ name, size = 22, filled = false, className }: { name: string; size?: number; filled?: boolean; className?: string }) {
  const d = P[name] ?? P.other;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => (
        <path key={i} d={(i ? 'M' : '') + seg} />
      ))}
    </svg>
  );
}
