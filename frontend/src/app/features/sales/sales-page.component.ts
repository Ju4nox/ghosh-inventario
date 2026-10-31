import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  LucideAngularModule,
  ReceiptText,
  Search,
  ShoppingBag,
  Trash2,
  Warehouse,
  X,
} from 'lucide-angular';

import { formatMoney, formatQuantity } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import { CatalogProduct, UserOption, WarehouseOption } from '../../core/models';

const PAGE_SIZE = 20;

interface SelectedQty {
  cajas: number;
  sueltos: number;
}

interface SummaryLine {
  sku: string;
  nombre: string;
  cajas: number;
  sueltos: number;
  unidades_por_caja: number;
  cantidad_total: number;
  subtotal: number;
}

interface SaleFeedback {
  success: boolean;
  title: string;
  message: string;
}

@Component({
  selector: 'app-sales-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <section class="space-y-8 animate-fade-up">
      <!-- Encabezado de página -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-semibold tracking-tight text-[#fafafa]">
            Nota de venta
          </h1>
          <p class="mt-1 text-[13px] text-[#a1a1aa]">
            Arma una nota con cajas completas, productos sueltos o ambas opciones.
          </p>
        </div>
        <div
          class="w-9 h-9 rounded-[8px] grid place-items-center bg-[#111111] border border-[#262626] text-[#a1a1aa] shrink-0"
          aria-hidden="true"
        >
          <lucide-icon [img]="icons.ReceiptText" [size]="18" [strokeWidth]="1.5"></lucide-icon>
        </div>
      </div>

      <!-- Tarjetas de Resumen de la Nota en curso -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Artículos en la nota</span>
            <lucide-icon
              [img]="icons.ShoppingBag"
              [size]="16"
              [strokeWidth]="1.5"
              class="text-[#a1a1aa]"
            ></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ summaryLines().length }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            {{
              summaryLines().length === 1
                ? '1 línea activa'
                : summaryLines().length + ' líneas activas'
            }}
          </p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Unidades totales</span>
            <lucide-icon
              [img]="icons.Boxes"
              [size]="16"
              [strokeWidth]="1.5"
              class="text-[#a1a1aa]"
            ></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatQuantity(totalUnits()) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">Cajas convertidas + sueltos</p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Total estimado nota</span>
            <lucide-icon
              [img]="icons.DollarSign"
              [size]="16"
              [strokeWidth]="1.5"
              class="text-[#a1a1aa]"
            ></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatMoney(saleTotal()) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">Descuento FEFO automático</p>
        </article>
      </div>

      <!-- Selección de Vendedor y Bodega -->
      <div class="glass-panel p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="field-label">Vendedor</span>
          <select
            id="sale-seller"
            name="seller"
            class="glass-input"
            [ngModel]="selectedSeller()"
            (ngModelChange)="selectedSeller.set($event)"
            required
          >
            <option value="">
              {{ sellers().length ? 'Selecciona una opción' : 'No hay vendedores disponibles' }}
            </option>
            @for (s of sellers(); track s.id_usuario) {
              <option [value]="String(s.id_usuario)">{{ s.nombre }}</option>
            }
          </select>
        </label>

        <label class="block">
          <span class="field-label">Bodega de salida</span>
          <select
            id="sale-warehouse"
            name="warehouse"
            class="glass-input"
            [ngModel]="selectedWarehouse()"
            (ngModelChange)="onWarehouseChange($event)"
            required
          >
            <option value="">
              {{ warehouses().length ? 'Selecciona una opción' : 'No hay bodegas disponibles' }}
            </option>
            @for (w of warehouses(); track w.id_bodega) {
              <option [value]="String(w.id_bodega)">{{ w.nombre }}</option>
            }
          </select>
        </label>
      </div>

      <!-- Filtros de productos para la venta -->
      <form
        id="sale-filter"
        class="glass-panel p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_240px_auto_auto] gap-3 items-end"
        (ngSubmit)="onFilterSubmit()"
      >
        <label class="block">
          <span class="field-label">Buscar producto</span>
          <div class="input-icon-wrap">
            <span class="input-icon" aria-hidden="true">
              <lucide-icon [img]="icons.Search" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </span>
            <input
              id="sale-query"
              name="query"
              type="search"
              [(ngModel)]="queryInput"
              placeholder="Artículo o código I/B"
              autocomplete="off"
              class="glass-input has-icon pl-10"
            />
          </div>
        </label>

        <label class="block">
          <span class="field-label">Categoría</span>
          <select
            id="sale-category"
            name="category"
            class="glass-input"
            [(ngModel)]="categoryInput"
            (ngModelChange)="onCategoryChange()"
          >
            <option value="">Todas las categorías</option>
            @for (cat of categories(); track cat) {
              <option [value]="cat">{{ cat }}</option>
            }
          </select>
        </label>

        <button type="submit" class="btn btn-primary w-full lg:w-auto">
          <span>Buscar</span>
        </button>

        <button
          id="sale-clear-filter"
          type="button"
          class="btn btn-ghost w-full lg:w-auto"
          (click)="onClearFilter()"
        >
          <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
          <span>Limpiar</span>
        </button>
      </form>

      <!-- Catálogo para esta venta -->
      <section class="glass-panel overflow-hidden" aria-labelledby="sale-products-heading">
        <div
          class="p-5 flex items-center justify-between gap-4 border-b border-[#262626]"
        >
          <div>
            <h2 id="sale-products-heading" class="text-[15px] font-semibold text-[#fafafa]">
              Catálogo para esta venta
            </h2>
            <p id="sale-catalog-caption" class="text-[12px] text-[#a1a1aa] mt-0.5">
              {{ catalogCaption() }}
            </p>
          </div>
          <span class="badge">CAJAS Y SUELTOS</span>
        </div>

        @if (!selectedWarehouse()) {
          <div class="py-16 px-4 text-center text-[13px] text-[#a1a1aa]">
            Selecciona una bodega para consultar su stock.
          </div>
        } @else if (loading()) {
          <div class="py-16 px-4 text-center text-[13px] text-[#a1a1aa]">
            Cargando productos…
          </div>
        } @else if (catalogError()) {
          <div class="py-16 px-4 text-center text-[13px] text-[#fafafa] font-medium">
            {{ catalogError() }}
          </div>
        } @else if (items().length === 0) {
          <div class="py-16 px-4 text-center text-[13px] text-[#a1a1aa]">
            No hay productos disponibles para esos filtros.
          </div>
        } @else {
          <!-- Tabla en Escritorio (md+) -->
          <div class="hidden md:block overflow-x-auto scroll-area">
            <table class="data-table min-w-[850px]">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="num">Precio unitario</th>
                  <th class="num">Disponible</th>
                  <th class="num">Capacidad</th>
                  <th class="num">Cajas</th>
                  <th class="num">Sueltos</th>
                </tr>
              </thead>
              <tbody id="sale-product-rows">
                @for (product of items(); track product.sku) {
                  <tr>
                    <td>
                      <span class="block font-medium text-[#fafafa]">{{ product.nombre }}</span>
                      <small class="block text-[11px] font-mono text-[#a1a1aa] mt-0.5">
                        {{ product.sku }}
                      </small>
                    </td>
                    <td class="num font-medium text-[#fafafa]">
                      {{ formatMoney(product.precio_vigente) }}
                    </td>
                    <td class="num">
                      <span
                        class="badge"
                        [ngClass]="
                          Number(product.disponible) < 10 ? 'badge-rose' : 'badge-emerald'
                        "
                      >
                        {{ formatQuantity(product.disponible) }}
                      </span>
                    </td>
                    <td class="num text-[#a1a1aa]">
                      {{ formatQuantity(product.unidades_por_caja) }} por caja
                    </td>
                    <td class="num">
                      <input
                        type="number"
                        min="0"
                        [max]="maxBoxes(product)"
                        step="1"
                        class="glass-input qty-input"
                        [attr.aria-label]="'Cajas de ' + product.nombre"
                        [ngModel]="getBoxesValue(product.sku)"
                        (ngModelChange)="onBoxesInput(product, $event)"
                      />
                    </td>
                    <td class="num">
                      <input
                        type="number"
                        min="0"
                        [max]="Number(product.disponible || 0)"
                        [step]="looseStep(product)"
                        class="glass-input qty-input"
                        [attr.aria-label]="'Unidades sueltas de ' + product.nombre"
                        [ngModel]="getLooseValue(product.sku)"
                        (ngModelChange)="onLooseInput(product, $event)"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Tarjetas en Móvil (< md) -->
          <div class="grid md:hidden gap-3 p-4">
            @for (product of items(); track product.sku) {
              <article class="glass-subtle p-4 space-y-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <h3 class="text-[14px] font-semibold text-[#fafafa]">{{ product.nombre }}</h3>
                    <span class="text-[12px] font-mono text-[#a1a1aa]">{{ product.sku }}</span>
                  </div>
                  <span
                    class="badge shrink-0"
                    [ngClass]="Number(product.disponible) < 10 ? 'badge-rose' : 'badge-emerald'"
                  >
                    Disp: {{ formatQuantity(product.disponible) }}
                  </span>
                </div>

                <div class="flex items-center justify-between text-[12px] text-[#a1a1aa]">
                  <span>
                    Precio:
                    <strong class="text-[#fafafa]">
                      {{ formatMoney(product.precio_vigente) }}
                    </strong>
                  </span>
                  <span>{{ formatQuantity(product.unidades_por_caja) }} por caja</span>
                </div>

                <div class="grid grid-cols-2 gap-3 pt-2 border-t border-[#1f1f1f]">
                  <label class="block">
                    <span class="field-label">Cajas</span>
                    <input
                      type="number"
                      min="0"
                      [max]="maxBoxes(product)"
                      step="1"
                      class="glass-input tabular-nums"
                      [attr.aria-label]="'Cajas de ' + product.nombre"
                      [ngModel]="getBoxesValue(product.sku)"
                      (ngModelChange)="onBoxesInput(product, $event)"
                    />
                  </label>
                  <label class="block">
                    <span class="field-label">Sueltos</span>
                    <input
                      type="number"
                      min="0"
                      [max]="Number(product.disponible || 0)"
                      [step]="looseStep(product)"
                      class="glass-input tabular-nums"
                      [attr.aria-label]="'Unidades sueltas de ' + product.nombre"
                      [ngModel]="getLooseValue(product.sku)"
                      (ngModelChange)="onLooseInput(product, $event)"
                    />
                  </label>
                </div>
              </article>
            }
          </div>
        }

        <!-- Paginación del catálogo de ventas -->
        <div
          class="px-5 py-3.5 border-t border-[#262626] flex items-center justify-between gap-4 text-[12px] text-[#a1a1aa]"
        >
          <span id="sale-page-label">{{ pageLabel() }}</span>
          <div class="flex items-center gap-2">
            <button
              id="sale-prev"
              type="button"
              class="btn btn-ghost btn-sm btn-icon"
              aria-label="Página anterior"
              [disabled]="offset() <= 0 || loading()"
              (click)="prevPage()"
            >
              <lucide-icon [img]="icons.ChevronLeft" [size]="16" [strokeWidth]="1.5"></lucide-icon>
            </button>
            <button
              id="sale-next"
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

      <!-- Sumario Pre-Venta -->
      <section class="glass-panel overflow-hidden" aria-labelledby="sale-summary-heading">
        <div
          class="p-5 flex items-center justify-between gap-4 border-b border-[#262626]"
        >
          <div>
            <h2 id="sale-summary-heading" class="text-[15px] font-semibold text-[#fafafa]">
              Sumario pre venta
            </h2>
            <p class="text-[12px] text-[#a1a1aa] mt-0.5">
              Solo aparecen los productos con cantidades seleccionadas.
            </p>
          </div>
          <span id="sale-line-count" class="badge">
            {{
              summaryLines().length === 1
                ? '1 PRODUCTO'
                : summaryLines().length + ' PRODUCTOS'
            }}
          </span>
        </div>

        @if (summaryLines().length === 0) {
          <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
            Agrega productos desde el catálogo.
          </div>
        } @else {
          <!-- Tabla sumario (Escritorio md+) -->
          <div class="hidden md:block overflow-x-auto scroll-area">
            <table class="data-table min-w-[740px]">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th class="num">Cajas</th>
                  <th class="num">Sueltos</th>
                  <th class="num">Cantidad total</th>
                  <th class="num">Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="sale-summary-rows">
                @for (line of summaryLines(); track line.sku) {
                  <tr>
                    <td>
                      <span class="block font-medium text-[#fafafa]">{{ line.nombre }}</span>
                      <small class="block text-[11px] font-mono text-[#a1a1aa] mt-0.5">
                        {{ line.sku }}
                      </small>
                    </td>
                    <td class="num">{{ formatQuantity(line.cajas) }}</td>
                    <td class="num">{{ formatQuantity(line.sueltos) }}</td>
                    <td class="num font-medium text-[#fafafa]">
                      {{ formatQuantity(line.cantidad_total) }}
                    </td>
                    <td class="num font-semibold text-[#fafafa]">
                      {{ formatMoney(line.subtotal) }}
                    </td>
                    <td class="text-right">
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        (click)="removeLine(line.sku)"
                      >
                        <lucide-icon [img]="icons.Trash2" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                        <span>Quitar</span>
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Tarjetas sumario (Móvil < md) -->
          <div class="grid md:hidden gap-3 p-4">
            @for (line of summaryLines(); track line.sku) {
              <article class="glass-subtle p-4 flex items-center justify-between gap-3">
                <div class="space-y-1">
                  <h3 class="text-[14px] font-semibold text-[#fafafa]">{{ line.nombre }}</h3>
                  <p class="text-[12px] font-mono text-[#a1a1aa]">{{ line.sku }}</p>
                  <p class="text-[12px] text-[#a1a1aa]">
                    Cajas: <strong class="text-[#fafafa]">{{ formatQuantity(line.cajas) }}</strong> ·
                    Sueltos: <strong class="text-[#fafafa]">{{ formatQuantity(line.sueltos) }}</strong> ·
                    Total:
                    <strong class="text-[#fafafa]">{{ formatQuantity(line.cantidad_total) }}</strong>
                  </p>
                  <p class="text-[14px] font-semibold text-[#fafafa] tabular-nums">
                    {{ formatMoney(line.subtotal) }}
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost shrink-0"
                  (click)="removeLine(line.sku)"
                >
                  <lucide-icon [img]="icons.Trash2" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                  <span>Quitar</span>
                </button>
              </article>
            }
          </div>
        }

        <!-- Total nota -->
        <div
          class="px-5 py-4 border-t border-[#262626] flex items-center justify-end gap-5"
        >
          <span class="text-[12px] uppercase tracking-wider text-[#a1a1aa] font-medium">
            Total nota
          </span>
          <strong
            id="sale-total"
            class="text-[22px] font-semibold text-[#fafafa] tabular-nums"
          >
            {{ formatMoney(saleTotal()) }}
          </strong>
        </div>

        <!-- Botón de confirmación -->
        <div
          class="p-5 border-t border-[#262626] flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <p class="hint max-w-xl">
            Al registrar la nota se descuenta el inventario de la bodega seleccionada y se registra
            cada salida en Movimientos.
          </p>
          <button
            id="sale-submit"
            type="button"
            class="btn btn-primary w-full sm:w-auto"
            [disabled]="summaryLines().length === 0 || submitting() || !selectedSeller() || !selectedWarehouse()"
            (click)="submitSaleNote()"
          >
            <span>{{ submitting() ? 'Registrando nota…' : 'Registrar nota de venta' }}</span>
            <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
          </button>
        </div>
      </section>

      <!-- Resultado del registro de la nota -->
      @if (feedback(); as fb) {
        <div
          id="sale-result"
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
    </section>
  `,
})
export class SalesPageComponent implements OnInit {
  private readonly api = inject(GhoshApiService);

  readonly pageSize = PAGE_SIZE;
  readonly Number = Number;
  readonly String = String;
  readonly formatMoney = formatMoney;
  readonly formatQuantity = formatQuantity;

  readonly icons = {
    ReceiptText,
    ShoppingBag,
    Boxes,
    DollarSign,
    Warehouse,
    Search,
    X,
    ChevronLeft,
    ChevronRight,
    Trash2,
    ArrowRight,
    CheckCircle2,
    AlertTriangle,
  };

  readonly sellers = signal<UserOption[]>([]);
  readonly warehouses = signal<WarehouseOption[]>([]);
  readonly selectedSeller = signal('');
  readonly selectedWarehouse = signal('');

  queryInput = '';
  categoryInput = '';

  readonly categories = signal<string[]>([]);
  readonly items = signal<CatalogProduct[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly loading = signal(false);
  readonly submitting = signal(false);
  readonly catalogError = signal<string | null>(null);
  readonly feedback = signal<SaleFeedback | null>(null);

  private readonly productCache = new Map<string, CatalogProduct>();
  readonly selection = signal<Record<string, SelectedQty>>({});

  readonly summaryLines = computed<SummaryLine[]>(() => {
    const sel = this.selection();
    const lines: SummaryLine[] = [];
    for (const [sku, values] of Object.entries(sel)) {
      const boxes = Number(values.cajas) || 0;
      const loose = Number(values.sueltos) || 0;
      if (boxes <= 0 && loose <= 0) continue;
      const product = this.productCache.get(sku);
      if (!product) continue;
      const packSize = Number(product.unidades_por_caja) || 1;
      const quantityTotal = boxes * packSize + loose;
      const subtotal = Math.round(Number(product.precio_vigente) * quantityTotal * 100) / 100;
      lines.push({
        sku,
        nombre: product.nombre,
        cajas: boxes,
        sueltos: loose,
        unidades_por_caja: packSize,
        cantidad_total: quantityTotal,
        subtotal,
      });
    }
    return lines;
  });

  readonly saleTotal = computed(() =>
    this.summaryLines().reduce((acc, line) => acc + line.subtotal, 0),
  );

  readonly totalUnits = computed(() =>
    this.summaryLines().reduce((acc, line) => acc + line.cantidad_total, 0),
  );

  readonly catalogCaption = computed(() => {
    if (!this.selectedWarehouse()) return 'Selecciona cantidades por producto.';
    if (this.loading()) return 'Cargando productos…';
    if (this.catalogError()) return 'No fue posible cargar el catálogo';
    return `${formatQuantity(this.total())} productos en el catálogo`;
  });

  readonly pageLabel = computed(() => {
    const total = this.total();
    if (!total) return 'Sin resultados';
    const start = this.offset() + 1;
    const end = Math.min(this.offset() + PAGE_SIZE, total);
    return `Mostrando ${start}–${end} de ${total}`;
  });

  ngOnInit(): void {
    this.loadSaleOptions();
  }

  loadSaleOptions(): void {
    this.api.getSaleOptions().subscribe({
      next: (options) => {
        const sellers = options.vendedores ?? [];
        const warehouses = options.bodegas ?? [];
        this.sellers.set(sellers);
        this.warehouses.set(warehouses);

        if (sellers.length === 1) {
          this.selectedSeller.set(String(sellers[0].id_usuario));
        }
        if (warehouses.length === 1) {
          this.selectedWarehouse.set(String(warehouses[0].id_bodega));
          this.loadSalesCatalog();
        }
      },
      error: (err) => {
        this.feedback.set({
          success: false,
          title: 'No se cargaron las opciones',
          message: this.api.extractErrorMessage(
            err,
            'No se pudieron cargar vendedores y bodegas.',
          ),
        });
      },
    });
  }

  loadSalesCatalog(): void {
    const warehouseId = Number(this.selectedWarehouse());
    if (!warehouseId) {
      this.items.set([]);
      this.total.set(0);
      return;
    }

    this.loading.set(true);
    this.catalogError.set(null);

    this.api
      .getCatalogProducts({
        limit: PAGE_SIZE,
        offset: this.offset(),
        id_bodega: warehouseId,
        q: this.queryInput,
        categoria: this.categoryInput,
      })
      .subscribe({
        next: (result) => {
          const items = result.items ?? [];
          for (const product of items) {
            this.productCache.set(product.sku, product);
          }
          this.items.set(items);
          this.total.set(result.total ?? 0);
          this.categories.set(result.categories ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          this.items.set([]);
          this.total.set(0);
          this.loading.set(false);
          this.catalogError.set(
            this.api.extractErrorMessage(err, 'No se pudo conectar con la API.'),
          );
        },
      });
  }

  onWarehouseChange(value: string): void {
    this.selectedWarehouse.set(value);
    this.selection.set({});
    this.offset.set(0);
    this.loadSalesCatalog();
  }

  onFilterSubmit(): void {
    this.offset.set(0);
    this.loadSalesCatalog();
  }

  onCategoryChange(): void {
    this.offset.set(0);
    this.loadSalesCatalog();
  }

  onClearFilter(): void {
    this.queryInput = '';
    this.categoryInput = '';
    this.offset.set(0);
    this.loadSalesCatalog();
  }

  prevPage(): void {
    this.offset.update((current) => Math.max(0, current - PAGE_SIZE));
    this.loadSalesCatalog();
  }

  nextPage(): void {
    if (this.offset() + PAGE_SIZE < this.total()) {
      this.offset.update((current) => current + PAGE_SIZE);
      this.loadSalesCatalog();
    }
  }

  maxBoxes(product: CatalogProduct): number {
    const available = Number(product.disponible ?? 0);
    const pack = Number(product.unidades_por_caja || 1);
    return Math.max(0, Math.floor(available / pack));
  }

  looseStep(product: CatalogProduct): string {
    return String(10 ** -Number(product.decimales || 0));
  }

  getBoxesValue(sku: string): number | string {
    const entry = this.selection()[sku];
    return entry?.cajas ? entry.cajas : '';
  }

  getLooseValue(sku: string): number | string {
    const entry = this.selection()[sku];
    return entry?.sueltos ? entry.sueltos : '';
  }

  onBoxesInput(product: CatalogProduct, rawValue: number | string | null): void {
    this.productCache.set(product.sku, product);
    const boxes = Math.max(0, Math.floor(Number(rawValue) || 0));
    this.selection.update((curr) => {
      const existing = curr[product.sku] ?? { cajas: 0, sueltos: 0 };
      return { ...curr, [product.sku]: { ...existing, cajas: boxes } };
    });
  }

  onLooseInput(product: CatalogProduct, rawValue: number | string | null): void {
    this.productCache.set(product.sku, product);
    const loose = Math.max(0, Number(rawValue) || 0);
    this.selection.update((curr) => {
      const existing = curr[product.sku] ?? { cajas: 0, sueltos: 0 };
      return { ...curr, [product.sku]: { ...existing, sueltos: loose } };
    });
  }

  removeLine(sku: string): void {
    this.selection.update((curr) => {
      const next = { ...curr };
      delete next[sku];
      return next;
    });
  }

  submitSaleNote(): void {
    const lines = this.summaryLines();
    if (!lines.length || !this.selectedSeller() || !this.selectedWarehouse()) return;

    this.submitting.set(true);
    this.feedback.set(null);

    this.api
      .registerSaleNote({
        id_vendedor: Number(this.selectedSeller()),
        id_bodega: Number(this.selectedWarehouse()),
        items: lines.map((line) => ({
          sku: line.sku,
          cajas: Number(line.cajas) || 0,
          sueltos: String(Number(line.sueltos) || 0),
        })),
      })
      .subscribe({
        next: (data) => {
          this.submitting.set(false);
          this.feedback.set({
            success: true,
            title: `Nota de venta #${data.id_nota_venta} registrada`,
            message: `Vendedor: ${data.vendedor} · Bodega: ${data.bodega} · Total: ${formatMoney(
              data.total,
            )}. El stock y los movimientos quedaron actualizados.`,
          });
          this.selection.set({});
          this.loadSalesCatalog();
        },
        error: (err) => {
          this.submitting.set(false);
          this.feedback.set({
            success: false,
            title: 'No se pudo registrar',
            message: this.api.extractErrorMessage(
              err,
              'No se pudo registrar la nota de venta.',
            ),
          });
        },
      });
  }
}
