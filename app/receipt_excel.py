"""Lectura y validación de listas de precios Excel para recepciones iniciales."""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import BytesIO
import re
import secrets
import unicodedata
from zipfile import BadZipFile

from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException


MAX_EXCEL_BYTES = 5 * 1024 * 1024
MAX_EXCEL_ROWS = 1000
MAX_HEADER_SCAN_ROWS = 40

_ALIASES = {
    "codigo_i": {"codigo i", "codigo", "sku", "codigo interno", "codigo producto"},
    "codigo_b": {"codigo b", "codigo barras", "ean", "barcode"},
    "nombre": {"articulo", "producto", "nombre"},
    "unidades_por_caja": {"unidad x caja", "unidades x caja", "unidad por caja", "unidades por caja"},
    "peso": {"peso", "peso unidad", "peso por unidad"},
    "precio_vigente": {"precio x unidad", "precio por unidad", "precio unidad"},
    "precio_con_iva": {"precio con iva", "precio x iva"},
    "codigo_lote": {"codigo lote", "lote", "numero lote"},
    "fecha_vencimiento": {"fecha vencimiento", "fecha de vencimiento", "vencimiento"},
}


def _error(row: int, field: str, code: str, message: str) -> dict:
    return {"row": row, "field": field, "code": code, "message": message}


def _normalized_text(value) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return " ".join(re.sub(r"[^a-zA-Z0-9]+", " ", text).casefold().split())


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _header_spec(worksheet) -> dict | None:
    scan_to = min(worksheet.max_row or MAX_HEADER_SCAN_ROWS, MAX_HEADER_SCAN_ROWS)
    for row_number, values in enumerate(
        worksheet.iter_rows(min_row=1, max_row=scan_to, values_only=True), start=1
    ):
        columns = {}
        for column_index, value in enumerate(values):
            key = _normalized_text(value)
            if not key:
                continue
            for field, aliases in _ALIASES.items():
                if key in aliases and field not in columns:
                    columns[field] = column_index
        if "nombre" in columns and "unidades_por_caja" in columns:
            return {"header_row": row_number, "columns": columns}
    return None


def _open_workbook(content: bytes):
    if len(content) > MAX_EXCEL_BYTES:
        raise ValueError("El archivo supera el máximo de 5 MiB.")
    if not content:
        raise ValueError("El archivo Excel está vacío.")
    try:
        return load_workbook(BytesIO(content), read_only=True, data_only=True, keep_links=False)
    except (BadZipFile, InvalidFileException, OSError, ValueError, KeyError) as exc:
        raise ValueError("El archivo no es un Excel .xlsx válido o está dañado.") from exc


def _table_rows(worksheet, header_row: int, columns: dict):
    start = header_row + 1
    stop = min(worksheet.max_row or start, start + MAX_EXCEL_ROWS)
    blank_rows = 0
    relevant = ("codigo_i", "codigo_b", "nombre", "unidades_por_caja", "peso", "precio_vigente", "codigo_lote", "fecha_vencimiento")
    for row_number, values in enumerate(
        worksheet.iter_rows(min_row=start, max_row=stop, values_only=True),
        start=start,
    ):
        if any("articulos en rojo agotados" in _normalized_text(value) for value in values if value is not None):
            break
        row = {field: values[index] if index < len(values) else None for field, index in columns.items()}
        if not any(row.get(field) not in (None, "") for field in relevant):
            blank_rows += 1
            if blank_rows >= 2:
                break
            continue
        blank_rows = 0
        yield row_number, values

def _sheet_specs(workbook) -> list[dict]:
    specs = []
    for worksheet in workbook.worksheets[:30]:
        header = _header_spec(worksheet)
        if not header:
            continue
        columns = header["columns"]
        start = header["header_row"] + 1
        stop = min(worksheet.max_row or start, start + MAX_EXCEL_ROWS)
        count = sum(1 for _ in _table_rows(worksheet, header["header_row"], columns))
        specs.append({"name": worksheet.title, "header_row": header["header_row"], "rows": count, "columns": columns})
    return specs


def _as_date(value):
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, pattern).date()
        except ValueError:
            continue
    raise ValueError("Usa una fecha válida (AAAA-MM-DD o DD/MM/AAAA).")


def _as_quantity(value) -> Decimal:
    raw = _cell_text(value).replace(",", ".")
    if not raw:
        raise ValueError("Falta el valor de UNIDAD X CAJA.")
    try:
        quantity = Decimal(raw)
    except InvalidOperation as exc:
        raise ValueError("UNIDAD X CAJA debe contener una cantidad numérica.") from exc
    if not quantity.is_finite() or quantity <= 0:
        raise ValueError("UNIDAD X CAJA debe ser mayor que cero.")
    if quantity >= Decimal("1000000000"):
        raise ValueError("UNIDAD X CAJA supera el máximo permitido.")
    rounded = quantity.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if rounded <= 0:
        raise ValueError("UNIDAD X CAJA debe ser mayor que cero después del redondeo.")
    return rounded


def _resolve_product(raw, products_by_sku, products_by_barcode):
    code_i, code_b, name = (_cell_text(raw.get(key)) for key in ("codigo_i", "codigo_b", "nombre"))
    if code_i:
        product = products_by_sku.get(code_i.casefold())
        barcode_owner = products_by_barcode.get(code_b.casefold()) if code_b else None
        if barcode_owner and (not product or barcode_owner["sku"].casefold() != product["sku"].casefold()):
            return None, _error(raw["row"], "codigo_b", "barcode_already_assigned", f"El Código B '{code_b}' ya pertenece al producto '{barcode_owner['sku']}'.")
        return product, None
    if code_b:
        product = products_by_barcode.get(code_b.casefold())
        if not product:
            return None, _error(raw["row"], "codigo_i", "new_product_requires_code_i", "Para crear un artículo nuevo, la planilla debe incluir su Código I.")
        return product, None
    return None, _error(raw["row"], "codigo_i", "missing_unique_identifier", "Artículo omitido: necesita un Código I o Código B único para poder identificarse.")


def _excel_decimal(value, field: str, row: int, errors: list[dict], scale: int) -> Decimal | None:
    raw = _cell_text(value).replace(",", ".")
    if not raw:
        errors.append(_error(row, field, "required_for_new_product", "Este dato es obligatorio para crear el artículo nuevo desde la planilla."))
        return None
    try:
        number = Decimal(raw)
    except InvalidOperation:
        errors.append(_error(row, field, "invalid_number", "Debe ser un valor numérico válido."))
        return None
    if not number.is_finite() or number < 0:
        errors.append(_error(row, field, "out_of_range", "Debe ser un número finito mayor o igual a cero."))
        return None
    if number >= Decimal(10) ** (12 - scale):
        errors.append(_error(row, field, "out_of_range", "El número supera la precisión permitida por el catálogo."))
        return None
    rounded = number.quantize(Decimal(1).scaleb(-scale), rounding=ROUND_HALF_UP)
    if rounded >= Decimal(10) ** (12 - scale):
        errors.append(_error(row, field, "out_of_range", "El número supera la precisión permitida por el catálogo después del redondeo."))
        return None
    return rounded


def _new_product_data(raw, row: int, quantity: Decimal | None) -> tuple[dict | None, list[dict]]:
    errors = []
    sku = _cell_text(raw.get("codigo_i"))
    barcode = _cell_text(raw.get("codigo_b")) or None
    name = _cell_text(raw.get("nombre"))
    if not sku:
        errors.append(_error(row, "codigo_i", "required_for_new_product", "La planilla debe incluir el Código I para crear el artículo."))
    elif len(sku) > 40:
        errors.append(_error(row, "codigo_i", "too_long", "El Código I admite hasta 40 caracteres."))
    if not name:
        errors.append(_error(row, "articulo", "required", "El artículo no puede estar vacío."))
    elif len(name) > 120:
        errors.append(_error(row, "articulo", "too_long", "El artículo admite hasta 120 caracteres."))
    if barcode and len(barcode) > 20:
        errors.append(_error(row, "codigo_b", "too_long", "El Código B admite hasta 20 caracteres."))
    weight = _excel_decimal(raw.get("peso"), "peso", row, errors, 4)
    price = _excel_decimal(raw.get("precio_vigente"), "precio_por_unidad", row, errors, 2)
    if quantity is not None and (quantity != quantity.to_integral_value() or quantity > 1000000):
        errors.append(_error(row, "unidades_por_caja", "invalid_pack_size", "Para crear el artículo, UNIDAD X CAJA debe ser un entero entre 1 y 1.000.000."))
    tax_raw = raw.get("precio_con_iva")
    if tax_raw not in (None, ""):
        tax_price = _excel_decimal(tax_raw, "precio_con_iva", row, errors, 2)
        if price is not None and tax_price is not None:
            expected = (price * Decimal("1.19")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if tax_price != expected:
                errors.append(_error(row, "precio_con_iva", "tax_price_mismatch", f"Debe corresponder al precio por unidad más 19%: {expected:.2f}."))
    if errors or quantity is None or weight is None or price is None or not sku or not name:
        return None, errors
    return {
        "sku": sku, "codigo_b": barcode, "nombre": name, "peso": weight,
        "precio_vigente": price, "unidades_por_caja": int(quantity),
    }, errors


def preview_receipt_workbook(conn, content: bytes, worksheet_name: str | None = None,
                             common_expiration: date | None = None,
                             batch_ref: str | None = None) -> dict:
    """Analiza una hoja de lista de precios sin guardar cambios en PostgreSQL."""
    try:
        workbook = _open_workbook(content)
    except ValueError as exc:
        return {
            "status": "rejected", "sheets": [], "selected_sheet": None,
            "batch_ref": batch_ref, "total_rows": 0, "valid_rows": 0,
            "items": [], "errors": [_error(1, "_file", "invalid_workbook", str(exc))],
        }

    try:
        specs = _sheet_specs(workbook)
        public_specs = [{key: spec[key] for key in ("name", "header_row", "rows")} for spec in specs]
        if not specs:
            return {
                "status": "rejected", "sheets": [], "selected_sheet": None,
                "batch_ref": batch_ref, "total_rows": 0, "valid_rows": 0,
                "items": [], "errors": [_error(1, "_sheet", "table_not_found", "No se encontró una hoja con las columnas Artículo y UNIDAD X CAJA.")],
            }
        if worksheet_name is None:
            spec = specs[0] if len(specs) == 1 else None
        else:
            spec = next((item for item in specs if item["name"] == worksheet_name), None)
            if spec is None:
                return {
                    "status": "rejected", "sheets": public_specs, "selected_sheet": worksheet_name,
                    "batch_ref": batch_ref, "total_rows": 0, "valid_rows": 0,
                    "items": [], "errors": [_error(1, "_sheet", "sheet_not_found", f"La hoja '{worksheet_name}' no tiene el formato esperado.")],
                }
        if batch_ref is None:
            batch_ref = secrets.token_hex(4).upper()
        elif not re.fullmatch(r"[A-Fa-f0-9]{8}", batch_ref):
            return {
                "status": "rejected", "sheets": public_specs, "selected_sheet": spec["name"] if spec else worksheet_name,
                "batch_ref": batch_ref, "total_rows": 0, "valid_rows": 0,
                "items": [], "errors": [_error(1, "_batch", "invalid_batch_ref", "La referencia de importación no es válida. Vuelve a seleccionar el archivo.")],
            }

        if spec is None:
            return {
                "status": "choose_sheet",
                "sheets": public_specs,
                "selected_sheet": None,
                "batch_ref": batch_ref,
                "total_rows": 0,
                "valid_rows": 0,
                "items": [],
                "errors": [],
                "rows": [],
            }
        with conn.cursor() as cursor:
            cursor.execute("SELECT sku, codigo_b, nombre, requiere_trazabilidad, activo FROM producto WHERE eliminado = FALSE")
            products = cursor.fetchall()
        products_by_sku = {str(row[0]).casefold(): {"sku": row[0], "codigo_b": row[1], "nombre": row[2], "requiere_trazabilidad": row[3], "activo": row[4]} for row in products}
        products_by_barcode = {str(row[1]).casefold(): {"sku": row[0], "codigo_b": row[1], "nombre": row[2], "requiere_trazabilidad": row[3], "activo": row[4]} for row in products if row[1]}
        worksheet = workbook[spec["name"]]
        columns = spec["columns"]
        first_row = spec["header_row"] + 1
        source_rows = list(_table_rows(worksheet, spec["header_row"], columns))
        identifier_occurrences = {}
        for row_number, values in source_rows:
            raw = {field: values[index] if index < len(values) else None for field, index in columns.items()}
            for field in ("codigo_i", "codigo_b"):
                code = _cell_text(raw.get(field)).casefold()
                if code:
                    identifier_occurrences.setdefault((field, code), []).append(row_number)
        duplicate_identifiers = {}
        for (field, _), row_numbers in identifier_occurrences.items():
            if len(row_numbers) > 1:
                for row_number in row_numbers:
                    duplicate_identifiers.setdefault(row_number, set()).add(field)

        rows, preview_items, errors, omitted_rows = [], [], [], []
        seen_skus, seen_lots, seen_barcodes = {}, {}, {}
        total_rows = 0
        has_actual_lot_column = "codigo_lote" in columns
        for row_number, values in source_rows:
            raw = {field: values[index] if index < len(values) else None for field, index in columns.items()}
            total_rows += 1
            if total_rows > MAX_EXCEL_ROWS:
                errors.append(_error(row_number, "_file", "too_many_rows", f"La hoja puede contener hasta {MAX_EXCEL_ROWS} artículos por carga."))
                break
            raw["row"] = row_number
            name = _cell_text(raw.get("nombre"))
            if row_number in duplicate_identifiers:
                fields = duplicate_identifiers[row_number]
                label = " y ".join("Código I" if field == "codigo_i" else "Código B" for field in ("codigo_i", "codigo_b") if field in fields)
                code_i = _cell_text(raw.get("codigo_i"))
                code_b = _cell_text(raw.get("codigo_b"))
                skipped = _error(row_number, next(iter(fields)), "duplicate_identifier_in_file", f"Artículo '{name or '(sin nombre)'}' omitido: {label} se repite en la planilla; Código I: {code_i or '—'}, Código B: {code_b or '—'}. Se omiten todas sus apariciones.")
                omitted_rows.append(skipped)
                preview_items.append({
                    "row": row_number, "sku": _cell_text(raw.get("codigo_i")) or _cell_text(raw.get("codigo_b")),
                    "nombre": name, "producto_nuevo": False,
                    "cantidad": _cell_text(raw.get("unidades_por_caja")), "codigo_lote": "",
                    "fecha_vencimiento": None, "status": "omitted", "message": skipped["message"],
                })
                continue
            row_errors = [] if name else [_error(row_number, "articulo", "missing_name", "Falta el nombre del artículo.")]
            product, product_error = _resolve_product(raw, products_by_sku, products_by_barcode)
            if product_error and product_error["code"] in {"missing_unique_identifier", "new_product_requires_code_i", "barcode_already_assigned"}:
                omitted_rows.append(product_error)
                preview_items.append({
                    "row": row_number,
                    "sku": _cell_text(raw.get("codigo_i")) or _cell_text(raw.get("codigo_b")),
                    "nombre": name,
                    "producto_nuevo": False,
                    "cantidad": _cell_text(raw.get("unidades_por_caja")),
                    "codigo_lote": "",
                    "fecha_vencimiento": None,
                    "status": "omitted",
                    "message": product_error["message"],
                })
                continue
            new_product = None
            if product_error:
                row_errors.append(product_error)
            elif product and not product["activo"]:
                row_errors.append(_error(row_number, "codigo_i", "product_inactive", f"El producto '{product['nombre']}' está inactivo."))
            try:
                quantity = _as_quantity(raw.get("unidades_por_caja"))
            except ValueError as exc:
                quantity = None
                row_errors.append(_error(row_number, "unidad x caja", "invalid_quantity", str(exc)))
            try:
                expiration = _as_date(raw.get("fecha_vencimiento")) or common_expiration
            except ValueError as exc:
                expiration = None
                row_errors.append(_error(row_number, "fecha_vencimiento", "invalid_expiration", str(exc)))
            if expiration and expiration < date.today():
                row_errors.append(_error(row_number, "fecha_vencimiento", "expiration_in_past", "La fecha de vencimiento no puede estar en el pasado."))
            if product and product["requiere_trazabilidad"] and expiration is None:
                row_errors.append(_error(row_number, "fecha_vencimiento", "expiration_required", "Este producto requiere trazabilidad; ingresa una fecha común o completa la fecha en la planilla."))
            if product is None and product_error is None:
                if quantity is not None:
                    quantity = quantity.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                    if quantity <= 0:
                        row_errors.append(_error(row_number, "unidad x caja", "invalid_quantity", "UNIDAD X CAJA debe ser mayor que cero después del redondeo a unidades enteras."))
                new_product, product_errors = _new_product_data(raw, row_number, quantity)
                row_errors.extend(product_errors)

            actual_lot = _cell_text(raw.get("codigo_lote")) if has_actual_lot_column else ""
            lot_code = actual_lot or f"XLS-{batch_ref}-{row_number:04d}"
            if len(lot_code) > 40:
                row_errors.append(_error(row_number, "codigo_lote", "lot_too_long", "El código de lote admite hasta 40 caracteres."))
            candidate_sku = product["sku"] if product else new_product["sku"] if new_product else _cell_text(raw.get("codigo_i"))
            skip_row = False
            if candidate_sku:
                normalized_sku = candidate_sku.casefold()
                previous_row = seen_skus.get(normalized_sku)
                if previous_row and not has_actual_lot_column:
                    row_errors.append(_error(row_number, "codigo_i", "duplicate_product", f"Este producto ya aparece en la fila {previous_row}; combina cantidades o especifica lotes distintos."))
                else:
                    seen_skus.setdefault(normalized_sku, row_number)
                if new_product and new_product["codigo_b"]:
                    barcode_key = new_product["codigo_b"].casefold()
                    previous_barcode_row = seen_barcodes.get(barcode_key)
                    if previous_barcode_row and seen_skus.get(normalized_sku) != previous_barcode_row:
                        omitted_rows.append(_error(row_number, "codigo_b", "duplicate_barcode_in_file", f"Artículo '{name or '(sin nombre)'}' omitido: el Código B '{new_product['codigo_b']}' también aparece en la fila {previous_barcode_row}."))
                        skip_row = True
                    else:
                        seen_barcodes.setdefault(barcode_key, row_number)
                lot_key = (normalized_sku, lot_code.casefold())
                if lot_key in seen_lots:
                    row_errors.append(_error(row_number, "codigo_lote", "duplicate_lot", f"Este producto y lote ya aparecen en la fila {seen_lots[lot_key]}."))
                else:
                    seen_lots[lot_key] = row_number
            errors.extend(row_errors)
            item = {
                "row": row_number,
                "sku": product["sku"] if product else new_product["sku"] if new_product else _cell_text(raw.get("codigo_i")) or _cell_text(raw.get("codigo_b")),
                "nombre": product["nombre"] if product else new_product["nombre"] if new_product else name,
                "producto_nuevo": new_product is not None,
                "cantidad": format(quantity.normalize(), "f") if quantity is not None else "",
                "codigo_lote": lot_code,
                "fecha_vencimiento": expiration.isoformat() if expiration else None,
                "status": "error" if row_errors else "omitted" if skip_row else "new" if new_product else "ready",
            }
            preview_items.append(item)
            if not row_errors and not skip_row and (product or new_product) and quantity is not None:
                rows.append({
                    "row": row_number,
                    "nuevo_producto": new_product,
                    "sku": product["sku"] if product else new_product["sku"],
                    "codigo_lote": lot_code,
                    "cantidad": quantity,
                    "fecha_vencimiento": expiration,
                    "motivo": "Carga inicial desde lista de precios Excel",
                })
        if total_rows == 0 and not errors:
            errors.append(_error(first_row, "_sheet", "no_data_rows", "La hoja no contiene artículos para recibir."))
        return {
            "status": "rejected" if errors else "preview",
            "sheets": public_specs, "selected_sheet": spec["name"], "batch_ref": batch_ref,
            "header_row": spec["header_row"], "total_rows": min(total_rows, MAX_EXCEL_ROWS),
            "valid_rows": len(rows), "omitted_rows": omitted_rows,
            "items": preview_items, "errors": errors, "rows": rows,
        }
    finally:
        workbook.close()




