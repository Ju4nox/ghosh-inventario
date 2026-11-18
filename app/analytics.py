"""Reportes de ranking de demanda (GHOSH-18) y alertas de stock y vencimientos (GHOSH-19)."""

from __future__ import annotations

import csv
import io
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException

from app.sales import _ensure_sales_schema, _expire_reservations_in_tx


def _error(status_code: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _assign_positions(rows: list[dict]) -> list[dict]:
    return [{"posicion": idx, **row} for idx, row in enumerate(rows, start=1)]


def demand_ranking(
    conn,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    id_bodega: int | None = None,
    categoria: str | None = None,
    q: str | None = None,
    incluir_sin_demanda: bool = True,
    limit: int = 20,
) -> dict:
    """Calcula el ranking de mayor y menor demanda por período excluyendo pedidos cancelados."""
    if fecha_desde is not None and fecha_hasta is not None and fecha_desde > fecha_hasta:
        _error(
            422,
            "invalid_date_range",
            "La fecha inicial no puede ser posterior a la fecha final.",
        )
    if limit < 1 or limit > 200:
        _error(422, "invalid_limit", "El límite del ranking debe estar entre 1 y 200.")

    category_clean = categoria.strip() if categoria else ""
    query_clean = q.strip() if q else ""

    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)
            _expire_reservations_in_tx(cursor)

    demand_filters = ["ep.nombre != 'cancelado'"]
    demand_params: list[object] = []
    if fecha_desde is not None:
        demand_filters.append("pe.fecha_creacion::date >= %s")
        demand_params.append(fecha_desde)
    if fecha_hasta is not None:
        demand_filters.append("pe.fecha_creacion::date <= %s")
        demand_params.append(fecha_hasta)
    if id_bodega is not None:
        demand_filters.append("COALESCE(pe.id_bodega, nv.id_bodega) = %s")
        demand_params.append(id_bodega)
    demand_where = " WHERE " + " AND ".join(demand_filters)

    lot_filters = ["(l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)"]
    lot_params: list[object] = []
    if id_bodega is not None:
        lot_filters.append("l.id_bodega = %s")
        lot_params.append(id_bodega)
    lot_where = " WHERE " + " AND ".join(lot_filters)

    product_filters = ["p.eliminado = FALSE", "p.activo = TRUE"]
    product_params: list[object] = []
    if category_clean:
        product_filters.append("c.nombre = %s")
        product_params.append(category_clean)
    if query_clean:
        term = f"%{query_clean}%"
        product_filters.append("(p.nombre ILIKE %s OR p.sku ILIKE %s OR p.codigo_b ILIKE %s)")
        product_params.extend((term, term, term))
    product_where = " WHERE " + " AND ".join(product_filters)

    with conn.cursor() as cursor:
        cursor.execute(
            f"""WITH demanda_periodo AS (
                    SELECT dp.id_producto,
                           COUNT(DISTINCT pe.id_pedido) AS pedidos_confirmados,
                           COALESCE(SUM(dp.cantidad), 0) AS unidades_demandadas,
                           COALESCE(SUM(ROUND(dp.cantidad * dp.precio_confirmado, 2)), 0) AS monto_demandado,
                           MAX(pe.fecha_creacion) AS ultima_venta
                    FROM detalle_pedido dp
                    JOIN pedido pe ON pe.id_pedido = dp.id_pedido
                    JOIN estado_pedido ep ON ep.id_estado_pedido = pe.id_estado_pedido
                    LEFT JOIN nota_venta nv ON nv.id_nota_venta = pe.id_nota_venta
                    {demand_where}
                    GROUP BY dp.id_producto
                ),
                disponibilidad_actual AS (
                    SELECT l.id_producto,
                           COALESCE(SUM(GREATEST(l.cantidad_fisica - COALESCE(r.reservada, 0), 0)), 0) AS disponible
                    FROM lote l
                    LEFT JOIN LATERAL (
                        SELECT SUM(rv.cantidad) AS reservada
                        FROM reserva rv
                        JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                        WHERE rv.id_lote = l.id_lote
                          AND er.nombre = 'vigente'
                          AND (rv.fecha_expiracion IS NULL OR rv.fecha_expiracion > NOW())
                    ) r ON TRUE
                    {lot_where}
                    GROUP BY l.id_producto
                )
                SELECT p.sku,
                       p.codigo_b,
                       p.nombre,
                       c.nombre AS categoria,
                       u.nombre AS unidad,
                       p.unidades_por_caja,
                       p.precio_vigente,
                       COALESCE(dem.pedidos_confirmados, 0) AS pedidos_confirmados,
                       COALESCE(dem.unidades_demandadas, 0) AS unidades_demandadas,
                       ROUND(COALESCE(dem.unidades_demandadas, 0) / p.unidades_por_caja, 2) AS cajas_equivalentes,
                       COALESCE(dem.monto_demandado, 0) AS monto_demandado,
                       dem.ultima_venta,
                       COALESCE(disp.disponible, 0) AS stock_disponible
                FROM producto p
                JOIN categoria c ON c.id_categoria = p.id_categoria
                JOIN unidad_comercial u ON u.id_unidad = p.id_unidad
                LEFT JOIN demanda_periodo dem ON dem.id_producto = p.id_producto
                LEFT JOIN disponibilidad_actual disp ON disp.id_producto = p.id_producto
                {product_where}
                ORDER BY p.nombre ASC, p.sku ASC""",
            [*demand_params, *lot_params, *product_params],
        )
        columns = [column.name for column in cursor.description]
        base_rows = [dict(zip(columns, row)) for row in cursor.fetchall()]

        cursor.execute(
            f"""SELECT COUNT(DISTINCT pe.id_pedido)
                FROM detalle_pedido dp
                JOIN pedido pe ON pe.id_pedido = dp.id_pedido
                JOIN estado_pedido ep ON ep.id_estado_pedido = pe.id_estado_pedido
                LEFT JOIN nota_venta nv ON nv.id_nota_venta = pe.id_nota_venta
                JOIN producto p ON p.id_producto = dp.id_producto
                JOIN categoria c ON c.id_categoria = p.id_categoria
                {demand_where}
                AND {" AND ".join(product_filters)}""",
            [*demand_params, *product_params],
        )
        confirmed_orders_count = cursor.fetchone()[0] or 0

        cursor.execute("SELECT id_bodega, nombre FROM bodega ORDER BY nombre")
        warehouses = [{"id_bodega": row[0], "nombre": row[1]} for row in cursor.fetchall()]

        cursor.execute(
            """SELECT DISTINCT c.nombre
               FROM categoria c
               JOIN producto p ON p.id_categoria = c.id_categoria
               WHERE p.eliminado = FALSE AND p.activo = TRUE
               ORDER BY c.nombre"""
        )
        categories = [row[0] for row in cursor.fetchall()]

    total_units = sum((Decimal(row["unidades_demandadas"]) for row in base_rows), Decimal("0"))
    total_amount = sum((Decimal(row["monto_demandado"]) for row in base_rows), Decimal("0.00"))

    for row in base_rows:
        units = Decimal(row["unidades_demandadas"])
        share = (
            ((units * Decimal("100")) / total_units).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if total_units > 0
            else Decimal("0.00")
        )
        row["participacion_pct"] = share

    with_demand = [row for row in base_rows if Decimal(row["unidades_demandadas"]) > 0]
    most_sorted = sorted(
        with_demand,
        key=lambda r: (
            -Decimal(r["unidades_demandadas"]),
            -Decimal(r["monto_demandado"]),
            -int(r["pedidos_confirmados"]),
            r["nombre"].casefold(),
            r["sku"].casefold(),
        ),
    )[:limit]

    lowest_source = base_rows if incluir_sin_demanda else with_demand
    least_sorted = sorted(
        lowest_source,
        key=lambda r: (
            Decimal(r["unidades_demandadas"]),
            Decimal(r["monto_demandado"]),
            int(r["pedidos_confirmados"]),
            r["nombre"].casefold(),
            r["sku"].casefold(),
        ),
    )[:limit]

    mas_demandados = _assign_positions(most_sorted)
    menos_demandados = _assign_positions(least_sorted)

    return {
        "summary": {
            "productos_evaluados": len(base_rows),
            "productos_con_demanda": len(with_demand),
            "productos_sin_demanda": len(base_rows) - len(with_demand),
            "pedidos_confirmados": confirmed_orders_count,
            "unidades_totales": total_units,
            "monto_total": total_amount,
            "top_sku": mas_demandados[0]["sku"] if mas_demandados else None,
            "top_producto": mas_demandados[0]["nombre"] if mas_demandados else None,
            "top_unidades": mas_demandados[0]["unidades_demandadas"] if mas_demandados else Decimal("0"),
        },
        "mas_demandados": mas_demandados,
        "menos_demandados": menos_demandados,
        "bodegas": warehouses,
        "categorias": categories,
        "filtros": {
            "fecha_desde": fecha_desde,
            "fecha_hasta": fecha_hasta,
            "id_bodega": id_bodega,
            "categoria": category_clean or None,
            "q": query_clean or None,
            "incluir_sin_demanda": incluir_sin_demanda,
            "limit": limit,
        },
    }


def build_demand_csv(ranking: dict) -> bytes:
    """Serializa el ranking de mayor y menor demanda en CSV UTF-8 con BOM compatible con Excel."""
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow([
        "tipo_ranking",
        "posicion",
        "sku",
        "codigo_b",
        "nombre",
        "categoria",
        "unidad",
        "pedidos_confirmados",
        "unidades_demandadas",
        "cajas_equivalentes",
        "monto_demandado",
        "participacion_pct",
        "stock_disponible_actual",
    ])

    for group_key, label in (("mas_demandados", "mayor_demanda"), ("menos_demandados", "menor_demanda")):
        for item in ranking.get(group_key, []):
            writer.writerow([
                label,
                item["posicion"],
                item["sku"],
                item.get("codigo_b") or "",
                item["nombre"],
                item["categoria"],
                item["unidad"],
                item["pedidos_confirmados"],
                item["unidades_demandadas"],
                item["cajas_equivalentes"],
                item["monto_demandado"],
                item["participacion_pct"],
                item["stock_disponible"],
            ])

    return buffer.getvalue().encode("utf-8-sig")


def inventory_alerts(
    conn,
    id_bodega: int | None = None,
    dias_vencimiento: int = 30,
    umbral_stock: Decimal = Decimal("10"),
    q: str | None = None,
) -> dict:
    """Consulta alertas activas de stock crítico/agotado y lotes próximos a vencer o vencidos."""
    if dias_vencimiento < 0 or dias_vencimiento > 3650:
        _error(
            422,
            "invalid_expiry_window",
            "La ventana de vencimiento debe estar entre 0 y 3650 días.",
        )
    if umbral_stock < 0:
        _error(
            422,
            "invalid_stock_threshold",
            "El umbral de stock crítico no puede ser negativo.",
        )

    query_clean = q.strip() if q else ""

    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)
            _expire_reservations_in_tx(cursor)

    lot_warehouse_filter = "AND l.id_bodega = %s" if id_bodega is not None else ""
    lot_warehouse_params: list[object] = [id_bodega] if id_bodega is not None else []

    stock_search_filter = ""
    lot_search_filter = ""
    search_params_stock: list[object] = []
    search_params_lot: list[object] = []
    if query_clean:
        term = f"%{query_clean}%"
        stock_search_filter = "AND (p.nombre ILIKE %s OR p.sku ILIKE %s OR p.codigo_b ILIKE %s)"
        search_params_stock = [term, term, term]
        lot_search_filter = "AND (p.nombre ILIKE %s OR p.sku ILIKE %s OR p.codigo_b ILIKE %s OR l.codigo_lote ILIKE %s)"
        search_params_lot = [term, term, term, term]

    with conn.cursor() as cursor:
        cursor.execute(
            f"""WITH reservas_lote AS (
                    SELECT rv.id_lote, SUM(rv.cantidad) AS reservada
                    FROM reserva rv
                    JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                    WHERE er.nombre = 'vigente'
                      AND (rv.fecha_expiracion IS NULL OR rv.fecha_expiracion > NOW())
                    GROUP BY rv.id_lote
                ),
                stock_producto AS (
                    SELECT l.id_producto,
                           COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE
                                             THEN l.cantidad_fisica ELSE 0 END), 0) AS stock_fisico_vigente,
                           COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE
                                             THEN COALESCE(rl.reservada, 0) ELSE 0 END), 0) AS stock_reservado,
                           COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE
                                             THEN GREATEST(l.cantidad_fisica - COALESCE(rl.reservada, 0), 0) ELSE 0 END), 0) AS disponible,
                           COALESCE(SUM(CASE WHEN l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento < CURRENT_DATE
                                             THEN l.cantidad_fisica ELSE 0 END), 0) AS lotes_vencidos_unidades
                    FROM lote l
                    LEFT JOIN reservas_lote rl ON rl.id_lote = l.id_lote
                    WHERE 1=1 {lot_warehouse_filter}
                    GROUP BY l.id_producto
                )
                SELECT p.sku,
                       p.codigo_b,
                       p.nombre,
                       c.nombre AS categoria,
                       u.nombre AS unidad,
                       p.unidades_por_caja,
                       COALESCE(sp.stock_fisico_vigente, 0) AS stock_fisico_vigente,
                       COALESCE(sp.stock_reservado, 0) AS stock_reservado,
                       COALESCE(sp.disponible, 0) AS disponible,
                       GREATEST(p.umbral_stock_critico, %s) AS umbral_aplicado,
                       COALESCE(sp.lotes_vencidos_unidades, 0) AS lotes_vencidos_unidades,
                       CASE
                           WHEN COALESCE(sp.disponible, 0) <= 0 THEN 'agotado'
                           ELSE 'stock_critico'
                       END AS nivel_alerta
                FROM producto p
                JOIN categoria c ON c.id_categoria = p.id_categoria
                JOIN unidad_comercial u ON u.id_unidad = p.id_unidad
                LEFT JOIN stock_producto sp ON sp.id_producto = p.id_producto
                WHERE p.eliminado = FALSE
                  AND p.activo = TRUE
                  AND COALESCE(sp.disponible, 0) <= GREATEST(p.umbral_stock_critico, %s)
                  {stock_search_filter}
                ORDER BY COALESCE(sp.disponible, 0) ASC, p.nombre ASC, p.sku ASC""",
            [*lot_warehouse_params, umbral_stock, umbral_stock, *search_params_stock],
        )
        stock_cols = [column.name for column in cursor.description]
        stock_alerts = [dict(zip(stock_cols, row)) for row in cursor.fetchall()]

        cursor.execute(
            f"""WITH reservas_lote AS (
                    SELECT rv.id_lote, SUM(rv.cantidad) AS reservada
                    FROM reserva rv
                    JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                    WHERE er.nombre = 'vigente'
                      AND (rv.fecha_expiracion IS NULL OR rv.fecha_expiracion > NOW())
                    GROUP BY rv.id_lote
                )
                SELECT l.id_lote,
                       l.codigo_lote,
                       p.sku,
                       p.nombre AS producto,
                       c.nombre AS categoria,
                       b.id_bodega,
                       b.nombre AS bodega,
                       l.fecha_recepcion,
                       l.fecha_vencimiento,
                       (l.fecha_vencimiento - CURRENT_DATE) AS dias_para_vencer,
                       l.cantidad_fisica,
                       COALESCE(rl.reservada, 0) AS cantidad_reservada,
                       GREATEST(l.cantidad_fisica - COALESCE(rl.reservada, 0), 0) AS disponible_lote,
                       CASE
                           WHEN l.fecha_vencimiento < CURRENT_DATE THEN 'vencido'
                           WHEN l.fecha_vencimiento = CURRENT_DATE THEN 'vence_hoy'
                           ELSE 'proximo_a_vencer'
                       END AS estado_vencimiento
                FROM lote l
                JOIN producto p ON p.id_producto = l.id_producto
                JOIN categoria c ON c.id_categoria = p.id_categoria
                JOIN bodega b ON b.id_bodega = l.id_bodega
                LEFT JOIN reservas_lote rl ON rl.id_lote = l.id_lote
                WHERE p.eliminado = FALSE
                  AND l.cantidad_fisica > 0
                  AND l.fecha_vencimiento IS NOT NULL
                  AND l.fecha_vencimiento <= CURRENT_DATE + (%s * INTERVAL '1 day')
                  {lot_warehouse_filter}
                  {lot_search_filter}
                ORDER BY l.fecha_vencimiento ASC, l.id_lote ASC""",
            [dias_vencimiento, *lot_warehouse_params, *search_params_lot],
        )
        lot_cols = [column.name for column in cursor.description]
        lot_alerts = [dict(zip(lot_cols, row)) for row in cursor.fetchall()]

        cursor.execute("SELECT id_bodega, nombre FROM bodega ORDER BY nombre")
        warehouses = [{"id_bodega": row[0], "nombre": row[1]} for row in cursor.fetchall()]

    out_of_stock_count = sum(1 for item in stock_alerts if item["nivel_alerta"] == "agotado")
    critical_stock_count = sum(1 for item in stock_alerts if item["nivel_alerta"] == "stock_critico")

    expired_lots = [item for item in lot_alerts if item["estado_vencimiento"] == "vencido"]
    expiring_lots = [item for item in lot_alerts if item["estado_vencimiento"] in ("vence_hoy", "proximo_a_vencer")]

    return {
        "summary": {
            "productos_agotados": out_of_stock_count,
            "productos_stock_critico": critical_stock_count,
            "total_alertas_stock": len(stock_alerts),
            "lotes_vencidos": len(expired_lots),
            "unidades_vencidas": sum((Decimal(item["cantidad_fisica"]) for item in expired_lots), Decimal("0")),
            "lotes_proximos_a_vencer": len(expiring_lots),
            "unidades_proximas_a_vencer": sum((Decimal(item["cantidad_fisica"]) for item in expiring_lots), Decimal("0")),
            "total_alertas_lotes": len(lot_alerts),
            "dias_vencimiento": dias_vencimiento,
            "umbral_stock": umbral_stock,
        },
        "alertas_stock": stock_alerts,
        "alertas_lotes": lot_alerts,
        "bodegas": warehouses,
    }
