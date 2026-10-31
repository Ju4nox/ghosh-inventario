import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ArrowRight,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  LucideAngularModule,
  Search,
  User,
  X,
} from 'lucide-angular';

import { formatChileDate, formatQuantity } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import { InventoryMovement } from '../../core/models';

const MOVEMENT_PAGE_SIZE = 50;

@Component({
  selector: 'app-movements-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <section class="space-y-8 animate-fade-up">
      <!-- Encabezado de página -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-semibold tracking-tight text-[#fafafa]">
            Movimientos
          </h1>
          <p class="mt-1 text-[13px] text-[#a1a1aa]">
            Historial auditable de recepciones, reservas, despachos y ajustes.
          </p>
        </div>
        <div
          class="w-9 h-9 rounded-[8px] grid place-items-center bg-[#111111] border border-[#262626] text-[#a1a1aa] shrink-0"
          aria-hidden="true"
        >
          <lucide-icon [img]="icons.ArrowUpDown" [size]="18" [strokeWidth]="1.5"></lucide-icon>
        </div>
      </div>

      <!-- Panel de filtros -->
      <form
        id="movement-filter"
        class="glass-panel p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-3 items-end"
        (ngSubmit)="onFilter()"
      >
        <label class="block">
          <span class="field-label">Código I</span>
          <div class="input-icon-wrap">
            <span class="input-icon" aria-hidden="true">
              <lucide-icon [img]="icons.Search" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </span>
            <input
              id="movement-sku"
              name="sku"
              type="search"
              [(ngModel)]="skuInput"
              placeholder="Ej. TKA311001901"
              class="glass-input has-icon pl-10"
            />
          </div>
        </label>

        <label class="block">
          <span class="field-label">Código de lote</span>
          <div class="input-icon-wrap">
            <span class="input-icon" aria-hidden="true">
              <lucide-icon [img]="icons.Layers" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </span>
            <input
              id="movement-lot"
              name="codigo_lote"
              type="search"
              [(ngModel)]="lotInput"
              placeholder="Ej. L-LEC-A"
              class="glass-input has-icon pl-10"
            />
          </div>
        </label>

        <button type="submit" class="btn btn-primary w-full lg:w-auto">
          <span>Filtrar</span>
          <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
        </button>

        <button
          id="movement-clear"
          type="button"
          class="btn btn-ghost w-full lg:w-auto"
          (click)="onClear()"
        >
          <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
          <span>Limpiar</span>
        </button>
      </form>

      <!-- Tabla / Tarjetas de Auditoría -->
      <section class="glass-panel overflow-hidden" aria-labelledby="movement-table-heading">
        <div
          class="p-5 flex items-center justify-between gap-4 border-b border-[#262626]"
        >
          <div>
            <h2 id="movement-table-heading" class="text-[15px] font-semibold text-[#fafafa]">
              Historial de movimientos
            </h2>
            <p id="movement-result-caption" class="text-[12px] text-[#a1a1aa] mt-0.5">
              {{ resultCaption() }}
            </p>
          </div>
          <span class="badge">AUDITORÍA</span>
        </div>

        @if (loading()) {
          <div class="py-16 px-4 text-center text-[13px] text-[#a1a1aa]">
            Cargando movimientos…
          </div>
        } @else if (errorMessage()) {
          <div class="py-16 px-4 text-center text-[13px] text-[#fafafa] font-medium">
            {{ errorMessage() }}
          </div>
        } @else if (items().length === 0) {
          <div class="py-16 px-4 text-center text-[13px] text-[#a1a1aa]">
            Todavía no hay movimientos para estos filtros.
          </div>
        } @else {
          <!-- Vista de Tabla para Escritorio (md+) -->
          <div class="hidden md:block overflow-x-auto scroll-area">
            <table class="data-table min-w-[960px]">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th>Producto / lote</th>
                  <th class="num">Cantidad</th>
                  <th>Usuario</th>
                  <th>Motivo</th>
                  <th>Pedido / nota de venta</th>
                </tr>
              </thead>
              <tbody id="movement-rows">
                @for (m of items(); track m.id_movimiento) {
                  <tr>
                    <td class="text-[12px] text-[#a1a1aa] whitespace-nowrap">
                      {{ formatChileDate(m.fecha) }}
                    </td>
                    <td>
                      <span class="badge capitalize" [ngClass]="badgeClass(m.tipo)">
                        {{ m.tipo }}
                      </span>
                    </td>
                    <td>
                      <span class="block font-medium text-[#fafafa]">{{ m.producto }}</span>
                      <small class="block text-[11px] font-mono text-[#a1a1aa] mt-0.5">
                        {{ m.sku }} · Lote {{ m.codigo_lote }}
                      </small>
                    </td>
                    <td
                      class="num font-semibold"
                      [ngClass]="Number(m.cantidad) < 0 ? 'text-[#a1a1aa]' : 'text-[#fafafa]'"
                    >
                      {{ Number(m.cantidad) > 0 ? '+' : '' }}{{ formatQuantity(m.cantidad) }}
                    </td>
                    <td class="text-[#fafafa]">{{ m.usuario }}</td>
                    <td class="text-[#a1a1aa] text-[12px]">{{ m.motivo }}</td>
                    <td class="text-[12px] font-mono text-[#a1a1aa]">
                      {{ formatReference(m) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Vista de Tarjetas Apiladas para Móvil (< md) -->
          <div class="grid md:hidden gap-3 p-4">
            @for (m of items(); track m.id_movimiento) {
              <article class="glass-subtle p-4 space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="badge capitalize" [ngClass]="badgeClass(m.tipo)">
                    {{ m.tipo }}
                  </span>
                  <span class="text-[11px] text-[#a1a1aa] flex items-center gap-1">
                    <lucide-icon [img]="icons.Clock" [size]="12" [strokeWidth]="1.5"></lucide-icon>
                    {{ formatChileDate(m.fecha) }}
                  </span>
                </div>

                <div class="flex items-start justify-between gap-3 pt-1">
                  <div>
                    <h3 class="text-[14px] font-semibold text-[#fafafa]">{{ m.producto }}</h3>
                    <p class="text-[12px] font-mono text-[#a1a1aa] mt-0.5">
                      {{ m.sku }} · Lote {{ m.codigo_lote }}
                    </p>
                  </div>
                  <div
                    class="text-[15px] font-semibold tabular-nums shrink-0"
                    [ngClass]="Number(m.cantidad) < 0 ? 'text-[#a1a1aa]' : 'text-[#fafafa]'"
                  >
                    {{ Number(m.cantidad) > 0 ? '+' : '' }}{{ formatQuantity(m.cantidad) }}
                  </div>
                </div>

                <div
                  class="pt-2 border-t border-[#1f1f1f] flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#a1a1aa]"
                >
                  <span class="inline-flex items-center gap-1.5 text-[#fafafa]">
                    <lucide-icon [img]="icons.User" [size]="13" [strokeWidth]="1.5"></lucide-icon>
                    {{ m.usuario }}
                  </span>
                  @if (formatReference(m) !== '—') {
                    <span class="badge badge-slate font-mono">{{ formatReference(m) }}</span>
                  }
                </div>

                <p class="text-[12px] text-[#a1a1aa]">{{ m.motivo }}</p>
              </article>
            }
          </div>
        }

        <!-- Pie de tabla y paginación -->
        <div
          class="px-5 py-3.5 border-t border-[#262626] flex items-center justify-between gap-4 text-[12px] text-[#a1a1aa]"
        >
          <span id="movement-page-label">{{ pageLabel() }}</span>
          <div class="flex items-center gap-2">
            <button
              id="movement-prev"
              type="button"
              class="btn btn-ghost btn-sm btn-icon"
              aria-label="Página anterior"
              [disabled]="offset() <= 0 || loading()"
              (click)="prevPage()"
            >
              <lucide-icon [img]="icons.ChevronLeft" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </button>
            <button
              id="movement-next"
              type="button"
              class="btn btn-ghost btn-sm btn-icon"
              aria-label="Página siguiente"
              [disabled]="offset() + pageSize >= total() || loading()"
              (click)="nextPage()"
            >
              <lucide-icon [img]="icons.ChevronRight" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </button>
          </div>
        </div>
      </section>
    </section>
  `,
})
export class MovementsPageComponent implements OnInit {
  private readonly api = inject(GhoshApiService);

  readonly pageSize = MOVEMENT_PAGE_SIZE;
  readonly Number = Number;
  readonly formatChileDate = formatChileDate;
  readonly formatQuantity = formatQuantity;

  readonly icons = {
    ArrowUpDown,
    Search,
    Layers,
    ArrowRight,
    X,
    ChevronLeft,
    ChevronRight,
    Clock,
    User,
  };

  skuInput = '';
  lotInput = '';

  readonly items = signal<InventoryMovement[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly resultCaption = computed(() => {
    if (this.loading() && !this.loaded()) return 'Cargando movimientos…';
    if (this.errorMessage()) return 'No fue posible cargar el historial';
    const total = this.total();
    return total === 1
      ? '1 movimiento encontrado'
      : `${formatQuantity(total)} movimientos encontrados`;
  });

  readonly pageLabel = computed(() => {
    const total = this.total();
    if (total === 0) return 'Sin resultados';
    const start = this.offset() + 1;
    const end = Math.min(this.offset() + MOVEMENT_PAGE_SIZE, total);
    return `Mostrando ${start}–${end} de ${total}`;
  });

  ngOnInit(): void {
    this.loadMovements();
  }

  badgeClass(tipo: string): string {
    const normalized = String(tipo || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    switch (normalized) {
      case 'recepcion':
        return 'badge-emerald';
      case 'despacho':
        return 'badge-sky';
      case 'reserva':
        return 'badge-violet';
      case 'ajuste':
      case 'cancelacion':
        return 'badge-amber';
      default:
        return 'badge-slate';
    }
  }

  formatReference(movement: InventoryMovement): string {
    if (movement.id_pedido) return `Pedido #${movement.id_pedido}`;
    if (movement.id_nota_venta) return `NV #${movement.id_nota_venta}`;
    return '—';
  }

  loadMovements(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api
      .getMovements({
        sku: this.skuInput,
        codigo_lote: this.lotInput,
        limit: MOVEMENT_PAGE_SIZE,
        offset: this.offset(),
      })
      .subscribe({
        next: (res) => {
          this.items.set(res.items ?? []);
          this.total.set(res.total ?? 0);
          this.loaded.set(true);
          this.loading.set(false);
        },
        error: (err) => {
          this.items.set([]);
          this.total.set(0);
          this.loaded.set(false);
          this.loading.set(false);
          this.errorMessage.set(
            this.api.extractErrorMessage(err, 'No se pudo conectar con la API.'),
          );
        },
      });
  }

  onFilter(): void {
    this.offset.set(0);
    this.loadMovements();
  }

  onClear(): void {
    this.skuInput = '';
    this.lotInput = '';
    this.offset.set(0);
    this.loadMovements();
  }

  prevPage(): void {
    this.offset.update((current) => Math.max(0, current - MOVEMENT_PAGE_SIZE));
    this.loadMovements();
  }

  nextPage(): void {
    if (this.offset() + MOVEMENT_PAGE_SIZE < this.total()) {
      this.offset.update((current) => current + MOVEMENT_PAGE_SIZE);
      this.loadMovements();
    }
  }
}
