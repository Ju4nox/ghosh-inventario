"""Validación e importación inicial del catálogo desde CSV."""
import csv
import io
from decimal import Decimal, InvalidOperation

REQUIRED_COLUMNS = ("sku", "nombre", "categoria", "unidad", "precio_vigente")
OPTIONAL_COLUMNS = ("requiere_trazabilidad", "umbral_stock_critico")
ALLOWED_COLUMNS = frozenset((*REQUIRED_COLUMNS, *OPTIONAL_COLUMNS))
MAX_CSV_BYTES = 5 * 1024 * 1024


def _error(row: int, field: str, code: str, message: str) -> dict:
    return {"row": row, "field": field, "code": code, "message": message}


def _decimal(value: str, field: str, row: int, errors: list[dict], scale: int):
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
    if number >= Decimal(10) ** (12 - scale):
        errors.append(_error(row, field, "out_of_range", "El número supera la precisión permitida por la base de datos."))
        return None
    return number


def _boolean(value: str, row: int, errors: list[dict]):
    normalized = value.strip().casefold()
    if normalized in {"true", "1", "si", "sí", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    errors.append(_error(row, "requiere_trazabilidad", "invalid_boolean", "Use true/false, sí/no o 1/0."))
    return None


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
        return [], [_error(1, "_file", "empty_file", "El archivo CSV está vacío o no tiene un encabezado válido.")], 0

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
    parsed, seen_skus, total_rows = [], {}, 0
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
            for field in REQUIRED_COLUMNS:
                if not row[field]:
                    errors.append(_error(row_number, field, "required", f"'{field}' no puede estar vacío."))
            sku_key = row["sku"].casefold()
            if row["sku"]:
                if sku_key in seen_skus:
                    errors.append(_error(row_number, "sku", "duplicate_in_file", f"SKU duplicado; también aparece en la fila {seen_skus[sku_key]}."))
                else:
                    seen_skus[sku_key] = row_number
            price = _decimal(row["precio_vigente"], "precio_vigente", row_number, errors, 2) if row["precio_vigente"] else None
            threshold_raw = row.get("umbral_stock_critico", "")
            threshold = _decimal(threshold_raw, "umbral_stock_critico", row_number, errors, 3) if threshold_raw else Decimal("0")
            traceability_raw = row.get("requiere_trazabilidad", "")
            traceability = _boolean(traceability_raw, row_number, errors) if traceability_raw else False
            if len(errors) == before:
                parsed.append({
                    "row": row_number,
                    "sku": row["sku"],
                    "nombre": row["nombre"],
                    "categoria": row["categoria"],
                    "unidad": row["unidad"],
                    "precio_vigente": price,
                    "requiere_trazabilidad": traceability,
                    "umbral_stock_critico": threshold,
                })
    except csv.Error as exc:
        errors.append(_error(reader.line_num, "_file", "invalid_csv", f"Error de formato CSV: {exc}."))
    if total_rows == 0 and not errors:
        errors.append(_error(2, "_file", "no_data_rows", "El CSV no contiene filas de productos."))
    return parsed, errors, total_rows


def import_catalog_rows(conn, rows: list[dict]) -> list[dict]:
    """Valida referencias/duplicados y carga todo en una transacción."""
    if not rows:
        return []
    errors = []
    skus = [row["sku"].casefold() for row in rows]
    categories = sorted({row["categoria"].casefold() for row in rows})
    units = sorted({row["unidad"].casefold() for row in rows})
    with conn.cursor() as cursor:
        cursor.execute("SELECT sku FROM producto WHERE lower(sku) = ANY(%s)", (skus,))
        existing_skus = {sku.casefold() for (sku,) in cursor.fetchall()}
        cursor.execute("SELECT id_categoria, nombre FROM categoria WHERE lower(nombre) = ANY(%s)", (categories,))
        category_ids = {name.casefold(): category_id for category_id, name in cursor.fetchall()}
        cursor.execute("SELECT id_unidad, nombre FROM unidad_comercial WHERE lower(nombre) = ANY(%s)", (units,))
        unit_ids = {name.casefold(): unit_id for unit_id, name in cursor.fetchall()}
        for row in rows:
            if row["sku"].casefold() in existing_skus:
                errors.append(_error(row["row"], "sku", "duplicate_in_database", f"El SKU '{row['sku']}' ya existe en el catálogo."))
            if row["categoria"].casefold() not in category_ids:
                errors.append(_error(row["row"], "categoria", "unknown_category", f"La categoría '{row['categoria']}' no existe."))
            if row["unidad"].casefold() not in unit_ids:
                errors.append(_error(row["row"], "unidad", "unknown_unit", f"La unidad '{row['unidad']}' no existe."))
        if errors:
            return errors
        with conn.transaction():
            for row in rows:
                cursor.execute(
                    """INSERT INTO producto
                       (sku, nombre, id_categoria, id_unidad, precio_vigente,
                        requiere_trazabilidad, umbral_stock_critico)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (sku) DO NOTHING RETURNING id_producto""",
                    (row["sku"], row["nombre"], category_ids[row["categoria"].casefold()],
                     unit_ids[row["unidad"].casefold()], row["precio_vigente"],
                     row["requiere_trazabilidad"], row["umbral_stock_critico"]),
                )
                if cursor.fetchone() is None:
                    raise RuntimeError(f"duplicate_sku:{row['row']}:{row['sku']}")
    return []
