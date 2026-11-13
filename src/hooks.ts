import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from './db';
import { BUILTIN_TEMPLATES, normalizeTemplate } from './templates';
import type { Invoice, Settings, Status, TemplateConfig } from './types';

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), []);
}

export function useRecurrences() {
  return useLiveQuery(() => db.recurrences.orderBy('nextRun').toArray(), []);
}

export function useAllTemplates(): TemplateConfig[] | undefined {
  return useLiveQuery(async () => {
    const custom = await db.templates.orderBy('updatedAt').reverse().toArray();
    return [...custom.map(normalizeTemplate), ...BUILTIN_TEMPLATES];
  }, []);
}

interface PdfState {
  blob: Blob | null;
  busy: boolean;
  error: string | null;
}

export function useInvoicePdf(
  inv: Invoice | undefined,
  tpl: TemplateConfig | undefined,
  settings: Settings | undefined,
  status: Status,
  delay = 350,
): PdfState {
  const [state, setState] = useState<PdfState>({ blob: null, busy: false, error: null });
  const run = useRef(0);
  // Live queries return a new object only when the record changes, so identity is enough; stringifying would
  // serialise the base64 logo, signature and QRIS on every keystroke.
  useEffect(() => {
    if (!inv || !tpl || !settings) return;
    const id = ++run.current;
    setState((s) => ({ ...s, busy: true }));
    const timer = setTimeout(async () => {
      try {
        const { renderInvoicePdf } = await import('./pdf/document');
        const blob = await renderInvoicePdf(inv, tpl, settings, status);
        if (id === run.current) setState({ blob, busy: false, error: null });
      } catch (e) {
        if (id === run.current) setState((s) => ({ ...s, busy: false, error: (e as Error).message || 'PDF gagal dibuat.' }));
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [inv, tpl, settings, status]);

  return state;
}

export function useWide(query = '(min-width: 1024px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setWide(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return wide;
}

export function useDebouncedEffect(fn: () => void, deps: unknown[], delay: number) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    const t = setTimeout(() => saved.current(), delay);
    return () => clearTimeout(t);
  }, deps);
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// The event fires once, often before the install card mounts, so it is captured at module level.
let installEvent: BeforeInstallPromptEvent | null = null;
const installSubscribers = new Set<() => void>();
const notifyInstall = () => installSubscribers.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    notifyInstall();
  });
}

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

const INSTALL_DISMISSED_KEY = 'install_dismissed';

export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(installEvent);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const fn = () => {
      setEvent(installEvent);
      setInstalled(isStandalone());
    };
    installSubscribers.add(fn);
    return () => {
      installSubscribers.delete(fn);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return 'unavailable' as const;
    try {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      installEvent = null;
      if (outcome === 'accepted') setInstalled(true);
      return outcome;
    } catch {
      return 'unavailable' as const;
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
    } catch {
      /* private mode */
    }
    setDismissed(true);
  }, []);

  return { canInstall: !!event, installed, ios: isIOSDevice(), dismissed, promptInstall, dismiss };
}

export function useStorageHealth() {
  const [state, setState] = useState({ usage: 0, quota: 0, persisted: null as boolean | null, loading: true });

  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    Promise.all([
      navigator.storage?.estimate?.() ?? Promise.resolve({ usage: 0, quota: 0 }),
      navigator.storage?.persisted?.() ?? Promise.resolve(null),
    ])
      .then(([estimate, persisted]) => {
        setState({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted, loading: false });
      })
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const percent = state.quota > 0 ? (state.usage / state.quota) * 100 : 0;
  return { ...state, percent, refresh };
}

export function useStoredState<T>(key: string, initial: T, storage: 'local' | 'session' = 'local') {
  const store = () => (storage === 'local' ? localStorage : sessionStorage);
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = store().getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      store().setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
