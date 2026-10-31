"""API base de GHOSH (ticket GHOSH-4)."""
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.catalog import MAX_CSV_BYTES, delete_catalog_product, import_catalog_rows, search_catalog, set_product_active, validate_csv
from app.db import pool
from app.inventory import BulkReceiptError, ReceiptRequest, import_receipts, movement_history, parse_receipt_csv, receipt_options, receive_goods
from app.sales import SaleRequest, create_sale, sale_options
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
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Consulta el historial de movimientos, filtrable por SKU y lote."""
    with pool.connection() as conn:
        return movement_history(conn, sku=sku, codigo_lote=codigo_lote, limit=limit, offset=offset)


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
def update_catalog_product_status(sku: str, activo: bool = Body(embed=True)):
    """Da de baja o reactiva un producto conservando lotes y movimientos."""
    with pool.connection() as conn:
        return set_product_active(conn, sku, activo)
@app.delete("/catalog/products/{sku}", tags=["catalogo"])
def remove_catalog_product(sku: str):
    """Elimina un producto del catálogo y libera sus códigos, conservando su historial."""
    with pool.connection() as conn:
        return delete_catalog_product(conn, sku)

@app.get("/inventory/receipt-options", tags=["inventario"])
def get_receipt_options():
    """Lista bodegas y operadores habilitados para registrar recepciones."""
    with pool.connection() as conn:
        return receipt_options(conn)


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
    """Lista bodegas y vendedores activos disponibles para las notas."""
    with pool.connection() as conn:
        return sale_options(conn)


@app.post("/sales/notes", status_code=201, tags=["ventas"])
def register_sale_note(note: SaleRequest):
    """Registra una nota de venta y descuenta las unidades disponibles."""
    with pool.connection() as conn:
        return create_sale(conn, note)


_SPA_ROUTES = frozenset({"catalogo", "ventas", "recepcion", "movimientos"})


@app.get("/{spa_path:path}", include_in_schema=False)
def serve_spa(spa_path: str):
    """Sirve recursos estáticos compilados de Angular y rutas SPA."""
    frontend = _frontend_dir()
    if frontend is not None:
        resolved_root = frontend.resolve()
        candidate = (resolved_root / spa_path).resolve()
        if resolved_root in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        if spa_path.strip("/") in _SPA_ROUTES:
            return FileResponse(resolved_root / "index.html")
    elif spa_path.strip("/") in _SPA_ROUTES:
        return FileResponse(Path(__file__).parent / "static" / "index.html")
    raise HTTPException(status_code=404, detail="Not Found")
