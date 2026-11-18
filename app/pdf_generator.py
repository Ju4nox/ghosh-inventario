"""Generador PDF puro en Python (sin dependencias externas) para notas de venta."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def _escape_pdf_text(value: str) -> bytes:
    """Codifica texto en WinAnsi (cp1252) y escapa caracteres especiales PDF."""
    cleaned = " ".join(str(value or "").splitlines()).strip()
    raw = cleaned.encode("cp1252", errors="replace")
    out = bytearray()
    for byte in raw:
        if byte in (40, 41, 92):  # (, ), \
            out.append(92)
        out.append(byte)
    return bytes(out)


def _format_clp(value: Any) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0.0
    rounded = int(round(amount))
    return "$" + f"{rounded:,}".replace(",", ".")


def _format_num(value: Any) -> str:
    try:
        num = float(value or 0)
    except (TypeError, ValueError):
        return "0"
    if num.is_integer():
        return str(int(num))
    return f"{num:.2f}".rstrip("0").rstrip(".")


def _format_dt(value: Any) -> str:
    if not value:
        return "—"
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y %H:%M")
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%d/%m/%Y %H:%M")
    except ValueError:
        return text[:19]


def _wrap_text(text: str, max_chars: int) -> list[str]:
    words = " ".join((text or "").split()).split(" ")
    if not words or words == [""]:
        return ["—"]
    lines: list[str] = []
    current = ""
    for word in words:
        if len(word) > max_chars:
            if current:
                lines.append(current)
                current = ""
            for i in range(0, len(word), max_chars):
                chunk = word[i : i + max_chars]
                if len(chunk) == max_chars:
                    lines.append(chunk)
                else:
                    current = chunk
        elif not current:
            current = word
        elif len(current) + 1 + len(word) <= max_chars:
            current += " " + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or ["—"]


def _pdf_text(cmds: list[bytes], x: float, y: float, font: str, size: float, text: str) -> None:
    escaped = _escape_pdf_text(text)
    cmds.append(
        f"BT /{font} {size:.1f} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm (".encode("ascii")
        + escaped
        + b") Tj ET"
    )


def _pdf_text_right(
    cmds: list[bytes],
    right_x: float,
    y: float,
    font: str,
    size: float,
    text: str,
    char_width_factor: float = 0.52,
) -> None:
    # Aproximación conservadora de ancho para Helvetica/Courier para alinear montos a la derecha.
    approx_w = len(str(text)) * size * char_width_factor
    x = max(36.0, right_x - approx_w)
    _pdf_text(cmds, x, y, font, size, text)


def _pdf_line(cmds: list[bytes], x1: float, y1: float, x2: float, y2: float, gray: float = 0.82, width: float = 0.7) -> None:
    cmds.append(f"q {width:.2f} w {gray:.2f} G {x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S Q".encode("ascii"))


def _pdf_rect(
    cmds: list[bytes],
    x: float,
    y: float,
    w: float,
    h: float,
    fill_rgb: tuple[float, float, float] | None = None,
    stroke_rgb: tuple[float, float, float] | None = None,
) -> None:
    parts = [b"q 0.8 w"]
    if fill_rgb:
        parts.append(f"{fill_rgb[0]:.3f} {fill_rgb[1]:.3f} {fill_rgb[2]:.3f} rg".encode("ascii"))
    if stroke_rgb:
        parts.append(f"{stroke_rgb[0]:.3f} {stroke_rgb[1]:.3f} {stroke_rgb[2]:.3f} RG".encode("ascii"))
    op = "B" if (fill_rgb and stroke_rgb) else ("f" if fill_rgb else "S")
    parts.append(f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re {op} Q".encode("ascii"))
    cmds.append(b" ".join(parts))


def _render_header(cmds: list[bytes], note: dict[str, Any], page_num: int, total_pages: int) -> float:
    """Dibuja el encabezado de página en A4 (595 x 842) y devuelve la coordenada Y libre."""
    numero = note.get("numero") or note.get("id_nota_venta") or "—"
    estado = str(note.get("estado_pedido") or "pendiente").upper()

    # Banda superior de marca
    _pdf_rect(cmds, 36, 756, 523, 52, fill_rgb=(0.075, 0.251, 0.239))
    cmds.append(b"1 1 1 rg")
    _pdf_text(cmds, 50, 785, "F2", 15, "DISTRIBUIDORA GHOSH")
    _pdf_text(cmds, 50, 769, "F1", 9, "Nota de Venta y Comprobante de Despacho")
    _pdf_text_right(cmds, 545, 785, "F2", 14, f"NOTA N° {str(numero).zfill(4)}", 0.56)
    _pdf_text_right(cmds, 545, 769, "F1", 9, f"Estado: {estado}  |  Pag. {page_num}/{total_pages}", 0.48)
    cmds.append(b"0 0 0 rg")

    if page_num > 1:
        _pdf_text(cmds, 36, 738, "F2", 9.5, f"Continuación detalle - Nota de Venta N° {str(numero).zfill(4)}")
        _pdf_line(cmds, 36, 730, 559, 730, 0.75, 0.8)
        return 714.0

    # Bloque de metadatos (2 columnas)
    _pdf_rect(cmds, 36, 636, 523, 108, fill_rgb=(0.972, 0.978, 0.976), stroke_rgb=(0.82, 0.85, 0.84))

    cmds.append(b"0.18 0.22 0.21 rg")
    _pdf_text(cmds, 48, 725, "F2", 9, "DATOS DE EMISION")
    _pdf_text(cmds, 305, 725, "F2", 9, "CLIENTE Y ENTREGA")
    cmds.append(b"0 0 0 rg")

    id_pedido = note.get("id_pedido")
    _pdf_text(cmds, 48, 708, "F1", 9, f"Fecha emision: {_format_dt(note.get('fecha_creacion'))}")
    _pdf_text(cmds, 48, 694, "F1", 9, f"Pedido asociado: {'#' + str(id_pedido) if id_pedido else 'Sin pedido'}")
    _pdf_text(cmds, 48, 680, "F1", 9, f"Vendedor (Ventas): {note.get('vendedor') or '—'}")
    _pdf_text(cmds, 48, 666, "F1", 9, f"Bodega origen: {note.get('bodega') or '—'}")
    if estado == "DESPACHADO":
        _pdf_text(cmds, 48, 652, "F1", 8.5, f"Despachado: {_format_dt(note.get('fecha_entrega'))} ({note.get('usuario_entrega') or 'Bodega'})")
    elif estado == "CANCELADO":
        _pdf_text(cmds, 48, 652, "F1", 8.5, f"Anulado: {_format_dt(note.get('fecha_anulacion'))} ({note.get('usuario_anulacion') or 'Sistema'})")

    local_name = str(note.get("nombre_local") or "Venta en local")
    direccion = str(note.get("direccion_entrega") or "Sin dirección registrada (retiro o despacho estándar)")
    _pdf_text(cmds, 305, 708, "F2", 9.5, f"Local / Alias: {local_name[:38]}")
    addr_lines = _wrap_text(f"Direccion: {direccion}", 44)[:3]
    y_addr = 694.0
    for line in addr_lines:
        _pdf_text(cmds, 305, y_addr, "F1", 8.8, line)
        y_addr -= 13.0

    y_after = 620.0
    if estado == "CANCELADO" and note.get("motivo_anulacion"):
        motivo_lines = _wrap_text(f"MOTIVO DE ANULACION: {note.get('motivo_anulacion')}", 88)[:2]
        _pdf_rect(cmds, 36, 594, 523, 30, fill_rgb=(0.99, 0.94, 0.94), stroke_rgb=(0.86, 0.65, 0.65))
        cmds.append(b"0.60 0.12 0.12 rg")
        _pdf_text(cmds, 46, 612, "F2", 8.5, motivo_lines[0])
        if len(motivo_lines) > 1:
            _pdf_text(cmds, 46, 600, "F1", 8.5, motivo_lines[1])
        cmds.append(b"0 0 0 rg")
        y_after = 580.0

    return y_after


def _render_table_header(cmds: list[bytes], y: float) -> float:
    _pdf_rect(cmds, 36, y - 4, 523, 20, fill_rgb=(0.92, 0.94, 0.93))
    cmds.append(b"0.12 0.16 0.15 rg")
    _pdf_text(cmds, 42, y + 3, "F2", 8.5, "SKU")
    _pdf_text(cmds, 108, y + 3, "F2", 8.5, "PRODUCTO")
    _pdf_text(cmds, 305, y + 3, "F2", 8.5, "CAJAS/SUEL.")
    _pdf_text(cmds, 382, y + 3, "F2", 8.5, "CANT.")
    _pdf_text(cmds, 435, y + 3, "F2", 8.5, "P. UNIT.")
    _pdf_text(cmds, 505, y + 3, "F2", 8.5, "SUBTOTAL")
    cmds.append(b"0 0 0 rg")
    return y - 18.0


def build_sale_note_pdf(note: dict[str, Any]) -> bytes:
    """Construye un PDF A4 válido con el detalle completo, precios confirmados y total."""
    items: list[dict[str, Any]] = list(note.get("items") or [])
    pages_cmds: list[list[bytes]] = []

    current_cmds: list[bytes] = []
    y = _render_header(current_cmds, note, 1, 1)
    y = _render_table_header(current_cmds, y)

    # Guardamos solo los items paginados para saber total de páginas primero
    page_items: list[list[dict[str, Any]]] = [[]]
    sim_y = y
    for item in items:
        prod_lines = _wrap_text(str(item.get("producto") or item.get("sku") or "Producto"), 32)
        row_h = max(20.0, len(prod_lines) * 11.5 + 7.0)
        if sim_y - row_h < 115.0:
            page_items.append([item])
            sim_y = 714.0 - 18.0 - row_h
        else:
            page_items[-1].append(item)
            sim_y -= row_h

    total_pages = max(1, len(page_items))
    for page_idx, chunk in enumerate(page_items, start=1):
        cmds: list[bytes] = []
        y = _render_header(cmds, note, page_idx, total_pages)
        y = _render_table_header(cmds, y)

        for idx, item in enumerate(chunk):
            prod_lines = _wrap_text(str(item.get("producto") or item.get("sku") or "Producto"), 32)
            row_h = max(20.0, len(prod_lines) * 11.5 + 7.0)
            if idx % 2 == 1:
                _pdf_rect(cmds, 36, y - row_h + 13, 523, row_h, fill_rgb=(0.985, 0.988, 0.987))

            sku = str(item.get("sku") or "—")[:13]
            cajas = int(item.get("cajas") or 0)
            sueltos = _format_num(item.get("sueltos") or 0)
            cant_total = _format_num(item.get("cantidad_total") or 0)
            precio_u = _format_clp(item.get("precio_confirmado"))
            subtotal = _format_clp(item.get("subtotal"))

            _pdf_text(cmds, 42, y, "F3", 8.2, sku)
            line_y = y
            for line in prod_lines:
                _pdf_text(cmds, 108, line_y, "F1", 8.6, line)
                line_y -= 11.2
            _pdf_text(cmds, 305, y, "F1", 8.5, f"{cajas}c + {sueltos}u")
            _pdf_text_right(cmds, 418, y, "F1", 8.6, cant_total, 0.50)
            _pdf_text_right(cmds, 488, y, "F1", 8.6, precio_u, 0.50)
            _pdf_text_right(cmds, 552, y, "F2", 8.8, subtotal, 0.52)

            _pdf_line(cmds, 36, y - row_h + 13, 559, y - row_h + 13, 0.90, 0.5)
            y -= row_h

        # Totales y pie solo en la última página
        if page_idx == total_pages:
            box_y = max(56.0, y - 54.0)
            _pdf_rect(cmds, 330, box_y, 229, 46, fill_rgb=(0.955, 0.972, 0.968), stroke_rgb=(0.075, 0.251, 0.239))
            _pdf_text(cmds, 342, box_y + 28, "F1", 9, f"Lineas: {len(items)}  |  Unidades: {_format_num(note.get('unidades_totales') or 0)}")
            _pdf_text(cmds, 342, box_y + 10, "F2", 11, "TOTAL CONFIRMADO:")
            _pdf_text_right(cmds, 548, box_y + 10, "F2", 12, _format_clp(note.get("total")), 0.54)

            cmds.append(b"0.42 0.45 0.44 rg")
            _pdf_text(cmds, 36, 40, "F1", 8, "Documento generado por Sistema de Inventario Ghosh — Precios confirmados al emitir la nota.")
            cmds.append(b"0 0 0 rg")

        pages_cmds.append(cmds)

    # Ensamblar estructura PDF 1.4 con fuentes estándar Helvetica, Helvetica-Bold y Courier (WinAnsiEncoding)
    objects: list[bytes] = []

    def add_obj(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog_id = add_obj(b"")  # placeholder 1
    pages_id = add_obj(b"")    # placeholder 2
    font1_id = add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    font2_id = add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    font3_id = add_obj(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")

    page_ids: list[int] = []
    for cmds in pages_cmds:
        stream = b"\n".join(cmds)
        content_id = add_obj(
            f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
        )
        page_id = add_obj(
            (
                f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] "
                f"/Resources << /Font << /F1 {font1_id} 0 R /F2 {font2_id} 0 R /F3 {font3_id} 0 R >> >> "
                f"/Contents {content_id} 0 R >>"
            ).encode("ascii")
        )
        page_ids.append(page_id)

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects[catalog_id - 1] = f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode("ascii")
    objects[pages_id - 1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode("ascii")

    pdf = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: list[int] = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf.extend(f"{idx} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        pdf.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root {catalog_id} 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(pdf)
