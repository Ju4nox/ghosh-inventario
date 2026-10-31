import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap, throwError } from 'rxjs';

import {
  BulkReceiptResponse,
  CatalogSearchResponse,
  ExcelImportResponse,
  ExcelPreviewResponse,
  MovementsResponse,
  ProductDeleteResponse,
  ProductStatusResponse,
  ReceiptOptionsResponse,
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

  updateProductStatus(sku: string, activo: boolean): Observable<ProductStatusResponse> {
    return this.http
      .patch<ProductStatusResponse>(
        `/catalog/products/${encodeURIComponent(sku)}/status`,
        { activo },
      )
      .pipe(
        tap(() => this.apiOnline.set(true)),
        catchError((err) => this.handleError(err)),
      );
  }

  deleteProduct(sku: string): Observable<ProductDeleteResponse> {
    return this.http
      .delete<ProductDeleteResponse>(`/catalog/products/${encodeURIComponent(sku)}`)
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

  getMovements(options: {
    sku?: string;
    codigo_lote?: string;
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

    return this.http.get<MovementsResponse>('/inventory/movements', { params }).pipe(
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
      if (body && typeof body === 'object') {
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
