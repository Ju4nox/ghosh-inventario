import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ArrowRight,
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  DollarSign,
  FileDown,
  FileSpreadsheet,
  MapPin,
  Search,
  Truck,
  X,
  LucideAngularModule,
} from 'lucide-angular';

import { formatChileDate, formatMoney, formatQuantity } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import {
  SaleNoteRecord,
  SaleNotesSummary,
  UserOption,
  WarehouseOption,
} from '../../core/models';

const AUDIT_PAGE_SIZE = 30;

@Component({
  selector: 'app-sales-audit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <section class="space-y-8 animate-fade-up">
      <!-- Encabezado -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-semibold tracking-tight text-[#fafafa]">
            Auditoría de ventas
          </h1>
          <p class="mt-1 text-[13px] text-[#a1a1aa]">
            Registro contable auditable de todas las notas de venta emitidas, su desglose de precios confirmados, direcciones de despacho y exportación a PDF.
          </p>
        </div>
        <div
          class="w-9 h-9 rounded-[8px] grid place-items-center bg-[#111111] border border-[#262626] text-[#a1a1aa] shrink-0"
          aria-hidden="true"
        >
          <lucide-icon [img]="icons.FileSpreadsheet" [size]="18" [strokeWidth]="1.5"></lucide-icon>
        </div>
      </div>

      <!-- KPIs Contables -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Venta neta activa</span>
            <lucide-icon [img]="icons.DollarSign" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div id="audit-net-amount" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatMoney(summary().monto_neto_activo) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            {{ formatQuantity(summary().pendientes + summary().despachados) }} notas vigentes/despachadas
          </p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Facturado despachado</span>
            <lucide-icon [img]="icons.Truck" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatMoney(summary().monto_despachado) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            {{ formatQuantity(summary().despachados) }} notas cerradas
          </p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Por despachar (pendiente)</span>
            <lucide-icon [img]="icons.Clock" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatMoney(summary().monto_pendiente) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            {{ formatQuantity(summary().pendientes) }} notas pendientes
          </p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Notas anuladas</span>
            <lucide-icon [img]="icons.Ban" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatMoney(summary().monto_anulado) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            {{ formatQuantity(summary().anulados) }} anuladas (excluidas del neto)
          </p>
        </article>
      </div>

      <!-- Filtros Contables -->
      <div class="glass-panel p-5 space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          @for (tab of statusTabs; track tab.value) {
            <button
              type="button"
              class="btn btn-sm"
              [ngClass]="estadoInput === tab.value ? 'btn-primary' : 'btn-ghost'"
              (click)="onStatusChange(tab.value)"
            >
              <span>{{ tab.label }}</span>
            </button>
          }
        </div>

        <form
          id="audit-filter-form"
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
          (ngSubmit)="onFilterSubmit()"
        >
          <label class="block">
            <span class="field-label">N° Nota</span>
            <input
              id="audit-numero"
              name="numero"
              type="number"
              min="1"
              [(ngModel)]="numeroInput"
              placeholder="Ej. 15"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label">N° Pedido</span>
            <input
              id="audit-pedido"
              name="id_pedido"
              type="number"
              min="1"
              [(ngModel)]="pedidoInput"
              placeholder="Ej. 12"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label">Desde fecha</span>
            <input
              id="audit-desde"
              name="fecha_desde"
              type="date"
              [(ngModel)]="desdeInput"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label">Hasta fecha</span>
            <input
              id="audit-hasta"
              name="fecha_hasta"
              type="date"
              [(ngModel)]="hastaInput"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label">Búsqueda general</span>
            <div class="input-icon-wrap">
              <span class="input-icon" aria-hidden="true">
                <lucide-icon [img]="icons.Search" [size]="16" [strokeWidth]="1.5"></lucide-icon>
              </span>
              <input
                id="audit-query"
                name="query"
                type="search"
                [(ngModel)]="queryInput"
                placeholder="Local, dirección, SKU o producto"
                class="glass-input has-icon pl-10"
              />
            </div>
          </label>

          <label class="block">
            <span class="field-label">Vendedor</span>
            <select
              id="audit-seller"
              name="vendedor"
              class="glass-input"
              [(ngModel)]="vendedorInput"
              (ngModelChange)="onDropdownChange()"
            >
              <option value="">Todos los vendedores</option>
              @for (s of sellers(); track s.id_usuario) {
                <option [value]="String(s.id_usuario)">{{ s.nombre }}</option>
              }
            </select>
          </label>

          <label class="block">
            <span class="field-label">Bodega</span>
            <select
              id="audit-warehouse"
              name="bodega"
              class="glass-input"
              [(ngModel)]="bodegaInput"
              (ngModelChange)="onDropdownChange()"
            >
              <option value="">Todas las bodegas</option>
              @for (w of warehouses(); track w.id_bodega) {
                <option [value]="String(w.id_bodega)">{{ w.nombre }}</option>
              }
            </select>
          </label>

          <div class="flex items-center gap-2">
            <button type="submit" class="btn btn-primary flex-1">
              <span>Consultar</span>
              <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
            </button>
            <button type="button" class="btn btn-ghost" (click)="onClear()">
              <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
              <span>Limpiar</span>
            </button>
          </div>
        </form>
      </div>

      <!-- Tabla Contable de Notas de Venta -->
      <section class="glass-panel overflow-hidden" aria-labelledby="audit-table-heading">
        <div
          class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626]"
        >
          <div>
            <h2 id="audit-table-heading" class="text-[15px] font-semibold text-[#fafafa]">
              Libro auditable de notas de venta
            </h2>
            <p class="text-[12px] text-[#a1a1aa] mt-0.5">
              {{ caption() }} · Haz clic en cualquier fila para ver el desglose completo.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              [disabled]="offset() === 0"
              (click)="prevPage()"
            >
              <lucide-icon [img]="icons.ChevronLeft" [size]="14" [strokeWidth]="1.5"></lucide-icon>
              <span>Anterior</span>
            </button>
            <span class="text-[12px] text-[#a1a1aa] tabular-nums px-2">{{ pageLabel() }}</span>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              [disabled]="offset() + pageSize >= total()"
              (click)="nextPage()"
            >
              <span>Siguiente</span>
              <lucide-icon [img]="icons.ChevronRight" [size]="14" [strokeWidth]="1.5"></lucide-icon>
            </button>
          </div>
        </div>

        @if (loading()) {
          <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
            Consultando libro de ventas…
          </div>
        } @else if (errorMessage()) {
          <div class="py-12 px-4 text-center text-[13px] text-[#fafafa] font-medium">
            {{ errorMessage() }}
          </div>
        } @else if (items().length === 0) {
          <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
            No hay notas de venta que coincidan con los filtros consultados.
          </div>
        } @else {
          <div class="overflow-x-auto scroll-area">
            <table class="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Nota N°</th>
                  <th>Fecha emisión</th>
                  <th>Cliente / Entrega</th>
                  <th>Vendedor / Bodega</th>
                  <th>Pedido / Estado</th>
                  <th class="num">Líneas / Unid.</th>
                  <th class="num">Total</th>
                  <th class="text-right">PDF</th>
                </tr>
              </thead>
              <tbody id="audit-notes-rows">
                @for (note of items(); track note.id_nota_venta) {
                  <tr
                    class="cursor-pointer hover:bg-[#171717]/70 transition-colors"
                    (click)="toggleExpand(note.id_nota_venta)"
                  >
                    <td class="font-mono font-semibold text-[#fafafa] whitespace-nowrap">
                      <div class="inline-flex items-center gap-2">
                        <lucide-icon
                          [img]="isExpanded(note.id_nota_venta) ? icons.ChevronUp : icons.ChevronDown"
                          [size]="14"
                          [strokeWidth]="1.5"
                          class="text-[#a1a1aa]"
                        ></lucide-icon>
                        <span>N° {{ note.numero }}</span>
                      </div>
                    </td>
                    <td class="text-[12px] text-[#a1a1aa] whitespace-nowrap">
                      {{ formatChileDate(note.fecha_creacion) }}
                    </td>
                    <td>
                      <strong class="block font-medium text-[#fafafa]">{{ note.nombre_local }}</strong>
                      <small class="block text-[11px] text-[#a1a1aa] mt-0.5 truncate max-w-[240px]">
                        {{ note.direccion_entrega || 'Sin dirección especificada' }}
                      </small>
                    </td>
                    <td>
                      <span class="block text-[#fafafa]">{{ note.vendedor }}</span>
                      <small class="block text-[11px] text-[#a1a1aa]">{{ note.bodega }}</small>
                    </td>
                    <td>
                      <span class="badge capitalize" [ngClass]="badgeClass(note.estado_pedido)">
                        {{ note.id_pedido ? '#' + note.id_pedido + ' · ' : '' }}{{ note.estado_pedido }}
                      </span>
                    </td>
                    <td class="num text-[12px] text-[#a1a1aa] whitespace-nowrap">
                      {{ note.cantidad_lineas }} lín. · {{ formatQuantity(note.unidades_totales) }} u.
                    </td>
                    <td class="num font-semibold text-[#fafafa] whitespace-nowrap">
                      {{ formatMoney(note.total) }}
                    </td>
                    <td class="text-right whitespace-nowrap" (click)="$event.stopPropagation()">
                      <a
                        [href]="api.getSaleNotePdfUrl(note.numero)"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-sm btn-ghost inline-flex items-center gap-1.5 no-underline"
                      >
                        <lucide-icon [img]="icons.FileDown" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                        <span>PDF</span>
                      </a>
                    </td>
                  </tr>

                  @if (isExpanded(note.id_nota_venta)) {
                    <tr class="bg-[#0d0d0d]">
                      <td colspan="8" class="p-0">
                        <div class="p-5 border-t border-b border-[#262626] space-y-4">
                          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-[12px]">
                            <div class="glass-subtle p-3.5 space-y-1">
                              <span class="text-[#a1a1aa] flex items-center gap-1.5 font-medium">
                                <lucide-icon [img]="icons.MapPin" [size]="13" [strokeWidth]="1.5"></lucide-icon>
                                Dirección de entrega
                              </span>
                              <p class="text-[#fafafa]">
                                {{ note.direccion_entrega || 'No informada al emitir la nota' }}
                              </p>
                            </div>

                            <div class="glass-subtle p-3.5 space-y-1">
                              <span class="text-[#a1a1aa] font-medium block">Auditoría de pedido</span>
                              @if (note.estado_pedido === 'despachado') {
                                <p class="text-[#fafafa]">
                                  Despachado por {{ note.usuario_entrega || 'Bodega' }} el {{ formatChileDate(note.fecha_entrega) }}
                                </p>
                              } @else if (note.estado_pedido === 'cancelado') {
                                <p class="text-rose-300">
                                  Anulado por {{ note.usuario_anulacion || 'Sistema' }} el {{ formatChileDate(note.fecha_anulacion) }}
                                </p>
                                @if (note.motivo_anulacion) {
                                  <p class="text-[#a1a1aa]">Motivo: {{ note.motivo_anulacion }}</p>
                                }
                              } @else {
                                <p class="text-amber-300">Pendiente de despacho en bodega</p>
                              }
                            </div>

                            <div class="glass-subtle p-3.5 flex items-center justify-between gap-3">
                              <div>
                                <span class="text-[#a1a1aa] font-medium block">Comprobante contable</span>
                                <strong class="text-[16px] text-[#fafafa] tabular-nums">
                                  {{ formatMoney(note.total) }}
                                </strong>
                              </div>
                              <a
                                [href]="api.getSaleNotePdfUrl(note.numero)"
                                target="_blank"
                                rel="noopener"
                                class="btn btn-sm btn-primary inline-flex items-center gap-1.5 no-underline"
                              >
                                <lucide-icon [img]="icons.FileDown" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                                <span>Exportar PDF</span>
                              </a>
                            </div>
                          </div>

                          <div class="overflow-x-auto rounded-[8px] border border-[#262626]">
                            <table class="data-table min-w-[640px]">
                              <thead>
                                <tr>
                                  <th>SKU</th>
                                  <th>Producto</th>
                                  <th class="num">Cajas / Sueltos</th>
                                  <th class="num">Total u.</th>
                                  <th class="num">Precio confirmado</th>
                                  <th class="num">Subtotal</th>
                                </tr>
                              </thead>
                              <tbody>
                                @for (line of note.items; track line.sku) {
                                  <tr>
                                    <td class="font-mono text-[#a1a1aa]">{{ line.sku }}</td>
                                    <td class="text-[#fafafa]">{{ line.nombre }}</td>
                                    <td class="num text-[#a1a1aa]">
                                      {{ line.cajas }}c + {{ formatQuantity(line.sueltos) }}u
                                    </td>
                                    <td class="num text-[#fafafa]">{{ formatQuantity(line.cantidad_total) }}</td>
                                    <td class="num text-[#a1a1aa]">{{ formatMoney(line.precio_confirmado) }}</td>
                                    <td class="num font-semibold text-[#fafafa]">{{ formatMoney(line.subtotal) }}</td>
                                  </tr>
                                }
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </section>
  `,
})
export class SalesAuditPageComponent implements OnInit {
  readonly api = inject(GhoshApiService);

  readonly pageSize = AUDIT_PAGE_SIZE;
  readonly String = String;
  readonly formatChileDate = formatChileDate;
  readonly formatMoney = formatMoney;
  readonly formatQuantity = formatQuantity;

  readonly icons = {
    FileSpreadsheet,
    DollarSign,
    Truck,
    Clock,
    Ban,
    Search,
    ArrowRight,
    X,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    FileDown,
    MapPin,
  };

  readonly statusTabs = [
    { value: 'todos', label: 'Todas' },
    { value: 'pendiente', label: 'Pendientes' },
    { value: 'despachado', label: 'Despachadas' },
    { value: 'cancelado', label: 'Anuladas' },
  ];

  estadoInput = 'todos';
  numeroInput: number | null = null;
  pedidoInput: number | null = null;
  desdeInput = '';
  hastaInput = '';
  queryInput = '';
  vendedorInput = '';
  bodegaInput = '';

  readonly summary = signal<SaleNotesSummary>({
    total_notas: 0,
    pendientes: 0,
    despachados: 0,
    anulados: 0,
    monto_pendiente: 0,
    monto_despachado: 0,
    monto_anulado: 0,
    monto_neto_activo: 0,
  });
  readonly warehouses = signal<WarehouseOption[]>([]);
  readonly sellers = signal<UserOption[]>([]);
  readonly items = signal<SaleNoteRecord[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly expandedNoteId = signal<number | null>(null);

  readonly caption = computed(() => {
    if (this.loading()) return 'Consultando notas de venta…';
    if (this.errorMessage()) return 'No fue posible consultar el registro';
    const count = this.total();
    return count === 1 ? '1 nota de venta encontrada' : `${formatQuantity(count)} notas de venta encontradas`;
  });

  readonly pageLabel = computed(() => {
    const t = this.total();
    if (!t) return 'Sin resultados';
    const start = this.offset() + 1;
    const end = Math.min(this.offset() + AUDIT_PAGE_SIZE, t);
    return `Mostrando ${start}–${end} de ${t}`;
  });

  ngOnInit(): void {
    this.loadNotes();
  }

  badgeClass(estado: string): string {
    switch (estado) {
      case 'pendiente':
        return 'badge-amber';
      case 'despachado':
      case 'entregado':
        return 'badge-emerald';
      case 'cancelado':
        return 'badge-rose';
      default:
        return 'badge-slate';
    }
  }

  isExpanded(idNota: number): boolean {
    return this.expandedNoteId() === idNota;
  }

  toggleExpand(idNota: number): void {
    this.expandedNoteId.update((curr) => (curr === idNota ? null : idNota));
  }

  onStatusChange(value: string): void {
    this.estadoInput = value;
    this.offset.set(0);
    this.loadNotes();
  }

  onDropdownChange(): void {
    this.offset.set(0);
    this.loadNotes();
  }

  onFilterSubmit(): void {
    this.offset.set(0);
    this.loadNotes();
  }

  onClear(): void {
    this.estadoInput = 'todos';
    this.numeroInput = null;
    this.pedidoInput = null;
    this.desdeInput = '';
    this.hastaInput = '';
    this.queryInput = '';
    this.vendedorInput = '';
    this.bodegaInput = '';
    this.offset.set(0);
    this.loadNotes();
  }

  prevPage(): void {
    if (this.offset() > 0) {
      this.offset.update((v) => Math.max(0, v - AUDIT_PAGE_SIZE));
      this.loadNotes();
    }
  }

  nextPage(): void {
    if (this.offset() + AUDIT_PAGE_SIZE < this.total()) {
      this.offset.update((v) => v + AUDIT_PAGE_SIZE);
      this.loadNotes();
    }
  }

  loadNotes(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api
      .getSaleNotes({
        estado: this.estadoInput,
        numero: this.numeroInput,
        id_pedido: this.pedidoInput,
        fecha_desde: this.desdeInput,
        fecha_hasta: this.hastaInput,
        q: this.queryInput,
        id_vendedor: this.vendedorInput ? Number(this.vendedorInput) : undefined,
        id_bodega: this.bodegaInput ? Number(this.bodegaInput) : undefined,
        limit: AUDIT_PAGE_SIZE,
        offset: this.offset(),
      })
      .subscribe({
        next: (res) => {
          this.items.set(res.items ?? []);
          this.total.set(res.total ?? 0);
          if (res.summary) this.summary.set(res.summary);
          if (res.bodegas) this.warehouses.set(res.bodegas);
          if (res.vendedores) this.sellers.set(res.vendedores);
          this.loading.set(false);
        },
        error: (err) => {
          this.items.set([]);
          this.total.set(0);
          this.loading.set(false);
          this.errorMessage.set(
            this.api.extractErrorMessage(err, 'No se pudo cargar la auditoría de ventas.'),
          );
        },
      });
  }
}
