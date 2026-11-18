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
  auditoria?: CatalogAuditRecord | null;
}

export interface ProductDeleteResponse {
  status: 'removed_from_catalog';
  sku: string;
  nombre: string;
  codigos_liberados: boolean;
  stock_fisico_conservado: number | string;
  auditoria?: CatalogAuditRecord;
}

export interface ProductAuditPayload {
  id_usuario: number;
  motivo: string;
}

export interface CatalogAuditRecord extends ProductAuditPayload {
  id_auditoria: number;
  accion: 'retiro' | 'eliminacion' | 'merma';
  usuario: string;
  fecha: string;
}

export interface ProductShrinkagePayload {
  cantidad: string | number;
  id_usuario: number;
  motivo: string;
}

export interface ProductShrinkageResponse {
  status: 'shrinkage_recorded';
  sku: string;
  nombre: string;
  cantidad_merma: number | string;
  stock_fisico: number | string;
  lotes_afectados: number;
  auditoria: CatalogAuditRecord;
}

export interface CatalogAuditOptionsResponse {
  usuarios: UserOption[];
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

export interface FrequentClientOption {
  id_cliente: number;
  nombre_local: string;
  direccion: string;
}

export interface SaleOptionsResponse {
  bodegas: WarehouseOption[];
  vendedores: UserOption[];
  clientes_frecuentes: FrequentClientOption[];
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
  id_cliente?: number | null;
  nombre_local?: string;
  direccion_entrega?: string | null;
  guardar_cliente_frecuente?: boolean;
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
  numero: number;
  id_pedido?: number;
  estado_pedido?: string;
  id_cliente?: number | null;
  nombre_local?: string;
  direccion_entrega?: string | null;
  cliente_frecuente_guardado?: FrequentClientOption | null;
  fecha_creacion: string;
  vendedor: string;
  bodega: string;
  total: number | string;
  items: SaleResponseItem[];
}

export interface SaleNoteRecord {
  id_nota_venta: number;
  numero: number;
  fecha_creacion: string;
  id_vendedor: number;
  vendedor: string;
  id_bodega: number;
  bodega: string;
  id_pedido: number | null;
  estado_pedido: string;
  nombre_local: string;
  direccion_entrega: string | null;
  fecha_entrega: string | null;
  usuario_entrega: string | null;
  motivo_anulacion: string | null;
  fecha_anulacion: string | null;
  usuario_anulacion: string | null;
  cantidad_lineas: number;
  unidades_totales: number | string;
  total: number | string;
  items: SaleResponseItem[];
}

export interface SaleNotesSummary {
  total_notas: number;
  pendientes: number;
  despachados: number;
  anulados: number;
  monto_pendiente: number | string;
  monto_despachado: number | string;
  monto_anulado: number | string;
  monto_neto_activo: number | string;
}

export interface SaleNotesListResponse {
  summary?: SaleNotesSummary;
  bodegas?: WarehouseOption[];
  vendedores?: UserOption[];
  items: SaleNoteRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface OrderLotReservation {
  id_reserva: number;
  id_lote: number;
  codigo_lote: string;
  fecha_vencimiento: string | null;
  cantidad: number | string;
  estado_reserva: 'vigente' | 'consumida' | 'liberada' | 'expirada' | string;
  fecha_expiracion: string | null;
  sku?: string;
  producto?: string;
}

export interface OrderLineItem {
  sku: string;
  nombre: string;
  cajas: number;
  sueltos: number | string;
  unidades_por_caja: number;
  cantidad_total: number | string;
  precio_confirmado: number | string;
  subtotal: number | string;
  lotes_reservados?: OrderLotReservation[];
}

export interface OrderRecord {
  id_pedido: number;
  id_nota_venta: number | null;
  numero_nota: number | null;
  estado: 'pendiente' | 'despachado' | 'cancelado' | string;
  nombre_local: string;
  direccion_entrega: string | null;
  id_bodega: number | null;
  bodega: string;
  vendedor: string;
  usuario_entrega: string | null;
  fecha_creacion: string;
  fecha_entrega: string | null;
  motivo_anulacion: string | null;
  fecha_anulacion: string | null;
  usuario_anulacion: string | null;
  total: number | string;
  unidades_totales: number | string;
  items: OrderLineItem[];
  reservas?: OrderLotReservation[];
}

export interface OrdersSummary {
  pendientes: number;
  despachados: number;
  anulados: number;
  monto_pendiente: number | string;
  monto_despachado: number | string;
  monto_anulado: number | string;
}

export interface OrdersListResponse {
  summary: OrdersSummary;
  bodegas: WarehouseOption[];
  responsables: UserOption[];
  items: OrderRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface DispatchOrderPayload {
  id_usuario: number;
  motivo?: string;
}

export interface DispatchOrderResponse {
  status: 'dispatched';
  id_pedido: number;
  numero_nota: number;
  estado: 'despachado';
  usuario_entrega: string;
  fecha_entrega: string;
  nombre_local: string;
  bodega: string;
}

export interface CancelOrderPayload {
  id_usuario: number;
  motivo: string;
}

export interface CancelOrderResponse {
  status: 'cancelled';
  id_pedido: number;
  numero_nota: number | null;
  estado: 'cancelado';
  usuario_anulacion: string;
  fecha_anulacion: string;
  motivo_anulacion: string;
  nombre_local: string;
  bodega: string;
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

export interface DemandRankingItem {
  posicion: number;
  sku: string;
  codigo_b: string | null;
  nombre: string;
  categoria: string;
  unidad: string;
  unidades_por_caja: number;
  precio_vigente: number | string;
  pedidos_confirmados: number;
  unidades_demandadas: number | string;
  cajas_equivalentes: number | string;
  monto_demandado: number | string;
  ultima_venta: string | null;
  stock_disponible: number | string;
  participacion_pct: number | string;
}

export interface DemandRankingSummary {
  productos_evaluados: number;
  productos_con_demanda: number;
  productos_sin_demanda: number;
  pedidos_confirmados: number;
  unidades_totales: number | string;
  monto_total: number | string;
  top_sku: string | null;
  top_producto: string | null;
  top_unidades: number | string;
}

export interface DemandRankingResponse {
  summary: DemandRankingSummary;
  mas_demandados: DemandRankingItem[];
  menos_demandados: DemandRankingItem[];
  bodegas: WarehouseOption[];
  categorias: string[];
  filtros: {
    fecha_desde: string | null;
    fecha_hasta: string | null;
    id_bodega: number | null;
    categoria: string | null;
    q: string | null;
    incluir_sin_demanda: boolean;
    limit: number;
  };
}

export interface StockAlertItem {
  sku: string;
  codigo_b: string | null;
  nombre: string;
  categoria: string;
  unidad: string;
  unidades_por_caja: number;
  stock_fisico_vigente: number | string;
  stock_reservado: number | string;
  disponible: number | string;
  umbral_aplicado: number | string;
  lotes_vencidos_unidades: number | string;
  nivel_alerta: 'agotado' | 'stock_critico' | string;
}

export interface LotAlertItem {
  id_lote: number;
  codigo_lote: string;
  sku: string;
  producto: string;
  categoria: string;
  id_bodega: number;
  bodega: string;
  fecha_recepcion: string;
  fecha_vencimiento: string;
  dias_para_vencer: number;
  cantidad_fisica: number | string;
  cantidad_reservada: number | string;
  disponible_lote: number | string;
  estado_vencimiento: 'vencido' | 'vence_hoy' | 'proximo_a_vencer' | string;
}

export interface InventoryAlertsSummary {
  productos_agotados: number;
  productos_stock_critico: number;
  total_alertas_stock: number;
  lotes_vencidos: number;
  unidades_vencidas: number | string;
  lotes_proximos_a_vencer: number;
  unidades_proximas_a_vencer: number | string;
  total_alertas_lotes: number;
  dias_vencimiento: number;
  umbral_stock: number | string;
}

export interface InventoryAlertsResponse {
  summary: InventoryAlertsSummary;
  alertas_stock: StockAlertItem[];
  alertas_lotes: LotAlertItem[];
  bodegas: WarehouseOption[];
}

