import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AlertTriangle,
  ArrowRight,
  BookmarkPlus,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  FileDown,
  LucideAngularModule,
  MapPin,
  ReceiptText,
  Search,
  ShoppingBag,
  Trash2,
  Warehouse,
  X,
} from 'lucide-angular';

import { formatChileDate, formatMoney, formatQuantity } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import {
  CatalogProduct,
  FrequentClientOption,
  SaleNoteRecord,
  UserOption,
  WarehouseOption,
} from '../../core/models';

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
  pdfNumber?: number;
}

@Component({
  selector: 'app-sales-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
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

      <!-- Selección de Vendedor, Bodega, Cliente frecuente y Dirección de entrega -->
      <div class="glass-panel p-5 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

          <label class="block">
            <span class="field-label">Cliente frecuente (alias guardado)</span>
            <select
              id="sale-frequent-client"
              name="frequentClient"
              class="glass-input"
              [ngModel]="selectedClientId()"
              (ngModelChange)="onFrequentClientSelect($event)"
            >
              <option value="">
                {{
                  frequentClients().length
                    ? 'Ingreso manual / nuevo cliente'
                    : 'Sin clientes guardados (ingreso manual)'
                }}
              </option>
              @for (c of frequentClients(); track c.id_cliente) {
                <option [value]="String(c.id_cliente)">
                  {{ c.nombre_local }}{{ c.direccion ? ' · ' + c.direccion : '' }}
                </option>
              }
            </select>
          </label>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 pt-3 border-t border-[#1f1f1f]">
          <label class="block">
            <span class="field-label">Nombre o alias del negocio</span>
            <input
              id="sale-local"
              name="nombre_local"
              type="text"
              maxlength="120"
              [(ngModel)]="localNameInput"
              placeholder="Ej. Minimarket Don Pepe (o Venta en local)"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label flex items-center gap-1.5">
              <lucide-icon [img]="icons.MapPin" [size]="13" [strokeWidth]="1.5"></lucide-icon>
              <span>Dirección de entrega exacta</span>
            </span>
            <input
              id="sale-address"
              name="direccion_entrega"
              type="text"
              maxlength="250"
              [(ngModel)]="deliveryAddressInput"
              placeholder="Ej. Calle 1 Sur 845, local 2, Talca"
              class="glass-input"
            />
          </label>
        </div>

        @if (!selectedClientId() && deliveryAddressInput.trim().length > 0) {
          <div
            id="sale-frequent-prompt"
            class="glass-subtle p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-[#262626]"
          >
            <div class="flex items-start gap-2.5 text-[12px]">
              <lucide-icon
                [img]="icons.BookmarkPlus"
                [size]="16"
                [strokeWidth]="1.5"
                class="text-[#fafafa] mt-0.5 shrink-0"
              ></lucide-icon>
              <div>
                <strong class="text-[#fafafa] block">
                  ¿Guardar esta dirección como cliente frecuente?
                </strong>
                <span class="text-[#a1a1aa]">
                  @if (saveFrequentChoice() === 'si') {
                    Se guardará con el nombre/alias "{{ localNameInput.trim() || 'indica un alias arriba' }}" para seleccionarlo rápido en futuras ventas.
                  } @else {
                    Elige "Sí" para guardarla bajo un alias o "No" para usarla solo en esta nota.
                  }
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button
                id="sale-save-client-yes"
                type="button"
                class="btn btn-sm"
                [ngClass]="saveFrequentChoice() === 'si' ? 'btn-primary' : 'btn-ghost'"
                (click)="saveFrequentChoice.set('si')"
              >
                Sí, guardar
              </button>
              <button
                id="sale-save-client-no"
                type="button"
                class="btn btn-sm"
                [ngClass]="saveFrequentChoice() === 'no' ? 'btn-primary' : 'btn-ghost'"
                (click)="saveFrequentChoice.set('no')"
              >
                No, solo esta vez
              </button>
            </div>
          </div>
        }
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
          <!-- Tabla en Escritorio (lg+) -->
          <div class="desktop-only-view overflow-x-auto scroll-area">
            <table class="data-table min-w-[920px]">
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
                      <div class="qty-stepper w-[144px]">
                        <button
                          type="button"
                          class="qty-stepper-btn"
                          [attr.aria-label]="'Restar caja de ' + product.nombre"
                          [disabled]="Number(getBoxesValue(product.sku) || 0) <= 0"
                          (click)="stepBoxes(product, -1)"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          [max]="maxBoxesForProduct(product)"
                          step="1"
                          class="qty-stepper-input"
                          [attr.aria-label]="'Cajas de ' + product.nombre"
                          [ngModel]="getBoxesValue(product.sku)"
                          (ngModelChange)="onBoxesInput(product, $event)"
                        />
                        <button
                          type="button"
                          class="qty-stepper-btn"
                          [attr.aria-label]="'Sumar caja de ' + product.nombre"
                          [disabled]="Number(getBoxesValue(product.sku) || 0) >= maxBoxesForProduct(product)"
                          (click)="stepBoxes(product, 1)"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td class="num">
                      <div class="qty-stepper w-[144px]">
                        <button
                          type="button"
                          class="qty-stepper-btn"
                          [attr.aria-label]="'Restar sueltos de ' + product.nombre"
                          [disabled]="Number(getLooseValue(product.sku) || 0) <= 0"
                          (click)="stepLoose(product, -1)"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          [max]="maxLooseForProduct(product)"
                          [step]="looseStep(product)"
                          class="qty-stepper-input"
                          [attr.aria-label]="'Unidades sueltas de ' + product.nombre"
                          [ngModel]="getLooseValue(product.sku)"
                          (ngModelChange)="onLooseInput(product, $event)"
                        />
                        <button
                          type="button"
                          class="qty-stepper-btn"
                          [attr.aria-label]="'Sumar sueltos de ' + product.nombre"
                          [disabled]="Number(getLooseValue(product.sku) || 0) >= maxLooseForProduct(product)"
                          (click)="stepLoose(product, 1)"
                        >
                          +
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Tarjetas Táctiles para Redmi Pad SE 11" Vertical / Móvil -->
          <div class="tablet-only-view grid-cols-1 sm:grid-cols-2 gap-3.5 p-4">
            @for (product of items(); track product.sku) {
              <article
                class="glass-subtle p-4 space-y-3 flex flex-col justify-between"
                [class.border-[#52525b]]="lineUnits(product) > 0"
              >
                <div class="space-y-2">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <h3 class="text-[14px] font-semibold text-[#fafafa] leading-snug">{{ product.nombre }}</h3>
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
                    <span>{{ formatQuantity(product.unidades_por_caja) }} u / caja</span>
                  </div>
                </div>

                <div class="space-y-2.5 pt-2.5 border-t border-[#1f1f1f]">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-[12px] font-medium text-[#d4d4d8] shrink-0">Cajas</span>
                    <div class="qty-stepper max-w-[180px]">
                      <button
                        type="button"
                        class="qty-stepper-btn"
                        [attr.aria-label]="'Restar caja de ' + product.nombre"
                        [disabled]="Number(getBoxesValue(product.sku) || 0) <= 0"
                        (click)="stepBoxes(product, -1)"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputmode="numeric"
                        min="0"
                        [max]="maxBoxesForProduct(product)"
                        step="1"
                        class="qty-stepper-input"
                        [attr.aria-label]="'Cajas de ' + product.nombre"
                        [ngModel]="getBoxesValue(product.sku)"
                        (ngModelChange)="onBoxesInput(product, $event)"
                      />
                      <button
                        type="button"
                        class="qty-stepper-btn"
                        [attr.aria-label]="'Sumar caja de ' + product.nombre"
                        [disabled]="Number(getBoxesValue(product.sku) || 0) >= maxBoxesForProduct(product)"
                        (click)="stepBoxes(product, 1)"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  <div class="flex items-center justify-between gap-3">
                    <span class="text-[12px] font-medium text-[#d4d4d8] shrink-0">Sueltos</span>
                    <div class="qty-stepper max-w-[180px]">
                      <button
                        type="button"
                        class="qty-stepper-btn"
                        [attr.aria-label]="'Restar sueltos de ' + product.nombre"
                        [disabled]="Number(getLooseValue(product.sku) || 0) <= 0"
                        (click)="stepLoose(product, -1)"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputmode="decimal"
                        min="0"
                        [max]="maxLooseForProduct(product)"
                        [step]="looseStep(product)"
                        class="qty-stepper-input"
                        [attr.aria-label]="'Unidades sueltas de ' + product.nombre"
                        [ngModel]="getLooseValue(product.sku)"
                        (ngModelChange)="onLooseInput(product, $event)"
                      />
                      <button
                        type="button"
                        class="qty-stepper-btn"
                        [attr.aria-label]="'Sumar sueltos de ' + product.nombre"
                        [disabled]="Number(getLooseValue(product.sku) || 0) >= maxLooseForProduct(product)"
                        (click)="stepLoose(product, 1)"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  @if (lineUnits(product) > 0) {
                    <div class="pt-1.5 flex items-center justify-between text-[12px] text-[#fafafa] border-t border-[#1f1f1f]/80">
                      <span class="text-[#a1a1aa]">En esta nota</span>
                      <strong class="tabular-nums">
                        {{ formatQuantity(lineUnits(product)) }} u · {{ formatMoney(lineSubtotal(product)) }}
                      </strong>
                    </div>
                  }
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
          <!-- Tabla sumario (Escritorio lg+) -->
          <div class="desktop-only-view overflow-x-auto scroll-area">
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

          <!-- Tarjetas sumario (Redmi Pad SE 11" Vertical / Móvil) -->
          <div class="tablet-only-view grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            @for (line of summaryLines(); track line.sku) {
              <article class="glass-subtle p-4 space-y-2.5">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <h3 class="text-[14px] font-semibold text-[#fafafa] leading-snug">{{ line.nombre }}</h3>
                    <p class="text-[12px] font-mono text-[#a1a1aa]">{{ line.sku }}</p>
                  </div>
                  <strong class="text-[15px] font-semibold text-[#fafafa] tabular-nums shrink-0">
                    {{ formatMoney(line.subtotal) }}
                  </strong>
                </div>

                <p class="text-[12px] text-[#a1a1aa]">
                  Cajas: <strong class="text-[#fafafa]">{{ formatQuantity(line.cajas) }}</strong> ·
                  Sueltos: <strong class="text-[#fafafa]">{{ formatQuantity(line.sueltos) }}</strong> ·
                  Total: <strong class="text-[#fafafa]">{{ formatQuantity(line.cantidad_total) }} u</strong>
                </p>

                <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1f1f1f]">
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost min-h-[44px]"
                    (click)="stepSummaryBoxes(line.sku, -1)"
                  >
                    −1 cj
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost min-h-[44px]"
                    (click)="stepSummaryBoxes(line.sku, 1)"
                  >
                    +1 cj
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost min-h-[44px]"
                    (click)="stepSummaryLoose(line.sku, 1)"
                  >
                    +1 suelto
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost min-h-[44px] ml-auto"
                    (click)="removeLine(line.sku)"
                  >
                    <lucide-icon [img]="icons.Trash2" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                    <span>Quitar</span>
                  </button>
                </div>
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
            Al registrar la nota se reserva el inventario por FEFO, se genera el pedido activo en
            Pedidos y se audita la operación en Movimientos.
          </p>
          <button
            id="sale-submit"
            type="button"
            class="btn btn-primary w-full sm:w-auto min-h-[48px] px-6 text-[14px]"
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
          class="glass-panel p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 border border-[#262626]"
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
          <div class="flex items-center gap-2 shrink-0">
            @if (fb.pdfNumber) {
              <a
                id="sale-result-pdf"
                [href]="api.getSaleNotePdfUrl(fb.pdfNumber)"
                target="_blank"
                rel="noopener"
                class="btn btn-sm btn-primary inline-flex items-center gap-1.5 no-underline"
              >
                <lucide-icon [img]="icons.FileDown" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                <span>Exportar PDF</span>
              </a>
            }
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-icon shrink-0"
              aria-label="Cerrar aviso"
              (click)="feedback.set(null)"
            >
              <lucide-icon [img]="icons.X" [size]="14" [strokeWidth]="1.5"></lucide-icon>
            </button>
          </div>
        </div>
      }

      <!-- Vista rápida de notas emitidas -->
      <section class="glass-panel overflow-hidden" aria-labelledby="sale-notes-history-heading">
        <div
          class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626]"
        >
          <div>
            <h2 id="sale-notes-history-heading" class="text-[15px] font-semibold text-[#fafafa]">
              Últimas notas de venta emitidas
            </h2>
            <p class="text-[12px] text-[#a1a1aa] mt-0.5">
              {{ notesCaption() }} ·
              <a routerLink="/notas-venta" class="text-[#fafafa] underline underline-offset-2">
                Ir a Auditoría contable completa
              </a>
            </p>
          </div>
          <form
            class="flex items-center gap-2 w-full sm:w-auto"
            (ngSubmit)="onNotesSearch()"
          >
            <input
              id="sale-notes-query"
              name="notesQuery"
              type="search"
              [(ngModel)]="notesQueryInput"
              placeholder="Buscar N° nota, local, SKU..."
              class="glass-input sm:w-64"
            />
            <button type="submit" class="btn btn-ghost btn-sm shrink-0">Buscar</button>
            @if (notesQueryInput) {
              <button type="button" class="btn btn-ghost btn-sm shrink-0" (click)="onNotesClear()">
                Limpiar
              </button>
            }
          </form>
        </div>

        @if (notesLoading()) {
          <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
            Cargando notas de venta…
          </div>
        } @else if (notesError()) {
          <div class="py-12 px-4 text-center text-[13px] text-[#fafafa] font-medium">
            {{ notesError() }}
          </div>
        } @else if (saleNotes().length === 0) {
          <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
            Todavía no hay notas de venta registradas para esos filtros.
          </div>
        } @else {
          <div class="desktop-only-view overflow-x-auto scroll-area">
            <table class="data-table min-w-[920px]">
              <thead>
                <tr>
                  <th>Nota N°</th>
                  <th>Fecha</th>
                  <th>Vendedor / Bodega / Local</th>
                  <th>Pedido</th>
                  <th>Detalle</th>
                  <th class="num">Total</th>
                  <th class="text-right">PDF</th>
                </tr>
              </thead>
              <tbody id="sale-notes-rows">
                @for (note of saleNotes(); track note.id_nota_venta) {
                  <tr>
                    <td class="font-mono font-semibold text-[#fafafa] whitespace-nowrap">
                      N° {{ note.numero }}
                    </td>
                    <td class="text-[12px] text-[#a1a1aa] whitespace-nowrap">
                      {{ formatChileDate(note.fecha_creacion) }}
                    </td>
                    <td>
                      <span class="block font-medium text-[#fafafa]">{{ note.nombre_local }}</span>
                      @if (note.direccion_entrega) {
                        <small class="block text-[11px] text-[#a1a1aa] mt-0.5">
                          {{ note.direccion_entrega }}
                        </small>
                      }
                      <small class="block text-[11px] text-[#a1a1aa] mt-0.5">
                        {{ note.vendedor }} · {{ note.bodega }}
                      </small>
                    </td>
                    <td>
                      @if (note.id_pedido) {
                        <span
                          class="badge capitalize"
                          [ngClass]="
                            note.estado_pedido === 'pendiente'
                              ? 'badge-amber'
                              : note.estado_pedido === 'cancelado'
                                ? 'badge-rose'
                                : 'badge-emerald'
                          "
                        >
                          Pedido #{{ note.id_pedido }} · {{ note.estado_pedido }}
                        </span>
                      } @else {
                        <span class="text-[12px] text-[#a1a1aa]">—</span>
                      }
                    </td>
                    <td>
                      <div class="space-y-1 max-w-[320px]">
                        @for (line of note.items; track line.sku) {
                          <div class="text-[12px] text-[#fafafa] flex items-center justify-between gap-2">
                            <span class="truncate">{{ line.nombre }}</span>
                            <span class="font-mono text-[#a1a1aa] shrink-0">
                              {{ formatQuantity(line.cantidad_total) }} u.
                            </span>
                          </div>
                        }
                      </div>
                    </td>
                    <td class="num font-semibold text-[#fafafa] whitespace-nowrap">
                      {{ formatMoney(note.total) }}
                    </td>
                    <td class="text-right whitespace-nowrap">
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
                }
              </tbody>
            </table>
          </div>

          <div class="tablet-only-view grid-cols-1 sm:grid-cols-2 gap-3 p-4">
            @for (note of saleNotes(); track note.id_nota_venta) {
              <article class="glass-subtle p-4 space-y-2.5 flex flex-col justify-between">
                <div class="space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <strong class="font-mono text-[14px] text-[#fafafa]">Nota N° {{ note.numero }}</strong>
                    <span
                      class="badge capitalize"
                      [ngClass]="note.estado_pedido === 'pendiente' ? 'badge-amber' : note.estado_pedido === 'cancelado' ? 'badge-rose' : 'badge-emerald'"
                    >
                      {{ note.id_pedido ? 'Pedido #' + note.id_pedido + ' · ' + note.estado_pedido : note.estado_pedido }}
                    </span>
                  </div>
                  <p class="text-[12px] text-[#a1a1aa]">
                    {{ note.nombre_local }} · {{ note.vendedor }} · {{ note.bodega }}
                  </p>
                  <p class="text-[11px] text-[#a1a1aa]">{{ formatChileDate(note.fecha_creacion) }}</p>
                  <div class="pt-2 border-t border-[#1f1f1f] space-y-1">
                    @for (line of note.items; track line.sku) {
                      <div class="flex items-center justify-between text-[12px]">
                        <span class="text-[#fafafa] truncate pr-2">{{ line.nombre }}</span>
                        <span class="font-mono text-[#a1a1aa]">{{ formatQuantity(line.cantidad_total) }} u.</span>
                      </div>
                    }
                  </div>
                </div>
                <div class="pt-2.5 border-t border-[#1f1f1f] flex items-center justify-between gap-3">
                  <strong class="text-[15px] text-[#fafafa] tabular-nums">{{ formatMoney(note.total) }}</strong>
                  <a
                    [href]="api.getSaleNotePdfUrl(note.numero)"
                    target="_blank"
                    rel="noopener"
                    class="btn btn-sm btn-ghost min-h-[44px] inline-flex items-center gap-1.5 no-underline"
                  >
                    <lucide-icon [img]="icons.FileDown" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                    <span>PDF</span>
                  </a>
                </div>
              </article>
            }
          </div>
        }
      </section>
    </section>
  `,
})
export class SalesPageComponent implements OnInit {
  readonly api = inject(GhoshApiService);

  readonly pageSize = PAGE_SIZE;
  readonly Number = Number;
  readonly String = String;
  readonly formatChileDate = formatChileDate;
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
    MapPin,
    BookmarkPlus,
    FileDown,
  };

  readonly sellers = signal<UserOption[]>([]);
  readonly warehouses = signal<WarehouseOption[]>([]);
  readonly frequentClients = signal<FrequentClientOption[]>([]);
  readonly selectedSeller = signal('');
  readonly selectedWarehouse = signal('');
  readonly selectedClientId = signal('');
  readonly saveFrequentChoice = signal<'si' | 'no'>('no');

  localNameInput = '';
  deliveryAddressInput = '';
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

  notesQueryInput = '';
  readonly saleNotes = signal<SaleNoteRecord[]>([]);
  readonly notesTotal = signal(0);
  readonly notesLoading = signal(false);
  readonly notesError = signal<string | null>(null);

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

  readonly notesCaption = computed(() => {
    if (this.notesLoading()) return 'Consultando vista de notas de venta…';
    if (this.notesError()) return 'No fue posible consultar las notas';
    const total = this.notesTotal();
    return total === 1
      ? '1 nota emitida registrada'
      : `${formatQuantity(total)} notas emitidas registradas`;
  });

  ngOnInit(): void {
    this.loadSaleOptions();
    this.loadSaleNotes();
  }

  loadSaleNotes(): void {
    this.notesLoading.set(true);
    this.notesError.set(null);

    this.api
      .getSaleNotes({
        q: this.notesQueryInput,
        limit: 20,
        offset: 0,
      })
      .subscribe({
        next: (res) => {
          this.saleNotes.set(res.items ?? []);
          this.notesTotal.set(res.total ?? 0);
          this.notesLoading.set(false);
        },
        error: (err) => {
          this.saleNotes.set([]);
          this.notesTotal.set(0);
          this.notesLoading.set(false);
          this.notesError.set(
            this.api.extractErrorMessage(err, 'No se pudieron consultar las notas de venta.'),
          );
        },
      });
  }

  onNotesSearch(): void {
    this.loadSaleNotes();
  }

  onNotesClear(): void {
    this.notesQueryInput = '';
    this.loadSaleNotes();
  }

  loadSaleOptions(): void {
    this.api.getSaleOptions().subscribe({
      next: (options) => {
        const sellers = options.vendedores ?? [];
        const warehouses = options.bodegas ?? [];
        this.sellers.set(sellers);
        this.warehouses.set(warehouses);
        this.frequentClients.set(options.clientes_frecuentes ?? []);

        if (sellers.length === 1 && !this.selectedSeller()) {
          this.selectedSeller.set(String(sellers[0].id_usuario));
        }
        if (warehouses.length === 1 && !this.selectedWarehouse()) {
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

  onFrequentClientSelect(clientId: string): void {
    this.selectedClientId.set(clientId);
    if (!clientId) {
      this.saveFrequentChoice.set('no');
      return;
    }
    const found = this.frequentClients().find((c) => String(c.id_cliente) === clientId);
    if (found) {
      this.localNameInput = found.nombre_local;
      this.deliveryAddressInput = found.direccion || '';
    }
    this.saveFrequentChoice.set('no');
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

  maxBoxesForProduct(product: CatalogProduct): number {
    const available = Number(product.disponible ?? 0);
    const pack = Number(product.unidades_por_caja || 1);
    const loose = Number(this.selection()[product.sku]?.sueltos || 0);
    return Math.max(0, Math.floor((available - loose) / pack));
  }

  maxLooseForProduct(product: CatalogProduct): number {
    const available = Number(product.disponible ?? 0);
    const pack = Number(product.unidades_por_caja || 1);
    const boxes = Number(this.selection()[product.sku]?.cajas || 0);
    const remaining = Math.max(0, available - boxes * pack);
    return Number(product.decimales || 0) > 0
      ? Math.round(remaining * 1000) / 1000
      : Math.floor(remaining);
  }

  looseStep(product: CatalogProduct): string {
    return String(10 ** -Number(product.decimales || 0));
  }

  lineUnits(product: CatalogProduct): number {
    const entry = this.selection()[product.sku];
    if (!entry) return 0;
    const pack = Number(product.unidades_por_caja || 1);
    return (Number(entry.cajas) || 0) * pack + (Number(entry.sueltos) || 0);
  }

  lineSubtotal(product: CatalogProduct): number {
    const units = this.lineUnits(product);
    return Math.round(Number(product.precio_vigente || 0) * units * 100) / 100;
  }

  getBoxesValue(sku: string): number | string {
    const entry = this.selection()[sku];
    return entry?.cajas ? entry.cajas : '';
  }

  getLooseValue(sku: string): number | string {
    const entry = this.selection()[sku];
    return entry?.sueltos ? entry.sueltos : '';
  }

  stepBoxes(product: CatalogProduct, delta: number): void {
    const current = Number(this.selection()[product.sku]?.cajas || 0);
    const next = Math.min(this.maxBoxesForProduct(product), Math.max(0, current + delta));
    this.onBoxesInput(product, next);
  }

  stepLoose(product: CatalogProduct, delta: number): void {
    const step = Number(this.looseStep(product)) || 1;
    const current = Number(this.selection()[product.sku]?.sueltos || 0);
    const rawNext = Math.max(0, current + delta * step);
    const clamped = Math.min(this.maxLooseForProduct(product), rawNext);
    const rounded = Number(product.decimales || 0) > 0 ? Math.round(clamped * 1000) / 1000 : Math.floor(clamped);
    this.onLooseInput(product, rounded);
  }

  stepSummaryBoxes(sku: string, delta: number): void {
    const product = this.productCache.get(sku);
    if (product) {
      this.stepBoxes(product, delta);
    }
  }

  stepSummaryLoose(sku: string, delta: number): void {
    const product = this.productCache.get(sku);
    if (product) {
      this.stepLoose(product, delta);
    }
  }

  onBoxesInput(product: CatalogProduct, rawValue: number | string | null): void {
    this.productCache.set(product.sku, product);
    const boxes = Math.min(this.maxBoxesForProduct(product), Math.max(0, Math.floor(Number(rawValue) || 0)));
    this.selection.update((curr) => {
      const existing = curr[product.sku] ?? { cajas: 0, sueltos: 0 };
      return { ...curr, [product.sku]: { ...existing, cajas: boxes } };
    });
  }

  onLooseInput(product: CatalogProduct, rawValue: number | string | null): void {
    this.productCache.set(product.sku, product);
    const loose = Math.min(this.maxLooseForProduct(product), Math.max(0, Number(rawValue) || 0));
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

    const manualAddress = this.deliveryAddressInput.trim();
    const alias = this.localNameInput.trim();
    const wantsToSaveFrequent =
      !this.selectedClientId() && manualAddress.length > 0 && this.saveFrequentChoice() === 'si';

    if (wantsToSaveFrequent && (!alias || alias.toLowerCase() === 'venta en local')) {
      this.feedback.set({
        success: false,
        title: 'Falta el nombre o alias del cliente',
        message:
          'Para guardar esta dirección como cliente frecuente, ingresa un nombre o alias de negocio distinto de "Venta en local".',
      });
      return;
    }

    this.submitting.set(true);
    this.feedback.set(null);

    this.api
      .registerSaleNote({
        id_vendedor: Number(this.selectedSeller()),
        id_bodega: Number(this.selectedWarehouse()),
        id_cliente: this.selectedClientId() ? Number(this.selectedClientId()) : null,
        nombre_local: alias || 'Venta en local',
        direccion_entrega: manualAddress || null,
        guardar_cliente_frecuente: wantsToSaveFrequent,
        items: lines.map((line) => ({
          sku: line.sku,
          cajas: Number(line.cajas) || 0,
          sueltos: String(Number(line.sueltos) || 0),
        })),
      })
      .subscribe({
        next: (data) => {
          this.submitting.set(false);
          const saleNumber = data.numero ?? data.id_nota_venta;
          const orderPart = data.id_pedido ? ` · Pedido #${data.id_pedido} (pendiente)` : '';
          const addressPart = data.direccion_entrega ? ` · Entrega: ${data.direccion_entrega}` : '';
          const savedClientPart = data.cliente_frecuente_guardado
            ? ` · Guardado en clientes frecuentes`
            : '';
          this.feedback.set({
            success: true,
            title: `Nota de venta N° ${saleNumber} registrada`,
            message: `Correlativo #${saleNumber}${orderPart} · Local: ${data.nombre_local || 'Venta en local'}${addressPart}${savedClientPart} · Total: ${formatMoney(
              data.total,
            )}.`,
            pdfNumber: saleNumber,
          });
          this.selectedClientId.set('');
          this.localNameInput = '';
          this.deliveryAddressInput = '';
          this.saveFrequentChoice.set('no');
          this.selection.set({});
          this.loadSaleOptions();
          this.loadSalesCatalog();
          this.loadSaleNotes();
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
