export interface CatalogProduct {
  sku: string;
  codigo_b: string | null;
  nombre: string;
  peso: number | string;
  categoria: string;
  unidad: string;
  precio_vigente: number | string;
  precio_con_iva: number | string;
  unidades_por_caja: number;
  decimales: number;
  activo: boolean;
  disponible: number | string;
  cajas_disponibles: number;
}

export interface CatalogSearchResponse {
  items: CatalogProduct[];
  total: number;
  limit: number;
  offset: number;
  categories: string[];
}

export interface ProductStatusResponse {
  status: 'active' | 'inactive';
  sku: string;
  nombre: string;
  activo: boolean;
  stock_fisico: number | string;
}

export interface ProductDeleteResponse {
  status: 'removed_from_catalog';
  sku: string;
  nombre: string;
  codigos_liberados: boolean;
  stock_fisico_conservado: number | string;
}

export interface WarehouseOption {
  id_bodega: number;
  nombre: string;
}

export interface UserOption {
  id_usuario: number;
  nombre: string;
}

export interface ReceiptOptionsResponse {
  bodegas: WarehouseOption[];
  operadores: UserOption[];
}

export interface SaleOptionsResponse {
  bodegas: WarehouseOption[];
  vendedores: UserOption[];
}

export interface SingleReceiptPayload {
  sku: string;
  id_bodega: number;
  codigo_lote: string;
  cantidad: string | number;
  fecha_vencimiento: string | null;
  id_usuario: number;
  motivo: string;
}

export interface SingleReceiptResponse {
  status: 'received';
  id_lote: number;
  id_movimiento: number;
  sku: string;
  codigo_lote: string;
  cantidad_recibida: number | string;
  cantidad_fisica_lote: number | string;
  fecha_vencimiento: string | null;
}

export interface RowValidationError {
  row: number;
  field: string;
  code: string;
  message: string;
}

export interface BulkReceiptResponse {
  status: 'received' | 'rejected';
  total_rows: number;
  received: number;
  items?: Array<SingleReceiptResponse & { row: number; producto_creado?: boolean }>;
  errors?: RowValidationError[];
}

export interface ExcelSheetSpec {
  name: string;
  header_row: number;
  rows: number;
}

export interface ExcelPreviewItem {
  row: number;
  sku: string;
  nombre: string;
  producto_nuevo: boolean;
  cantidad: string;
  codigo_lote: string;
  fecha_vencimiento: string | null;
  status: 'ready' | 'new' | 'omitted' | 'error';
  message?: string;
}

export interface ExcelPreviewResponse {
  status: 'preview' | 'rejected' | 'choose_sheet';
  sheets: ExcelSheetSpec[];
  selected_sheet: string | null;
  batch_ref: string | null;
  header_row?: number;
  total_rows: number;
  valid_rows: number;
  omitted_rows?: RowValidationError[];
  items: ExcelPreviewItem[];
  errors: RowValidationError[];
}

export interface ExcelImportResponse {
  status: 'received' | 'rejected';
  selected_sheet: string;
  batch_ref: string;
  total_rows: number;
  omitted_rows: number;
  omitted_details?: RowValidationError[];
  received: number;
  created_products: number;
  existing_products: number;
  items?: Array<SingleReceiptResponse & { row: number; producto_creado?: boolean }>;
  errors?: RowValidationError[];
}

export interface SaleLinePayload {
  sku: string;
  cajas: number;
  sueltos: string;
}

export interface SaleRequestPayload {
  id_vendedor: number;
  id_bodega: number;
  items: SaleLinePayload[];
}

export interface SaleResponseItem {
  sku: string;
  nombre: string;
  cajas: number;
  sueltos: number | string;
  unidades_por_caja: number;
  cantidad_total: number | string;
  precio_confirmado: number | string;
  subtotal: number | string;
}

export interface SaleResponse {
  id_nota_venta: number;
  fecha_creacion: string;
  vendedor: string;
  bodega: string;
  total: number | string;
  items: SaleResponseItem[];
}

export interface InventoryMovement {
  id_movimiento: number;
  tipo: string;
  sku: string;
  producto: string;
  id_lote: number;
  codigo_lote: string;
  fecha_vencimiento: string | null;
  id_bodega: number;
  bodega: string;
  cantidad: number | string;
  fecha: string;
  motivo: string;
  id_usuario: number;
  usuario: string;
  id_pedido: number | null;
  id_nota_venta: number | null;
}

export interface MovementsResponse {
  items: InventoryMovement[];
  total: number;
  limit: number;
  offset: number;
}

export interface PurgeStockResponse {
  status: 'purged';
  lots_zeroed: number;
  units_removed: number | string;
  motivo: string;
}

