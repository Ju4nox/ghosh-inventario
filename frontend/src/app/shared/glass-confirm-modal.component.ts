import { CommonModule } from '@angular/common';
import { Component, HostListener, inject } from '@angular/core';
import {
  AlertTriangle,
  CheckCircle2,
  LucideAngularModule,
  Trash2,
  X,
} from 'lucide-angular';

import { ConfirmModalService } from '../core/confirm-modal.service';

@Component({
  selector: 'app-glass-confirm-modal',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `
    @if (modal.state(); as state) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 animate-fade-in"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="'confirm-modal-title'"
        (click)="onBackdropClick($event)"
      >
        <div
          class="w-full max-w-md p-6 bg-[#111111] border border-[#262626] rounded-[10px] animate-modal-in relative"
          (click)="$event.stopPropagation()"
        >
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon absolute top-4 right-4 text-[#a1a1aa] hover:text-[#fafafa]"
            aria-label="Cerrar diálogo"
            (click)="modal.cancel()"
          >
            <lucide-icon [img]="icons.X" [size]="16" [strokeWidth]="1.5"></lucide-icon>
          </button>

          <div class="flex items-start gap-3.5">
            <div
              class="w-9 h-9 rounded-[8px] flex items-center justify-center shrink-0 bg-[#171717] border border-[#262626] text-[#fafafa]"
            >
              @if (state.tone === 'danger') {
                <lucide-icon [img]="icons.Trash2" [size]="18" [strokeWidth]="1.5"></lucide-icon>
              } @else if (state.tone === 'emerald') {
                <lucide-icon [img]="icons.CheckCircle2" [size]="18" [strokeWidth]="1.5"></lucide-icon>
              } @else {
                <lucide-icon [img]="icons.AlertTriangle" [size]="18" [strokeWidth]="1.5"></lucide-icon>
              }
            </div>

            <div class="pr-6">
              <h3 id="confirm-modal-title" class="text-[15px] font-semibold text-[#fafafa] leading-snug">
                {{ state.title }}
              </h3>
              <p class="mt-2 text-[13px] text-[#a1a1aa] leading-relaxed">
                {{ state.message }}
              </p>

              @if (state.highlight) {
                <div
                  class="mt-3 p-3 rounded-[6px] text-[12px] font-medium bg-[#0a0a0a] border border-[#262626] text-[#fafafa]"
                >
                  {{ state.highlight }}
                </div>
              }
            </div>
          </div>

          <div class="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" class="btn btn-ghost" (click)="modal.cancel()">
              {{ state.cancelLabel }}
            </button>
            <button
              type="button"
              class="btn btn-primary"
              (click)="modal.accept()"
            >
              {{ state.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class GlassConfirmModalComponent {
  readonly modal = inject(ConfirmModalService);
  readonly icons = { AlertTriangle, Trash2, CheckCircle2, X };

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.modal.state()) {
      this.modal.cancel();
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.modal.cancel();
    }
  }
}
