"""Validación e importación de listas de precios desde CSV."""
import csv
import io
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from fastapi import HTTPException

REQUIRED_COLUMNS = (
    "codigo_i",
    "codigo_b",
    "articulo",
    "peso",
    "unidades_por_caja",
    "precio_por_unidad",
    "precio_con_iva",
)
ALLOWED_COLUMNS = frozenset(REQUIRED_COLUMNS)
MAX_CSV_BYTES = 5 * 1024 * 1024
DEFAULT_CATEGORY = "Lista de precios"
DEFAULT_UNIT = "unidad"


def _error(row: int, field: str, code: str, message: str) -> dict:
    return {"row": row, "field": field, "code": code, "message": message}


def _decimal(value: str, field: str, row: int, errors: list[dict], scale: int, precision: int = 12):
    try:
        number = Decimal(value.strip())
    except (InvalidOperation, AttributeError):
        errors.append(_error(row, field, "invalid_number", "Debe ser un número válido usando punto decimal."))
        return None
    if not number.is_finite() or number < 0:
        errors.append(_error(row, field, "out_of_range", "Debe ser un número finito mayor o igual a cero."))
        return None
    if number.as_tuple().exponent < -scale:
        errors.append(_error(row, field, "too_many_decimals", f"Admite como máximo {scale} decimales."))
        return None
    if number >= Decimal(10) ** (precision - scale):
        errors.append(_error(row, field, "out_of_range", "El número supera la precisión permitida por la base de datos."))
        return None
    return number


def validate_csv(content: bytes) -> tuple[list[dict], list[dict], int]:
    """Devuelve filas válidas, errores y total de filas de datos."""
    if len(content) > MAX_CSV_BYTES:
        return [], [_error(1, "_file", "file_too_large", "El archivo supera el máximo de 5 MiB.")], 0
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [_error(1, "_file", "invalid_encoding", "El archivo debe estar codificado en UTF-8.")], 0
    if not text.strip():
        return [], [_error(1, "_file", "empty_file", "El archivo CSV está vacío.")], 0
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text, newline=""), dialect)
    try:
        headers = next(reader)
    except (StopIteration, csv.Error):
        return [], [_error(1, "_file", "invalid_header", "El archivo debe incluir un encabezado CSV válido.")], 0

    normalized = [header.strip().casefold() for header in headers]
    errors = []
    for header in sorted({name for name in normalized if normalized.count(name) > 1}):
        errors.append(_error(1, header or "_header", "duplicate_column", f"La columna '{header}' está repetida."))
    for header in REQUIRED_COLUMNS:
        if header not in normalized:
            errors.append(_error(1, header, "missing_column", f"Falta la columna obligatoria '{header}'."))
    for header in normalized:
        if header and header not in ALLOWED_COLUMNS:
            errors.append(_error(1, header, "unknown_column", f"La columna '{header}' no está soportada."))
    if errors:
        return [], errors, 0

    indexes = {name: index for index, name in enumerate(normalized)}
    parsed, seen_codes, seen_barcodes, total_rows = [], {}, {}, 0
    try:
        for values in reader:
            row_number = reader.line_num
            if not values or all(not value.strip() for value in values):
                continue
            total_rows += 1
            before = len(errors)
            if len(values) != len(headers):
                errors.append(_error(row_number, "_row", "wrong_column_count", f"La fila tiene {len(values)} campos y se esperaban {len(headers)}."))
                continue

            row = {name: values[index].strip() for name, index in indexes.items()}
            for field in ("codigo_i", "codigo_b", "articulo"):
                if not row[field]:
                    errors.append(_error(row_number, field, "required", f"'{field}' no puede estar vacío."))
            if len(row["codigo_i"]) > 40:
                errors.append(_error(row_number, "codigo_i", "too_long", "El código I admite hasta 40 caracteres."))
            if len(row["codigo_b"]) > 20:
                errors.append(_error(row_number, "codigo_b", "too_long", "El código B admite hasta 20 caracteres."))
            if len(row["articulo"]) > 120:
                errors.append(_error(row_number, "articulo", "too_long", "El artículo admite hasta 120 caracteres."))

            code_key = row["codigo_i"].casefold()
            barcode_key = row["codigo_b"].casefold()
            if code_key:
                if code_key in seen_codes:
                    errors.append(_error(row_number, "codigo_i", "duplicate_in_file", f"El código I también aparece en la fila {seen_codes[code_key]}."))
                else:
                    seen_codes[code_key] = row_number
            if barcode_key:
                if barcode_key in seen_barcodes:
                    errors.append(_error(row_number, "codigo_b", "duplicate_in_file", f"El código B también aparece en la fila {seen_barcodes[barcode_key]}."))
                else:
                    seen_barcodes[barcode_key] = row_number

            weight = _decimal(row["peso"], "peso", row_number, errors, 4)
            price = _decimal(row["precio_por_unidad"], "precio_por_unidad", row_number, errors, 2)
            tax_price = _decimal(row["precio_con_iva"], "precio_con_iva", row_number, errors, 2)
            try:
                pack_size = int(row["unidades_por_caja"])
                if pack_size <= 0 or pack_size > 1000000:
                    raise ValueError
            except ValueError:
                pack_size = None
                errors.append(_error(row_number, "unidades_por_caja", "invalid_pack_size", "Debe ser un entero entre 1 y 1.000.000."))

            if price is not None and tax_price is not None:
                expected_tax_price = (price * Decimal("1.19")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if tax_price != expected_tax_price:
                    errors.append(_error(row_number, "precio_con_iva", "tax_price_mismatch", f"Debe corresponder al precio por unidad más 19%: {expected_tax_price:.2f}."))

            if len(errors) == before:
                parsed.append({
                    "row": row_number,
                    "sku": row["codigo_i"],
                    "codigo_b": row["codigo_b"],
                    "nombre": row["articulo"],
                    "peso": weight,
                    "precio_vigente": price,
                    "unidades_por_caja": pack_size,
                })
    except csv.Error as exc:
        errors.append(_error(reader.line_num, "_file", "invalid_csv", f"Error de formato CSV: {exc}."))
    if total_rows == 0 and not errors:
        errors.append(_error(2, "_file", "no_data_rows", "El CSV no contiene filas de productos."))
    return parsed, errors, total_rows


def import_catalog_rows(conn, rows: list[dict]) -> list[dict]:
    """Inserta o actualiza los productos de la lista en una única transacción."""
    if not rows:
        return []
    errors = []
    skus = [row["sku"].casefold() for row in rows]
    barcodes = [row["codigo_b"].casefold() for row in rows]
    with conn.cursor() as cursor:
        cursor.execute(
            "SELECT id_categoria FROM categoria WHERE lower(nombre) = lower(%s)",
            (DEFAULT_CATEGORY,),
        )
        category = cursor.fetchone()
        cursor.execute(
            "SELECT id_unidad FROM unidad_comercial WHERE lower(nombre) = lower(%s)",
            (DEFAULT_UNIT,),
        )
        unit = cursor.fetchone()
        if category is None:
            errors.append(_error(1, "categoria", "default_category_missing", "Falta la categoría interna 'Lista de precios'."))
        if unit is None:
            errors.append(_error(1, "unidad", "default_unit_missing", "Falta la unidad interna 'unidad'."))
        cursor.execute(
            "SELECT sku, codigo_b FROM producto WHERE eliminado = FALSE AND lower(codigo_b) = ANY(%s)",
            (barcodes,),
        )
        existing_barcodes = {barcode.casefold(): sku for sku, barcode in cursor.fetchall() if barcode}
        for row in rows:
            owner = existing_barcodes.get(row["codigo_b"].casefold())
            if owner is not None and owner.casefold() != row["sku"].casefold():
                errors.append(_error(row["row"], "codigo_b", "duplicate_in_database", f"El código B '{row['codigo_b']}' ya pertenece al código I '{owner}'."))

        if errors:
            return errors

        with conn.transaction():
            for row in rows:
                cursor.execute(
                    """INSERT INTO producto
                           (sku, codigo_b, nombre, peso, id_categoria, id_unidad, precio_vigente,
                            unidades_por_caja, requiere_trazabilidad, umbral_stock_critico)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, FALSE, 0)
                       ON CONFLICT (sku) WHERE eliminado = FALSE DO UPDATE SET
                           codigo_b = EXCLUDED.codigo_b,
                           nombre = EXCLUDED.nombre,
                           peso = EXCLUDED.peso,
                           id_categoria = EXCLUDED.id_categoria,
                           id_unidad = EXCLUDED.id_unidad,
                           precio_vigente = EXCLUDED.precio_vigente,
                           unidades_por_caja = EXCLUDED.unidades_por_caja
                       RETURNING id_producto""",
                    (
                        row["sku"], row["codigo_b"], row["nombre"], row["peso"],
                        category[0], unit[0], row["precio_vigente"], row["unidades_por_caja"],
                    ),
                )
                cursor.fetchone()
    return []


def set_product_active(conn, sku: str, active: bool) -> dict:
    """Retira o reactiva un producto sin borrar su historial ni sus lotes."""
    normalized_sku = sku.strip()
    if not normalized_sku:
        raise HTTPException(status_code=422, detail={"code": "invalid_sku", "message": "El Código I no puede estar vacío."})
    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id_producto, nombre, activo FROM producto WHERE sku = %s AND eliminado = FALSE FOR UPDATE",
                (normalized_sku,),
            )
            product = cursor.fetchone()
            if product is None:
                raise HTTPException(status_code=404, detail={"code": "product_not_found", "message": f"No existe el producto con Código I '{normalized_sku}'."})
            product_id, name, current_status = product
            if current_status != active:
                cursor.execute("UPDATE producto SET activo = %s WHERE id_producto = %s", (active, product_id))
            cursor.execute(
                "SELECT COALESCE(SUM(cantidad_fisica), 0) FROM lote WHERE id_producto = %s",
                (product_id,),
            )
            physical_stock = cursor.fetchone()[0]
    return {
        "status": "active" if active else "inactive",
        "sku": normalized_sku,
        "nombre": name,
        "activo": active,
        "stock_fisico": physical_stock,
    }

def delete_catalog_product(conn, sku: str) -> dict:
    """Retira el producto del catálogo y libera sus códigos sin borrar su historial."""
    normalized_sku = sku.strip()
    if not normalized_sku:
        raise HTTPException(status_code=422, detail={"code": "invalid_sku", "message": "El Código I no puede estar vacío."})
    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id_producto, nombre, activo FROM producto WHERE sku = %s AND eliminado = FALSE FOR UPDATE",
                (normalized_sku,),
            )
            product = cursor.fetchone()
            if product is None:
                raise HTTPException(status_code=404, detail={"code": "product_not_found", "message": f"No existe un producto disponible para eliminar con Código I '{normalized_sku}'."})
            product_id, name, active = product
            if active:
                raise HTTPException(status_code=409, detail={"code": "product_must_be_retired", "message": "Retira el producto antes de eliminarlo del catálogo."})
            cursor.execute(
                "UPDATE producto SET eliminado = TRUE WHERE id_producto = %s",
                (product_id,),
            )
            cursor.execute(
                "SELECT COALESCE(SUM(cantidad_fisica), 0) FROM lote WHERE id_producto = %s",
                (product_id,),
            )
            physical_stock = cursor.fetchone()[0]
    return {
        "status": "removed_from_catalog",
        "sku": normalized_sku,
        "nombre": name,
        "codigos_liberados": True,
        "stock_fisico_conservado": physical_stock,
    }

def search_catalog(conn, q: str | None = None, categoria: str | None = None,
                   limit: int = 20, offset: int = 0, id_bodega: int | None = None, incluir_inactivos: bool = False) -> dict:
    """Busca productos y calcula stock disponible descontando reservas vigentes."""
    filters = ["p.eliminado = FALSE"]
    if not incluir_inactivos:
        filters.append("p.activo = TRUE")
    parameters = []
    if q:
        filters.append("(p.nombre ILIKE %s OR p.sku ILIKE %s OR p.codigo_b ILIKE %s)")
        term = f"%{q.strip()}%"
        parameters.extend((term, term, term))
    if categoria:
        filters.append("c.nombre = %s")
        parameters.append(categoria)
    where = " WHERE " + " AND ".join(filters) if filters else ""
    availability_filters, availability_parameters = [], []
    if id_bodega is not None:
        availability_filters.append("l.id_bodega = %s")
        availability_parameters.append(id_bodega)
    lot_where = " AND " + " AND ".join(availability_filters) if availability_filters else ""
    with conn.cursor() as cursor:
        cursor.execute(
            """SELECT COUNT(*)
               FROM producto p
               JOIN categoria c ON c.id_categoria = p.id_categoria""" + where,
            parameters,
        )
        total = cursor.fetchone()[0]
        cursor.execute(
            """WITH disponibilidad AS (
                   SELECT l.id_producto,
                          SUM(GREATEST(l.cantidad_fisica - COALESCE(r.cantidad_reservada, 0), 0)) AS disponible
                   FROM lote l
                   LEFT JOIN LATERAL (
                       SELECT SUM(rv.cantidad) AS cantidad_reservada
                       FROM reserva rv
                       JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                       WHERE rv.id_lote = l.id_lote
                         AND er.nombre = 'vigente'
                         AND rv.fecha_expiracion > NOW()
                   ) r ON TRUE
                   WHERE (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)""" + lot_where + """
                   GROUP BY l.id_producto
               )
               SELECT p.sku, p.codigo_b, p.nombre, p.peso, c.nombre AS categoria, u.nombre AS unidad,
                      p.precio_vigente, ROUND(p.precio_vigente * 1.19, 2) AS precio_con_iva,
                      p.unidades_por_caja, u.decimales, p.activo,
                      COALESCE(d.disponible, 0) AS disponible,
                      FLOOR(COALESCE(d.disponible, 0) / p.unidades_por_caja) AS cajas_disponibles
               FROM producto p
               JOIN categoria c ON c.id_categoria = p.id_categoria
               JOIN unidad_comercial u ON u.id_unidad = p.id_unidad
               LEFT JOIN disponibilidad d ON d.id_producto = p.id_producto""" + where +
            " ORDER BY p.nombre, p.sku LIMIT %s OFFSET %s",
            [*availability_parameters, *parameters, limit, offset],
        )
        columns = [column.name for column in cursor.description]
        items = [dict(zip(columns, row)) for row in cursor.fetchall()]
        cursor.execute(
            """SELECT DISTINCT c.nombre
               FROM categoria c
               JOIN producto p ON p.id_categoria = c.id_categoria
               WHERE p.activo = TRUE
               ORDER BY c.nombre"""
        )
        categories = [row[0] for row in cursor.fetchall()]
    return {"items": items, "total": total, "limit": limit, "offset": offset, "categories": categories}




