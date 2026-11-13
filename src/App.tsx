import { useEffect } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './components/layout';
import { useSettings } from './hooks';
import { requestPersistentStorage, runDueRecurrences } from './db';
import { InvoiceList } from './pages/InvoiceList';
import { InvoiceEditor } from './pages/InvoiceEditor';
import { InvoiceView } from './pages/InvoiceView';
import { Clients } from './pages/Clients';
import { Templates } from './pages/Templates';
import { TemplateEditor } from './pages/TemplateEditor';
import { SettingsPage } from './pages/Settings';
import { Products } from './pages/Products';
import { Reports } from './pages/Reports';
import { FollowUp } from './pages/FollowUp';
import { Recurring } from './pages/Recurring';
import { EmptyState, useUI } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  const settings = useSettings();
  const { toast } = useUI();
  const navigate = useNavigate();

  useEffect(() => {
    const pref = settings?.theme;
    if (!pref) return;
    const root = document.documentElement;
    if (pref === 'system') delete root.dataset.theme;
    else root.dataset.theme = pref;
    try {
      localStorage.setItem('theme', pref);
    } catch {
      /* private mode */
    }
  }, [settings?.theme]);

  useEffect(() => {
    requestPersistentStorage().catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      runDueRecurrences()
        .then((count) => {
          if (!cancelled && count > 0) {
            toast(`${count} invoice berulang dibuat sebagai draft`, 'ok', {
              label: 'Lihat',
              onClick: () => navigate('/berulang'),
            });
          }
        })
        .catch(() => undefined);
    };
    run();
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return;
      last = Date.now();
      run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <AppShell>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<InvoiceList />} />
          <Route path="/invoice/:id" element={<InvoiceView />} />
          <Route path="/invoice/:id/edit" element={<InvoiceEditor />} />
          <Route path="/klien" element={<Clients />} />
          <Route path="/template" element={<Templates />} />
          <Route path="/template/:id" element={<TemplateEditor />} />
          <Route path="/pengaturan" element={<SettingsPage />} />
          <Route path="/produk" element={<Products />} />
          <Route path="/laporan" element={<Reports />} />
          <Route path="/tagih" element={<FollowUp />} />
          <Route path="/berulang" element={<Recurring />} />
          <Route
            path="*"
            element={
              <EmptyState
                title="Halaman tidak ditemukan"
                body="Alamat ini tidak ada di aplikasi."
                action={
                  <Link to="/" className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-bg">
                    Ke daftar invoice
                  </Link>
                }
              />
            }
          />
        </Routes>
      </ErrorBoundary>
    </AppShell>
  );
}
