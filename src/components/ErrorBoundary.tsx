import { Component, type ErrorInfo, type ReactNode } from 'react';
import { exportBackup } from '../lib/backup';
import { downloadFile } from '../lib/files';
import { Button, Card } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  backingUp: boolean;
  backupDone: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, backingUp: false, backupDone: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  private backup = async () => {
    this.setState({ backingUp: true });
    try {
      downloadFile(await exportBackup());
      this.setState({ backupDone: true });
    } catch {
      this.setState({ backupDone: false });
    } finally {
      this.setState({ backingUp: false });
    }
  };

  render() {
    const { error, backingUp, backupDone } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="py-8">
        <Card className="mx-auto max-w-lg">
          <h1 className="text-lg font-extrabold tracking-tight">Terjadi kesalahan</h1>
          <p className="mt-1 text-sm text-muted">
            Halaman ini berhenti karena error. Data di perangkat tetap tersimpan — unduh backup dulu sebelum memuat ulang.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" onClick={() => location.reload()}>
              Muat ulang
            </Button>
            <Button onClick={this.backup} disabled={backingUp}>
              {backingUp ? 'Menyiapkan backup...' : backupDone ? 'Backup diunduh' : 'Unduh backup darurat'}
            </Button>
          </div>
          {import.meta.env.DEV && (
            <pre className="custom-scrollbar mt-4 max-h-60 overflow-auto rounded-xl bg-sunken p-3 text-xs text-muted">
              {error.stack || error.message}
            </pre>
          )}
        </Card>
      </div>
    );
  }
}
