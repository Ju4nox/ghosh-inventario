import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Eye,
  EyeOff,
  LayoutGrid,
  LucideAngularModule,
  MinusCircle,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-angular';

import { ConfirmModalService } from '../../core/confirm-modal.service';
import { formatMoney, formatQuantity, formatWeight } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import {
  CatalogProduct,
  InventoryAlertsSummary,
  ProductAuditPayload,
  ProductShrinkagePayload,
  UserOption,
} from '../../core/models';

const PAGE_SIZE = 20;

interface ActionFeedback {
  success: boolean;
  title: string;
  message: string;
}

interface AuditDialogResult {
  id_usuario: number;
  motivo: string;
  cantidad?: string;
}

interface AuditDialogState {
  mode: 'retiro' | 'eliminacion' | 'merma';
  title: string;
  subtitle: string;
  highlight?: string;
  confirmLabel: string;
  actors: UserOption[];
  availableStock: number;
  maxReasonLength: number;
  decimals: number;
  resolve: (value: AuditDialogResult | null) => void;
}

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  template: `
    <section class="space-y-8 animate-fade-up">
      <!-- Encabezado de página -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-semibold tracking-tight text-[#fafafa]">
            Catálogo
          </h1>
          <p class="mt-1 text-[13px] text-[#a1a1aa]">
            Consulta códigos, pesos, empaques, precios y stock actual.
          </p>
        </div>
        <div
          class="w-9 h-9 rounded-[8px] grid place-items-center bg-[#111111] border border-[#262626] text-[#a1a1aa] shrink-0"
          aria-hidden="true"
        >
          <lucide-icon [img]="icons.LayoutGrid" [size]="18" [strokeWidth]="1.5"></lucide-icon>
        </div>
      </div>

      <!-- Tarjetas de Resumen (Estilo shadcn/ui monocromo) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-4">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Productos encontrados</span>
            <lucide-icon
              [img]="icons.Package"
              [size]="16"
              [strokeWidth]="1.5"
              class="text-[#a1a1aa]"
            ></lucide-icon>
          </div>
          <div
            id="product-total"
            class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums"
          >
            {{ loaded() ? formatQuantity(total()) : '—' }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">{{ resultCaption() }}</p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-4">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Información de precios</span>
            <lucide-icon
              [img]="icons.DollarSign"
              [size]="16"
              [strokeWidth]="1.5"
              class="text-[#a1a1aa]"
            ></lucide-icon>
          </div>
          <div class="mt-2 text-[20px] font-semibold text-[#fafafa]">Lista de precios</div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            Precio unitario y precio con IVA (19%)
          </p>
        </article>

        <article class="glass-card p-5 sm:col-span-2 lg:col-span-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Alertas de stock y lotes</span>
            <lucide-icon
              [img]="icons.AlertTriangle"
              [size]="16"
              [strokeWidth]="1.5"
              class="text-[#a1a1aa]"
            ></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{
              alertSummary()
                ? (alertSummary()!.total_alertas_stock + alertSummary()!.total_alertas_lotes)
                : lowStockCount()
            }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            @if (alertSummary(); as alerts) {
              {{ alerts.total_alertas_stock }} stock crítico · {{ alerts.total_alertas_lotes }} lotes por vencer/vencidos ·
              <a routerLink="/demanda" class="text-[#fafafa] underline hover:text-[#d4d4d8]">Ver alertas</a>
            } @else {
              {{
                lowStockCount() > 0
                  ? 'Artículos con menos de 10 unidades en página'
                  : 'Stock saludable en esta página'
              }}
            }
          </p>
        </article>
      </div>

      <!-- Panel de búsqueda -->
      <form
        id="catalog-filter"
        class="glass-panel p-5 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-end"
        (ngSubmit)="onSearch()"
      >
        <label class="block">
          <span class="field-label">Buscar producto</span>
          <div class="input-icon-wrap">
            <span class="input-icon" aria-hidden="true">
              <lucide-icon [img]="icons.Search" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </span>
            <input
              id="catalog-query"
              name="query"
              type="search"
              [(ngModel)]="queryInput"
              placeholder="Artículo o código I/B"
              autocomplete="off"
              class="glass-input has-icon pl-10"
            />
          </div>
        </label>
        <button type="submit" class="btn btn-primary w-full sm:w-auto">
          <span>Buscar</span>
          <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
        </button>
        <button
          id="catalog-clear"
          type="button"
          class="btn btn-ghost w-full sm:w-auto"
          (click)="onClear()"
        >
          <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
          <span>Limpiar</span>
        </button>
      </form>

      <!-- Resultado de acción (Retirar / Reactivar / Eliminar) -->
      @if (feedback(); as fb) {
        <div
          id="catalog-action-result"
          role="status"
          aria-live="polite"
          class="glass-panel p-4 flex items-start justify-between gap-3 border border-[#262626]"
        >
          <div class="flex items-start gap-3">
            <lucide-icon
              [img]="fb.success ? icons.CheckCircle2 : icons.AlertTriangle"
              [size]="18"
              [strokeWidth]="1.5"
              class="mt-0.5 shrink-0 text-[#fafafa]"
            ></lucide-icon>
            <div class="text-[13px] leading-relaxed">
              <strong class="block font-semibold text-[#fafafa]">{{ fb.title }}</strong>
              <span class="text-[#a1a1aa]">{{ fb.message }}</span>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon shrink-0"
            aria-label="Cerrar aviso"
            (click)="feedback.set(null)"
          >
            <lucide-icon [img]="icons.X" [size]="14" [strokeWidth]="1.5"></lucide-icon>
          </button>
        </div>
      }

      <!-- Contenedor principal del Catálogo -->
      <section class="glass-panel overflow-hidden" aria-labelledby="catalog-table-heading">
        <div
          class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#262626]"
        >
          <div>
            <h2 id="catalog-table-heading" class="text-[15px] font-semibold text-[#fafafa]">
              Productos
            </h2>
            <p id="catalog-result-caption" class="text-[12px] text-[#a1a1aa] mt-0.5">
              {{ resultCaption() }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button
              id="catalog-inactive-toggle"
              type="button"
              class="btn btn-ghost btn-sm"
              [attr.aria-pressed]="includeInactive()"
              (click)="toggleInactive()"
            >
              <lucide-icon
                [img]="includeInactive() ? icons.EyeOff : icons.Eye"
                [size]="15"
                [strokeWidth]="1.5"
              ></lucide-icon>
              <span>{{ includeInactive() ? 'Solo activos' : 'Mostrar retirados' }}</span>
            </button>

            <button
              id="catalog-purge-stock"
              type="button"
              class="btn btn-ghost btn-sm text-[#a1a1aa] hover:text-[#fafafa]"
              title="Dejar el stock de todos los artículos en 0 (testeo de purga)"
              [disabled]="purging() || loading()"
              (click)="onPurgeStock()"
            >
              <lucide-icon [img]="icons.RotateCcw" [size]="14" [strokeWidth]="1.5"></lucide-icon>
              <span>{{ purging() ? 'Purgando…' : 'Purgar stock (0)' }}</span>
            </button>

            <button
              id="catalog-refresh"
              type="button"
              class="btn btn-ghost btn-sm"
              title="Actualizar productos"
              aria-label="Actualizar catálogo"
              (click)="onRefresh()"
            >
              <lucide-icon
                [img]="icons.RefreshCw"
                [size]="14"
                [strokeWidth]="1.5"
                [class.animate-spin]="loading()"
              ></lucide-icon>
              <span>Actualizar</span>
            </button>

            <span class="badge">CATÁLOGO</span>
          </div>
        </div>

        <!-- Estado de carga / vacío / error -->
        @if (loading()) {
          <div class="py-16 px-4 text-center text-[13px] text-[#a1a1aa]">
            Cargando productos…
          </div>
        } @else if (errorMessage()) {
          <div class="py-16 px-4 text-center text-[13px] text-[#fafafa] font-medium">
            {{ errorMessage() }}
          </div>
        } @else if (items().length === 0) {
          <div class="py-16 px-4 text-center text-[13px] text-[#a1a1aa]">
            No encontramos productos con esos filtros.
          </div>
        } @else {
          <!-- Vista de Tabla para Escritorio (lg+) -->
          <div class="desktop-only-view overflow-x-auto scroll-area">
            <table class="data-table min-w-[1100px]">
              <thead>
                <tr>
                  <th>Código I</th>
                  <th>Código B</th>
                  <th>Artículo</th>
                  <th class="num">Peso</th>
                  <th class="num">Unidad x caja</th>
                  <th class="num">Stock</th>
                  <th class="num">Precio x unidad</th>
                  <th class="num">Precio con IVA</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody id="catalog-rows">
                @for (product of items(); track product.sku) {
                  <tr [class.opacity-55]="!product.activo">
                    <td class="font-mono text-[12px] text-[#fafafa] font-medium">
                      {{ product.sku }}
                    </td>
                    <td class="font-mono text-[12px] text-[#a1a1aa]">
                      {{ product.codigo_b || '—' }}
                    </td>
                    <td>
                      <div class="flex items-center gap-2">
                        <span class="font-medium text-[#fafafa]">{{ product.nombre }}</span>
                        @if (!product.activo) {
                          <span class="badge badge-slate">Retirado</span>
                        }
                      </div>
                    </td>
                    <td class="num text-[#a1a1aa]">{{ formatWeight(product.peso) }}</td>
                    <td class="num text-[#a1a1aa]">
                      {{ formatQuantity(product.unidades_por_caja) }}
                    </td>
                    <td class="num">
                      <span
                        class="badge"
                        [ngClass]="
                          isLowStock(product)
                            ? 'badge-rose stock-low'
                            : 'badge-emerald stock-cell'
                        "
                      >
                        {{ formatQuantity(product.disponible) }}
                      </span>
                    </td>
                    <td class="num font-medium text-[#fafafa]">
                      {{ formatMoney(product.precio_vigente) }}
                    </td>
                    <td class="num font-semibold text-[#fafafa]">
                      {{ formatMoney(product.precio_con_iva) }}
                    </td>
                    <td>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="btn btn-sm btn-ghost"
                          [disabled]="Number(product.disponible ?? 0) <= 0"
                          [attr.aria-label]="'Registrar merma de ' + product.nombre"
                          title="Descontar unidades por merma o pérdida"
                          (click)="onRegisterShrinkage(product)"
                        >
                          <lucide-icon
                            [img]="icons.MinusCircle"
                            [size]="14"
                            [strokeWidth]="1.5"
                          ></lucide-icon>
                          <span>Merma</span>
                        </button>

                        <button
                          type="button"
                          class="btn btn-sm btn-ghost"
                          [attr.aria-label]="
                            (product.activo ? 'Retirar ' : 'Reactivar ') + product.nombre
                          "
                          (click)="onToggleProductStatus(product)"
                        >
                          <lucide-icon
                            [img]="product.activo ? icons.Archive : icons.RotateCcw"
                            [size]="14"
                            [strokeWidth]="1.5"
                          ></lucide-icon>
                          <span>{{ product.activo ? 'Retirar' : 'Reactivar' }}</span>
                        </button>

                        @if (!product.activo) {
                          <button
                            type="button"
                            class="btn btn-sm btn-danger"
                            [attr.aria-label]="'Eliminar del catálogo ' + product.nombre"
                            (click)="onDeleteProduct(product)"
                          >
                            <lucide-icon
                              [img]="icons.Trash2"
                              [size]="14"
                              [strokeWidth]="1.5"
                            ></lucide-icon>
                            <span>Eliminar</span>
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Vista de Tarjetas Táctiles para Redmi Pad SE 11" Vertical / Móvil -->
          <div class="tablet-only-view grid-cols-1 sm:grid-cols-2 gap-3.5 p-4">
            @for (product of items(); track product.sku) {
              <article
                class="glass-subtle p-4 space-y-3"
                [class.opacity-60]="!product.activo"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class="font-mono text-[12px] font-medium text-[#fafafa]">
                        {{ product.sku }}
                      </span>
                      @if (product.codigo_b) {
                        <span class="text-[12px] text-[#a1a1aa] font-mono">
                          · {{ product.codigo_b }}
                        </span>
                      }
                      @if (!product.activo) {
                        <span class="badge badge-slate">Retirado</span>
                      }
                    </div>
                    <h3 class="mt-1 text-[14px] font-semibold text-[#fafafa] leading-snug">
                      {{ product.nombre }}
                    </h3>
                  </div>

                  <span
                    class="badge shrink-0"
                    [ngClass]="isLowStock(product) ? 'badge-rose' : 'badge-emerald'"
                  >
                    Stock: {{ formatQuantity(product.disponible) }}
                  </span>
                </div>

                <div class="grid grid-cols-2 gap-2 text-[12px] pt-2 border-t border-[#1f1f1f]">
                  <div>
                    <span class="text-[#a1a1aa] block">Precio unitario</span>
                    <strong class="text-[#fafafa] font-medium tabular-nums">
                      {{ formatMoney(product.precio_vigente) }}
                    </strong>
                  </div>
                  <div>
                    <span class="text-[#a1a1aa] block">Precio con IVA</span>
                    <strong class="text-[#fafafa] font-semibold tabular-nums">
                      {{ formatMoney(product.precio_con_iva) }}
                    </strong>
                  </div>
                  <div>
                    <span class="text-[#a1a1aa] block">Unidad x caja</span>
                    <strong class="text-[#fafafa] font-medium tabular-nums">
                      {{ formatQuantity(product.unidades_por_caja) }}
                    </strong>
                  </div>
                  <div>
                    <span class="text-[#a1a1aa] block">Peso</span>
                    <strong class="text-[#fafafa] font-medium tabular-nums">
                      {{ formatWeight(product.peso) }}
                    </strong>
                  </div>
                </div>

                <div class="pt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost flex-1"
                    [disabled]="Number(product.disponible ?? 0) <= 0"
                    (click)="onRegisterShrinkage(product)"
                  >
                    <lucide-icon
                      [img]="icons.MinusCircle"
                      [size]="15"
                      [strokeWidth]="1.5"
                    ></lucide-icon>
                    <span>Merma</span>
                  </button>

                  <button
                    type="button"
                    class="btn btn-sm btn-ghost flex-1"
                    (click)="onToggleProductStatus(product)"
                  >
                    <lucide-icon
                      [img]="product.activo ? icons.Archive : icons.RotateCcw"
                      [size]="15"
                      [strokeWidth]="1.5"
                    ></lucide-icon>
                    <span>{{ product.activo ? 'Retirar' : 'Reactivar' }}</span>
                  </button>

                  @if (!product.activo) {
                    <button
                      type="button"
                      class="btn btn-sm btn-danger flex-1"
                      (click)="onDeleteProduct(product)"
                    >
                      <lucide-icon
                        [img]="icons.Trash2"
                        [size]="15"
                        [strokeWidth]="1.5"
                      ></lucide-icon>
                      <span>Eliminar</span>
                    </button>
                  }
                </div>
              </article>
            }
          </div>
        }

        <!-- Pie de tabla y paginación -->
        <div
          class="px-5 py-3.5 border-t border-[#262626] flex items-center justify-between gap-4 text-[12px] text-[#a1a1aa]"
        >
          <span id="catalog-page-label">{{ pageLabel() }}</span>
          <div class="flex items-center gap-2">
            <button
              id="catalog-prev"
              type="button"
              class="btn btn-ghost btn-sm btn-icon"
              aria-label="Página anterior"
              [disabled]="offset() <= 0 || loading()"
              (click)="prevPage()"
            >
              <lucide-icon [img]="icons.ChevronLeft" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </button>
            <button
              id="catalog-next"
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

    <!-- Modal auditable para Retiro / Eliminación / Merma -->
    @if (auditDialog(); as dialog) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 animate-fade-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-dialog-title"
        (click)="closeAuditDialog()"
      >
        <div
          class="w-full max-w-md p-6 bg-[#111111] border border-[#262626] rounded-[10px] animate-modal-in relative"
          (click)="$event.stopPropagation()"
        >
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon absolute top-4 right-4 text-[#a1a1aa] hover:text-[#fafafa]"
            aria-label="Cerrar diálogo"
            (click)="closeAuditDialog()"
          >
            <lucide-icon [img]="icons.X" [size]="16" [strokeWidth]="1.5"></lucide-icon>
          </button>

          <h3 id="audit-dialog-title" class="text-[15px] font-semibold text-[#fafafa] pr-6">
            {{ dialog.title }}
          </h3>
          <p class="mt-1.5 text-[13px] text-[#a1a1aa]">
            {{ dialog.subtitle }}
          </p>

          @if (dialog.highlight) {
            <div
              class="mt-3 p-3 rounded-[6px] text-[12px] font-medium bg-[#0a0a0a] border border-[#262626] text-[#fafafa]"
            >
              {{ dialog.highlight }}
            </div>
          }

          <form class="mt-5 space-y-4" (ngSubmit)="submitAuditDialog()">
            <label class="block">
              <span class="field-label">Responsable</span>
              <select
                id="audit-dialog-user"
                name="auditUser"
                class="glass-input"
                [(ngModel)]="auditUserId"
                required
              >
                <option value="">Selecciona un responsable</option>
                @for (actor of dialog.actors; track actor.id_usuario) {
                  <option [value]="String(actor.id_usuario)">{{ actor.nombre }}</option>
                }
              </select>
            </label>

            @if (dialog.mode === 'merma') {
              <label class="block">
                <span class="field-label">
                  Cantidad a descontar
                  <span class="text-[#a1a1aa] font-normal">
                    (disponible: {{ formatQuantity(dialog.availableStock) }})
                  </span>
                </span>
                <input
                  id="audit-dialog-quantity"
                  name="auditQuantity"
                  type="number"
                  [min]="dialog.decimals > 0 ? '0.001' : '1'"
                  [step]="dialog.decimals > 0 ? '0.001' : '1'"
                  [max]="dialog.availableStock"
                  [(ngModel)]="auditQuantity"
                  placeholder="Ej. 2"
                  required
                  class="glass-input tabular-nums"
                />
              </label>
            }

            <label class="block">
              <span class="field-label">
                Motivo
                <span class="text-[#a1a1aa] font-normal">
                  (obligatorio, máx. {{ dialog.maxReasonLength }} caracteres)
                </span>
              </span>
              <textarea
                id="audit-dialog-reason"
                name="auditReason"
                rows="3"
                [maxlength]="dialog.maxReasonLength"
                [(ngModel)]="auditReason"
                [placeholder]="
                  dialog.mode === 'merma'
                    ? 'Ej. Envases dañados / producto vencido / rotura en bodega'
                    : 'Indica el motivo de la acción'
                "
                required
                class="glass-input resize-none"
              ></textarea>
            </label>

            @if (auditDialogError()) {
              <div
                role="alert"
                class="p-3 rounded-[6px] bg-[#0a0a0a] border border-[#262626] text-[12px] text-[#fafafa]"
              >
                {{ auditDialogError() }}
              </div>
            }

            <div class="pt-2 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button type="button" class="btn btn-ghost" (click)="closeAuditDialog()">
                Cancelar
              </button>
              <button type="submit" class="btn btn-primary">
                {{ dialog.confirmLabel }}
              </button>
            </div>
          </form>
        </div>
      </div>
    }
  `,
})
export class CatalogPageComponent implements OnInit {
  private readonly api = inject(GhoshApiService);
  private readonly confirmModal = inject(ConfirmModalService);

  readonly Number = Number;
  readonly String = String;
  readonly pageSize = PAGE_SIZE;
  readonly formatMoney = formatMoney;
  readonly formatQuantity = formatQuantity;
  readonly formatWeight = formatWeight;

  readonly icons = {
    LayoutGrid,
    Package,
    DollarSign,
    AlertTriangle,
    Search,
    ArrowRight,
    X,
    Eye,
    EyeOff,
    RefreshCw,
    Archive,
    MinusCircle,
    RotateCcw,
    Trash2,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
  };

  queryInput = '';
  auditUserId = '';
  auditQuantity = '';
  auditReason = '';
  readonly items = signal<CatalogProduct[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly includeInactive = signal(false);
  readonly loading = signal(false);
  readonly purging = signal(false);
  readonly loaded = signal(false);
  readonly alertSummary = signal<InventoryAlertsSummary | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly feedback = signal<ActionFeedback | null>(null);
  readonly auditDialog = signal<AuditDialogState | null>(null);
  readonly auditDialogError = signal<string | null>(null);

  readonly lowStockCount = computed(
    () => this.items().filter((item) => this.isLowStock(item)).length,
  );

  readonly resultCaption = computed(() => {
    if (this.loading() && !this.loaded()) return 'Cargando catálogo…';
    if (this.errorMessage()) return 'No fue posible cargar el catálogo';
    const total = this.total();
    return total === 1
      ? '1 producto coincide con los filtros'
      : `${formatQuantity(total)} productos coinciden con los filtros`;
  });

  readonly pageLabel = computed(() => {
    const total = this.total();
    if (total === 0) return 'Sin resultados';
    const start = this.offset() + 1;
    const end = Math.min(this.offset() + PAGE_SIZE, total);
    return `Mostrando ${start}–${end} de ${total}`;
  });

  ngOnInit(): void {
    this.loadCatalog();
  }

  isLowStock(product: CatalogProduct): boolean {
    return Number(product.disponible ?? 0) < 10;
  }

  loadCatalog(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api.getInventoryAlerts({ dias_vencimiento: 30, umbral_stock: 10 }).subscribe({
      next: (res) => this.alertSummary.set(res.summary),
      error: () => this.alertSummary.set(null),
    });

    this.api
      .getCatalogProducts({
        q: this.queryInput,
        limit: PAGE_SIZE,
        offset: this.offset(),
        incluir_inactivos: this.includeInactive(),
      })
      .subscribe({
        next: (result) => {
          this.items.set(result.items ?? []);
          this.total.set(result.total ?? 0);
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

  onSearch(): void {
    this.offset.set(0);
    this.loadCatalog();
  }

  onClear(): void {
    this.queryInput = '';
    this.offset.set(0);
    this.loadCatalog();
  }

  onRefresh(): void {
    this.queryInput = '';
    this.offset.set(0);
    this.loadCatalog();
  }

  toggleInactive(): void {
    this.includeInactive.update((v) => !v);
    this.offset.set(0);
    this.loadCatalog();
  }

  async onPurgeStock(): Promise<void> {
    const confirmed = await this.confirmModal.confirm({
      title: 'Purgar existencias a 0 (testeo de purga)',
      message:
        '¿Quieres dejar en 0 el stock de todos los artículos del catálogo? Ningún artículo ni lote será eliminado de la base de datos.',
      highlight:
        'Cada descuento quedará registrado en el historial de Movimientos como ajuste con el motivo "(testeo de purga)".',
      confirmLabel: 'Sí, dejar stock en 0',
      tone: 'warning',
    });

    if (!confirmed) return;

    this.purging.set(true);
    this.feedback.set(null);

    this.api.purgeCatalogStock().subscribe({
      next: (res) => {
        this.purging.set(false);
        const lots = Number(res.lots_zeroed ?? 0);
        const units = Number(res.units_removed ?? 0);
        this.feedback.set({
          success: true,
          title: 'Existencias reseteadas a 0',
          message:
            lots > 0
              ? `Se ajustaron ${formatQuantity(lots)} lotes (${formatQuantity(units)} unidades llevadas a 0) conservando todos los artículos. Registro en Movimientos: ${res.motivo}.`
              : 'Todos los artículos del catálogo ya se encontraban con stock en 0.',
        });
        this.loadCatalog();
      },
      error: (err) => {
        this.purging.set(false);
        this.feedback.set({
          success: false,
          title: 'No se pudo completar la purga de stock',
          message: this.api.extractErrorMessage(err, 'No se pudo conectar con la API.'),
        });
      },
    });
  }

  prevPage(): void {
    this.offset.update((current) => Math.max(0, current - PAGE_SIZE));
    this.loadCatalog();
  }

  nextPage(): void {
    if (this.offset() + PAGE_SIZE < this.total()) {
      this.offset.update((current) => current + PAGE_SIZE);
      this.loadCatalog();
    }
  }

  async onToggleProductStatus(product: CatalogProduct): Promise<void> {
    const targetActive = !product.activo;
    let audit: ProductAuditPayload | undefined;

    if (targetActive) {
      const confirmed = await this.confirmModal.confirm({
        title: `Reactivar «${product.nombre}»`,
        message: `¿Quieres reactivar «${product.nombre}» en el catálogo? Volverá a estar disponible para ventas y recepciones.`,
        confirmLabel: 'Sí, reactivar',
        tone: 'emerald',
      });
      if (!confirmed) return;
    } else {
      const details = await this.collectAuditDetails('retiro', product);
      if (!details) return;
      audit = details;
    }

    this.api.updateProductStatus(product.sku, targetActive, audit).subscribe({
      next: (data) => {
        const physical = Number(data.stock_fisico ?? 0);
        const stockMessage =
          physical > 0
            ? ` El inventario físico conservado en sus lotes es ${formatQuantity(physical)} unidades.`
            : ' El historial del producto se conservó.';

        this.feedback.set({
          success: true,
          title: targetActive ? 'Artículo reactivado' : 'Artículo retirado',
          message:
            `${product.nombre} ya ${
              targetActive
                ? 'está disponible'
                : 'no aparecerá para nuevas ventas ni recepciones'
            }.` + stockMessage + (data.auditoria ? ` Auditoría: ${data.auditoria.usuario}; motivo: ${data.auditoria.motivo}.` : ''),
        });
        this.offset.set(0);
        this.loadCatalog();
      },
      error: (err) => {
        this.feedback.set({
          success: false,
          title: 'No se pudo actualizar el artículo',
          message: this.api.extractErrorMessage(
            err,
            'No se pudo cambiar el estado del artículo.',
          ),
        });
      },
    });
  }

  async onDeleteProduct(product: CatalogProduct): Promise<void> {
    const audit = await this.collectAuditDetails('eliminacion', product);
    if (!audit) return;

    this.api.deleteProduct(product.sku, audit).subscribe({
      next: (data) => {
        const remaining = Number(data.stock_fisico_conservado ?? 0);
        const stockMessage =
          remaining > 0
            ? ` Se conservaron ${formatQuantity(remaining)} unidades en sus lotes históricos.`
            : ' Se conservó el historial de lotes y movimientos.';

        this.feedback.set({
          success: true,
          title: 'Artículo eliminado del catálogo',
          message:
            `${product.nombre} ya no aparecerá en el catálogo. Sus códigos quedaron liberados.` +
            stockMessage +
            (data.auditoria
              ? ` Auditoría: ${data.auditoria.usuario}; motivo: ${data.auditoria.motivo}.`
              : ''),
        });
        this.offset.set(0);
        this.loadCatalog();
      },
      error: (err) => {
        this.feedback.set({
          success: false,
          title: 'No se pudo eliminar el artículo',
          message: this.api.extractErrorMessage(
            err,
            'No se pudo eliminar el artículo del catálogo.',
          ),
        });
      },
    });
  }

  async onRegisterShrinkage(product: CatalogProduct): Promise<void> {
    const available = Number(product.disponible ?? 0);
    if (available <= 0) {
      this.feedback.set({
        success: false,
        title: 'Sin stock disponible para merma',
        message: `«${product.nombre}» no registra unidades disponibles libres de reservas.`,
      });
      return;
    }

    const actors = await this.loadAuditActors();
    if (!actors) return;

    const result = await this.openAuditDialog({
      mode: 'merma',
      title: `Registrar merma de «${product.nombre}»`,
      subtitle: `SKU ${product.sku} · Se descontará por orden FEFO de los lotes disponibles.`,
      confirmLabel: 'Registrar merma',
      actors,
      availableStock: available,
      maxReasonLength: 200,
      decimals: Number(product.decimales ?? 0),
    });

    if (!result || !result.cantidad) return;

    const payload: ProductShrinkagePayload = {
      cantidad: result.cantidad,
      id_usuario: result.id_usuario,
      motivo: result.motivo,
    };

    this.api.registerProductShrinkage(product.sku, payload).subscribe({
      next: (data) => {
        this.feedback.set({
          success: true,
          title: 'Merma de stock registrada',
          message:
            `Se descontaron ${formatQuantity(data.cantidad_merma)} unidades de «${product.nombre}» ` +
            `(${data.lotes_afectados} lote(s)). Stock físico restante: ${formatQuantity(data.stock_fisico)}. ` +
            `Auditoría: ${data.auditoria.usuario}; motivo: ${data.auditoria.motivo}.`,
        });
        this.loadCatalog();
      },
      error: (err) => {
        this.feedback.set({
          success: false,
          title: 'No se pudo registrar la merma',
          message: this.api.extractErrorMessage(
            err,
            'No se pudo registrar la merma de stock.',
          ),
        });
      },
    });
  }

  private async loadAuditActors(): Promise<UserOption[] | null> {
    let actors: UserOption[];
    try {
      actors = (await firstValueFrom(this.api.getCatalogAuditOptions())).usuarios ?? [];
    } catch (err) {
      this.feedback.set({
        success: false,
        title: 'No se pudo cargar responsables',
        message: this.api.extractErrorMessage(err, 'No se pudo consultar los usuarios activos.'),
      });
      return null;
    }

    if (!actors.length) {
      this.feedback.set({
        success: false,
        title: 'No hay responsable disponible',
        message: 'Crea o habilita un usuario antes de registrar una acción auditable.',
      });
      return null;
    }
    return actors;
  }

  private async collectAuditDetails(
    mode: 'retiro' | 'eliminacion',
    product: CatalogProduct,
  ): Promise<ProductAuditPayload | null> {
    const actors = await this.loadAuditActors();
    if (!actors) return null;

    const available = Number(product.disponible ?? 0);
    const result = await this.openAuditDialog({
      mode,
      title:
        mode === 'retiro'
          ? `Retirar «${product.nombre}» del catálogo`
          : `Eliminar «${product.nombre}» del catálogo`,
      subtitle:
        mode === 'retiro'
          ? 'Dejará de aparecer para nuevas ventas y recepciones; sus movimientos y stock se conservarán.'
          : 'Sus códigos I/B quedarán disponibles para otros productos. Sus lotes y movimientos históricos se conservarán.',
      highlight:
        mode === 'retiro'
          ? available > 0
            ? `Stock disponible actual: ${formatQuantity(available)} unidades.`
            : undefined
          : available > 0
            ? `Aún registra ${formatQuantity(available)} unidades disponibles; permanecerán en el historial y no podrán venderse desde este artículo eliminado.`
            : undefined,
      confirmLabel: mode === 'retiro' ? 'Sí, retirar artículo' : 'Eliminar del catálogo',
      actors,
      availableStock: available,
      maxReasonLength: 300,
      decimals: Number(product.decimales ?? 0),
    });

    if (!result) return null;
    return { id_usuario: result.id_usuario, motivo: result.motivo };
  }

  private openAuditDialog(
    options: Omit<AuditDialogState, 'resolve'>,
  ): Promise<AuditDialogResult | null> {
    const current = this.auditDialog();
    if (current) {
      current.resolve(null);
    }

    this.auditUserId =
      options.actors.length === 1 ? String(options.actors[0].id_usuario) : '';
    this.auditQuantity = '';
    this.auditReason = '';
    this.auditDialogError.set(null);

    return new Promise<AuditDialogResult | null>((resolve) => {
      this.auditDialog.set({ ...options, resolve });
    });
  }

  submitAuditDialog(): void {
    const dialog = this.auditDialog();
    if (!dialog) return;

    const id_usuario = Number(this.auditUserId);
    const actor = dialog.actors.find((item) => item.id_usuario === id_usuario);
    if (!actor) {
      this.auditDialogError.set('Selecciona un responsable válido.');
      return;
    }

    let cantidad: string | undefined;
    if (dialog.mode === 'merma') {
      const parsedQty = Number(this.auditQuantity);
      if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
        this.auditDialogError.set('Ingresa una cantidad de merma mayor que cero.');
        return;
      }
      if (parsedQty > dialog.availableStock) {
        this.auditDialogError.set(
          `La merma no puede superar el stock disponible (${formatQuantity(dialog.availableStock)}).`,
        );
        return;
      }
      if (dialog.decimals === 0 && !Number.isInteger(parsedQty)) {
        this.auditDialogError.set('Este producto admite solo cantidades enteras.');
        return;
      }
      cantidad = String(this.auditQuantity).trim();
    }

    const motivo = this.auditReason.trim();
    if (!motivo) {
      this.auditDialogError.set('Ingresa el motivo obligatorio.');
      return;
    }
    if (motivo.length > dialog.maxReasonLength) {
      this.auditDialogError.set(
        `El motivo puede tener hasta ${dialog.maxReasonLength} caracteres.`,
      );
      return;
    }

    this.auditDialog.set(null);
    this.auditDialogError.set(null);
    dialog.resolve({ id_usuario, motivo, cantidad });
  }

  closeAuditDialog(): void {
    const dialog = this.auditDialog();
    if (!dialog) return;
    this.auditDialog.set(null);
    this.auditDialogError.set(null);
    dialog.resolve(null);
  }
}
