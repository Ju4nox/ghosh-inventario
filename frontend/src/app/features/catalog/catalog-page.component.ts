import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { CatalogProduct } from '../../core/models';

const PAGE_SIZE = 20;

interface ActionFeedback {
  success: boolean;
  title: string;
  message: string;
}

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
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
            <span class="text-[12px] font-medium text-[#a1a1aa]">Alerta de stock en página</span>
            <lucide-icon
              [img]="icons.AlertTriangle"
              [size]="16"
              [strokeWidth]="1.5"
              class="text-[#a1a1aa]"
            ></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ lowStockCount() }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            {{
              lowStockCount() > 0
                ? 'Artículos con menos de 10 unidades'
                : 'Stock saludable en esta página'
            }}
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
          <!-- Vista de Tabla para Escritorio (md+) -->
          <div class="hidden md:block overflow-x-auto scroll-area">
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

          <!-- Vista de Tarjetas Apiladas para Móvil (< md) -->
          <div class="grid md:hidden gap-3 p-4">
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
  `,
})
export class CatalogPageComponent implements OnInit {
  private readonly api = inject(GhoshApiService);
  private readonly confirmModal = inject(ConfirmModalService);

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
    RotateCcw,
    Trash2,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
  };

  queryInput = '';
  readonly items = signal<CatalogProduct[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly includeInactive = signal(false);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly feedback = signal<ActionFeedback | null>(null);

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
    const actionVerb = targetActive ? 'reactivar' : 'retirar';
    const available = Number(product.disponible ?? 0);

    const confirmed = await this.confirmModal.confirm({
      title: `${targetActive ? 'Reactivar' : 'Retirar'} «${product.nombre}»`,
      message: targetActive
        ? `¿Quieres reactivar «${product.nombre}» en el catálogo? Volverá a estar disponible para ventas y recepciones.`
        : `¿Quieres ${actionVerb} «${product.nombre}» del catálogo? Dejará de aparecer para nuevas ventas y recepciones; sus movimientos y stock se conservarán.`,
      highlight:
        !targetActive && available > 0
          ? `Stock disponible actual: ${formatQuantity(available)} unidades.`
          : undefined,
      confirmLabel: targetActive ? 'Sí, reactivar' : 'Sí, retirar artículo',
      tone: targetActive ? 'emerald' : 'warning',
    });

    if (!confirmed) return;

    this.api.updateProductStatus(product.sku, targetActive).subscribe({
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
            }.` + stockMessage,
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
    const available = Number(product.disponible ?? 0);

    const confirmed = await this.confirmModal.confirm({
      title: `Eliminar «${product.nombre}» del catálogo`,
      message: `¿Eliminar definitivamente «${product.nombre}» del catálogo? Sus códigos I/B quedarán disponibles para otros productos. Sus lotes y movimientos históricos se conservarán.`,
      highlight:
        available > 0
          ? `Aún registra ${formatQuantity(available)} unidades disponibles; permanecerán en el historial y no podrán venderse desde este artículo eliminado.`
          : undefined,
      confirmLabel: 'Eliminar del catálogo',
      tone: 'danger',
    });

    if (!confirmed) return;

    this.api.deleteProduct(product.sku).subscribe({
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
            stockMessage,
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
}
