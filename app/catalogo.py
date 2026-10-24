"""Catálogo de productos: búsqueda por nombre, SKU y categoría (ticket GHOSH-6)."""
from decimal import Decimal

from fastapi import APIRouter, Query
from psycopg.rows import dict_row
from pydantic import BaseModel

from app.db import pool

router = APIRouter(prefix="/productos", tags=["catálogo"])


class ProductoOut(BaseModel):
    id_producto: int
    sku: str
    nombre: str
    categoria: str
    unidad: str
    decimales: int
    precio_vigente: Decimal
    disponible: Decimal


class ProductosPagina(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[ProductoOut]


def _escapar_like(texto: str) -> str:
    """Evita que % y _ escritos por el usuario actúen como comodines."""
    return texto.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# Stock físico de lotes no vencidos, menos reservas vigentes (no expiradas) sobre esos lotes.
_DISPONIBLE_SQL = """
    COALESCE((
        SELECT SUM(l.cantidad_fisica) FROM lote l
        WHERE l.id_producto = p.id_producto
          AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
    ), 0)
    - COALESCE((
        SELECT SUM(r.cantidad)
        FROM reserva r
        JOIN lote l ON l.id_lote = r.id_lote
        JOIN estado_reserva er ON er.id_estado_reserva = r.id_estado_reserva
        WHERE l.id_producto = p.id_producto
          AND er.nombre = 'vigente'
          AND r.fecha_expiracion > NOW()
          AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
    ), 0)
"""


@router.get("", response_model=ProductosPagina)
def buscar_productos(
    q: str | None = Query(None, description="Texto a buscar en nombre o SKU"),
    categoria: str | None = Query(None, description="Nombre exacto de la categoría"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """Lista productos activos con unidad de venta y disponible.

    Ejemplos: `/productos?q=arroz`, `/productos?categoria=Lácteos`,
    `/productos?q=001&categoria=Abarrotes`.
    """
    condiciones = ["p.activo"]
    params: list = []

    if q and q.strip():
        patron = f"%{_escapar_like(q.strip())}%"
        condiciones.append("(p.nombre ILIKE %s OR p.sku ILIKE %s)")
        params += [patron, patron]
    if categoria and categoria.strip():
        condiciones.append("LOWER(c.nombre) = LOWER(%s)")
        params.append(categoria.strip())

    where = " AND ".join(condiciones)
    desde = """
        FROM producto p
        JOIN categoria c ON c.id_categoria = p.id_categoria
        JOIN unidad_comercial u ON u.id_unidad = p.id_unidad
    """

    with pool.connection() as conn, conn.cursor(row_factory=dict_row) as cur:
        cur.execute(f"SELECT COUNT(*) AS total {desde} WHERE {where}", params)
        total = cur.fetchone()["total"]
        cur.execute(
            f"""
            SELECT p.id_producto, p.sku, p.nombre, c.nombre AS categoria,
                   u.nombre AS unidad, u.decimales, p.precio_vigente,
                   {_DISPONIBLE_SQL} AS disponible
            {desde}
            WHERE {where}
            ORDER BY p.nombre
            LIMIT %s OFFSET %s
            """,
            params + [limit, offset],
        )
        items = cur.fetchall()

    return {"total": total, "limit": limit, "offset": offset, "items": items}
