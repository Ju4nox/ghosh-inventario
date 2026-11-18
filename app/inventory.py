"""Recepción de inventario por producto, bodega y lote."""
import csv
import io
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.catalog import CatalogAuditRequest, DEFAULT_CATEGORY, DEFAULT_UNIT, _ensure_audit_schema, _record_catalog_audit


class ReceiptRequest(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    id_bodega: int = Field(gt=0)
    codigo_lote: str = Field(min_length=1, max_length=40)
    cantidad: Decimal = Field(gt=0, max_digits=12, decimal_places=3)
    fecha_vencimiento: date | None = None
    id_usuario: int = Field(gt=0)
    motivo: str = Field(default="Recepción de mercadería", min_length=1, max_length=200)

    @field_validator("sku", "codigo_lote", "motivo")
    @classmethod
    def trim_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El campo no puede estar vacío.")
        return value


def receive_goods(conn, receipt: ReceiptRequest) -> dict:
    """Registra el lote y el movimiento de recepción de forma atómica."""
    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT p.id_producto, p.requiere_trazabilidad, p.activo, u.decimales
                   FROM producto p
                   JOIN unidad_comercial u ON u.id_unidad = p.id_unidad
                   WHERE p.sku = %s AND p.eliminado = FALSE""",
                (receipt.sku,),
            )
            product = cursor.fetchone()
            if product is None:
                raise HTTPException(status_code=404, detail={
                    "code": "product_not_found", "message": f"No existe el producto con SKU '{receipt.sku}'.",
                })
            product_id, requires_traceability, active, decimals = product
            if not active:
                raise HTTPException(status_code=409, detail={
                    "code": "product_inactive", "message": "No se puede recibir stock para un producto inactivo.",
                })
            if requires_traceability and receipt.fecha_vencimiento is None:
                raise HTTPException(status_code=422, detail={
                    "code": "expiration_required", "message": "Este producto requiere trazabilidad y debe indicar fecha_vencimiento.",
                })
            if receipt.fecha_vencimiento and receipt.fecha_vencimiento < date.today():
                raise HTTPException(status_code=422, detail={
                    "code": "expiration_in_past", "message": "No se puede recibir un lote vencido.",
                })
            if receipt.cantidad.normalize().as_tuple().exponent < -decimals:
                raise HTTPException(status_code=422, detail={
                    "code": "quantity_precision", "message": f"La unidad comercial admite como máximo {decimals} decimales.",
                })

            cursor.execute("SELECT 1 FROM bodega WHERE id_bodega = %s", (receipt.id_bodega,))
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail={
                    "code": "warehouse_not_found", "message": f"No existe la bodega {receipt.id_bodega}.",
                })

            cursor.execute(
                """SELECT u.activo, r.nombre
                   FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
                   WHERE u.id_usuario = %s""",
                (receipt.id_usuario,),
            )
            user = cursor.fetchone()
            if user is None or not user[0]:
                raise HTTPException(status_code=404, detail={
                    "code": "user_not_found", "message": f"No existe un usuario activo con ID {receipt.id_usuario}.",
                })
            if user[1] != "bodega":
                raise HTTPException(status_code=403, detail={
                    "code": "warehouse_role_required", "message": "La recepción debe registrarla un usuario con rol bodega.",
                })

            cursor.execute("SELECT id_tipo FROM tipo_movimiento WHERE nombre = 'recepcion'")
            movement_type = cursor.fetchone()
            if movement_type is None:
                raise HTTPException(status_code=500, detail={
                    "code": "receipt_movement_missing", "message": "No está configurado el tipo de movimiento 'recepcion'.",
                })

            cursor.execute(
                """INSERT INTO lote
                       (id_producto, id_bodega, codigo_lote, fecha_vencimiento, cantidad_fisica)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (id_producto, id_bodega, codigo_lote)
                   DO UPDATE SET cantidad_fisica = lote.cantidad_fisica + EXCLUDED.cantidad_fisica
                   WHERE lote.fecha_vencimiento IS NOT DISTINCT FROM EXCLUDED.fecha_vencimiento
                   RETURNING id_lote, cantidad_fisica""",
                (product_id, receipt.id_bodega, receipt.codigo_lote,
                 receipt.fecha_vencimiento, receipt.cantidad),
            )
            lot = cursor.fetchone()
            if lot is None:
                raise HTTPException(status_code=409, detail={
                    "code": "lot_expiration_conflict",
                    "message": "El código de lote ya existe con una fecha de vencimiento distinta.",
                })
            lot_id, total_quantity = lot

            cursor.execute(
                """INSERT INTO movimiento_inventario
                       (id_lote, id_tipo, id_usuario, cantidad, motivo)
                   VALUES (%s, %s, %s, %s, %s)
                   RETURNING id_movimiento""",
                (lot_id, movement_type[0], receipt.id_usuario, receipt.cantidad, receipt.motivo),
            )
            movement_id = cursor.fetchone()[0]

    return {
        "status": "received",
        "id_lote": lot_id,
        "id_movimiento": movement_id,
        "sku": receipt.sku,
        "codigo_lote": receipt.codigo_lote,
        "cantidad_recibida": receipt.cantidad,
        "cantidad_fisica_lote": total_quantity,
        "fecha_vencimiento": receipt.fecha_vencimiento,
    }


def movement_history(
    conn,
    sku: str | None = None,
    codigo_lote: str | None = None,
    tipo: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Consulta movimientos auditables con filtros por producto, lote y categoría."""
    filters, parameters = [], []
    if sku is not None:
        sku = sku.strip()
        if not sku:
            raise HTTPException(status_code=422, detail={
                "code": "invalid_sku_filter", "message": "El filtro sku no puede estar vacío.",
            })
        term = f"%{sku}%"
        filters.append("(sku ILIKE %s OR producto ILIKE %s)")
        parameters.extend((term, term))
    if codigo_lote is not None:
        codigo_lote = codigo_lote.strip()
        if not codigo_lote:
            raise HTTPException(status_code=422, detail={
                "code": "invalid_lot_filter", "message": "El filtro codigo_lote no puede estar vacío.",
            })
        filters.append("codigo_lote ILIKE %s")
        parameters.append(f"%{codigo_lote}%")
    if tipo is not None:
        normalized_type = tipo.strip().casefold()
        if not normalized_type:
            raise HTTPException(status_code=422, detail={
                "code": "invalid_type_filter", "message": "El filtro tipo no puede estar vacío.",
            })
        type_clauses = {
            "pedidos": "tipo IN ('pedido_generado', 'pedido_despachado', 'pedido_anulado')",
            "pedidos_generados": "tipo = 'pedido_generado'",
            "pedidos_vendidos": "tipo = 'pedido_despachado'",
            "pedidos_anulados": "tipo = 'pedido_anulado'",
            "recepciones": "tipo = 'recepcion'",
            "productos_agregados": "tipo = 'producto_agregado'",
            "mermas": "tipo = 'merma'",
            "retiros": "tipo = 'retiro'",
            "eliminaciones": "tipo = 'eliminacion'",
            "productos": "tipo IN ('producto_agregado', 'retiro', 'eliminacion')",
        }
        clause = type_clauses.get(normalized_type)
        if clause is None:
            raise HTTPException(status_code=422, detail={
                "code": "invalid_type_filter",
                "message": f"Filtro de movimiento no soportado: '{tipo}'.",
            })
        filters.append(clause)

    where = " WHERE " + " AND ".join(filters) if filters else ""
    cte = """WITH todos_movimientos AS (
        SELECT m.id_movimiento AS id_movimiento,
               CASE
                   WHEN tm.nombre = 'reserva' THEN 'pedido_generado'
                   WHEN tm.nombre = 'despacho' THEN 'pedido_despachado'
                   WHEN tm.nombre = 'cancelacion' THEN 'pedido_anulado'
                   WHEN tm.nombre = 'ajuste' AND LEFT(LOWER(m.motivo), 5) = 'merma' THEN 'merma'
                   ELSE tm.nombre
               END AS tipo,
               p.sku AS sku,
               p.nombre AS producto,
               l.id_lote AS id_lote,
               l.codigo_lote AS codigo_lote,
               l.fecha_vencimiento AS fecha_vencimiento,
               b.id_bodega AS id_bodega,
               b.nombre AS bodega,
               m.cantidad AS cantidad,
               m.fecha AS fecha,
               m.motivo AS motivo,
               u.id_usuario AS id_usuario,
               u.nombre AS usuario,
               pe.id_pedido AS id_pedido,
               COALESCE(nv.numero, m.id_nota_venta) AS id_nota_venta
        FROM movimiento_inventario m
        JOIN tipo_movimiento tm ON tm.id_tipo = m.id_tipo
        JOIN lote l ON l.id_lote = m.id_lote
        JOIN producto p ON p.id_producto = l.id_producto
        JOIN bodega b ON b.id_bodega = l.id_bodega
        JOIN usuario u ON u.id_usuario = m.id_usuario
        LEFT JOIN pedido pe ON pe.id_pedido = m.id_pedido
        LEFT JOIN nota_venta nv ON nv.id_nota_venta = m.id_nota_venta
        UNION ALL
        SELECT -ac.id_auditoria AS id_movimiento,
               CASE
                   WHEN ac.accion = 'alta' THEN 'producto_agregado'
                   ELSE ac.accion
               END AS tipo,
               ac.sku_producto AS sku,
               ac.nombre_producto AS producto,
               0 AS id_lote,
               '—' AS codigo_lote,
               NULL::date AS fecha_vencimiento,
               0 AS id_bodega,
               'Catálogo' AS bodega,
               0::numeric(12,3) AS cantidad,
               ac.fecha AS fecha,
               ac.motivo AS motivo,
               ac.id_usuario AS id_usuario,
               ac.nombre_usuario AS usuario,
               NULL::integer AS id_pedido,
               NULL::integer AS id_nota_venta
        FROM auditoria_catalogo ac
        WHERE ac.accion IN ('alta', 'retiro', 'eliminacion')
    )"""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_audit_schema(cursor)
    with conn.cursor() as cursor:
        cursor.execute(cte + " SELECT COUNT(*) FROM todos_movimientos" + where, parameters)
        total = cursor.fetchone()[0]
        cursor.execute(
            cte +
            """ SELECT id_movimiento, tipo, sku, producto,
                       id_lote, codigo_lote, fecha_vencimiento,
                       id_bodega, bodega, cantidad, fecha,
                       motivo, id_usuario, usuario, id_pedido, id_nota_venta
                FROM todos_movimientos""" + where +
            " ORDER BY fecha DESC, ABS(id_movimiento) DESC LIMIT %s OFFSET %s",
            [*parameters, limit, offset],
        )
        columns = [column.name for column in cursor.description]
        items = [dict(zip(columns, row)) for row in cursor.fetchall()]
    return {"items": items, "total": total, "limit": limit, "offset": offset}



MAX_RECEIPT_ROWS = 1000
RECEIPT_COLUMNS = frozenset({"sku", "codigo_lote", "cantidad", "fecha_vencimiento", "motivo"})
RECEIPT_REQUIRED_COLUMNS = ("sku", "codigo_lote", "cantidad")


def _receipt_csv_error(row: int, field: str, code: str, message: str) -> dict:
    return {"row": row, "field": field, "code": code, "message": message}


def parse_receipt_csv(content: bytes, id_bodega: int, id_usuario: int) -> tuple[list[tuple[int, ReceiptRequest]], list[dict], int]:
    """Valida el formato CSV y convierte cada fila en una solicitud de recepción."""
    if len(content) > 5 * 1024 * 1024:
        return [], [_receipt_csv_error(1, "_file", "file_too_large", "El archivo supera el máximo de 5 MiB.")], 0
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [_receipt_csv_error(1, "_file", "invalid_encoding", "El archivo debe estar codificado en UTF-8.")], 0
    if not text.strip():
        return [], [_receipt_csv_error(1, "_file", "empty_file", "El archivo CSV está vacío.")], 0
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text, newline=""), dialect)
    try:
        headers = next(reader)
    except (StopIteration, csv.Error):
        return [], [_receipt_csv_error(1, "_file", "invalid_header", "El archivo debe incluir un encabezado CSV válido.")], 0

    normalized = [header.strip().casefold() for header in headers]
    errors = []
    for name in sorted({header for header in normalized if normalized.count(header) > 1}):
        errors.append(_receipt_csv_error(1, name or "_header", "duplicate_column", f"La columna '{name}' está repetida."))
    for name in RECEIPT_REQUIRED_COLUMNS:
        if name not in normalized:
            errors.append(_receipt_csv_error(1, name, "missing_column", f"Falta la columna obligatoria '{name}'."))
    for name in normalized:
        if name and name not in RECEIPT_COLUMNS:
            errors.append(_receipt_csv_error(1, name, "unknown_column", f"La columna '{name}' no está soportada."))
    if errors:
        return [], errors, 0

    indexes = {name: index for index, name in enumerate(normalized)}
    rows, seen_lots, total_rows = [], {}, 0
    try:
        for values in reader:
            line = reader.line_num
            if not values or all(not value.strip() for value in values):
                continue
            total_rows += 1
            if total_rows > MAX_RECEIPT_ROWS:
                return [], [_receipt_csv_error(line, "_file", "too_many_rows", f"El archivo puede contener hasta {MAX_RECEIPT_ROWS} recepciones por carga.")], total_rows
            if len(values) != len(headers):
                errors.append(_receipt_csv_error(line, "_row", "wrong_column_count", f"La fila tiene {len(values)} campos y se esperaban {len(headers)}."))
                continue
            raw = {name: values[index].strip() for name, index in indexes.items()}
            key = (raw.get("sku", "").casefold(), raw.get("codigo_lote", "").casefold())
            if all(key) and key in seen_lots:
                errors.append(_receipt_csv_error(line, "codigo_lote", "duplicate_lot_in_file", f"Este producto y lote también aparecen en la fila {seen_lots[key]}. Combina las cantidades en una sola fila."))
                continue
            if all(key):
                seen_lots[key] = line
            data = {
                "sku": raw.get("sku", ""),
                "codigo_lote": raw.get("codigo_lote", ""),
                "cantidad": raw.get("cantidad", ""),
                "fecha_vencimiento": raw.get("fecha_vencimiento") or None,
                "motivo": raw.get("motivo") or "Recepción de mercadería",
                "id_bodega": id_bodega,
                "id_usuario": id_usuario,
            }
            try:
                rows.append((line, ReceiptRequest.model_validate(data)))
            except ValidationError as exc:
                for issue in exc.errors():
                    field = str(issue["loc"][-1]) if issue.get("loc") else "_row"
                    messages = {
                        "missing": "Campo obligatorio.",
                        "decimal_parsing": "Ingresa una cantidad numérica válida.",
                        "greater_than": "La cantidad debe ser mayor que cero.",
                        "decimal_max_digits": "La cantidad supera la precisión admitida.",
                        "decimal_max_places": "La unidad admite como máximo tres decimales.",
                        "date_from_datetime_parsing": "Usa una fecha válida con formato AAAA-MM-DD.",
                        "date_parsing": "Usa una fecha válida con formato AAAA-MM-DD.",
                        "string_too_short": "El campo no puede estar vacío.",
                    }
                    errors.append(_receipt_csv_error(line, field, "invalid_value", messages.get(issue["type"], issue["msg"])))
    except csv.Error as exc:
        errors.append(_receipt_csv_error(reader.line_num, "_file", "invalid_csv", f"Error de formato CSV: {exc}."))
    if total_rows == 0 and not errors:
        errors.append(_receipt_csv_error(2, "_file", "no_data_rows", "El CSV no contiene recepciones."))
    return rows, errors, total_rows


class BulkReceiptError(Exception):
    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__("La carga masiva de recepciones fue rechazada.")


def import_receipts(
    conn,
    rows: list[tuple[int, ReceiptRequest]],
    new_products: list[dict] | None = None,
) -> list[dict]:
    """Crea productos faltantes y registra todas las recepciones de forma atómica."""
    results, errors = [], []
    new_products = new_products or []
    created_skus = set()
    with conn.transaction():
        if new_products:
            with conn.cursor() as cursor:
                cursor.execute("SELECT id_categoria FROM categoria WHERE lower(nombre) = lower(%s)", (DEFAULT_CATEGORY,))
                category = cursor.fetchone()
                cursor.execute("SELECT id_unidad FROM unidad_comercial WHERE lower(nombre) = lower(%s)", (DEFAULT_UNIT,))
                unit = cursor.fetchone()
                if category is None or unit is None:
                    raise BulkReceiptError([_receipt_csv_error(
                        1, "_catalog", "catalog_defaults_missing",
                        "Falta la categoría 'Lista de precios' o la unidad 'unidad' para crear los productos nuevos.",
                    )])
                for product in new_products:
                    cursor.execute(
                        "SELECT id_producto FROM producto WHERE sku = %s AND eliminado = FALSE FOR UPDATE",
                        (product["sku"],),
                    )
                    if cursor.fetchone() is not None:
                        continue
                    if product.get("codigo_b"):
                        cursor.execute(
                            "SELECT sku FROM producto WHERE codigo_b = %s AND eliminado = FALSE",
                            (product["codigo_b"],),
                        )
                        owner = cursor.fetchone()
                        if owner is not None:
                            errors.append(_receipt_csv_error(
                                product["row"], "codigo_b", "barcode_already_assigned",
                                f"El Código B '{product['codigo_b']}' ya pertenece al producto '{owner[0]}'.",
                            ))
                if errors:
                    raise BulkReceiptError(errors)
                _ensure_audit_schema(cursor)
                actor_name = None
                actor_id = rows[0][1].id_usuario if rows else None
                if actor_id is not None:
                    cursor.execute("SELECT nombre FROM usuario WHERE id_usuario = %s", (actor_id,))
                    actor_row = cursor.fetchone()
                    actor_name = actor_row[0] if actor_row else None
                for product in new_products:
                    cursor.execute(
                        "SELECT id_producto FROM producto WHERE sku = %s AND eliminado = FALSE",
                        (product["sku"],),
                    )
                    if cursor.fetchone() is not None:
                        continue
                    cursor.execute(
                        """INSERT INTO producto
                               (sku, codigo_b, nombre, peso, id_categoria, id_unidad, precio_vigente,
                                unidades_por_caja, requiere_trazabilidad, umbral_stock_critico)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE, 0)
                           ON CONFLICT (sku) WHERE eliminado = FALSE DO NOTHING
                           RETURNING id_producto""",
                        (
                            product["sku"], product.get("codigo_b"), product["nombre"], product["peso"],
                            category[0], unit[0], product["precio_vigente"], product["unidades_por_caja"],
                        ),
                    )
                    inserted_row = cursor.fetchone()
                    if inserted_row is not None:
                        created_skus.add(product["sku"].casefold())
                        if actor_id is not None and actor_name is not None:
                            cursor.execute(
                                """INSERT INTO auditoria_catalogo
                                       (id_producto, sku_producto, nombre_producto, accion, id_usuario, nombre_usuario, motivo)
                                   VALUES (%s, %s, %s, 'alta', %s, %s, %s)""",
                                (
                                    inserted_row[0],
                                    product["sku"],
                                    product["nombre"],
                                    actor_id,
                                    actor_name,
                                    "Producto agregado desde lista de precios Excel",
                                ),
                            )
        for row_number, receipt in rows:
            try:
                result = receive_goods(conn, receipt)
                item = {"row": row_number, **result}
                if new_products:
                    item["producto_creado"] = receipt.sku.casefold() in created_skus
                results.append(item)
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, dict) else {}
                code = detail.get("code", "receipt_rejected")
                field = {
                    "product_not_found": "sku",
                    "product_inactive": "sku",
                    "expiration_required": "fecha_vencimiento",
                    "expiration_in_past": "fecha_vencimiento",
                    "quantity_precision": "cantidad",
                    "warehouse_not_found": "id_bodega",
                    "user_not_found": "id_usuario",
                    "warehouse_role_required": "id_usuario",
                    "lot_expiration_conflict": "codigo_lote",
                }.get(code, "_row")
                errors.append(_receipt_csv_error(row_number, field, code, detail.get("message", "No se pudo registrar la recepción.")))
        if errors:
            raise BulkReceiptError(errors)
    return results


def receipt_options(conn) -> dict:
    """Devuelve bodegas y operadores activos con rol de bodega para los formularios."""
    with conn.cursor() as cursor:
        cursor.execute("SELECT id_bodega, nombre FROM bodega ORDER BY nombre")
        warehouses = [{"id_bodega": row[0], "nombre": row[1]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT u.id_usuario, u.nombre
               FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
               WHERE u.activo = TRUE AND r.nombre = 'bodega'
               ORDER BY u.nombre"""
        )
        operators = [{"id_usuario": row[0], "nombre": row[1]} for row in cursor.fetchall()]
    return {"bodegas": warehouses, "operadores": operators}


PURGE_REASON = "(testeo de purga)"


def purge_inventory_stock(conn) -> dict:
    """Deja en 0 las existencias físicas de todos los artículos sin eliminarlos y registra el ajuste auditable."""
    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute("SELECT id_tipo FROM tipo_movimiento WHERE nombre = 'ajuste'")
            movement_type = cursor.fetchone()
            if movement_type is None:
                raise HTTPException(status_code=500, detail={
                    "code": "adjustment_movement_missing",
                    "message": "No está configurado el tipo de movimiento 'ajuste'.",
                })

            cursor.execute(
                """SELECT u.id_usuario
                   FROM usuario u
                   JOIN rol r ON r.id_rol = u.id_rol
                   WHERE u.activo = TRUE
                   ORDER BY CASE WHEN r.nombre = 'bodega' THEN 0 WHEN r.nombre = 'gerencia' THEN 1 ELSE 2 END, u.id_usuario
                   LIMIT 1"""
            )
            user = cursor.fetchone()
            if user is None:
                raise HTTPException(status_code=404, detail={
                    "code": "active_user_not_found",
                    "message": "No existe un usuario activo para registrar el movimiento de purga.",
                })

            cursor.execute(
                """SELECT l.id_lote, l.cantidad_fisica
                   FROM lote l
                   JOIN producto p ON p.id_producto = l.id_producto
                   WHERE p.eliminado = FALSE AND l.cantidad_fisica > 0
                   ORDER BY l.id_lote
                   FOR UPDATE OF l"""
            )
            lots = cursor.fetchall()
            total_removed = Decimal("0")

            for lot_id, current_qty in lots:
                qty = Decimal(current_qty)
                if qty <= 0:
                    continue
                total_removed += qty
                cursor.execute(
                    "UPDATE lote SET cantidad_fisica = 0 WHERE id_lote = %s",
                    (lot_id,),
                )
                cursor.execute(
                    """INSERT INTO movimiento_inventario
                           (id_lote, id_tipo, id_usuario, cantidad, motivo)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (lot_id, movement_type[0], user[0], -qty, PURGE_REASON),
                )

    return {
        "status": "purged",
        "lots_zeroed": len(lots),
        "units_removed": total_removed,
        "motivo": PURGE_REASON,
    }


class ShrinkageRequest(BaseModel):
    """Solicitud auditable para registrar una merma de stock en el catálogo."""

    cantidad: Decimal = Field(gt=0, max_digits=12, decimal_places=3)
    id_usuario: int = Field(gt=0)
    motivo: str = Field(min_length=1, max_length=200)

    @field_validator("motivo")
    @classmethod
    def trim_motivo(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El motivo no puede estar vacío.")
        return value


def register_stock_shrinkage(conn, sku: str, request: ShrinkageRequest) -> dict:
    """Descuenta existencias libres de reservas por merma y registra movimiento y auditoría."""
    normalized_sku = sku.strip()
    if not normalized_sku:
        raise HTTPException(status_code=422, detail={
            "code": "invalid_sku",
            "message": "El Código I no puede estar vacío.",
        })

    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT p.id_producto, p.nombre, u.decimales
                   FROM producto p
                   JOIN unidad_comercial u ON u.id_unidad = p.id_unidad
                   WHERE p.sku = %s AND p.eliminado = FALSE
                   FOR UPDATE OF p""",
                (normalized_sku,),
            )
            product = cursor.fetchone()
            if product is None:
                raise HTTPException(status_code=404, detail={
                    "code": "product_not_found",
                    "message": f"No existe el producto con Código I '{normalized_sku}'.",
                })
            product_id, product_name, decimals = product

            if request.cantidad.normalize().as_tuple().exponent < -decimals:
                raise HTTPException(status_code=422, detail={
                    "code": "quantity_precision",
                    "message": f"La unidad comercial admite como máximo {decimals} decimales.",
                })

            cursor.execute("SELECT id_tipo FROM tipo_movimiento WHERE nombre = 'ajuste'")
            movement_type = cursor.fetchone()
            if movement_type is None:
                raise HTTPException(status_code=500, detail={
                    "code": "adjustment_movement_missing",
                    "message": "No está configurado el tipo de movimiento 'ajuste'.",
                })

            cursor.execute(
                """SELECT l.id_lote, l.codigo_lote, l.cantidad_fisica,
                          COALESCE((
                              SELECT SUM(rv.cantidad)
                              FROM reserva rv
                              JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                              WHERE rv.id_lote = l.id_lote
                                AND er.nombre = 'vigente'
                                AND (rv.fecha_expiracion IS NULL OR rv.fecha_expiracion > NOW())
                          ), 0) AS reservada
                   FROM lote l
                   WHERE l.id_producto = %s AND l.cantidad_fisica > 0
                   ORDER BY
                       CASE WHEN l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE THEN 0 ELSE 1 END,
                       l.fecha_vencimiento ASC NULLS LAST,
                       l.fecha_recepcion ASC,
                       l.id_lote ASC
                   FOR UPDATE OF l""",
                (product_id,),
            )
            lots = []
            descontable_total = Decimal("0")
            for lot_id, _lot_code, physical, reserved in cursor.fetchall():
                descontable = max(Decimal(physical) - Decimal(reserved), Decimal("0"))
                if descontable > 0:
                    lots.append({"id_lote": lot_id, "descontable": descontable})
                    descontable_total += descontable

            if descontable_total < request.cantidad:
                raise HTTPException(status_code=409, detail={
                    "code": "insufficient_stock",
                    "message": (
                        f"No hay suficiente stock libre de reservas para descontar la merma. "
                        f"Disponible: {descontable_total}; merma indicada: {request.cantidad}."
                    ),
                })

            audit_record = _record_catalog_audit(
                cursor,
                product_id=product_id,
                sku=normalized_sku,
                product_name=product_name,
                action="merma",
                audit=CatalogAuditRequest(id_usuario=request.id_usuario, motivo=request.motivo),
            )

            movement_reason = (
                request.motivo if request.motivo.lower().startswith("merma") else f"Merma: {request.motivo}"
            )[:200]

            remaining = request.cantidad
            affected_lots = 0
            for lot in lots:
                if remaining <= 0:
                    break
                qty = min(remaining, lot["descontable"])
                cursor.execute(
                    "UPDATE lote SET cantidad_fisica = cantidad_fisica - %s WHERE id_lote = %s",
                    (qty, lot["id_lote"]),
                )
                cursor.execute(
                    """INSERT INTO movimiento_inventario
                           (id_lote, id_tipo, id_usuario, cantidad, motivo)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (lot["id_lote"], movement_type[0], request.id_usuario, -qty, movement_reason),
                )
                remaining -= qty
                affected_lots += 1

            cursor.execute(
                "SELECT COALESCE(SUM(cantidad_fisica), 0) FROM lote WHERE id_producto = %s",
                (product_id,),
            )
            physical_stock = cursor.fetchone()[0]

    return {
        "status": "shrinkage_recorded",
        "sku": normalized_sku,
        "nombre": product_name,
        "cantidad_merma": request.cantidad,
        "stock_fisico": physical_stock,
        "lotes_afectados": affected_lots,
        "auditoria": audit_record,
    }




