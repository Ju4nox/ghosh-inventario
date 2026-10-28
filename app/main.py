"""API base de GHOSH (ticket GHOSH-4)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.catalog import MAX_CSV_BYTES, import_catalog_rows, validate_csv
from app.db import pool


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open(wait=False)  # no bloquea el arranque si la base aún no responde
    yield
    pool.close()


app = FastAPI(title="GHOSH · Inventario y pedidos", version="0.1.0", lifespan=lifespan)


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
