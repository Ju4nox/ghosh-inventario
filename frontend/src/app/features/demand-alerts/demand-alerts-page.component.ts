import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Boxes,
  Clock,
  DollarSign,
  FileDown,
  FileSpreadsheet,
  LucideAngularModule,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Warehouse,
  X,
} from 'lucide-angular';

import { formatChileDate, formatMoney, formatQuantity } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import {
  DemandRankingItem,
  DemandRankingSummary,
  InventoryAlertsSummary,
  LotAlertItem,
  StockAlertItem,
  WarehouseOption,
} from '../../core/models';

@Component({
  selector: 'app-demand-alerts-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LucideAngularModule],
  template: `
    <section class="space-y-8 animate-fade-up">
      <!-- Encabezado -->
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-semibold tracking-tight text-[#fafafa]">
            Demanda y alertas de control
          </h1>
          <p class="mt-1 text-[13px] text-[#a1a1aa]">
            Monitoreo en tiempo real de stock crítico y lotes por vencer o vencidos (GHOSH-19), junto al ranking de mayor y menor demanda por período con exportación CSV (GHOSH-18).
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2 shrink-0">
          @for (tab of viewTabs; track tab.value) {
            <button
              type="button"
              class="btn btn-sm"
              [ngClass]="activeView() === tab.value ? 'btn-primary' : 'btn-ghost'"
              (click)="activeView.set(tab.value)"
            >
              <span>{{ tab.label }}</span>
            </button>
          }
        </div>
      </div>

      <!-- ==================== SECCIÓN GHOSH-19: ALERTAS DE STOCK Y VENCIMIENTOS ==================== -->
      @if (activeView() === 'todos' || activeView() === 'alertas') {
        <section class="space-y-5" aria-labelledby="alerts-heading">
          <div class="flex items-center justify-between gap-3">
            <div>
              <h2 id="alerts-heading" class="text-[16px] font-semibold text-[#fafafa]">
                Alertas de stock crítico y lotes por vencer / vencidos
              </h2>
              <p class="text-[12px] text-[#a1a1aa]">
                Detecta artículos bajo el umbral crítico y lotes con fecha de vencimiento vencida o dentro de la ventana configurada.
              </p>
            </div>
            <span class="badge">GHOSH-19</span>
          </div>

          <!-- KPIs de Alertas -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Productos agotados</span>
                <lucide-icon [img]="icons.AlertTriangle" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div id="alerts-out-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
                {{ alertSummary().productos_agotados }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">Disponible en 0 unidades vigentes</p>
            </article>

            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Stock crítico</span>
                <lucide-icon [img]="icons.Package" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div id="alerts-critical-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
                {{ alertSummary().productos_stock_critico }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">
                Con disponible &le; {{ formatQuantity(alertSummary().umbral_stock) }} u
              </p>
            </article>

            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Lotes vencidos</span>
                <lucide-icon [img]="icons.Clock" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div id="alerts-expired-lots-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
                {{ alertSummary().lotes_vencidos }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">
                {{ formatQuantity(alertSummary().unidades_vencidas) }} unidades retenidas
              </p>
            </article>

            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Próximos a vencer</span>
                <lucide-icon [img]="icons.Boxes" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div id="alerts-expiring-lots-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
                {{ alertSummary().lotes_proximos_a_vencer }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">
                Dentro de {{ alertSummary().dias_vencimiento }} días ({{ formatQuantity(alertSummary().unidades_proximas_a_vencer) }} u)
              </p>
            </article>
          </div>

          <!-- Filtros de Alertas -->
          <form
            id="alerts-filter-form"
            class="glass-panel p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
            (ngSubmit)="loadAlerts()"
          >
            <label class="block">
              <span class="field-label">Bodega</span>
              <div class="input-icon-wrap">
                <span class="input-icon" aria-hidden="true">
                  <lucide-icon [img]="icons.Warehouse" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                </span>
                <select
                  id="alerts-warehouse"
                  name="alertsWarehouse"
                  class="glass-input has-icon pl-10"
                  [(ngModel)]="alertsWarehouseInput"
                  (ngModelChange)="loadAlerts()"
                >
                  <option value="">Todas las bodegas</option>
                  @for (w of warehouses(); track w.id_bodega) {
                    <option [value]="String(w.id_bodega)">{{ w.nombre }}</option>
                  }
                </select>
              </div>
            </label>

            <label class="block">
              <span class="field-label">Umbral stock crítico (u)</span>
              <input
                id="alerts-stock-threshold"
                name="umbralStock"
                type="number"
                min="0"
                step="1"
                [(ngModel)]="umbralStockInput"
                class="glass-input"
              />
            </label>

            <label class="block">
              <span class="field-label">Ventana vencimiento (días)</span>
              <input
                id="alerts-expiry-days"
                name="diasVencimiento"
                type="number"
                min="0"
                max="3650"
                step="1"
                [(ngModel)]="diasVencimientoInput"
                class="glass-input"
              />
            </label>

            <label class="block">
              <span class="field-label">Buscar SKU, artículo o lote</span>
              <div class="input-icon-wrap">
                <span class="input-icon" aria-hidden="true">
                  <lucide-icon [img]="icons.Search" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                </span>
                <input
                  id="alerts-query"
                  name="alertsQuery"
                  type="search"
                  [(ngModel)]="alertsQueryInput"
                  placeholder="Nombre, SKU o lote"
                  class="glass-input has-icon pl-10"
                />
              </div>
            </label>

            <div class="flex items-center gap-2">
              <button type="submit" class="btn btn-primary flex-1">
                <span>Aplicar</span>
                <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                title="Restablecer filtros de alertas"
                (click)="resetAlertFilters()"
              >
                <lucide-icon [img]="icons.RefreshCw" [size]="14" [strokeWidth]="1.5" [class.animate-spin]="alertsLoading()"></lucide-icon>
              </button>
            </div>
          </form>

          @if (alertsError()) {
            <div class="glass-panel p-4 text-[13px] text-[#fafafa]">
              {{ alertsError() }}
            </div>
          }

          <!-- Tablas de Alertas -->
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <!-- Lotes vencidos y próximos a vencer -->
            <section class="glass-panel overflow-hidden" aria-labelledby="lot-alerts-title">
              <div class="p-5 flex items-center justify-between gap-3 border-b border-[#262626]">
                <div>
                  <h3 id="lot-alerts-title" class="text-[15px] font-semibold text-[#fafafa]">
                    Lotes vencidos y próximos a vencer
                  </h3>
                  <p class="text-[12px] text-[#a1a1aa] mt-0.5">
                    Ordenados por prioridad FEFO (más urgente primero).
                  </p>
                </div>
                <span class="badge" [class]="lotAlerts().length ? 'badge-rose' : 'badge-emerald'">
                  {{ lotAlerts().length }} lotes
                </span>
              </div>

              @if (alertsLoading()) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">Analizando vencimientos…</div>
              } @else if (lotAlerts().length === 0) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
                  No hay lotes vencidos ni próximos a vencer en la ventana seleccionada.
                </div>
              } @else {
                <div class="overflow-x-auto max-h-[420px] overflow-y-auto scroll-area">
                  <table class="data-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>Estado</th>
                        <th>Lote</th>
                        <th>Producto</th>
                        <th>Bodega</th>
                        <th>Vencimiento</th>
                        <th class="num">Físico / Disp.</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (lot of lotAlerts(); track lot.id_lote) {
                        <tr>
                          <td>
                            <span class="badge" [class]="lotBadgeClass(lot.estado_vencimiento)">
                              {{ lotStatusLabel(lot) }}
                            </span>
                          </td>
                          <td class="font-mono text-[12px] text-[#fafafa]">{{ lot.codigo_lote }}</td>
                          <td>
                            <div class="font-medium text-[#fafafa]">{{ lot.producto }}</div>
                            <div class="font-mono text-[11px] text-[#71717a]">{{ lot.sku }}</div>
                          </td>
                          <td class="text-[#a1a1aa]">{{ lot.bodega }}</td>
                          <td class="font-mono text-[12px] text-[#e4e4e7]">
                            {{ formatDateOnly(lot.fecha_vencimiento) }}
                          </td>
                          <td class="num">
                            <div class="font-semibold text-[#fafafa]">{{ formatQuantity(lot.cantidad_fisica) }} u</div>
                            <div class="text-[11px] text-[#71717a]">
                              Disp.: {{ formatQuantity(lot.disponible_lote) }}
                            </div>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </section>

            <!-- Stock crítico y agotado -->
            <section class="glass-panel overflow-hidden" aria-labelledby="stock-alerts-title">
              <div class="p-5 flex items-center justify-between gap-3 border-b border-[#262626]">
                <div>
                  <h3 id="stock-alerts-title" class="text-[15px] font-semibold text-[#fafafa]">
                    Productos con stock crítico o agotado
                  </h3>
                  <p class="text-[12px] text-[#a1a1aa] mt-0.5">
                    Basado en stock no vencido ni reservado. <a routerLink="/recepcion" class="underline hover:text-[#fafafa]">Ir a recepción</a>
                  </p>
                </div>
                <span class="badge" [class]="stockAlerts().length ? 'badge-amber' : 'badge-emerald'">
                  {{ stockAlerts().length }} SKUs
                </span>
              </div>

              @if (alertsLoading()) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">Analizando existencias…</div>
              } @else if (stockAlerts().length === 0) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
                  Todo el catálogo activo supera el umbral de stock crítico.
                </div>
              } @else {
                <div class="overflow-x-auto max-h-[420px] overflow-y-auto scroll-area">
                  <table class="data-table min-w-[600px]">
                    <thead>
                      <tr>
                        <th>Nivel</th>
                        <th>SKU / Artículo</th>
                        <th class="num">Disponible</th>
                        <th class="num">Reservado</th>
                        <th class="num">Umbral</th>
                        <th class="num">Vencido</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (item of stockAlerts(); track item.sku) {
                        <tr>
                          <td>
                            <span class="badge" [class]="item.nivel_alerta === 'agotado' ? 'badge-rose' : 'badge-amber'">
                              {{ item.nivel_alerta === 'agotado' ? 'Agotado' : 'Stock crítico' }}
                            </span>
                          </td>
                          <td>
                            <div class="font-medium text-[#fafafa]">{{ item.nombre }}</div>
                            <div class="font-mono text-[11px] text-[#71717a]">{{ item.sku }}</div>
                          </td>
                          <td class="num font-semibold text-[#fafafa]">{{ formatQuantity(item.disponible) }} u</td>
                          <td class="num text-[#a1a1aa]">{{ formatQuantity(item.stock_reservado) }}</td>
                          <td class="num text-[#a1a1aa]">{{ formatQuantity(item.umbral_aplicado) }}</td>
                          <td class="num text-[#71717a]">
                            {{ Number(item.lotes_vencidos_unidades) > 0 ? formatQuantity(item.lotes_vencidos_unidades) + ' u' : '—' }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </section>
          </div>
        </section>
      }

      <!-- ==================== SECCIÓN GHOSH-18: RANKING DE DEMANDA Y EXPORTACIÓN CSV ==================== -->
      @if (activeView() === 'todos' || activeView() === 'demanda') {
        <section class="space-y-5 pt-2 border-t border-[#1f1f1f]" aria-labelledby="demand-heading">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 id="demand-heading" class="text-[16px] font-semibold text-[#fafafa]">
                Ranking de mayor y menor demanda por período
              </h2>
              <p class="text-[12px] text-[#a1a1aa]">
                Calculado sobre pedidos confirmados y despachados (excluye pedidos cancelados o expirados).
              </p>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge">GHOSH-18</span>
              <a
                id="demand-export-csv"
                [href]="demandCsvUrl()"
                download="ranking-demanda-ghosh.csv"
                class="btn btn-sm btn-primary no-underline"
              >
                <lucide-icon [img]="icons.FileDown" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                <span>Exportar CSV</span>
              </a>
            </div>
          </div>

          <!-- KPIs de Demanda -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Unidades demandadas</span>
                <lucide-icon [img]="icons.ShoppingBag" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div id="demand-total-units" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
                {{ formatQuantity(demandSummary().unidades_totales) }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">
                {{ demandSummary().productos_con_demanda }} SKUs con movimiento
              </p>
            </article>

            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Monto confirmado</span>
                <lucide-icon [img]="icons.DollarSign" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div id="demand-total-amount" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
                {{ formatMoney(demandSummary().monto_total) }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">En el período consultado</p>
            </article>

            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Pedidos considerados</span>
                <lucide-icon [img]="icons.FileSpreadsheet" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div id="demand-orders-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
                {{ demandSummary().pedidos_confirmados }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">Pendientes y despachados</p>
            </article>

            <article class="glass-card p-5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[12px] font-medium text-[#a1a1aa]">Líder del período</span>
                <lucide-icon [img]="icons.ArrowUpDown" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
              </div>
              <div class="mt-2 text-[15px] font-semibold text-[#fafafa] truncate" [title]="demandSummary().top_producto || 'Sin ventas'">
                {{ demandSummary().top_producto || 'Sin ventas en el período' }}
              </div>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">
                {{
                  demandSummary().top_sku
                    ? demandSummary().top_sku + ' · ' + formatQuantity(demandSummary().top_unidades) + ' u'
                    : 'Ajusta el rango de fechas'
                }}
              </p>
            </article>
          </div>

          <!-- Filtros de Demanda -->
          <form
            id="demand-filter-form"
            class="glass-panel p-5 space-y-4"
            (ngSubmit)="loadDemand()"
          >
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
              <label class="block">
                <span class="field-label">Fecha desde</span>
                <input
                  id="demand-desde"
                  name="demandDesde"
                  type="date"
                  [(ngModel)]="demandDesdeInput"
                  class="glass-input"
                />
              </label>

              <label class="block">
                <span class="field-label">Fecha hasta</span>
                <input
                  id="demand-hasta"
                  name="demandHasta"
                  type="date"
                  [(ngModel)]="demandHastaInput"
                  class="glass-input"
                />
              </label>

              <label class="block">
                <span class="field-label">Bodega</span>
                <select
                  id="demand-warehouse"
                  name="demandWarehouse"
                  class="glass-input"
                  [(ngModel)]="demandWarehouseInput"
                  (ngModelChange)="loadDemand()"
                >
                  <option value="">Todas las bodegas</option>
                  @for (w of warehouses(); track w.id_bodega) {
                    <option [value]="String(w.id_bodega)">{{ w.nombre }}</option>
                  }
                </select>
              </label>

              <label class="block">
                <span class="field-label">Categoría</span>
                <select
                  id="demand-category"
                  name="demandCategory"
                  class="glass-input"
                  [(ngModel)]="demandCategoryInput"
                  (ngModelChange)="loadDemand()"
                >
                  <option value="">Todas</option>
                  @for (cat of categories(); track cat) {
                    <option [value]="cat">{{ cat }}</option>
                  }
                </select>
              </label>

              <label class="block">
                <span class="field-label">Top filas</span>
                <select
                  id="demand-limit"
                  name="demandLimit"
                  class="glass-input"
                  [(ngModel)]="demandLimitInput"
                  (ngModelChange)="loadDemand()"
                >
                  <option [ngValue]="10">Top 10</option>
                  <option [ngValue]="20">Top 20</option>
                  <option [ngValue]="50">Top 50</option>
                </select>
              </label>

              <div class="flex items-center gap-2">
                <button type="submit" class="btn btn-primary flex-1">
                  <span>Consultar</span>
                  <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                </button>
                <button
                  type="button"
                  class="btn btn-ghost"
                  title="Limpiar período y filtros"
                  (click)="resetDemandFilters()"
                >
                  <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                </button>
              </div>
            </div>

            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#1f1f1f]">
              <label class="inline-flex items-center gap-2 text-[12px] text-[#d4d4d8] cursor-pointer">
                <input
                  id="demand-include-zero"
                  name="includeZero"
                  type="checkbox"
                  [(ngModel)]="includeZeroDemand"
                  (ngModelChange)="loadDemand()"
                  class="rounded border-[#3f3f46] bg-[#0a0a0a]"
                />
                <span>Incluir productos sin movimiento (0 unidades) en el ranking de menor demanda</span>
              </label>

              <label class="flex items-center gap-2 text-[12px] text-[#a1a1aa]">
                <span>Buscar SKU/Nombre:</span>
                <input
                  id="demand-query"
                  name="demandQuery"
                  type="search"
                  [(ngModel)]="demandQueryInput"
                  placeholder="Filtrar artículos"
                  class="glass-input py-1.5 px-2.5 text-[12px] w-48"
                />
              </label>
            </div>
          </form>

          @if (demandError()) {
            <div class="glass-panel p-4 text-[13px] text-[#fafafa]">
              {{ demandError() }}
            </div>
          }

          <!-- Rankings lado a lado -->
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <!-- Mayor demanda -->
            <section class="glass-panel overflow-hidden" aria-labelledby="top-demand-heading">
              <div class="p-5 flex items-center justify-between gap-3 border-b border-[#262626]">
                <div>
                  <h3 id="top-demand-heading" class="text-[15px] font-semibold text-[#fafafa]">
                    Mayor demanda (Más solicitados)
                  </h3>
                  <p class="text-[12px] text-[#a1a1aa] mt-0.5">
                    Prioridad para asegurar reposición y stock de seguridad.
                  </p>
                </div>
                <span class="badge badge-emerald">Top {{ mostDemanded().length }}</span>
              </div>

              @if (demandLoading()) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">Calculando ranking de demanda…</div>
              } @else if (mostDemanded().length === 0) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
                  No hay ventas confirmadas para los filtros seleccionados.
                </div>
              } @else {
                <div class="overflow-x-auto max-h-[460px] overflow-y-auto scroll-area">
                  <table class="data-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>SKU / Artículo</th>
                        <th class="num">Pedidos</th>
                        <th class="num">Unidades</th>
                        <th class="num">% Part.</th>
                        <th class="num">Monto</th>
                        <th class="num">Stock actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (item of mostDemanded(); track item.sku) {
                        <tr>
                          <td class="font-mono text-[#a1a1aa]">{{ item.posicion }}</td>
                          <td>
                            <div class="font-medium text-[#fafafa]">{{ item.nombre }}</div>
                            <div class="font-mono text-[11px] text-[#71717a]">
                              {{ item.sku }} · {{ formatQuantity(item.cajas_equivalentes) }} cj eq.
                            </div>
                          </td>
                          <td class="num text-[#a1a1aa]">{{ item.pedidos_confirmados }}</td>
                          <td class="num font-semibold text-[#fafafa]">{{ formatQuantity(item.unidades_demandadas) }} u</td>
                          <td class="num text-[#a1a1aa]">{{ item.participacion_pct }}%</td>
                          <td class="num text-[#fafafa]">{{ formatMoney(item.monto_demandado) }}</td>
                          <td class="num">
                            <span class="badge" [class]="Number(item.stock_disponible) <= 10 ? 'badge-rose' : 'badge-emerald'">
                              {{ formatQuantity(item.stock_disponible) }}
                            </span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </section>

            <!-- Menor demanda -->
            <section class="glass-panel overflow-hidden" aria-labelledby="low-demand-heading">
              <div class="p-5 flex items-center justify-between gap-3 border-b border-[#262626]">
                <div>
                  <h3 id="low-demand-heading" class="text-[15px] font-semibold text-[#fafafa]">
                    Menor demanda (Baja rotación)
                  </h3>
                  <p class="text-[12px] text-[#a1a1aa] mt-0.5">
                    Artículos con menor salida para controlar sobrestock o vencimientos.
                  </p>
                </div>
                <span class="badge badge-slate">Top {{ leastDemanded().length }}</span>
              </div>

              @if (demandLoading()) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">Calculando baja rotación…</div>
              } @else if (leastDemanded().length === 0) {
                <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
                  No hay productos que coincidan con los filtros seleccionados.
                </div>
              } @else {
                <div class="overflow-x-auto max-h-[460px] overflow-y-auto scroll-area">
                  <table class="data-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>SKU / Artículo</th>
                        <th class="num">Pedidos</th>
                        <th class="num">Unidades</th>
                        <th class="num">% Part.</th>
                        <th class="num">Monto</th>
                        <th class="num">Stock actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (item of leastDemanded(); track item.sku) {
                        <tr>
                          <td class="font-mono text-[#a1a1aa]">{{ item.posicion }}</td>
                          <td>
                            <div class="font-medium text-[#fafafa]">{{ item.nombre }}</div>
                            <div class="font-mono text-[11px] text-[#71717a]">
                              {{ item.sku }} · {{ formatQuantity(item.cajas_equivalentes) }} cj eq.
                            </div>
                          </td>
                          <td class="num text-[#a1a1aa]">{{ item.pedidos_confirmados }}</td>
                          <td class="num font-semibold text-[#fafafa]">{{ formatQuantity(item.unidades_demandadas) }} u</td>
                          <td class="num text-[#a1a1aa]">{{ item.participacion_pct }}%</td>
                          <td class="num text-[#a1a1aa]">{{ formatMoney(item.monto_demandado) }}</td>
                          <td class="num">
                            <span class="badge badge-slate">{{ formatQuantity(item.stock_disponible) }}</span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </section>
          </div>
        </section>
      }
    </section>
  `,
})
export class DemandAlertsPageComponent implements OnInit {
  private readonly api = inject(GhoshApiService);

  readonly Number = Number;
  readonly String = String;
  readonly formatChileDate = formatChileDate;
  readonly formatMoney = formatMoney;
  readonly formatQuantity = formatQuantity;

  readonly icons = {
    AlertTriangle,
    ArrowRight,
    ArrowUpDown,
    Boxes,
    Clock,
    DollarSign,
    FileDown,
    FileSpreadsheet,
    Package,
    RefreshCw,
    Search,
    ShoppingBag,
    Warehouse,
    X,
  };

  readonly viewTabs: Array<{ value: 'todos' | 'alertas' | 'demanda'; label: string }> = [
    { value: 'todos', label: 'Vista completa' },
    { value: 'alertas', label: 'Alertas (GHOSH-19)' },
    { value: 'demanda', label: 'Demanda y CSV (GHOSH-18)' },
  ];
  readonly activeView = signal<'todos' | 'alertas' | 'demanda'>('todos');

  readonly warehouses = signal<WarehouseOption[]>([]);
  readonly categories = signal<string[]>([]);

  // Estado Alertas (GHOSH-19)
  alertsWarehouseInput = '';
  umbralStockInput = 10;
  diasVencimientoInput = 30;
  alertsQueryInput = '';
  readonly alertsLoading = signal(false);
  readonly alertsError = signal<string | null>(null);
  readonly stockAlerts = signal<StockAlertItem[]>([]);
  readonly lotAlerts = signal<LotAlertItem[]>([]);
  readonly alertSummary = signal<InventoryAlertsSummary>({
    productos_agotados: 0,
    productos_stock_critico: 0,
    total_alertas_stock: 0,
    lotes_vencidos: 0,
    unidades_vencidas: 0,
    lotes_proximos_a_vencer: 0,
    unidades_proximas_a_vencer: 0,
    total_alertas_lotes: 0,
    dias_vencimiento: 30,
    umbral_stock: 10,
  });

  // Estado Demanda (GHOSH-18)
  demandDesdeInput = '';
  demandHastaInput = '';
  demandWarehouseInput = '';
  demandCategoryInput = '';
  demandQueryInput = '';
  demandLimitInput = 20;
  includeZeroDemand = true;
  readonly demandLoading = signal(false);
  readonly demandError = signal<string | null>(null);
  readonly mostDemanded = signal<DemandRankingItem[]>([]);
  readonly leastDemanded = signal<DemandRankingItem[]>([]);
  readonly demandSummary = signal<DemandRankingSummary>({
    productos_evaluados: 0,
    productos_con_demanda: 0,
    productos_sin_demanda: 0,
    pedidos_confirmados: 0,
    unidades_totales: 0,
    monto_total: 0,
    top_sku: null,
    top_producto: null,
    top_unidades: 0,
  });

  readonly hasAlerts = computed(
    () => this.alertSummary().total_alertas_stock > 0 || this.alertSummary().total_alertas_lotes > 0,
  );

  ngOnInit(): void {
    this.loadAlerts();
    this.loadDemand();
  }

  demandCsvUrl(): string {
    return this.api.getDemandCsvUrl({
      fecha_desde: this.demandDesdeInput,
      fecha_hasta: this.demandHastaInput,
      id_bodega: this.demandWarehouseInput ? Number(this.demandWarehouseInput) : undefined,
      categoria: this.demandCategoryInput,
      q: this.demandQueryInput,
      incluir_sin_demanda: this.includeZeroDemand,
      limit: this.demandLimitInput,
    });
  }

  loadAlerts(): void {
    this.alertsLoading.set(true);
    this.alertsError.set(null);

    this.api
      .getInventoryAlerts({
        id_bodega: this.alertsWarehouseInput ? Number(this.alertsWarehouseInput) : undefined,
        dias_vencimiento: Math.max(0, Number(this.diasVencimientoInput ?? 30)),
        umbral_stock: Math.max(0, Number(this.umbralStockInput ?? 10)),
        q: this.alertsQueryInput,
      })
      .subscribe({
        next: (res) => {
          this.alertSummary.set(res.summary);
          this.stockAlerts.set(res.alertas_stock ?? []);
          this.lotAlerts.set(res.alertas_lotes ?? []);
          if (res.bodegas?.length) {
            this.warehouses.set(res.bodegas);
          }
          this.alertsLoading.set(false);
        },
        error: (err) => {
          this.alertsLoading.set(false);
          this.alertsError.set(
            this.api.extractErrorMessage(err, 'No se pudieron consultar las alertas de inventario.'),
          );
        },
      });
  }

  resetAlertFilters(): void {
    this.alertsWarehouseInput = '';
    this.umbralStockInput = 10;
    this.diasVencimientoInput = 30;
    this.alertsQueryInput = '';
    this.loadAlerts();
  }

  loadDemand(): void {
    this.demandLoading.set(true);
    this.demandError.set(null);

    this.api
      .getDemandRanking({
        fecha_desde: this.demandDesdeInput,
        fecha_hasta: this.demandHastaInput,
        id_bodega: this.demandWarehouseInput ? Number(this.demandWarehouseInput) : undefined,
        categoria: this.demandCategoryInput,
        q: this.demandQueryInput,
        incluir_sin_demanda: this.includeZeroDemand,
        limit: this.demandLimitInput,
      })
      .subscribe({
        next: (res) => {
          this.demandSummary.set(res.summary);
          this.mostDemanded.set(res.mas_demandados ?? []);
          this.leastDemanded.set(res.menos_demandados ?? []);
          if (res.bodegas?.length) {
            this.warehouses.set(res.bodegas);
          }
          this.categories.set(res.categorias ?? []);
          this.demandLoading.set(false);
        },
        error: (err) => {
          this.demandLoading.set(false);
          this.demandError.set(
            this.api.extractErrorMessage(err, 'No se pudo generar el ranking de demanda.'),
          );
        },
      });
  }

  resetDemandFilters(): void {
    this.demandDesdeInput = '';
    this.demandHastaInput = '';
    this.demandWarehouseInput = '';
    this.demandCategoryInput = '';
    this.demandQueryInput = '';
    this.demandLimitInput = 20;
    this.includeZeroDemand = true;
    this.loadDemand();
  }

  lotBadgeClass(estado: string): string {
    switch (estado) {
      case 'vencido':
        return 'badge-rose';
      case 'vence_hoy':
      case 'proximo_a_vencer':
        return 'badge-amber';
      default:
        return 'badge-slate';
    }
  }

  lotStatusLabel(lot: LotAlertItem): string {
    if (lot.estado_vencimiento === 'vencido') {
      return `Vencido hace ${Math.abs(lot.dias_para_vencer)} d`;
    }
    if (lot.estado_vencimiento === 'vence_hoy' || lot.dias_para_vencer === 0) {
      return 'Vence hoy';
    }
    return `Vence en ${lot.dias_para_vencer} d`;
  }

  formatDateOnly(fecha: string | null | undefined): string {
    if (!fecha) return 'Sin vencimiento';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    return fecha;
  }
}
