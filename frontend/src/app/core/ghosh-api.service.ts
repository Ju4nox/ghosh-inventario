import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';

import {
  BulkReceiptResponse,
  CancelOrderPayload,
  CancelOrderResponse,
  CatalogAuditOptionsResponse,
  CatalogSearchResponse,
  DemandRankingResponse,
  DispatchOrderPayload,
  DispatchOrderResponse,
  ExcelImportResponse,
  ExcelPreviewResponse,
  FrequentClientOption,
  InventoryAlertsResponse,
  MovementsResponse,
  OrdersListResponse,
  ProductDeleteResponse,
  ProductAuditPayload,
  ProductShrinkagePayload,
  ProductShrinkageResponse,
  ProductStatusResponse,
  PurgeStockResponse,
  ReceiptOptionsResponse,
  SaleNoteRecord,
  SaleNotesListResponse,
  SaleOptionsResponse,
  SaleRequestPayload,
  SaleResponse,
  SingleReceiptPayload,
  SingleReceiptResponse,
} from './models';

@Injectable({ providedIn: 'root' })
export class GhoshApiService {
  private readonly http = inject(HttpClient);

  /** null = conectando, true = API conectada, false = API sin conexión */
  readonly apiOnline = signal<boolean | null>(null);

  checkHealth(): Observable<boolean> {
    return this.http.get<{ status: string }>('/health').pipe(
      map((res) => res?.status === 'ok'),
      tap((ok) => this.apiOnline.set(ok)),
      catchError(() => {
        this.apiOnline.set(false);
        return of(false);
      }),
    );
  }

  getCatalogProducts(options: {
    q?: string;
    categoria?: string;
    limit?: number;
    offset?: number;
    id_bodega?: number;
    incluir_inactivos?: boolean;
  }): Observable<CatalogSearchResponse> {
    let params = new HttpParams()
      .set('limit', String(options.limit ?? 20))
      .set('offset', String(options.offset ?? 0));

    if (options.q?.trim()) {
      params = params.set('q', options.q.trim());
    }
    if (options.categoria?.trim()) {
      params = params.set('categoria', options.categoria.trim());
    }
    if (options.id_bodega && options.id_bodega > 0) {
      params = params.set('id_bodega', String(options.id_bodega));
    }
    if (options.incluir_inactivos) {
      params = params.set('incluir_inactivos', 'true');
    }

    return this.http.get<CatalogSearchResponse>('/catalog/products', { params }).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  updateProductStatus(
    sku: string,
    activo: boolean,
    audit?: ProductAuditPayload,
  ): Observable<ProductStatusResponse> {
    return this.http
      .patch<ProductStatusResponse>(
        `/catalog/products/${encodeURIComponent(sku)}/status`,
        activo ? { activo } : { activo, ...audit },
      )
      .pipe(
        tap(() => this.apiOnline.set(true)),
        catchError((err) => this.handleError(err)),
      );
  }

  deleteProduct(sku: string, audit: ProductAuditPayload): Observable<ProductDeleteResponse> {
    return this.http
      .delete<ProductDeleteResponse>(`/catalog/products/${encodeURIComponent(sku)}`, { body: audit })
      .pipe(
        tap(() => this.apiOnline.set(true)),
        catchError((err) => this.handleError(err)),
      );
  }

  getCatalogAuditOptions(): Observable<CatalogAuditOptionsResponse> {
    return this.http.get<CatalogAuditOptionsResponse>('/catalog/audit-options').pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  registerProductShrinkage(
    sku: string,
    payload: ProductShrinkagePayload,
  ): Observable<ProductShrinkageResponse> {
    return this.http
      .post<ProductShrinkageResponse>(
        `/catalog/products/${encodeURIComponent(sku)}/shrinkage`,
        payload,
      )
      .pipe(
        tap(() => this.apiOnline.set(true)),
        catchError((err) => this.handleError(err)),
      );
  }

  getReceiptOptions(): Observable<ReceiptOptionsResponse> {
    return this.http.get<ReceiptOptionsResponse>('/inventory/receipt-options').pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  purgeCatalogStock(): Observable<PurgeStockResponse> {
    return this.http.post<PurgeStockResponse>('/inventory/purge-stock', {}).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  registerSingleReceipt(payload: SingleReceiptPayload): Observable<SingleReceiptResponse> {
    return this.http.post<SingleReceiptResponse>('/inventory/receipts', payload).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  importReceiptsCsv(file: File, id_bodega: number, id_usuario: number): Observable<BulkReceiptResponse> {
    const params = new HttpParams()
      .set('id_bodega', String(id_bodega))
      .set('id_usuario', String(id_usuario));
    const headers = new HttpHeaders({ 'Content-Type': 'text/csv' });

    return this.http
      .post<BulkReceiptResponse>('/inventory/receipts/import', file, { params, headers })
      .pipe(
        tap(() => this.apiOnline.set(true)),
        catchError((err) => this.handleError(err)),
      );
  }

  previewReceiptsExcel(options: {
    file: File;
    hoja?: string;
    fecha_vencimiento?: string;
    batch_ref?: string | null;
  }): Observable<ExcelPreviewResponse> {
    let params = new HttpParams();
    if (options.hoja) params = params.set('hoja', options.hoja);
    if (options.fecha_vencimiento) params = params.set('fecha_vencimiento', options.fecha_vencimiento);
    if (options.batch_ref) params = params.set('batch_ref', options.batch_ref);

    const headers = new HttpHeaders({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    return this.http
      .post<ExcelPreviewResponse>('/inventory/receipts/excel/preview', options.file, {
        params,
        headers,
      })
      .pipe(
        tap(() => this.apiOnline.set(true)),
        catchError((err) => this.handleError(err)),
      );
  }

  importReceiptsExcel(options: {
    file: File;
    id_bodega: number;
    id_usuario: number;
    hoja: string;
    batch_ref: string;
    acepta_lote_interno: boolean;
    fecha_vencimiento?: string;
  }): Observable<ExcelImportResponse> {
    let params = new HttpParams()
      .set('id_bodega', String(options.id_bodega))
      .set('id_usuario', String(options.id_usuario))
      .set('hoja', options.hoja)
      .set('batch_ref', options.batch_ref)
      .set('acepta_lote_interno', String(options.acepta_lote_interno));

    if (options.fecha_vencimiento) {
      params = params.set('fecha_vencimiento', options.fecha_vencimiento);
    }

    const headers = new HttpHeaders({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    return this.http
      .post<ExcelImportResponse>('/inventory/receipts/excel/import', options.file, {
        params,
        headers,
      })
      .pipe(
        tap(() => this.apiOnline.set(true)),
        catchError((err) => this.handleError(err)),
      );
  }

  getSaleOptions(): Observable<SaleOptionsResponse> {
    return this.http.get<SaleOptionsResponse>('/sales/options').pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  registerSaleNote(payload: SaleRequestPayload): Observable<SaleResponse> {
    return this.http.post<SaleResponse>('/sales/notes', payload).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  saveFrequentClient(payload: {
    nombre_local: string;
    direccion: string;
  }): Observable<FrequentClientOption> {
    return this.http.post<FrequentClientOption>('/sales/frequent-clients', payload).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  getSaleNotePdfUrl(numero: number): string {
    return `/sales/notes/${numero}/pdf`;
  }

  getSaleNotes(options: {
    q?: string;
    id_bodega?: number;
    numero?: number | null;
    id_pedido?: number | null;
    fecha_desde?: string;
    fecha_hasta?: string;
    estado?: string;
    id_vendedor?: number;
    limit?: number;
    offset?: number;
  }): Observable<SaleNotesListResponse> {
    let params = new HttpParams()
      .set('limit', String(options.limit ?? 50))
      .set('offset', String(options.offset ?? 0));

    if (options.q?.trim()) {
      params = params.set('q', options.q.trim());
    }
    if (options.id_bodega && options.id_bodega > 0) {
      params = params.set('id_bodega', String(options.id_bodega));
    }
    if (options.numero && options.numero > 0) {
      params = params.set('numero', String(options.numero));
    }
    if (options.id_pedido && options.id_pedido > 0) {
      params = params.set('id_pedido', String(options.id_pedido));
    }
    if (options.fecha_desde?.trim()) {
      params = params.set('fecha_desde', options.fecha_desde.trim());
    }
    if (options.fecha_hasta?.trim()) {
      params = params.set('fecha_hasta', options.fecha_hasta.trim());
    }
    if (options.estado?.trim() && options.estado !== 'todos') {
      params = params.set('estado', options.estado.trim());
    }
    if (options.id_vendedor && options.id_vendedor > 0) {
      params = params.set('id_vendedor', String(options.id_vendedor));
    }

    return this.http.get<SaleNotesListResponse>('/sales/notes', { params }).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  getOrders(options: {
    estado?: string;
    q?: string;
    id_bodega?: number;
    numero_nota?: number | null;
    id_pedido?: number | null;
    fecha_desde?: string;
    fecha_hasta?: string;
    limit?: number;
    offset?: number;
  }): Observable<OrdersListResponse> {
    let params = new HttpParams()
      .set('limit', String(options.limit ?? 50))
      .set('offset', String(options.offset ?? 0));

    if (options.estado?.trim() && options.estado !== 'todos') {
      params = params.set('estado', options.estado.trim());
    }
    if (options.q?.trim()) {
      params = params.set('q', options.q.trim());
    }
    if (options.id_bodega && options.id_bodega > 0) {
      params = params.set('id_bodega', String(options.id_bodega));
    }
    if (options.numero_nota && options.numero_nota > 0) {
      params = params.set('numero_nota', String(options.numero_nota));
    }
    if (options.id_pedido && options.id_pedido > 0) {
      params = params.set('id_pedido', String(options.id_pedido));
    }
    if (options.fecha_desde?.trim()) {
      params = params.set('fecha_desde', options.fecha_desde.trim());
    }
    if (options.fecha_hasta?.trim()) {
      params = params.set('fecha_hasta', options.fecha_hasta.trim());
    }

    return this.http.get<OrdersListResponse>('/orders', { params }).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  dispatchOrder(idPedido: number, payload: DispatchOrderPayload): Observable<DispatchOrderResponse> {
    return this.http.post<DispatchOrderResponse>(`/orders/${idPedido}/dispatch`, payload).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  cancelOrder(idPedido: number, payload: CancelOrderPayload): Observable<CancelOrderResponse> {
    return this.http.post<CancelOrderResponse>(`/orders/${idPedido}/cancel`, payload).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  getMovements(options: {
    sku?: string;
    codigo_lote?: string;
    tipo?: string;
    limit?: number;
    offset?: number;
  }): Observable<MovementsResponse> {
    let params = new HttpParams()
      .set('limit', String(options.limit ?? 50))
      .set('offset', String(options.offset ?? 0));

    if (options.sku?.trim()) {
      params = params.set('sku', options.sku.trim());
    }
    if (options.codigo_lote?.trim()) {
      params = params.set('codigo_lote', options.codigo_lote.trim());
    }
    if (options.tipo?.trim()) {
      params = params.set('tipo', options.tipo.trim());
    }

    return this.http.get<MovementsResponse>('/inventory/movements', { params }).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  private buildDemandParams(options: {
    fecha_desde?: string;
    fecha_hasta?: string;
    id_bodega?: number;
    categoria?: string;
    q?: string;
    incluir_sin_demanda?: boolean;
    limit?: number;
  }): HttpParams {
    let params = new HttpParams()
      .set('incluir_sin_demanda', String(options.incluir_sin_demanda ?? true))
      .set('limit', String(options.limit ?? 20));

    if (options.fecha_desde?.trim()) {
      params = params.set('fecha_desde', options.fecha_desde.trim());
    }
    if (options.fecha_hasta?.trim()) {
      params = params.set('fecha_hasta', options.fecha_hasta.trim());
    }
    if (options.id_bodega) {
      params = params.set('id_bodega', String(options.id_bodega));
    }
    if (options.categoria?.trim()) {
      params = params.set('categoria', options.categoria.trim());
    }
    if (options.q?.trim()) {
      params = params.set('q', options.q.trim());
    }
    return params;
  }

  getDemandRanking(options: {
    fecha_desde?: string;
    fecha_hasta?: string;
    id_bodega?: number;
    categoria?: string;
    q?: string;
    incluir_sin_demanda?: boolean;
    limit?: number;
  }): Observable<DemandRankingResponse> {
    const params = this.buildDemandParams(options);
    return this.http.get<DemandRankingResponse>('/reports/demand', { params }).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  getDemandCsvUrl(options: {
    fecha_desde?: string;
    fecha_hasta?: string;
    id_bodega?: number;
    categoria?: string;
    q?: string;
    incluir_sin_demanda?: boolean;
    limit?: number;
  }): string {
    const query = this.buildDemandParams(options).toString();
    return query ? `/reports/demand.csv?${query}` : '/reports/demand.csv';
  }

  getInventoryAlerts(options: {
    id_bodega?: number;
    dias_vencimiento?: number;
    umbral_stock?: number;
    q?: string;
  } = {}): Observable<InventoryAlertsResponse> {
    let params = new HttpParams()
      .set('dias_vencimiento', String(options.dias_vencimiento ?? 30))
      .set('umbral_stock', String(options.umbral_stock ?? 10));

    if (options.id_bodega) {
      params = params.set('id_bodega', String(options.id_bodega));
    }
    if (options.q?.trim()) {
      params = params.set('q', options.q.trim());
    }

    return this.http.get<InventoryAlertsResponse>('/inventory/alerts', { params }).pipe(
      tap(() => this.apiOnline.set(true)),
      catchError((err) => this.handleError(err)),
    );
  }

  extractErrorMessage(error: unknown, fallback = 'No se pudo completar la operación.'): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0 || error.status === 503) {
        return 'No se pudo conectar con la API.';
      }
      const body = error.error;
      if (body && typeof body === 'object' && !(body instanceof Error)) {
        if (body.detail && typeof body.detail === 'object' && body.detail.message) {
          return String(body.detail.message);
        }
        if (typeof body.detail === 'string') {
          return body.detail;
        }
        if (Array.isArray(body.errors) && body.errors.length > 0 && body.errors[0]?.message) {
          return String(body.errors[0].message);
        }
        if (typeof body.message === 'string') {
          return body.message;
        }
      }
      if (error.status >= 500) {
        return fallback;
      }
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return fallback;
  }

  private handleError(error: HttpErrorResponse) {
    if (error.status === 0 || error.status === 503) {
      this.apiOnline.set(false);
    }
    return throwError(() => error);
  }
}
