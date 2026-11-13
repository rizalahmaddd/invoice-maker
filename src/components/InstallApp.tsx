import { useInstallPrompt } from '../hooks';
import { IconClose, IconDownload } from './icons';
import { Button, Card, IconButton } from './ui';

export function InstallApp({ dismissible = false }: { dismissible?: boolean }) {
  const { canInstall, installed, ios, dismissed, promptInstall, dismiss } = useInstallPrompt();

  if (installed) return null;
  if (!canInstall && !ios) return null;
  if (dismissible && dismissed) return null;

  return (
    <Card className="relative flex items-start gap-3 border-clay/30 bg-clay-soft/40">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink text-bg">
        <IconDownload size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Pasang ke layar utama</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {ios
            ? 'Di Safari, ketuk tombol Bagikan lalu pilih “Tambah ke Layar Utama”.'
            : 'Buka lebih cepat seperti aplikasi biasa dan tetap bisa dipakai tanpa internet.'}
        </p>
        {canInstall && (
          <Button size="sm" variant="primary" className="mt-2" onClick={() => promptInstall()}>
            Pasang aplikasi
          </Button>
        )}
      </div>
      {dismissible && (
        <IconButton label="Tutup" onClick={dismiss} className="-mt-2 -mr-2 size-9">
          <IconClose size={16} />
        </IconButton>
      )}
    </Card>
  );
}
