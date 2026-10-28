"""Notas de venta registradas por vendedores con descuento FEFO de inventario."""
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator


class SaleLine(BaseModel):
    sku: str = Field(min_length=1, max_length=40)
    cajas: int = Field(default=0, ge=0, le=100000)
    sueltos: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=3)

    @field_validator("sku")
    @classmethod
    def trim_sku(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El SKU no puede estar vacío.")
        return value


class SaleRequest(BaseModel):
    id_bodega: int = Field(gt=0)
    id_vendedor: int = Field(gt=0)
    items: list[SaleLine] = Field(min_length=1, max_length=100)


def _error(status: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def sale_options(conn) -> dict:
    with conn.cursor() as cursor:
        cursor.execute("SELECT id_bodega, nombre FROM bodega ORDER BY nombre")
        warehouses = [{"id_bodega": row[0], "nombre": row[1]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT u.id_usuario, u.nombre
               FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
               WHERE u.activo = TRUE AND r.nombre = 'ventas'
               ORDER BY u.nombre"""
        )
        sellers = [{"id_usuario": row[0], "nombre": row[1]} for row in cursor.fetchall()]
    return {"bodegas": warehouses, "vendedores": sellers}


def create_sale(conn, request: SaleRequest) -> dict:
    """Registra la nota y descuenta stock por lote en una sola transacción."""
    normalized_skus = [line.sku.casefold() for line in request.items]
    if len(normalized_skus) != len(set(normalized_skus)):
        _error(422, "duplicate_product", "Cada producto debe aparecer una sola vez en la nota.")

    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute(
                """SELECT u.nombre
                   FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
                   WHERE u.id_usuario = %s AND u.activo = TRUE AND r.nombre = 'ventas'""",
                (request.id_vendedor,),
            )
            seller = cursor.fetchone()
            if seller is None:
                _error(403, "seller_required", "Selecciona un vendedor activo con rol ventas.")

            cursor.execute("SELECT nombre FROM bodega WHERE id_bodega = %s", (request.id_bodega,))
            warehouse = cursor.fetchone()
            if warehouse is None:
                _error(404, "warehouse_not_found", f"No existe la bodega {request.id_bodega}.")

            prepared = []
            for line in sorted(request.items, key=lambda item: item.sku.casefold()):
                cursor.execute(
                    """SELECT p.id_producto, p.nombre, p.precio_vigente, p.unidades_por_caja,
                              p.activo, uc.decimales
                       FROM producto p
                       JOIN unidad_comercial uc ON uc.id_unidad = p.id_unidad
                       WHERE p.sku = %s AND p.eliminado = FALSE""",
                    (line.sku,),
                )
                product = cursor.fetchone()
                if product is None:
                    _error(404, "product_not_found", f"No existe el producto con SKU '{line.sku}'.")
                product_id, name, price, pack_size, active, decimals = product
                if not active:
                    _error(409, "product_inactive", f"El producto '{line.sku}' está inactivo.")
                if line.cajas == 0 and line.sueltos <= 0:
                    _error(422, "empty_quantity", f"Indica cajas o unidades sueltas para '{line.sku}'.")
                if line.sueltos.normalize().as_tuple().exponent < -decimals:
                    _error(422, "quantity_precision", f"'{line.sku}' admite {decimals} decimales en unidades sueltas.")

                total_quantity = Decimal(line.cajas * pack_size) + line.sueltos
                if total_quantity >= Decimal("1000000000"):
                    _error(422, "quantity_out_of_range", f"La cantidad de '{line.sku}' supera el máximo permitido.")
                subtotal = (Decimal(price) * total_quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if subtotal >= Decimal("1000000000000"):
                    _error(422, "subtotal_out_of_range", f"El subtotal de '{line.sku}' supera el máximo permitido.")

                cursor.execute(
                    """SELECT l.id_lote, l.cantidad_fisica,
                              COALESCE((
                                  SELECT SUM(rv.cantidad)
                                  FROM reserva rv
                                  JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                                  WHERE rv.id_lote = l.id_lote
                                    AND er.nombre = 'vigente'
                                    AND rv.fecha_expiracion > NOW()
                              ), 0) AS reservada
                       FROM lote l
                       WHERE l.id_producto = %s
                         AND l.id_bodega = %s
                         AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
                       ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.fecha_recepcion, l.id_lote
                       FOR UPDATE OF l""",
                    (product_id, request.id_bodega),
                )
                lots = []
                for lot_id, physical, reserved in cursor.fetchall():
                    available = max(Decimal(physical) - Decimal(reserved), Decimal("0"))
                    if available > 0:
                        lots.append({"id_lote": lot_id, "disponible": available})
                available_total = sum((lot["disponible"] for lot in lots), Decimal("0"))
                if total_quantity > available_total:
                    _error(
                        409,
                        "insufficient_stock",
                        f"Stock insuficiente para '{name}' en {warehouse[0]}. Disponible: {available_total}; solicitado: {total_quantity}.",
                    )

                prepared.append({
                    "id_producto": product_id,
                    "sku": line.sku,
                    "nombre": name,
                    "cajas": line.cajas,
                    "sueltos": line.sueltos,
                    "unidades_por_caja": pack_size,
                    "cantidad_total": total_quantity,
                    "precio_confirmado": Decimal(price),
                    "subtotal": subtotal,
                    "lotes": lots,
                })

            total = sum((item["subtotal"] for item in prepared), Decimal("0.00"))
            if total >= Decimal("1000000000000"):
                _error(422, "total_out_of_range", "El total de la nota supera el máximo permitido.")
            cursor.execute(
                """INSERT INTO nota_venta (id_vendedor, id_bodega, total)
                   VALUES (%s, %s, %s)
                   RETURNING id_nota_venta, fecha_creacion""",
                (request.id_vendedor, request.id_bodega, total),
            )
            sale_id, created_at = cursor.fetchone()

            cursor.execute("SELECT id_tipo FROM tipo_movimiento WHERE nombre = 'despacho'")
            movement_type = cursor.fetchone()
            if movement_type is None:
                _error(500, "dispatch_movement_missing", "No está configurado el tipo de movimiento 'despacho'.")

            response_items = []
            for item in prepared:
                cursor.execute(
                    """INSERT INTO detalle_nota_venta
                           (id_nota_venta, id_producto, cajas, sueltos, unidades_por_caja,
                            cantidad_total, precio_confirmado, subtotal)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        sale_id, item["id_producto"], item["cajas"], item["sueltos"],
                        item["unidades_por_caja"], item["cantidad_total"],
                        item["precio_confirmado"], item["subtotal"],
                    ),
                )

                remaining = item["cantidad_total"]
                for lot in item["lotes"]:
                    if remaining <= 0:
                        break
                    quantity = min(remaining, lot["disponible"])
                    cursor.execute(
                        "UPDATE lote SET cantidad_fisica = cantidad_fisica - %s WHERE id_lote = %s",
                        (quantity, lot["id_lote"]),
                    )
                    cursor.execute(
                        """INSERT INTO movimiento_inventario
                               (id_lote, id_tipo, id_usuario, id_nota_venta, cantidad, motivo)
                           VALUES (%s, %s, %s, %s, %s, %s)""",
                        (
                            lot["id_lote"], movement_type[0], request.id_vendedor,
                            sale_id, -quantity, f"Nota de venta #{sale_id}",
                        ),
                    )
                    remaining -= quantity

                response_items.append({
                    "sku": item["sku"],
                    "nombre": item["nombre"],
                    "cajas": item["cajas"],
                    "sueltos": item["sueltos"],
                    "unidades_por_caja": item["unidades_por_caja"],
                    "cantidad_total": item["cantidad_total"],
                    "precio_confirmado": item["precio_confirmado"],
                    "subtotal": item["subtotal"],
                })

    return {
        "id_nota_venta": sale_id,
        "fecha_creacion": created_at,
        "vendedor": seller[0],
        "bodega": warehouse[0],
        "total": total,
        "items": response_items,
    }

