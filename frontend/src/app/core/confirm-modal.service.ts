import { Injectable, signal } from '@angular/core';

export interface ConfirmModalOptions {
  title: string;
  message: string;
  highlight?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'warning' | 'danger' | 'emerald';
}

interface ActiveConfirmState extends ConfirmModalOptions {
  resolve: (confirmed: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmModalService {
  readonly state = signal<ActiveConfirmState | null>(null);

  confirm(options: ConfirmModalOptions): Promise<boolean> {
    const current = this.state();
    if (current) {
      current.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      this.state.set({
        confirmLabel: 'Confirmar',
        cancelLabel: 'Cancelar',
        tone: 'warning',
        ...options,
        resolve,
      });
    });
  }

  accept(): void {
    const current = this.state();
    if (!current) return;
    this.state.set(null);
    current.resolve(true);
  }

  cancel(): void {
    const current = this.state();
    if (!current) return;
    this.state.set(null);
    current.resolve(false);
  }
}
