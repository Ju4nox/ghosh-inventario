import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  DollarSign,
  FileDown,
  LucideAngularModule,
  MapPin,
  Search,
  Truck,
  User,
  Warehouse,
  X,
} from 'lucide-angular';

import { formatChileDate, formatMoney, formatQuantity } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import { OrderRecord, OrdersSummary, UserOption, WarehouseOption } from '../../core/models';

const ORDERS_PAGE_SIZE = 30;

interface OrderFeedback {
  success: boolean;
  title: string;
  message: string;
}

@Component({
  selector: 'app-orders-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <section class="space-y-8 animate-fade-up">
      <!-- Encabezado de página -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-semibold tracking-tight text-[#fafafa]">
            Pedidos
          </h1>
          <p class="mt-1 text-[13px] text-[#a1a1aa]">
            Consulta pedidos por número, nota o fecha, haz clic para ver su desglose completo con dirección y precios, despacha o anula con motivo.
          </p>
        </div>
        <div
          class="w-9 h-9 rounded-[8px] grid place-items-center bg-[#111111] border border-[#262626] text-[#a1a1aa] shrink-0"
          aria-hidden="true"
        >
          <lucide-icon [img]="icons.ClipboardList" [size]="18" [strokeWidth]="1.5"></lucide-icon>
        </div>
      </div>

      <!-- Tarjetas de Resumen -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Activos (pendientes)</span>
            <lucide-icon [img]="icons.Clock" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div id="orders-pending-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatQuantity(summary().pendientes) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            Por entregar: {{ formatMoney(summary().monto_pendiente) }}
          </p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Vendidos / despachados</span>
            <lucide-icon [img]="icons.Truck" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div id="orders-dispatched-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatQuantity(summary().despachados) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            Despachado: {{ formatMoney(summary().monto_despachado) }}
          </p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Pedidos anulados</span>
            <lucide-icon [img]="icons.Ban" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div id="orders-cancelled-count" class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatQuantity(summary().anulados) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            Anulado: {{ formatMoney(summary().monto_anulado) }}
          </p>
        </article>

        <article class="glass-card p-5">
          <div class="flex items-center justify-between gap-3">
            <span class="text-[12px] font-medium text-[#a1a1aa]">Monto neto vigente</span>
            <lucide-icon [img]="icons.DollarSign" [size]="16" [strokeWidth]="1.5" class="text-[#a1a1aa]"></lucide-icon>
          </div>
          <div class="mt-2 text-[24px] font-semibold text-[#fafafa] tabular-nums">
            {{ formatMoney(Number(summary().monto_pendiente) + Number(summary().monto_despachado)) }}
          </div>
          <p class="mt-1 text-[12px] text-[#a1a1aa]">
            Pendientes + despachados
          </p>
        </article>
      </div>

      <!-- Filtros -->
      <div class="glass-panel p-5 space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          @for (tab of statusTabs; track tab.value) {
            <button
              type="button"
              class="btn btn-sm"
              [ngClass]="statusFilter() === tab.value ? 'btn-primary' : 'btn-ghost'"
              (click)="onStatusTabChange(tab.value)"
            >
              <span>{{ tab.label }}</span>
              @if (tab.value === 'pendiente') {
                <span class="ml-1 opacity-80">({{ summary().pendientes }})</span>
              } @else if (tab.value === 'despachado') {
                <span class="ml-1 opacity-80">({{ summary().despachados }})</span>
              } @else if (tab.value === 'cancelado') {
                <span class="ml-1 opacity-80">({{ summary().anulados }})</span>
              }
            </button>
          }
        </div>

        <form
          id="orders-filter"
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
          (ngSubmit)="onFilterSubmit()"
        >
          <label class="block">
            <span class="field-label">N° Nota de venta</span>
            <input
              id="orders-nota"
              name="numero_nota"
              type="number"
              min="1"
              [(ngModel)]="notaInput"
              placeholder="Ej. 12"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label">N° Pedido</span>
            <input
              id="orders-id"
              name="id_pedido"
              type="number"
              min="1"
              [(ngModel)]="pedidoInput"
              placeholder="Ej. 8"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label">Desde fecha</span>
            <input
              id="orders-desde"
              name="fecha_desde"
              type="date"
              [(ngModel)]="desdeInput"
              class="glass-input"
            />
          </label>

          <label class="block">
            <span class="field-label">Hasta fecha</span>
            <input
              id="orders-hasta"
              name="fecha_hasta"
              type="date"
              [(ngModel)]="hastaInput"
              class="glass-input"
            />
          </label>

          <label class="block sm:col-span-2">
            <span class="field-label">Buscar local, dirección, vendedor o SKU</span>
            <div class="input-icon-wrap">
              <span class="input-icon" aria-hidden="true">
                <lucide-icon [img]="icons.Search" [size]="16" [strokeWidth]="1.5"></lucide-icon>
              </span>
              <input
                id="orders-query"
                name="query"
                type="search"
                [(ngModel)]="queryInput"
                placeholder="Minimarket, calle, TKA311001901..."
                class="glass-input has-icon pl-10"
              />
            </div>
          </label>

          <label class="block">
            <span class="field-label">Bodega</span>
            <select
              id="orders-warehouse"
              name="warehouse"
              class="glass-input"
              [(ngModel)]="warehouseInput"
              (ngModelChange)="onWarehouseChange()"
            >
              <option value="">Todas las bodegas</option>
              @for (w of warehouses(); track w.id_bodega) {
                <option [value]="String(w.id_bodega)">{{ w.nombre }}</option>
              }
            </select>
          </label>

          <div class="flex items-center gap-2">
            <button type="submit" class="btn btn-primary flex-1">
              <span>Buscar</span>
              <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
            </button>
            <button
              id="orders-clear"
              type="button"
              class="btn btn-ghost"
              (click)="onClear()"
            >
              <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
              <span>Limpiar</span>
            </button>
          </div>
        </form>
      </div>

      <!-- Feedback -->
      @if (feedback(); as fb) {
        <div
          id="orders-action-result"
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

      <!-- Listado de Pedidos -->
      <section class="glass-panel overflow-hidden" aria-labelledby="orders-list-heading">
        <div
          class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#262626]"
        >
          <div>
            <h2 id="orders-list-heading" class="text-[15px] font-semibold text-[#fafafa]">
              Auditoría de pedidos
            </h2>
            <p id="orders-caption" class="text-[12px] text-[#a1a1aa] mt-0.5">
              {{ ordersCaption() }} · Haz clic en un pedido para desplegar el detalle, dirección y precios.
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
            Cargando pedidos…
          </div>
        } @else if (errorMessage()) {
          <div class="py-12 px-4 text-center text-[13px] text-[#fafafa] font-medium">
            {{ errorMessage() }}
          </div>
        } @else if (items().length === 0) {
          <div class="py-12 px-4 text-center text-[13px] text-[#a1a1aa]">
            No se encontraron pedidos con esos criterios.
          </div>
        } @else {
          <div class="divide-y divide-[#1f1f1f]">
            @for (order of items(); track order.id_pedido) {
              <article class="transition-colors hover:bg-[#141414]/60">
                <!-- Fila resumen clicable -->
                <div
                  class="p-5 cursor-pointer flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  (click)="toggleExpand(order.id_pedido)"
                >
                  <div class="space-y-1.5 min-w-0">
                    <div class="flex flex-wrap items-center gap-2.5">
                      <lucide-icon
                        [img]="isExpanded(order.id_pedido) ? icons.ChevronUp : icons.ChevronDown"
                        [size]="16"
                        [strokeWidth]="1.5"
                        class="text-[#a1a1aa] shrink-0"
                      ></lucide-icon>
                      <strong class="font-mono text-[15px] text-[#fafafa]">
                        Pedido #{{ order.id_pedido }}
                      </strong>
                      @if (order.numero_nota) {
                        <span class="badge badge-slate font-mono">
                          Nota N° {{ order.numero_nota }}
                        </span>
                      }
                      <span
                        class="badge capitalize"
                        [ngClass]="badgeClass(order.estado)"
                      >
                        {{ order.estado }}
                      </span>
                      <span class="text-[13px] font-medium text-[#fafafa]">
                        {{ order.nombre_local }}
                      </span>
                    </div>

                    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[#a1a1aa] pl-6">
                      <span>Bodega: {{ order.bodega }}</span>
                      <span>Vendedor: {{ order.vendedor }}</span>
                      <span>Emitido: {{ formatChileDate(order.fecha_creacion) }}</span>
                      @if (order.direccion_entrega) {
                        <span class="inline-flex items-center gap-1 text-[#d4d4d8]">
                          <lucide-icon [img]="icons.MapPin" [size]="12" [strokeWidth]="1.5"></lucide-icon>
                          {{ order.direccion_entrega }}
                        </span>
                      }
                    </div>
                  </div>

                  <div
                    class="flex flex-wrap items-center gap-2.5 shrink-0 pl-6 lg:pl-0"
                    (click)="$event.stopPropagation()"
                  >
                    <div class="text-left lg:text-right mr-2">
                      <span class="block text-[11px] text-[#a1a1aa]">
                        {{ formatQuantity(order.unidades_totales) }} u. ({{ order.items.length }} ítems)
                      </span>
                      <strong class="text-[16px] text-[#fafafa] tabular-nums">
                        {{ formatMoney(order.total) }}
                      </strong>
                    </div>

                    @if (order.numero_nota) {
                      <a
                        [href]="api.getSaleNotePdfUrl(order.numero_nota)"
                        target="_blank"
                        rel="noopener"
                        class="btn btn-sm btn-ghost inline-flex items-center gap-1.5 no-underline"
                      >
                        <lucide-icon [img]="icons.FileDown" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                        <span>PDF</span>
                      </a>
                    }

                    @if (order.estado === 'pendiente') {
                      <button
                        type="button"
                        class="btn btn-sm btn-primary"
                        [disabled]="dispatchingId() === order.id_pedido || cancellingId() === order.id_pedido"
                        (click)="openDispatchDialog(order)"
                      >
                        <lucide-icon [img]="icons.Truck" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                        <span>Despachar</span>
                      </button>

                      <button
                        type="button"
                        class="btn btn-sm btn-ghost text-rose-300 border-rose-500/30 hover:bg-rose-950/40"
                        [disabled]="dispatchingId() === order.id_pedido || cancellingId() === order.id_pedido"
                        (click)="openCancelDialog(order)"
                      >
                        <lucide-icon [img]="icons.Ban" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                        <span>Anular</span>
                      </button>
                    }
                  </div>
                </div>

                <!-- Desglose expandible al hacer clic -->
                @if (isExpanded(order.id_pedido)) {
                  <div class="px-5 pb-5 pt-2 bg-[#0c0c0c] border-t border-[#1f1f1f] space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-[12px]">
                      <div class="glass-subtle p-3.5 space-y-1">
                        <span class="text-[#a1a1aa] font-medium flex items-center gap-1.5">
                          <lucide-icon [img]="icons.MapPin" [size]="13" [strokeWidth]="1.5"></lucide-icon>
                          Dirección de entrega
                        </span>
                        <p class="text-[#fafafa]">
                          {{ order.direccion_entrega || 'Retiro / venta en local (sin dirección registrada)' }}
                        </p>
                        <p class="text-[#a1a1aa]">Alias / Local: {{ order.nombre_local }}</p>
                      </div>

                      <div class="glass-subtle p-3.5 space-y-1">
                        <span class="text-[#a1a1aa] font-medium block">Trazabilidad y estado</span>
                        @if (order.estado === 'despachado') {
                          <p class="text-emerald-300">
                            Despachado el {{ formatChileDate(order.fecha_entrega) }}
                          </p>
                          <p class="text-[#a1a1aa]">Responsable: {{ order.usuario_entrega || 'Bodega' }}</p>
                        } @else if (order.estado === 'cancelado') {
                          <p class="text-rose-300">
                            Anulado el {{ formatChileDate(order.fecha_anulacion) }} por {{ order.usuario_anulacion || 'Sistema' }}
                          </p>
                          @if (order.motivo_anulacion) {
                            <p class="text-[#fafafa]">Motivo: {{ order.motivo_anulacion }}</p>
                          }
                        } @else {
                          <p class="text-amber-300">Reserva vigente esperando despacho en bodega</p>
                        }
                      </div>

                      <div class="glass-subtle p-3.5 flex items-center justify-between gap-3">
                        <div>
                          <span class="text-[#a1a1aa] font-medium block">Precio final confirmado</span>
                          <strong class="text-[18px] text-[#fafafa] tabular-nums">
                            {{ formatMoney(order.total) }}
                          </strong>
                        </div>
                        @if (order.numero_nota) {
                          <a
                            [href]="api.getSaleNotePdfUrl(order.numero_nota)"
                            target="_blank"
                            rel="noopener"
                            class="btn btn-sm btn-primary inline-flex items-center gap-1.5 no-underline"
                          >
                            <lucide-icon [img]="icons.FileDown" [size]="14" [strokeWidth]="1.5"></lucide-icon>
                            <span>Exportar PDF</span>
                          </a>
                        }
                      </div>
                    </div>

                    <div class="desktop-only-view overflow-x-auto rounded-[8px] border border-[#262626]">
                      <table class="data-table min-w-[780px]">
                        <thead>
                          <tr>
                            <th>SKU</th>
                            <th>Producto solicitado</th>
                            <th>Lotes FEFO / reserva</th>
                            <th class="num">Cajas / Sueltos</th>
                            <th class="num">U. por caja</th>
                            <th class="num">Cant. total</th>
                            <th class="num">Precio unit.</th>
                            <th class="num">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          @for (line of order.items; track line.sku) {
                            <tr>
                              <td class="font-mono text-[#a1a1aa]">{{ line.sku }}</td>
                              <td class="text-[#fafafa]">{{ line.nombre }}</td>
                              <td>
                                @if (line.lotes_reservados?.length) {
                                  <div class="flex flex-col gap-1">
                                    @for (lot of line.lotes_reservados; track lot.id_reserva) {
                                      <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                                        <span class="font-mono font-medium text-[#e4e4e7]">
                                          {{ lot.codigo_lote }}
                                        </span>
                                        <span class="text-[#71717a]">
                                          ({{ formatQuantity(lot.cantidad) }} u · Vence: {{ formatLotExpiry(lot.fecha_vencimiento) }})
                                        </span>
                                        <span class="badge" [class]="reservationBadgeClass(lot.estado_reserva)">
                                          {{ lot.estado_reserva }}
                                        </span>
                                      </div>
                                    }
                                  </div>
                                } @else {
                                  <span class="text-[11px] text-[#71717a]">Sin lote asignado</span>
                                }
                              </td>
                              <td class="num text-[#a1a1aa]">
                                {{ line.cajas }}c + {{ formatQuantity(line.sueltos) }}u
                              </td>
                              <td class="num text-[#a1a1aa]">{{ line.unidades_por_caja }}</td>
                              <td class="num text-[#fafafa]">{{ formatQuantity(line.cantidad_total) }}</td>
                              <td class="num text-[#a1a1aa]">{{ formatMoney(line.precio_confirmado) }}</td>
                              <td class="num font-semibold text-[#fafafa]">{{ formatMoney(line.subtotal) }}</td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>

                    <!-- Tarjetas de detalle para Redmi Pad SE 11" Vertical / Móvil -->
                    <div class="tablet-only-view grid-cols-1 sm:grid-cols-2 gap-3">
                      @for (line of order.items; track line.sku) {
                        <article class="glass-subtle p-3.5 space-y-2">
                          <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                              <h4 class="text-[13px] font-semibold text-[#fafafa] leading-snug">{{ line.nombre }}</h4>
                              <span class="text-[11px] font-mono text-[#a1a1aa]">{{ line.sku }}</span>
                            </div>
                            <strong class="text-[14px] font-semibold text-[#fafafa] tabular-nums shrink-0">
                              {{ formatMoney(line.subtotal) }}
                            </strong>
                          </div>

                          <div class="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#a1a1aa]">
                            <span>{{ line.cajas }} cj ({{ line.unidades_por_caja }}u) + {{ formatQuantity(line.sueltos) }} u</span>
                            <strong class="text-[#fafafa]">Total: {{ formatQuantity(line.cantidad_total) }} u</strong>
                          </div>

                          <div class="pt-2 border-t border-[#1f1f1f]">
                            <span class="block text-[11px] text-[#a1a1aa] mb-1">Lotes FEFO asignados</span>
                            @if (line.lotes_reservados?.length) {
                              <div class="flex flex-col gap-1">
                                @for (lot of line.lotes_reservados; track lot.id_reserva) {
                                  <div class="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                                    <span class="font-mono text-[#e4e4e7]">
                                      {{ lot.codigo_lote }} · {{ formatQuantity(lot.cantidad) }} u
                                    </span>
                                    <span class="text-[#71717a]">Vence: {{ formatLotExpiry(lot.fecha_vencimiento) }}</span>
                                    <span class="badge" [class]="reservationBadgeClass(lot.estado_reserva)">
                                      {{ lot.estado_reserva }}
                                    </span>
                                  </div>
                                }
                              </div>
                            } @else {
                              <span class="text-[11px] text-[#71717a]">Sin lote asignado</span>
                            }
                          </div>
                        </article>
                      }
                    </div>
                  </div>
                }
              </article>
            }
          </div>
        }
      </section>
    </section>

    <!-- Modal de confirmación de despacho -->
    @if (dispatchTarget(); as target) {
      <div
        class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm grid place-items-center p-4"
        (click)="closeDispatchDialog()"
      >
        <div
          class="w-full max-w-md glass-panel p-6 space-y-5 animate-fade-up"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-[17px] font-semibold text-[#fafafa]">
                Despachar pedido #{{ target.id_pedido }}
              </h3>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">
                Nota N° {{ target.numero_nota }} · {{ target.nombre_local }} · {{ formatMoney(target.total) }}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-ghost btn-icon"
              (click)="closeDispatchDialog()"
              aria-label="Cerrar diálogo"
            >
              <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
            </button>
          </div>

          <div class="space-y-4">
            <div class="rounded-[8px] border border-[#262626] bg-[#141414] p-3">
              <div class="flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
                <span>Preparación / retiro por lote (FEFO)</span>
                <span>{{ formatQuantity(target.unidades_totales) }} u totales</span>
              </div>
              <div class="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                @for (line of target.items; track line.sku) {
                  <div class="rounded-[6px] border border-[#262626]/80 bg-[#0d0d0d] px-2.5 py-2">
                    <div class="flex items-center justify-between gap-2 text-[12px]">
                      <span class="font-medium text-[#fafafa]">
                        <span class="font-mono text-[#a1a1aa]">{{ line.sku }}</span> · {{ line.nombre }}
                      </span>
                      <span class="font-semibold text-[#fafafa]">{{ formatQuantity(line.cantidad_total) }} u</span>
                    </div>
                    @if (line.lotes_reservados?.length) {
                      <div class="mt-1.5 flex flex-wrap gap-1.5">
                        @for (lot of line.lotes_reservados; track lot.id_reserva) {
                          <span class="inline-flex items-center gap-1 rounded border border-[#2a2a2e] bg-[#18181b] px-2 py-0.5 text-[11px] text-[#d4d4d8]">
                            <span class="font-mono font-semibold text-[#fafafa]">{{ lot.codigo_lote }}</span>
                            <span>{{ formatQuantity(lot.cantidad) }} u</span>
                            <span class="text-[#71717a]">· Vence: {{ formatLotExpiry(lot.fecha_vencimiento) }}</span>
                          </span>
                        }
                      </div>
                    } @else {
                      <p class="mt-1 text-[11px] text-[#71717a]">Sin detalle de lotes reservados.</p>
                    }
                  </div>
                }
              </div>
            </div>

            <label class="block">
              <span class="field-label">Responsable del despacho</span>
              <div class="input-icon-wrap">
                <span class="input-icon" aria-hidden="true">
                  <lucide-icon [img]="icons.User" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                </span>
                <select
                  id="dispatch-actor"
                  name="dispatchActor"
                  class="glass-input has-icon pl-10"
                  [(ngModel)]="dispatchActorId"
                >
                  <option value="">Selecciona responsable</option>
                  @for (u of responsibles(); track u.id_usuario) {
                    <option [value]="String(u.id_usuario)">{{ u.nombre }}</option>
                  }
                </select>
              </div>
            </label>

            <label class="block">
              <span class="field-label">Observación / motivo (opcional)</span>
              <input
                id="dispatch-reason"
                name="dispatchReason"
                type="text"
                maxlength="200"
                [(ngModel)]="dispatchReason"
                placeholder="Ej. Entregado en ruta mañana"
                class="glass-input"
              />
            </label>

            @if (dialogError()) {
              <div class="text-[12px] text-rose-400 font-medium">
                {{ dialogError() }}
              </div>
            }
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#262626]">
            <button
              type="button"
              class="btn btn-ghost"
              [disabled]="dispatchingId() !== null"
              (click)="closeDispatchDialog()"
            >
              Cancelar
            </button>
            <button
              id="dispatch-confirm"
              type="button"
              class="btn btn-primary"
              [disabled]="dispatchingId() !== null || !dispatchActorId"
              (click)="confirmDispatch()"
            >
              <lucide-icon [img]="icons.Truck" [size]="15" [strokeWidth]="1.5"></lucide-icon>
              <span>{{ dispatchingId() !== null ? 'Despachando…' : 'Confirmar despacho' }}</span>
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal único de anulación de pedido con motivo -->
    @if (cancelTarget(); as target) {
      <div
        class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm grid place-items-center p-4"
        (click)="closeCancelDialog()"
      >
        <div
          class="w-full max-w-md glass-panel p-6 space-y-5 animate-fade-up"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-[17px] font-semibold text-[#fafafa]">
                Anular pedido #{{ target.id_pedido }}
              </h3>
              <p class="mt-1 text-[12px] text-[#a1a1aa]">
                Nota N° {{ target.numero_nota }} · {{ target.nombre_local }} · Se liberará el stock reservado.
              </p>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-ghost btn-icon"
              (click)="closeCancelDialog()"
              aria-label="Cerrar diálogo"
            >
              <lucide-icon [img]="icons.X" [size]="15" [strokeWidth]="1.5"></lucide-icon>
            </button>
          </div>

          <div class="space-y-4">
            <label class="block">
              <span class="field-label">Responsable de la anulación</span>
              <div class="input-icon-wrap">
                <span class="input-icon" aria-hidden="true">
                  <lucide-icon [img]="icons.User" [size]="15" [strokeWidth]="1.5"></lucide-icon>
                </span>
                <select
                  id="cancel-actor"
                  name="cancelActor"
                  class="glass-input has-icon pl-10"
                  [(ngModel)]="cancelActorId"
                >
                  <option value="">Selecciona responsable</option>
                  @for (u of responsibles(); track u.id_usuario) {
                    <option [value]="String(u.id_usuario)">{{ u.nombre }}</option>
                  }
                </select>
              </div>
            </label>

            <label class="block">
              <span class="field-label">Motivo de anulación (obligatorio)</span>
              <input
                id="cancel-reason"
                name="cancelReason"
                type="text"
                maxlength="200"
                [(ngModel)]="cancelReason"
                placeholder="Ej. Cliente solicitó cancelar o cambió pedido"
                class="glass-input"
              />
            </label>

            @if (cancelDialogError()) {
              <div class="text-[12px] text-rose-400 font-medium">
                {{ cancelDialogError() }}
              </div>
            }
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#262626]">
            <button
              type="button"
              class="btn btn-ghost"
              [disabled]="cancellingId() !== null"
              (click)="closeCancelDialog()"
            >
              Volver
            </button>
            <button
              id="cancel-confirm"
              type="button"
              class="btn btn-primary"
              [disabled]="cancellingId() !== null || !cancelActorId"
              (click)="confirmCancel()"
            >
              <lucide-icon [img]="icons.Ban" [size]="15" [strokeWidth]="1.5"></lucide-icon>
              <span>{{ cancellingId() !== null ? 'Anulando…' : 'Confirmar anulación' }}</span>
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class OrdersPageComponent implements OnInit {
  readonly api = inject(GhoshApiService);

  readonly pageSize = ORDERS_PAGE_SIZE;
  readonly Number = Number;
  readonly String = String;
  readonly formatChileDate = formatChileDate;
  readonly formatMoney = formatMoney;
  readonly formatQuantity = formatQuantity;

  readonly icons = {
    ClipboardList,
    Clock,
    Truck,
    DollarSign,
    Search,
    Warehouse,
    ArrowRight,
    X,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    ChevronUp,
    CheckCircle2,
    AlertTriangle,
    User,
    Ban,
    FileDown,
    MapPin,
  };

  readonly statusTabs: Array<{ value: 'todos' | 'pendiente' | 'despachado' | 'cancelado'; label: string }> = [
    { value: 'todos', label: 'Todos' },
    { value: 'pendiente', label: 'Activos (pendientes)' },
    { value: 'despachado', label: 'Vendidos / despachados' },
    { value: 'cancelado', label: 'Anulados' },
  ];

  readonly statusFilter = signal<'todos' | 'pendiente' | 'despachado' | 'cancelado'>('todos');
  notaInput: number | null = null;
  pedidoInput: number | null = null;
  desdeInput = '';
  hastaInput = '';
  queryInput = '';
  warehouseInput = '';

  readonly summary = signal<OrdersSummary>({
    pendientes: 0,
    despachados: 0,
    anulados: 0,
    monto_pendiente: 0,
    monto_despachado: 0,
    monto_anulado: 0,
  });
  readonly warehouses = signal<WarehouseOption[]>([]);
  readonly responsibles = signal<UserOption[]>([]);
  readonly items = signal<OrderRecord[]>([]);
  readonly total = signal(0);
  readonly offset = signal(0);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly feedback = signal<OrderFeedback | null>(null);
  readonly expandedOrderId = signal<number | null>(null);

  readonly dispatchTarget = signal<OrderRecord | null>(null);
  readonly dispatchingId = signal<number | null>(null);
  readonly dialogError = signal<string | null>(null);
  dispatchActorId = '';
  dispatchReason = '';

  readonly cancelTarget = signal<OrderRecord | null>(null);
  readonly cancellingId = signal<number | null>(null);
  readonly cancelDialogError = signal<string | null>(null);
  cancelActorId = '';
  cancelReason = '';

  readonly ordersCaption = computed(() => {
    if (this.loading()) return 'Consultando pedidos…';
    if (this.errorMessage()) return 'No fue posible cargar los pedidos';
    const count = this.total();
    return count === 1 ? '1 pedido registrado' : `${formatQuantity(count)} pedidos registrados`;
  });

  readonly pageLabel = computed(() => {
    const t = this.total();
    if (!t) return 'Sin resultados';
    const start = this.offset() + 1;
    const end = Math.min(this.offset() + ORDERS_PAGE_SIZE, t);
    return `Mostrando ${start}–${end} de ${t}`;
  });

  ngOnInit(): void {
    this.loadOrders();
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

  reservationBadgeClass(estado: string): string {
    switch (estado) {
      case 'vigente':
        return 'badge-amber';
      case 'consumida':
        return 'badge-emerald';
      case 'liberada':
      case 'expirada':
        return 'badge-rose';
      default:
        return 'badge-slate';
    }
  }

  formatLotExpiry(fecha: string | null | undefined): string {
    if (!fecha) return 'Sin vencimiento';
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    return fecha;
  }

  isExpanded(idPedido: number): boolean {
    return this.expandedOrderId() === idPedido;
  }

  toggleExpand(idPedido: number): void {
    this.expandedOrderId.update((curr) => (curr === idPedido ? null : idPedido));
  }

  loadOrders(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.api
      .getOrders({
        estado: this.statusFilter(),
        numero_nota: this.notaInput,
        id_pedido: this.pedidoInput,
        fecha_desde: this.desdeInput,
        fecha_hasta: this.hastaInput,
        q: this.queryInput,
        id_bodega: this.warehouseInput ? Number(this.warehouseInput) : undefined,
        limit: ORDERS_PAGE_SIZE,
        offset: this.offset(),
      })
      .subscribe({
        next: (res) => {
          this.summary.set(res.summary);
          this.warehouses.set(res.bodegas ?? []);
          this.responsibles.set(res.responsables ?? []);
          if (!this.dispatchActorId && res.responsables?.length) {
            const preferred =
              res.responsables.find((u) => u.nombre.toLowerCase().includes('bodega')) ??
              res.responsables[0];
            this.dispatchActorId = String(preferred.id_usuario);
          }
          if (!this.cancelActorId && res.responsables?.length) {
            const preferredCancel =
              res.responsables.find((u) => u.nombre.toLowerCase().includes('venta')) ??
              res.responsables[0];
            this.cancelActorId = String(preferredCancel.id_usuario);
          }
          this.items.set(res.items ?? []);
          this.total.set(res.total ?? 0);
          this.loading.set(false);
        },
        error: (err) => {
          this.items.set([]);
          this.total.set(0);
          this.loading.set(false);
          this.errorMessage.set(
            this.api.extractErrorMessage(err, 'No se pudo cargar el listado de pedidos.'),
          );
        },
      });
  }

  onStatusTabChange(status: 'todos' | 'pendiente' | 'despachado' | 'cancelado'): void {
    this.statusFilter.set(status);
    this.offset.set(0);
    this.loadOrders();
  }

  onWarehouseChange(): void {
    this.offset.set(0);
    this.loadOrders();
  }

  onFilterSubmit(): void {
    this.offset.set(0);
    this.loadOrders();
  }

  onClear(): void {
    this.notaInput = null;
    this.pedidoInput = null;
    this.desdeInput = '';
    this.hastaInput = '';
    this.queryInput = '';
    this.warehouseInput = '';
    this.statusFilter.set('todos');
    this.offset.set(0);
    this.loadOrders();
  }

  prevPage(): void {
    this.offset.update((current) => Math.max(0, current - ORDERS_PAGE_SIZE));
    this.loadOrders();
  }

  nextPage(): void {
    if (this.offset() + ORDERS_PAGE_SIZE < this.total()) {
      this.offset.update((current) => current + ORDERS_PAGE_SIZE);
      this.loadOrders();
    }
  }

  openDispatchDialog(order: OrderRecord): void {
    this.dialogError.set(null);
    this.dispatchReason = '';
    if (!this.dispatchActorId && this.responsibles().length) {
      const preferred =
        this.responsibles().find((u) => u.nombre.toLowerCase().includes('bodega')) ??
        this.responsibles()[0];
      this.dispatchActorId = String(preferred.id_usuario);
    }
    this.dispatchTarget.set(order);
  }

  closeDispatchDialog(): void {
    if (this.dispatchingId() !== null) return;
    this.dispatchTarget.set(null);
    this.dialogError.set(null);
  }

  confirmDispatch(): void {
    const order = this.dispatchTarget();
    if (!order) return;

    const actorId = Number(this.dispatchActorId);
    if (!actorId) {
      this.dialogError.set('Selecciona al responsable del despacho.');
      return;
    }

    this.dialogError.set(null);
    this.dispatchingId.set(order.id_pedido);

    this.api
      .dispatchOrder(order.id_pedido, {
        id_usuario: actorId,
        motivo: this.dispatchReason.trim() || undefined,
      })
      .subscribe({
        next: (res) => {
          this.dispatchingId.set(null);
          this.dispatchTarget.set(null);
          this.feedback.set({
            success: true,
            title: `Pedido #${res.id_pedido} marcado como despachado`,
            message: `Nota de venta N° ${res.numero_nota} · Local: ${res.nombre_local} · Despachado por ${res.usuario_entrega}. El movimiento quedó registrado en Movimientos.`,
          });
          this.loadOrders();
        },
        error: (err) => {
          this.dispatchingId.set(null);
          this.dialogError.set(
            this.api.extractErrorMessage(err, 'No se pudo marcar el pedido como despachado.'),
          );
        },
      });
  }

  openCancelDialog(order: OrderRecord): void {
    this.cancelDialogError.set(null);
    this.cancelReason = '';
    if (!this.cancelActorId && this.responsibles().length) {
      const preferred =
        this.responsibles().find((u) => u.nombre.toLowerCase().includes('venta')) ??
        this.responsibles()[0];
      this.cancelActorId = String(preferred.id_usuario);
    }
    this.cancelTarget.set(order);
  }

  closeCancelDialog(): void {
    if (this.cancellingId() !== null) return;
    this.cancelTarget.set(null);
    this.cancelDialogError.set(null);
  }

  confirmCancel(): void {
    const order = this.cancelTarget();
    if (!order) return;

    const actorId = Number(this.cancelActorId);
    if (!actorId) {
      this.cancelDialogError.set('Selecciona al responsable de la anulación.');
      return;
    }

    const reasonClean = this.cancelReason.trim();
    if (reasonClean.length < 3) {
      this.cancelDialogError.set('Ingresa el motivo de la anulación (mínimo 3 caracteres).');
      return;
    }

    this.cancelDialogError.set(null);
    this.cancellingId.set(order.id_pedido);

    this.api
      .cancelOrder(order.id_pedido, {
        id_usuario: actorId,
        motivo: reasonClean,
      })
      .subscribe({
        next: (res) => {
          this.cancellingId.set(null);
          this.cancelTarget.set(null);
          this.feedback.set({
            success: true,
            title: `Pedido #${res.id_pedido} anulado`,
            message: `Nota N° ${res.numero_nota ?? '—'} · Motivo: ${res.motivo_anulacion} · Las reservas fueron liberadas y registradas en Movimientos.`,
          });
          this.loadOrders();
        },
        error: (err) => {
          this.cancellingId.set(null);
          this.cancelDialogError.set(
            this.api.extractErrorMessage(err, 'No se pudo anular el pedido.'),
          );
        },
      });
  }
}
