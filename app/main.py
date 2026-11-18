"""API base de GHOSH (ticket GHOSH-4)."""
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app.analytics import build_demand_csv, demand_ranking, inventory_alerts

from app.catalog import CatalogAuditRequest, MAX_CSV_BYTES, catalog_audit_history, catalog_audit_options, delete_catalog_product, import_catalog_rows, search_catalog, set_product_active, validate_csv
from app.db import pool
from app.inventory import BulkReceiptError, ReceiptRequest, ShrinkageRequest, import_receipts, movement_history, parse_receipt_csv, purge_inventory_stock, receipt_options, receive_goods, register_stock_shrinkage
from app.pdf_generator import build_sale_note_pdf
from app.sales import CancelOrderRequest, DispatchOrderRequest, ExpireReservationsRequest, FrequentClientRequest, SaleRequest, cancel_order, create_sale, dispatch_order, expire_reservations, get_sale_note, list_orders, list_sale_notes, sale_options, save_frequent_client
from app.receipt_excel import MAX_EXCEL_BYTES, preview_receipt_workbook


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open(wait=False)  # no bloquea el arranque si la base aún no responde
    yield
    pool.close()


app = FastAPI(title="GHOSH · Inventario, pedidos y ventas", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

_FRONTEND_CANDIDATES = (
    Path(__file__).resolve().parent.parent / "frontend" / "dist" / "ghosh" / "browser",
    Path("/srv/frontend_dist"),
)


def _frontend_dir() -> Path | None:
    for directory in _FRONTEND_CANDIDATES:
        if (directory / "index.html").is_file():
            return directory
    return None


@app.get("/health", tags=["sistema"])
def health():
    """Estado de la API y de la conexión a PostgreSQL."""
    try:
        with pool.connection(timeout=3) as conn:
            conn.execute("SELECT 1")
    except Exception:
        return JSONResponse(status_code=503, content={"status": "degraded", "db": "error"})
    return {"status": "ok", "db": "ok"}


@app.post("/catalog/import", tags=["catalogo"])
async def import_catalog(request: Request):
    """Valida e importa el catálogo completo desde un cuerpo CSV UTF-8."""
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_CSV_BYTES:
        return JSONResponse(status_code=413, content={
            "status": "rejected", "total_rows": 0, "loaded": 0,
            "errors": [{"row": 1, "field": "_file", "code": "file_too_large", "message": "El archivo supera el máximo de 5 MiB."}],
        })
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_CSV_BYTES:
            return JSONResponse(status_code=413, content={
                "status": "rejected", "total_rows": 0, "loaded": 0,
                "errors": [{"row": 1, "field": "_file", "code": "file_too_large", "message": "El archivo supera el máximo de 5 MiB."}],
            })
        chunks.append(chunk)

    rows, errors, total_rows = validate_csv(b"".join(chunks))
    if errors:
        return JSONResponse(status_code=422, content={
            "status": "rejected", "total_rows": total_rows, "loaded": 0, "errors": errors,
        })
    try:
        with pool.connection() as conn:
            errors = import_catalog_rows(conn, rows)
    except RuntimeError as exc:
        message = str(exc)
        if message.startswith("duplicate_sku:"):
            _, row_number, sku = message.split(":", 2)
            errors = [{"row": int(row_number), "field": "sku", "code": "duplicate_in_database", "message": f"El SKU '{sku}' ya existe en el catálogo."}]
        else:
            raise
    if errors:
        return JSONResponse(status_code=422, content={
            "status": "rejected", "total_rows": total_rows, "loaded": 0, "errors": errors,
        })
    return {"status": "imported", "total_rows": total_rows, "loaded": len(rows), "errors": []}


@app.post("/inventory/receipts", status_code=201, tags=["inventario"])
def register_receipt(receipt: ReceiptRequest):
    """Registra la recepción de mercadería por SKU, bodega y lote."""
    with pool.connection() as conn:
        return receive_goods(conn, receipt)


@app.get("/inventory/movements", tags=["inventario"])
def list_inventory_movements(
    sku: str | None = None,
    codigo_lote: str | None = None,
    tipo: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Consulta el historial de movimientos, filtrable por SKU/nombre, lote y categoría."""
    with pool.connection() as conn:
        return movement_history(conn, sku=sku, codigo_lote=codigo_lote, tipo=tipo, limit=limit, offset=offset)


@app.get("/", include_in_schema=False)
def dashboard():
    """Sirve la interfaz web de inventario (Angular SPA o respaldo estático)."""
    frontend = _frontend_dir()
    if frontend is not None:
        return FileResponse(frontend / "index.html")
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/catalog/products", tags=["catalogo"])
def list_catalog_products(
    q: str | None = Query(default=None, max_length=120),
    categoria: str | None = Query(default=None, max_length=60),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    id_bodega: int | None = Query(default=None, gt=0),
    incluir_inactivos: bool = Query(default=False),
):
    """Busca productos activos; incluye retirados cuando se solicita."""
    with pool.connection() as conn:
        return search_catalog(conn, q=q, categoria=categoria, limit=limit, offset=offset, id_bodega=id_bodega, incluir_inactivos=incluir_inactivos)

@app.patch("/catalog/products/{sku}/status", tags=["catalogo"])
def update_catalog_product_status(
    sku: str,
    activo: bool = Body(embed=True),
    id_usuario: int | None = Body(default=None, embed=True),
    motivo: str | None = Body(default=None, embed=True),
):
    """Da de baja o reactiva un producto conservando lotes y movimientos."""
    with pool.connection() as conn:
        audit = CatalogAuditRequest(id_usuario=id_usuario, motivo=motivo) if not activo else None
        return set_product_active(conn, sku, activo, audit)
@app.delete("/catalog/products/{sku}", tags=["catalogo"])
def remove_catalog_product(sku: str, audit: CatalogAuditRequest):
    """Elimina un producto del catálogo y libera sus códigos, conservando su historial."""
    with pool.connection() as conn:
        return delete_catalog_product(conn, sku, audit)

@app.post("/catalog/products/{sku}/shrinkage", tags=["catalogo"])
def record_catalog_product_shrinkage(sku: str, payload: ShrinkageRequest):
    """Registra una merma de stock auditable descontando por FEFO de los lotes del producto."""
    with pool.connection() as conn:
        return register_stock_shrinkage(conn, sku, payload)

@app.get("/catalog/audit-options", tags=["catalogo"])
def get_catalog_audit_options():
    """Lista responsables válidos para retiros y eliminaciones auditables."""
    with pool.connection() as conn:
        return catalog_audit_options(conn)

@app.get("/catalog/audit", tags=["catalogo"])
def list_catalog_audit(
    sku: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Consulta el registro de retiros y eliminaciones del catálogo."""
    with pool.connection() as conn:
        return catalog_audit_history(conn, sku=sku, limit=limit, offset=offset)

@app.get("/inventory/receipt-options", tags=["inventario"])
def get_receipt_options():
    """Lista bodegas y operadores habilitados para registrar recepciones."""
    with pool.connection() as conn:
        return receipt_options(conn)


@app.post("/inventory/purge-stock", tags=["inventario"])
def reset_all_inventory_stock():
    """Deja el stock de todos los productos en 0 sin eliminarlos, registrando '(testeo de purga)' en movimientos."""
    with pool.connection() as conn:
        return purge_inventory_stock(conn)


@app.post("/inventory/receipts/import", status_code=201, tags=["inventario"])
async def import_receipts_csv(
    request: Request,
    id_bodega: int = Query(gt=0),
    id_usuario: int = Query(gt=0),
):
    """Valida e importa recepciones CSV en una única transacción."""
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > 5 * 1024 * 1024:
        return JSONResponse(status_code=413, content={
            "status": "rejected", "total_rows": 0, "received": 0,
            "errors": [{"row": 1, "field": "_file", "code": "file_too_large", "message": "El archivo supera el máximo de 5 MiB."}],
        })
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 5 * 1024 * 1024:
            return JSONResponse(status_code=413, content={
                "status": "rejected", "total_rows": 0, "received": 0,
                "errors": [{"row": 1, "field": "_file", "code": "file_too_large", "message": "El archivo supera el máximo de 5 MiB."}],
            })
        chunks.append(chunk)
    rows, errors, total_rows = parse_receipt_csv(b"".join(chunks), id_bodega, id_usuario)
    if errors:
        return JSONResponse(status_code=422, content={
            "status": "rejected", "total_rows": total_rows, "received": 0, "errors": errors,
        })
    try:
        with pool.connection() as conn:
            results = import_receipts(conn, rows)
    except BulkReceiptError as exc:
        return JSONResponse(status_code=422, content={
            "status": "rejected", "total_rows": total_rows, "received": 0, "errors": exc.errors,
        })
    return {"status": "received", "total_rows": total_rows, "received": len(results), "items": results}

async def _read_excel_content(request: Request) -> bytes | None:
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_EXCEL_BYTES:
        return None
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_EXCEL_BYTES:
            return None
        chunks.append(chunk)
    return b"".join(chunks)


def _excel_too_large():
    return JSONResponse(status_code=413, content={
        "status": "rejected", "total_rows": 0, "valid_rows": 0, "received": 0,
        "errors": [{"row": 1, "field": "_file", "code": "file_too_large", "message": "El archivo supera el máximo de 5 MiB."}],
    })


@app.post("/inventory/receipts/excel/preview", tags=["inventario"])
async def preview_receipt_excel(
    request: Request,
    hoja: str | None = Query(default=None, max_length=31),
    fecha_vencimiento: date | None = None,
    batch_ref: str | None = Query(default=None, max_length=8),
):
    """Analiza una hoja de precios y muestra las recepciones que generaría."""
    content = await _read_excel_content(request)
    if content is None:
        return _excel_too_large()
    with pool.connection() as conn:
        result = preview_receipt_workbook(conn, content, hoja, fecha_vencimiento, batch_ref)
    result.pop("rows", None)
    return result


@app.post("/inventory/receipts/excel/import", status_code=201, tags=["inventario"])
async def import_receipts_excel(
    request: Request,
    id_bodega: int = Query(gt=0),
    id_usuario: int = Query(gt=0),
    hoja: str = Query(min_length=1, max_length=31),
    fecha_vencimiento: date | None = None,
    batch_ref: str = Query(min_length=8, max_length=8),
    acepta_lote_interno: bool = Query(default=False),
):
    """Importa una hoja Excel completa como recepción inicial, sin escrituras parciales."""
    content = await _read_excel_content(request)
    if content is None:
        return _excel_too_large()
    if not acepta_lote_interno:
        return JSONResponse(status_code=422, content={
            "status": "rejected", "total_rows": 0, "received": 0,
            "errors": [{"row": 1, "field": "codigo_lote", "code": "lot_confirmation_required", "message": "Confirma que se crearán códigos internos de lote porque la planilla no informa el lote del proveedor."}],
        })
    with pool.connection() as conn:
        plan = preview_receipt_workbook(conn, content, hoja, fecha_vencimiento, batch_ref)
        rows = plan.pop("rows", [])
        omitted_rows = plan.get("omitted_rows", [])
        if plan["errors"]:
            return JSONResponse(status_code=422, content={
                **plan, "status": "rejected", "received": 0,
            })
        if not rows:
            return JSONResponse(status_code=422, content={
                **plan, "status": "rejected", "received": 0,
                "errors": [{"row": 1, "field": "codigo_i", "code": "no_identified_rows", "message": "No hay artículos con un Código I o Código B único para recibir."}],
            })
        new_products = [
            {"row": row["row"], **row["nuevo_producto"]}
            for row in rows if row.get("nuevo_producto")
        ]
        receipt_rows = [
            (row["row"], ReceiptRequest(
                sku=row["sku"],
                id_bodega=id_bodega,
                codigo_lote=row["codigo_lote"],
                cantidad=row["cantidad"],
                fecha_vencimiento=row["fecha_vencimiento"],
                id_usuario=id_usuario,
                motivo=row["motivo"],
            ))
            for row in rows
        ]
        try:
            results = import_receipts(conn, receipt_rows, new_products)
        except BulkReceiptError as exc:
            return JSONResponse(status_code=422, content={
                "status": "rejected", "selected_sheet": hoja, "batch_ref": batch_ref,
                "total_rows": plan["total_rows"], "received": 0,
                "omitted_rows": len(omitted_rows), "omitted_details": omitted_rows, "errors": exc.errors,
            })
    created_products = sum(1 for item in results if item.get("producto_creado"))
    return {
        "status": "received", "selected_sheet": hoja, "batch_ref": batch_ref,
        "total_rows": plan["total_rows"], "omitted_rows": len(omitted_rows), "omitted_details": omitted_rows, "received": len(results),
        "created_products": created_products, "existing_products": len(results) - created_products,
        "items": [{"row": item["row"], **{key: value for key, value in item.items() if key != "row"}} for item in results],
    }

@app.get("/sales/options", tags=["ventas"])
def get_sale_options():
    """Lista bodegas, vendedores activos y clientes frecuentes disponibles para las notas."""
    with pool.connection() as conn:
        return sale_options(conn)


@app.post("/sales/frequent-clients", status_code=201, tags=["ventas"])
def post_frequent_client(client: FrequentClientRequest):
    """Guarda o actualiza un cliente frecuente con alias y dirección de entrega."""
    with pool.connection() as conn:
        return save_frequent_client(conn, client)


@app.get("/sales/notes", tags=["ventas"])
def get_sale_notes(
    q: str | None = Query(default=None, max_length=120),
    id_bodega: int | None = Query(default=None, gt=0),
    numero: int | None = Query(default=None, gt=0),
    id_pedido: int | None = Query(default=None, gt=0),
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    estado: str | None = Query(default=None, max_length=30),
    id_vendedor: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Consulta contable de todas las notas de venta emitidas desde la vista SQL."""
    with pool.connection() as conn:
        return list_sale_notes(
            conn,
            q=q,
            id_bodega=id_bodega,
            numero=numero,
            id_pedido=id_pedido,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            estado=estado,
            id_vendedor=id_vendedor,
            limit=limit,
            offset=offset,
        )


@app.get("/sales/notes/{numero}", tags=["ventas"])
def get_sale_note_by_number(numero: int):
    """Consulta una nota de venta por su número correlativo."""
    with pool.connection() as conn:
        return get_sale_note(conn, numero)


@app.get("/sales/notes/{numero}/pdf", tags=["ventas"])
def download_sale_note_pdf(numero: int):
    """Genera y descarga el PDF de una nota de venta con detalle, precios confirmados y total."""
    with pool.connection() as conn:
        note = get_sale_note(conn, numero)
    pdf_bytes = build_sale_note_pdf(note)
    filename = f"nota-venta-{str(note['numero']).zfill(4)}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/sales/notes", status_code=201, tags=["ventas"])
def register_sale_note(note: SaleRequest):
    """Registra una nota de venta, genera su pedido pendiente y reserva stock FEFO."""
    with pool.connection() as conn:
        return create_sale(conn, note)


@app.get("/orders", tags=["pedidos"])
def get_orders(
    estado: str | None = Query(default=None, max_length=30),
    q: str | None = Query(default=None, max_length=120),
    id_bodega: int | None = Query(default=None, gt=0),
    numero_nota: int | None = Query(default=None, gt=0),
    id_pedido: int | None = Query(default=None, gt=0),
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Lista y audita los pedidos activos (pendientes), despachados y anulados desde notas de venta."""
    with pool.connection() as conn:
        return list_orders(
            conn,
            estado=estado,
            q=q,
            id_bodega=id_bodega,
            numero_nota=numero_nota,
            id_pedido=id_pedido,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            limit=limit,
            offset=offset,
        )


@app.post("/orders/{id_pedido}/dispatch", tags=["pedidos"])
def post_dispatch_order(id_pedido: int, payload: DispatchOrderRequest):
    """Valida estado pendiente y nota de venta vigente para marcar el pedido como despachado."""
    with pool.connection() as conn:
        return dispatch_order(conn, id_pedido, payload)


@app.post("/orders/{id_pedido}/cancel", tags=["pedidos"])
def post_cancel_order(id_pedido: int, payload: CancelOrderRequest):
    """Anula un pedido pendiente con motivo, libera reservas vigentes y audita el movimiento."""
    with pool.connection() as conn:
        return cancel_order(conn, id_pedido, payload)


@app.post("/orders/expire", tags=["pedidos"])
def post_expire_reservations(payload: ExpireReservationsRequest | None = None):
    """Expira de forma idempotente todas las reservas vencidas y restaura disponible una sola vez."""
    body = payload or ExpireReservationsRequest()
    with pool.connection() as conn:
        return expire_reservations(conn, order_id=None, id_usuario=body.id_usuario, motivo=body.motivo)


@app.post("/orders/{id_pedido}/expire", tags=["pedidos"])
def post_expire_order_reservations(id_pedido: int, payload: ExpireReservationsRequest | None = None):
    """Expira de forma idempotente las reservas vigentes de un pedido y restaura disponible una sola vez."""
    body = payload or ExpireReservationsRequest()
    with pool.connection() as conn:
        return expire_reservations(conn, order_id=id_pedido, id_usuario=body.id_usuario, motivo=body.motivo)


@app.get("/reports/demand", tags=["reportes"])
def get_demand_report(
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    id_bodega: int | None = Query(default=None, gt=0),
    categoria: str | None = Query(default=None, max_length=60),
    q: str | None = Query(default=None, max_length=120),
    incluir_sin_demanda: bool = True,
    limit: int = Query(default=20, ge=1, le=200),
):
    """Ranking de mayor y menor demanda por período excluyendo pedidos cancelados (GHOSH-18)."""
    with pool.connection() as conn:
        return demand_ranking(
            conn,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            id_bodega=id_bodega,
            categoria=categoria,
            q=q,
            incluir_sin_demanda=incluir_sin_demanda,
            limit=limit,
        )


@app.get("/reports/demand.csv", tags=["reportes"])
def get_demand_report_csv(
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    id_bodega: int | None = Query(default=None, gt=0),
    categoria: str | None = Query(default=None, max_length=60),
    q: str | None = Query(default=None, max_length=120),
    incluir_sin_demanda: bool = True,
    limit: int = Query(default=20, ge=1, le=200),
):
    """Exporta el ranking de mayor y menor demanda del período en formato CSV UTF-8 (GHOSH-18)."""
    with pool.connection() as conn:
        ranking = demand_ranking(
            conn,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            id_bodega=id_bodega,
            categoria=categoria,
            q=q,
            incluir_sin_demanda=incluir_sin_demanda,
            limit=limit,
        )
    csv_bytes = build_demand_csv(ranking)
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="ranking-demanda-ghosh.csv"'},
    )


@app.get("/inventory/alerts", tags=["inventario"])
def get_inventory_alerts(
    id_bodega: int | None = Query(default=None, gt=0),
    dias_vencimiento: int = Query(default=30, ge=0, le=3650),
    umbral_stock: Decimal = Query(default=Decimal("10"), ge=0),
    q: str | None = Query(default=None, max_length=120),
):
    """Alertas activas de stock crítico/agotado y lotes vencidos o próximos a vencer (GHOSH-19)."""
    with pool.connection() as conn:
        return inventory_alerts(
            conn,
            id_bodega=id_bodega,
            dias_vencimiento=dias_vencimiento,
            umbral_stock=umbral_stock,
            q=q,
        )


_SPA_ROUTES = frozenset({"catalogo", "ventas", "pedidos", "notas-venta", "recepcion", "movimientos", "demanda"})


@app.get("/{spa_path:path}", include_in_schema=False)
def serve_spa(spa_path: str):
    """Sirve recursos estáticos compilados de Angular y rutas SPA."""
    frontend = _frontend_dir()
    if frontend is not None:
        resolved_root = frontend.resolve()
        candidate = (resolved_root / spa_path).resolve()
        if resolved_root in candidate.parents and candidate.is_file():
            if candidate.suffix == ".webmanifest":
                return FileResponse(candidate, media_type="application/manifest+json")
            if candidate.name == "sw.js":
                return FileResponse(candidate, media_type="application/javascript")
            return FileResponse(candidate)
        if spa_path.strip("/") in _SPA_ROUTES:
            return FileResponse(resolved_root / "index.html")
    elif spa_path.strip("/") in _SPA_ROUTES:
        return FileResponse(Path(__file__).parent / "static" / "index.html")
    raise HTTPException(status_code=404, detail="Not Found")
