import { HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  LucideAngularModule,
  PackagePlus,
  Upload,
  X,
} from 'lucide-angular';

import { formatQuantity } from '../../core/formatters';
import { GhoshApiService } from '../../core/ghosh-api.service';
import {
  CatalogProduct,
  ExcelPreviewItem,
  ExcelPreviewResponse,
  RowValidationError,
  UserOption,
  WarehouseOption,
} from '../../core/models';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface ReceiptFeedback {
  success: boolean;
  title: string;
  message: string;
  errors?: RowValidationError[];
}

@Component({
  selector: 'app-receipt-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    <section class="space-y-8 animate-fade-up">
      <!-- Encabezado de página -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-[24px] font-semibold tracking-tight text-[#fafafa]">
            Recepción
          </h1>
          <p class="mt-1 text-[13px] text-[#a1a1aa]">
            Registra mercadería por lote y deja el movimiento trazado.
          </p>
        </div>
        <div
          class="w-9 h-9 rounded-[8px] grid place-items-center bg-[#111111] border border-[#262626] text-[#a1a1aa] shrink-0"
          aria-hidden="true"
        >
          <lucide-icon [img]="icons.PackagePlus" [size]="18" [strokeWidth]="1.5"></lucide-icon>
        </div>
      </div>

      <!-- Selector de modo principal (Individual vs Carga Masiva) -->
      <div
        class="tab-switch w-full sm:w-auto"
        role="tablist"
        aria-label="Modo de recepción"
      >
        <button
          type="button"
          role="tab"
          class="tab-button mode-button"
          [class.active]="receiptMode() === 'single'"
          [attr.aria-selected]="receiptMode() === 'single'"
          (click)="receiptMode.set('single')"
        >
          <lucide-icon [img]="icons.PackagePlus" [size]="16" [strokeWidth]="1.5"></lucide-icon>
          <span>Individual</span>
        </button>
        <button
          type="button"
          role="tab"
          class="tab-button mode-button"
          [class.active]="receiptMode() === 'bulk'"
          [attr.aria-selected]="receiptMode() === 'bulk'"
          (click)="receiptMode.set('bulk')"
        >
          <lucide-icon [img]="icons.Upload" [size]="16" [strokeWidth]="1.5"></lucide-icon>
          <span>Carga masiva CSV / Excel</span>
        </button>
      </div>

      <!-- ==================== PANEL 1: RECEPCIÓN INDIVIDUAL ==================== -->
      @if (receiptMode() === 'single') {
        <section id="single-receipt-panel" class="glass-panel p-6 space-y-6">
          <div
            class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#262626]"
          >
            <div>
              <h2 class="text-[15px] font-semibold text-[#fafafa]">Registrar un lote</h2>
              <p class="text-[12px] text-[#a1a1aa] mt-0.5">
                Completa los datos de la mercadería recibida.
              </p>
            </div>
            <span class="badge w-fit">UNA RECEPCIÓN</span>
          </div>

          <form
            id="receipt-single-form"
            class="grid grid-cols-1 sm:grid-cols-2 gap-4"
            (ngSubmit)="submitSingleReceipt()"
          >
            <label class="block">
              <span class="field-label">Bodega</span>
              <select
                id="receipt-single-warehouse"
                name="singleWarehouse"
                class="glass-input"
                [(ngModel)]="singleWarehouse"
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
              <span class="field-label">Registrado por</span>
              <select
                id="receipt-single-operator"
                name="singleOperator"
                class="glass-input"
                [(ngModel)]="singleOperator"
                required
              >
                <option value="">
                  {{
                    operators().length ? 'Selecciona una opción' : 'No hay operadores disponibles'
                  }}
                </option>
                @for (op of operators(); track op.id_usuario) {
                  <option [value]="String(op.id_usuario)">{{ op.nombre }}</option>
                }
              </select>
            </label>

            <label class="block">
              <span class="field-label">Código I del producto</span>
              <input
                id="receipt-sku"
                name="singleSku"
                list="receipt-product-options"
                [(ngModel)]="singleSku"
                placeholder="Ej. TKA311001901"
                required
                maxlength="40"
                class="glass-input"
              />
              <datalist id="receipt-product-options">
                @for (p of catalogOptions(); track p.sku) {
                  <option [value]="p.sku" [label]="p.nombre"></option>
                }
              </datalist>
            </label>

            <label class="block">
              <span class="field-label">Código de lote</span>
              <input
                id="receipt-lot"
                name="singleLot"
                [(ngModel)]="singleLot"
                placeholder="Ej. L-ATUN-NUEVO"
                required
                maxlength="40"
                class="glass-input"
              />
            </label>

            <label class="block">
              <span class="field-label">Cantidad recibida</span>
              <input
                id="receipt-quantity"
                name="singleQuantity"
                type="number"
                min="0.001"
                step="0.001"
                [(ngModel)]="singleQuantity"
                placeholder="0"
                required
                class="glass-input tabular-nums"
              />
            </label>

            <label class="block">
              <span class="field-label">
                Fecha de vencimiento
                <span class="text-[#a1a1aa] font-normal">(cuando corresponda)</span>
              </span>
              <input
                id="receipt-expiration"
                name="singleExpiration"
                type="date"
                [(ngModel)]="singleExpiration"
                class="glass-input"
              />
            </label>

            <label class="block sm:col-span-2">
              <span class="field-label">Motivo o referencia</span>
              <input
                id="receipt-reason"
                name="singleReason"
                [(ngModel)]="singleReason"
                maxlength="200"
                placeholder="Ej. Recepción de proveedor"
                class="glass-input"
              />
            </label>

            <div
              class="sm:col-span-2 pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <p class="hint max-w-xl">
                Los productos con trazabilidad requieren fecha de vencimiento. Si vuelves a recibir
                el mismo lote, la fecha debe coincidir.
              </p>
              <button
                type="submit"
                class="btn btn-primary w-full sm:w-auto"
                [disabled]="singleSubmitting()"
              >
                <span>{{ singleSubmitting() ? 'Registrando…' : 'Registrar recepción' }}</span>
                <lucide-icon [img]="icons.ArrowRight" [size]="15" [strokeWidth]="1.5"></lucide-icon>
              </button>
            </div>
          </form>

          @if (singleFeedback(); as fb) {
            <div
              id="receipt-single-result"
              role="status"
              aria-live="polite"
              class="glass-subtle p-4 border border-[#262626]"
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
            </div>
          }
        </section>
      }

      <!-- ==================== PANEL 2: CARGA MASIVA CSV / EXCEL ==================== -->
      @if (receiptMode() === 'bulk') {
        <section id="bulk-receipt-panel" class="glass-panel p-6 space-y-6">
          <div
            class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#262626]"
          >
            <div>
              <h2 class="text-[15px] font-semibold text-[#fafafa]">Importar recepciones</h2>
              <p class="text-[12px] text-[#a1a1aa] mt-0.5">
                Carga varias filas con un CSV o transforma una lista de precios Excel.
              </p>
            </div>
            <span class="badge w-fit">CSV · XLSX</span>
          </div>

          <!-- Sub-pestañas de formato (CSV estructurado vs Lista de precios Excel) -->
          <div
            class="tab-switch w-full sm:w-auto"
            role="tablist"
            aria-label="Formato de carga masiva"
          >
            <button
              type="button"
              role="tab"
              class="tab-button format-button"
              [class.active]="bulkFormat() === 'csv'"
              [attr.aria-selected]="bulkFormat() === 'csv'"
              (click)="bulkFormat.set('csv')"
            >
              <lucide-icon [img]="icons.FileText" [size]="15" [strokeWidth]="1.5"></lucide-icon>
              <span>CSV estructurado</span>
            </button>
            <button
              type="button"
              role="tab"
              class="tab-button format-button"
              [class.active]="bulkFormat() === 'excel'"
              [attr.aria-selected]="bulkFormat() === 'excel'"
              (click)="bulkFormat.set('excel')"
            >
              <lucide-icon
                [img]="icons.FileSpreadsheet"
                [size]="15"
                [strokeWidth]="1.5"
              ></lucide-icon>
              <span>Lista de precios Excel</span>
            </button>
          </div>

          <!-- ---------- SUBMODO A: CSV ESTRUCTURADO ---------- -->
          @if (bulkFormat() === 'csv') {
            <form
              id="receipt-bulk-form"
              class="grid grid-cols-1 sm:grid-cols-2 gap-4"
              (ngSubmit)="submitBulkCsv()"
            >
              <label class="block">
                <span class="field-label">Bodega para estas filas</span>
                <select
                  id="receipt-bulk-warehouse"
                  name="bulkWarehouse"
                  class="glass-input"
                  [(ngModel)]="bulkWarehouse"
                  required
                >
                  <option value="">
                    {{
                      warehouses().length ? 'Selecciona una opción' : 'No hay bodegas disponibles'
                    }}
                  </option>
                  @for (w of warehouses(); track w.id_bodega) {
                    <option [value]="String(w.id_bodega)">{{ w.nombre }}</option>
                  }
                </select>
              </label>

              <label class="block">
                <span class="field-label">Registrado por</span>
                <select
                  id="receipt-bulk-operator"
                  name="bulkOperator"
                  class="glass-input"
                  [(ngModel)]="bulkOperator"
                  required
                >
                  <option value="">
                    {{
                      operators().length
                        ? 'Selecciona una opción'
                        : 'No hay operadores disponibles'
                    }}
                  </option>
                  @for (op of operators(); track op.id_usuario) {
                    <option [value]="String(op.id_usuario)">{{ op.nombre }}</option>
                  }
                </select>
              </label>

              <div class="sm:col-span-2 space-y-3">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span class="field-label mb-1">Archivo CSV</span>
                    <p class="hint">
                      Columnas: <code class="text-[#fafafa]">sku</code>,
                      <code class="text-[#fafafa]">codigo_lote</code>,
                      <code class="text-[#fafafa]">cantidad</code>; fecha y motivo son opcionales.
                      Para crear productos que aún no existen, usa la pestaña Lista de precios Excel.
                    </p>
                  </div>
                  <button
                    id="bulk-template"
                    type="button"
                    class="btn btn-ghost btn-sm shrink-0"
                    (click)="downloadReceiptTemplate()"
                  >
                    <lucide-icon
                      [img]="icons.Download"
                      [size]="15"
                      [strokeWidth]="1.5"
                    ></lucide-icon>
                    <span>Descargar plantilla</span>
                  </button>
                </div>

                <label
                  for="receipt-csv-file"
                  class="glass-subtle p-5 border border-dashed border-[#262626] hover:bg-[#171717] transition-colors flex items-center gap-4 cursor-pointer"
                >
                  <div
                    class="w-10 h-10 rounded-[8px] grid place-items-center bg-[#171717] border border-[#262626] text-[#fafafa] shrink-0"
                  >
                    <lucide-icon [img]="icons.Upload" [size]="18" [strokeWidth]="1.5"></lucide-icon>
                  </div>
                  <div class="min-w-0">
                    <strong class="block text-[13px] font-medium text-[#fafafa] truncate">
                      {{ csvFile() ? csvFile()!.name : 'Elige un CSV para cargar' }}
                    </strong>
                    <small class="block text-[12px] text-[#a1a1aa] mt-0.5">
                      UTF-8 · separado por coma o punto y coma · máximo 5 MiB
                    </small>
                  </div>
                  <input
                    id="receipt-csv-file"
                    type="file"
                    accept=".csv,text/csv"
                    class="sr-only"
                    (change)="onCsvFileChange($event)"
                  />
                </label>

                @if (csvFile()) {
                  <div id="receipt-file-preview" class="glass-subtle p-4 space-y-2">
                    <strong class="block text-[12px] text-[#fafafa] font-medium">
                      {{ csvFile()!.name }} · {{ (csvFile()!.size / 1024).toFixed(1) }} KB
                    </strong>
                    <pre
                      class="text-[12px] font-mono text-[#a1a1aa] overflow-x-auto whitespace-pre-wrap m-0"
                      >{{ csvPreviewLines() }}</pre
                    >
                  </div>
                }
              </div>

              <div
                class="sm:col-span-2 pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <p class="hint max-w-xl">
                  La carga es atómica: si alguna fila falla, no se registra ninguna. Combina en una
                  fila las cantidades repetidas del mismo producto y lote.
                </p>
                <button
                  id="receipt-bulk-submit"
                  type="submit"
                  class="btn btn-primary w-full sm:w-auto"
                  [disabled]="!isCsvReady() || csvSubmitting()"
                >
                  <span>
                    {{ csvSubmitting() ? 'Validando y registrando…' : 'Validar y registrar' }}
                  </span>
                  <lucide-icon
                    [img]="icons.ArrowRight"
                    [size]="15"
                    [strokeWidth]="1.5"
                  ></lucide-icon>
                </button>
              </div>
            </form>

            @if (csvFeedback(); as fb) {
              <div
                id="receipt-bulk-result"
                role="status"
                aria-live="polite"
                class="glass-subtle p-4 border border-[#262626] space-y-2"
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
                @if (fb.errors?.length) {
                  <ul
                    class="mt-2 pl-6 list-disc text-[12px] text-[#a1a1aa] space-y-1 max-h-60 overflow-y-auto scroll-area"
                  >
                    @for (err of fb.errors; track $index) {
                      <li>Fila {{ err.row }} · {{ err.field }}: {{ err.message }}</li>
                    }
                  </ul>
                }
              </div>
            }
          }

          <!-- ---------- SUBMODO B: LISTA DE PRECIOS EXCEL (.XLSX) ---------- -->
          @if (bulkFormat() === 'excel') {
            <form
              id="receipt-excel-form"
              class="grid grid-cols-1 sm:grid-cols-2 gap-4"
              (ngSubmit)="submitExcelReceipt()"
            >
              <label class="block">
                <span class="field-label">Bodega para estas filas</span>
                <select
                  id="receipt-excel-warehouse"
                  name="excelWarehouse"
                  class="glass-input"
                  [(ngModel)]="excelWarehouse"
                  required
                >
                  <option value="">
                    {{
                      warehouses().length ? 'Selecciona una opción' : 'No hay bodegas disponibles'
                    }}
                  </option>
                  @for (w of warehouses(); track w.id_bodega) {
                    <option [value]="String(w.id_bodega)">{{ w.nombre }}</option>
                  }
                </select>
              </label>

              <label class="block">
                <span class="field-label">Registrado por</span>
                <select
                  id="receipt-excel-operator"
                  name="excelOperator"
                  class="glass-input"
                  [(ngModel)]="excelOperator"
                  required
                >
                  <option value="">
                    {{
                      operators().length
                        ? 'Selecciona una opción'
                        : 'No hay operadores disponibles'
                    }}
                  </option>
                  @for (op of operators(); track op.id_usuario) {
                    <option [value]="String(op.id_usuario)">{{ op.nombre }}</option>
                  }
                </select>
              </label>

              <div class="sm:col-span-2 space-y-4">
                <div>
                  <span class="field-label mb-1">Lista de precios Excel</span>
                  <p class="hint">
                    Se busca la tabla con <code class="text-[#fafafa]">ARTICULO</code> y
                    <code class="text-[#fafafa]">UNIDAD X CAJA</code>. Solo se reciben artículos
                    con Código I o Código B único; las filas sin identificación única se omiten.
                  </p>
                </div>

                <label
                  for="receipt-excel-file"
                  class="glass-subtle p-5 border border-dashed border-[#262626] hover:bg-[#171717] transition-colors flex items-center gap-4 cursor-pointer"
                >
                  <div
                    class="w-10 h-10 rounded-[8px] grid place-items-center bg-[#171717] border border-[#262626] text-[#fafafa] shrink-0"
                  >
                    <lucide-icon
                      [img]="icons.FileSpreadsheet"
                      [size]="18"
                      [strokeWidth]="1.5"
                    ></lucide-icon>
                  </div>
                  <div class="min-w-0">
                    <strong class="block text-[13px] font-medium text-[#fafafa] truncate">
                      {{ excelFile() ? excelFile()!.name : 'Elige una planilla .xlsx' }}
                    </strong>
                    <small class="block text-[12px] text-[#a1a1aa] mt-0.5">
                      Máximo 5 MiB · se analizará antes de registrar
                    </small>
                  </div>
                  <input
                    id="receipt-excel-file"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    class="sr-only"
                    (change)="onExcelFileChange($event)"
                  />
                </label>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label class="block">
                    <span class="field-label">Hoja con los artículos</span>
                    <select
                      id="receipt-excel-sheet"
                      name="excelSheet"
                      class="glass-input"
                      [disabled]="excelSheets().length === 0 || excelAnalyzing()"
                      [ngModel]="selectedExcelSheet()"
                      (ngModelChange)="onExcelSheetChange($event)"
                      required
                    >
                      <option value="">
                        {{
                          excelAnalyzing()
                            ? 'Analizando hojas…'
                            : excelSheets().length
                              ? 'Selecciona una hoja'
                              : 'Primero selecciona un Excel'
                        }}
                      </option>
                      @for (s of excelSheets(); track s.name) {
                        <option [value]="s.name">
                          {{ s.name }} · {{ formatQuantity(s.rows) }} artículos
                        </option>
                      }
                    </select>
                  </label>

                  <label class="block">
                    <span class="field-label">
                      Vencimiento común
                      <span class="text-[#a1a1aa] font-normal">(si aplica)</span>
                    </span>
                    <input
                      id="receipt-excel-expiration"
                      name="excelExpiration"
                      type="date"
                      class="glass-input"
                      [ngModel]="excelCommonExpiration()"
                      (ngModelChange)="onExcelExpirationChange($event)"
                    />
                    <small class="block text-[11px] text-[#a1a1aa] mt-1">
                      Obligatorio si algún producto requiere trazabilidad y la planilla no trae la
                      fecha.
                    </small>
                  </label>
                </div>

                <!-- Vista previa de la planilla Excel -->
                @if (excelPreview(); as preview) {
                  @if (preview.items && preview.items.length > 0) {
                    <div id="receipt-excel-preview" class="glass-subtle overflow-hidden">
                      <div
                        id="receipt-excel-summary"
                        class="px-4 py-3 bg-[#111111] border-b border-[#262626] text-[12px] font-medium text-[#fafafa]"
                      >
                        {{ excelSummaryText() }}
                      </div>

                      <!-- Tabla de vista previa (Escritorio md+) -->
                      <div class="hidden md:block overflow-x-auto max-h-96 scroll-area">
                        <table class="data-table min-w-[780px]">
                          <thead>
                            <tr>
                              <th>Fila</th>
                              <th>Código I</th>
                              <th>Artículo</th>
                              <th class="num">Unidades iniciales</th>
                              <th>Lote generado</th>
                              <th>Vencimiento</th>
                              <th>Estado</th>
                            </tr>
                          </thead>
                          <tbody id="receipt-excel-rows">
                            @for (item of visibleExcelItems(); track item.row) {
                              <tr>
                                <td class="font-mono text-[12px] text-[#a1a1aa]">{{ item.row }}</td>
                                <td class="font-mono text-[12px] text-[#fafafa]">
                                  {{ item.sku || '—' }}
                                </td>
                                <td class="font-medium text-[#fafafa]">{{ item.nombre || '—' }}</td>
                                <td class="num font-medium">{{ item.cantidad || '—' }}</td>
                                <td class="font-mono text-[12px] text-[#a1a1aa]">
                                  {{ item.codigo_lote || '—' }}
                                </td>
                                <td class="text-[12px] text-[#a1a1aa]">
                                  {{ item.fecha_vencimiento || '—' }}
                                </td>
                                <td>
                                  <span class="badge" [ngClass]="excelStatusBadge(item)">
                                    {{ excelStatusLabel(item) }}
                                  </span>
                                </td>
                              </tr>
                            }
                          </tbody>
                        </table>
                      </div>

                      <!-- Tarjetas de vista previa (Móvil < md) -->
                      <div class="grid md:hidden gap-2.5 p-3 max-h-96 overflow-y-auto scroll-area">
                        @for (item of visibleExcelItems(); track item.row) {
                          <div class="p-3 rounded-[6px] bg-[#111111] border border-[#262626] space-y-1">
                            <div class="flex items-center justify-between gap-2">
                              <span class="text-[11px] font-mono text-[#a1a1aa]">
                                Fila {{ item.row }} · {{ item.sku || '—' }}
                              </span>
                              <span class="badge" [ngClass]="excelStatusBadge(item)">
                                {{ excelStatusLabel(item) }}
                              </span>
                            </div>
                            <div class="text-[12px] font-medium text-[#fafafa]">
                              {{ item.nombre || '—' }}
                            </div>
                            <div class="text-[11px] text-[#a1a1aa] flex justify-between">
                              <span>Cant: {{ item.cantidad || '—' }}</span>
                              <span class="font-mono">{{ item.codigo_lote || '—' }}</span>
                            </div>
                          </div>
                        }
                      </div>
                    </div>
                  }
                }
              </div>

              <label
                class="sm:col-span-2 glass-subtle p-3.5 flex items-start gap-3 cursor-pointer"
              >
                <input
                  id="receipt-excel-lot-confirm"
                  name="excelLotConfirm"
                  type="checkbox"
                  [(ngModel)]="excelLotConfirmed"
                  required
                  class="mt-0.5 w-4 h-4 accent-[#fafafa]"
                />
                <span class="text-[12px] text-[#fafafa] leading-relaxed">
                  Confirmo que la lista no trae lotes reales y acepto generar códigos internos para
                  esta recepción.
                </span>
              </label>

              <div class="sm:col-span-2 hint glass-subtle p-3.5">
                El archivo no contiene lotes. Se creará un código interno por artículo y fila,
                visible en el historial. Esto no sustituye el lote real del proveedor. La cantidad
                recibida será exactamente <strong class="text-[#fafafa]">UNIDAD X CAJA</strong>. Los
                decimales se redondean a la precisión admitida; para artículos nuevos, UNIDAD X CAJA
                se redondea a unidades enteras. Los artículos existentes suman stock. Si el Código I
                no existe, se crea el producto con ARTICULO, PESO, UNIDAD X CAJA y PRECIO X UNIDAD;
                para crearlo se requiere Código I único. Los nuevos se crean en Lista de precios,
                como unidad y sin trazabilidad activada.
              </div>

              <div
                class="sm:col-span-2 pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <p class="hint max-w-xl">
                  Revisaremos las filas antes de guardar. Si hay un dato inválido, no se registrará
                  ninguna recepción.
                </p>
                <button
                  id="receipt-excel-submit"
                  type="submit"
                  class="btn btn-primary w-full sm:w-auto"
                  [disabled]="!canSubmitExcel() || excelSubmitting()"
                >
                  <span>
                    {{
                      excelSubmitting()
                        ? 'Validando y registrando…'
                        : 'Crear y recibir artículos'
                    }}
                  </span>
                  <lucide-icon
                    [img]="icons.ArrowRight"
                    [size]="15"
                    [strokeWidth]="1.5"
                  ></lucide-icon>
                </button>
              </div>
            </form>

            @if (excelFeedback(); as fb) {
              <div
                id="receipt-excel-result"
                role="status"
                aria-live="polite"
                class="glass-subtle p-4 border border-[#262626] space-y-2"
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
                @if (fb.errors?.length) {
                  <ul
                    class="mt-2 pl-6 list-disc text-[12px] text-[#a1a1aa] space-y-1 max-h-60 overflow-y-auto scroll-area"
                  >
                    @for (err of fb.errors; track $index) {
                      <li>Fila {{ err.row }} · {{ err.field }}: {{ err.message }}</li>
                    }
                  </ul>
                }
              </div>
            }
          }
        </section>
      }
    </section>
  `,
})
export class ReceiptPageComponent implements OnInit {
  private readonly api = inject(GhoshApiService);

  readonly String = String;
  readonly formatQuantity = formatQuantity;

  readonly icons = {
    PackagePlus,
    Upload,
    FileText,
    FileSpreadsheet,
    Download,
    ArrowRight,
    CheckCircle2,
    AlertTriangle,
    X,
  };

  readonly receiptMode = signal<'single' | 'bulk'>('single');
  readonly bulkFormat = signal<'csv' | 'excel'>('csv');

  readonly warehouses = signal<WarehouseOption[]>([]);
  readonly operators = signal<UserOption[]>([]);
  readonly catalogOptions = signal<CatalogProduct[]>([]);

  // Formulario individual
  singleWarehouse = '';
  singleOperator = '';
  singleSku = '';
  singleLot = '';
  singleQuantity: number | string = '';
  singleExpiration = '';
  singleReason = '';
  readonly singleSubmitting = signal(false);
  readonly singleFeedback = signal<ReceiptFeedback | null>(null);

  // Formulario CSV
  bulkWarehouse = '';
  bulkOperator = '';
  readonly csvFile = signal<File | null>(null);
  readonly csvPreviewLines = signal('');
  readonly csvSubmitting = signal(false);
  readonly csvFeedback = signal<ReceiptFeedback | null>(null);

  // Formulario Excel
  excelWarehouse = '';
  excelOperator = '';
  readonly excelFile = signal<File | null>(null);
  readonly selectedExcelSheet = signal('');
  readonly excelCommonExpiration = signal('');
  excelLotConfirmed = false;
  readonly excelBatchRef = signal<string | null>(null);
  readonly excelPreview = signal<ExcelPreviewResponse | null>(null);
  readonly excelAnalyzing = signal(false);
  readonly excelSubmitting = signal(false);
  readonly excelFeedback = signal<ReceiptFeedback | null>(null);

  readonly excelSheets = computed(() => this.excelPreview()?.sheets ?? []);
  readonly visibleExcelItems = computed(() => (this.excelPreview()?.items ?? []).slice(0, 30));

  readonly excelSummaryText = computed(() => {
    const data = this.excelPreview();
    if (!data) return '';
    const items = data.items ?? [];
    const omitted = data.omitted_rows ?? [];
    const newProducts = items.filter(
      (item) => item.producto_nuevo && item.status !== 'omitted',
    ).length;
    let text =
      `Hoja ${data.selected_sheet || '—'} · ` +
      `${formatQuantity(data.valid_rows || 0)} de ${formatQuantity(data.total_rows || 0)} filas listas · ` +
      `${omitted.length} omitidas por identificador ausente o repetido · ` +
      `${newProducts} productos nuevos detectados · lote interno XLS-${data.batch_ref || '—'}`;
    if (items.length > 30) {
      text += ' · vista de las primeras 30 filas';
    }
    return text;
  });

  ngOnInit(): void {
    this.loadReceiptOptions();
  }

  loadReceiptOptions(): void {
    this.api.getReceiptOptions().subscribe({
      next: (options) => {
        const warehouses = options.bodegas ?? [];
        const operators = options.operadores ?? [];
        this.warehouses.set(warehouses);
        this.operators.set(operators);

        if (warehouses.length === 1) {
          const id = String(warehouses[0].id_bodega);
          this.singleWarehouse = id;
          this.bulkWarehouse = id;
          this.excelWarehouse = id;
        }
        if (operators.length === 1) {
          const id = String(operators[0].id_usuario);
          this.singleOperator = id;
          this.bulkOperator = id;
          this.excelOperator = id;
        }
      },
      error: (err) => {
        this.singleFeedback.set({
          success: false,
          title: 'No se cargaron las opciones',
          message: this.api.extractErrorMessage(
            err,
            'No se pudieron cargar las opciones de recepción.',
          ),
        });
      },
    });

    this.api.getCatalogProducts({ limit: 100 }).subscribe({
      next: (catalog) => {
        this.catalogOptions.set(catalog.items ?? []);
      },
    });
  }

  submitSingleReceipt(): void {
    if (
      !this.singleWarehouse ||
      !this.singleOperator ||
      !this.singleSku.trim() ||
      !this.singleLot.trim() ||
      !this.singleQuantity
    ) {
      return;
    }

    this.singleSubmitting.set(true);
    this.singleFeedback.set(null);

    this.api
      .registerSingleReceipt({
        sku: this.singleSku.trim(),
        id_bodega: Number(this.singleWarehouse),
        codigo_lote: this.singleLot.trim(),
        cantidad: this.singleQuantity,
        fecha_vencimiento: this.singleExpiration || null,
        id_usuario: Number(this.singleOperator),
        motivo: this.singleReason.trim() || 'Recepción de mercadería',
      })
      .subscribe({
        next: (data) => {
          this.singleSubmitting.set(false);
          this.singleFeedback.set({
            success: true,
            title: 'Recepción registrada',
            message: `${formatQuantity(data.cantidad_recibida)} unidades añadidas al lote ${
              data.codigo_lote
            }. Total físico: ${formatQuantity(
              data.cantidad_fisica_lote,
            )}. El stock por bodega se consulta en Nota de venta.`,
          });
        },
        error: (err) => {
          this.singleSubmitting.set(false);
          this.singleFeedback.set({
            success: false,
            title: 'No se pudo registrar',
            message: this.api.extractErrorMessage(err, 'No se pudo registrar la recepción.'),
          });
        },
      });
  }

  // ---------- Lógica CSV ----------
  onCsvFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.csvFile.set(file);
    this.csvFeedback.set(null);

    if (!file) {
      this.csvPreviewLines.set('');
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      this.csvFeedback.set({
        success: false,
        title: 'Archivo demasiado grande',
        message: 'El máximo permitido es 5 MiB.',
      });
    }

    file
      .text()
      .then((content) => {
        const lines = content
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 4)
          .join('\n');
        this.csvPreviewLines.set(lines);
      })
      .catch(() => {
        this.csvPreviewLines.set('No se pudo leer la vista previa.');
      });
  }

  isCsvReady(): boolean {
    const file = this.csvFile();
    return Boolean(
      file &&
        file.size > 0 &&
        file.size <= MAX_FILE_BYTES &&
        this.bulkWarehouse &&
        this.bulkOperator,
    );
  }

  submitBulkCsv(): void {
    const file = this.csvFile();
    if (!file || !this.isCsvReady()) return;

    this.csvSubmitting.set(true);
    this.csvFeedback.set(null);

    this.api
      .importReceiptsCsv(file, Number(this.bulkWarehouse), Number(this.bulkOperator))
      .subscribe({
        next: (data) => {
          this.csvSubmitting.set(false);
          this.csvFeedback.set({
            success: true,
            title: 'Carga completada',
            message: `${data.received} recepciones registradas correctamente. Cada lote quedó asociado a su movimiento. El stock por bodega se consulta en Nota de venta.`,
          });
          this.csvFile.set(null);
          this.csvPreviewLines.set('');
        },
        error: (err: unknown) => {
          this.csvSubmitting.set(false);
          const errors =
            err instanceof HttpErrorResponse && Array.isArray(err.error?.errors)
              ? (err.error.errors as RowValidationError[])
              : [];
          this.csvFeedback.set({
            success: false,
            title: errors.length ? 'No se registró ninguna fila' : 'No se pudo completar la carga',
            message: errors.length
              ? 'Corrige los errores indicados y vuelve a cargar el archivo.'
              : this.api.extractErrorMessage(err, 'No se pudo conectar con la API.'),
            errors,
          });
        },
      });
  }

  downloadReceiptTemplate(): void {
    const content =
      'sku,codigo_lote,cantidad,fecha_vencimiento,motivo\nTKA311001901,L-ATUN-NUEVO,12,,Recepción de proveedor\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plantilla-recepciones.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Lógica Excel ----------
  onExcelFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.excelFile.set(file);
    this.excelBatchRef.set(null);
    this.excelPreview.set(null);
    this.selectedExcelSheet.set('');
    this.excelFeedback.set(null);

    if (file) {
      this.previewExcel();
    }
  }

  onExcelSheetChange(sheet: string): void {
    this.selectedExcelSheet.set(sheet);
    if (this.excelFile()) {
      this.previewExcel();
    }
  }

  onExcelExpirationChange(expiration: string): void {
    this.excelCommonExpiration.set(expiration);
    if (this.excelFile()) {
      this.previewExcel();
    }
  }

  previewExcel(): void {
    const file = this.excelFile();
    if (!file) return;

    this.excelPreview.set(null);
    this.excelFeedback.set(null);

    if (file.size === 0 || file.size > MAX_FILE_BYTES) {
      this.excelFeedback.set({
        success: false,
        title: 'No se puede analizar',
        message: 'El archivo debe tener contenido y pesar como máximo 5 MiB.',
      });
      return;
    }

    this.excelAnalyzing.set(true);

    this.api
      .previewReceiptsExcel({
        file,
        hoja: this.selectedExcelSheet() || undefined,
        fecha_vencimiento: this.excelCommonExpiration() || undefined,
        batch_ref: this.excelBatchRef(),
      })
      .subscribe({
        next: (data) => {
          this.excelAnalyzing.set(false);
          this.excelPreview.set(data);
          this.excelBatchRef.set(data.batch_ref || null);

          if (data.selected_sheet) {
            this.selectedExcelSheet.set(data.selected_sheet);
          }

          const errors = data.errors ?? [];
          const omitted = data.omitted_rows ?? [];
          const repeatedIdentifiers = omitted.filter((item) =>
            ['duplicate_identifier_in_file', 'duplicate_barcode_in_file'].includes(item.code),
          );

          if (data.items && data.items.length > 0) {
            if (errors.length > 0) {
              this.excelFeedback.set({
                success: false,
                title: `${errors.length} error${errors.length === 1 ? '' : 'es'} en la planilla`,
                message: 'No se ha registrado inventario. Corrige estas filas y vuelve a analizar.',
                errors: [...errors, ...repeatedIdentifiers],
              });
            } else if (omitted.length > 0) {
              this.excelFeedback.set({
                success: true,
                title: 'Vista previa lista con filas omitidas',
                message: `${omitted.length} fila${
                  omitted.length === 1 ? ' omitida' : 's omitidas'
                } por identificadores ausentes, repetidos o no únicos. Las demás filas identificadas sí pueden recibirse.`,
                errors: repeatedIdentifiers,
              });
            } else {
              this.excelFeedback.set({
                success: true,
                title: 'Vista previa lista',
                message:
                  'Los artículos existentes sumarán stock; los nuevos se crearán con los datos de la planilla. Aún no se ha guardado ningún movimiento.',
              });
            }
          } else if (errors.length > 0) {
            this.excelFeedback.set({
              success: false,
              title: 'No se encontró una tabla compatible',
              message: errors[0].message,
              errors,
            });
          } else if ((data.sheets ?? []).length > 1) {
            this.excelFeedback.set({
              success: true,
              title: 'Elige la hoja que quieres recibir',
              message: `Se detectaron ${data.sheets.length} hojas compatibles. Cada hoja puede tener precios distintos.`,
            });
          }
        },
        error: (err) => {
          this.excelAnalyzing.set(false);
          this.excelFeedback.set({
            success: false,
            title: 'No se pudo analizar',
            message: this.api.extractErrorMessage(err, 'No se pudo analizar la planilla.'),
          });
        },
      });
  }

  canSubmitExcel(): boolean {
    const preview = this.excelPreview();
    return Boolean(
      this.excelFile() &&
        this.excelWarehouse &&
        this.excelOperator &&
        preview &&
        preview.selected_sheet &&
        preview.batch_ref &&
        preview.valid_rows > 0 &&
        (preview.errors ?? []).length === 0 &&
        this.excelLotConfirmed,
    );
  }

  submitExcelReceipt(): void {
    const file = this.excelFile();
    const preview = this.excelPreview();
    if (!file || !preview || !preview.selected_sheet || !preview.batch_ref || !this.canSubmitExcel()) {
      return;
    }

    this.excelSubmitting.set(true);
    this.excelFeedback.set(null);

    this.api
      .importReceiptsExcel({
        file,
        id_bodega: Number(this.excelWarehouse),
        id_usuario: Number(this.excelOperator),
        hoja: preview.selected_sheet,
        batch_ref: preview.batch_ref,
        acepta_lote_interno: this.excelLotConfirmed,
        fecha_vencimiento: this.excelCommonExpiration() || undefined,
      })
      .subscribe({
        next: (data) => {
          this.excelSubmitting.set(false);
          const repeated = (data.omitted_details ?? []).filter((item) =>
            ['duplicate_identifier_in_file', 'duplicate_barcode_in_file'].includes(item.code),
          );
          this.excelFeedback.set({
            success: true,
            title: 'Recepción registrada',
            message: `${data.created_products} productos nuevos creados y ${
              data.existing_products
            } existentes con stock actualizado; ${
              data.omitted_rows || 0
            } filas omitidas por identificadores ausentes, repetidos o no únicos. Se registró un movimiento auditable por artículo. Referencia de lote: XLS-${
              data.batch_ref
            }.`,
            errors: repeated,
          });
          this.excelFile.set(null);
          this.excelPreview.set(null);
          this.excelBatchRef.set(null);
          this.selectedExcelSheet.set('');
          this.excelLotConfirmed = false;
        },
        error: (err: unknown) => {
          this.excelSubmitting.set(false);
          if (err instanceof HttpErrorResponse && err.error) {
            const body = err.error;
            const omittedDetails: RowValidationError[] = Array.isArray(body.omitted_details)
              ? body.omitted_details
              : Array.isArray(body.omitted_rows)
                ? body.omitted_rows
                : [];
            const repeated = omittedDetails.filter((item) =>
              ['duplicate_identifier_in_file', 'duplicate_barcode_in_file'].includes(item.code),
            );
            const errors: RowValidationError[] = Array.isArray(body.errors) ? body.errors : [];
            this.excelFeedback.set({
              success: false,
              title: 'No se registró ninguna fila',
              message: 'Corrige los errores indicados y vuelve a analizar.',
              errors: [...errors, ...repeated],
            });
            return;
          }
          this.excelFeedback.set({
            success: false,
            title: 'No se pudo completar la carga',
            message: this.api.extractErrorMessage(err, 'No se pudo conectar con la API.'),
          });
        },
      });
  }

  excelStatusBadge(item: ExcelPreviewItem): string {
    switch (item.status) {
      case 'error':
        return 'badge-rose';
      case 'new':
        return 'badge-lime';
      case 'omitted':
        return 'badge-amber';
      default:
        return 'badge-emerald';
    }
  }

  excelStatusLabel(item: ExcelPreviewItem): string {
    switch (item.status) {
      case 'error':
        return 'Revisar';
      case 'new':
        return 'Se creará';
      case 'omitted':
        return 'Omitido';
      default:
        return 'Existente';
    }
  }
}
