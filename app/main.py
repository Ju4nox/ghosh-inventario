"""API base de GHOSH (ticket GHOSH-4)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

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
