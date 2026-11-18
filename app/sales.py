"""Notas de venta registradas por vendedores con descuento FEFO de inventario."""
from datetime import date, datetime
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
    id_cliente: int | None = Field(default=None, gt=0)
    nombre_local: str = Field(default="Venta en local", max_length=120)
    direccion_entrega: str | None = Field(default=None, max_length=250)
    guardar_cliente_frecuente: bool = False
    fecha_expiracion_reserva: datetime | None = None
    items: list[SaleLine] = Field(min_length=1, max_length=100)

    @field_validator("nombre_local")
    @classmethod
    def normalize_local(cls, value: str) -> str:
        cleaned = value.strip()
        return cleaned or "Venta en local"

    @field_validator("direccion_entrega")
    @classmethod
    def normalize_address(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = " ".join(value.split()).strip()
        return cleaned or None


class FrequentClientRequest(BaseModel):
    nombre_local: str = Field(min_length=2, max_length=120)
    direccion: str = Field(min_length=3, max_length=250)

    @field_validator("nombre_local")
    @classmethod
    def trim_name(cls, value: str) -> str:
        cleaned = " ".join(value.split()).strip()
        if len(cleaned) < 2:
            raise ValueError("Ingresa un nombre o alias válido (mínimo 2 caracteres).")
        return cleaned

    @field_validator("direccion")
    @classmethod
    def trim_address(cls, value: str) -> str:
        cleaned = " ".join(value.split()).strip()
        if len(cleaned) < 3:
            raise ValueError("Ingresa una dirección de entrega válida.")
        return cleaned


class DispatchOrderRequest(BaseModel):
    id_usuario: int = Field(gt=0)
    motivo: str | None = Field(default=None, max_length=200)


class CancelOrderRequest(BaseModel):
    id_usuario: int = Field(gt=0)
    motivo: str = Field(min_length=3, max_length=200)

    @field_validator("motivo")
    @classmethod
    def trim_motivo(cls, value: str) -> str:
        cleaned = " ".join(value.split()).strip()
        if len(cleaned) < 3:
            raise ValueError("Indica un motivo de anulación (mínimo 3 caracteres).")
        return cleaned


class ExpireReservationsRequest(BaseModel):
    id_usuario: int | None = Field(default=None, gt=0)
    motivo: str | None = Field(default=None, max_length=200)

    @field_validator("motivo")
    @classmethod
    def normalize_motivo(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = " ".join(value.split()).strip()
        return cleaned or None


def _error(status: int, code: str, message: str) -> None:
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def _ensure_sales_schema(cursor) -> None:
    """Asegura correlativos, columnas de pedido ligada a nota y backfill histórico."""
    cursor.execute(
        """SELECT
               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nota_venta' AND column_name = 'numero'),
               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pedido' AND column_name = 'id_nota_venta'),
               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pedido' AND column_name = 'direccion_entrega'),
               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pedido' AND column_name = 'motivo_anulacion'),
               EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'correlativo'),
               EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vw_nota_venta' AND column_name = 'direccion_entrega')"""
    )
    has_numero, has_pedido_nota, has_dir, has_cancel_cols, has_correlativo, has_view_dir = cursor.fetchone()

    if not (has_numero and has_pedido_nota and has_dir and has_cancel_cols and has_correlativo):
        cursor.execute(
            """
            INSERT INTO estado_pedido (nombre)
            VALUES ('pendiente'), ('despachado'), ('entregado'), ('cancelado')
            ON CONFLICT (nombre) DO NOTHING;

            INSERT INTO estado_reserva (nombre)
            VALUES ('vigente'), ('consumida'), ('liberada'), ('expirada')
            ON CONFLICT (nombre) DO NOTHING;

            INSERT INTO tipo_movimiento (nombre)
            VALUES ('recepcion'), ('reserva'), ('despacho'), ('cancelacion'), ('ajuste')
            ON CONFLICT (nombre) DO NOTHING;

            CREATE TABLE IF NOT EXISTS cliente_frecuente (
                id_cliente     SERIAL PRIMARY KEY,
                nombre_local   VARCHAR(120) NOT NULL,
                direccion      TEXT,
                activo         BOOLEAN NOT NULL DEFAULT TRUE,
                fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            ALTER TABLE cliente_frecuente ALTER COLUMN direccion TYPE TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_frecuente_nombre ON cliente_frecuente (LOWER(nombre_local));

            CREATE TABLE IF NOT EXISTS correlativo (
                tipo_documento VARCHAR(30) PRIMARY KEY,
                ultimo_numero  INTEGER NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0)
            );

            CREATE OR REPLACE FUNCTION siguiente_correlativo(p_tipo VARCHAR) RETURNS INTEGER
            LANGUAGE plpgsql AS $$
            DECLARE
                v_numero INTEGER;
            BEGIN
                UPDATE correlativo
                   SET ultimo_numero = ultimo_numero + 1
                 WHERE tipo_documento = p_tipo
                RETURNING ultimo_numero INTO v_numero;
                IF v_numero IS NULL THEN
                    RAISE EXCEPTION 'No existe el correlativo %', p_tipo;
                END IF;
                RETURN v_numero;
            END $$;

            ALTER TABLE nota_venta ADD COLUMN IF NOT EXISTS numero INTEGER;

            WITH base AS (
                SELECT COALESCE(MAX(numero), 0) AS max_num FROM nota_venta
            ),
            ordenadas AS (
                SELECT nv.id_nota_venta,
                       base.max_num + ROW_NUMBER() OVER (ORDER BY nv.fecha_creacion, nv.id_nota_venta) AS n
                FROM nota_venta nv
                CROSS JOIN base
                WHERE nv.numero IS NULL
            )
            UPDATE nota_venta nv
               SET numero = o.n
              FROM ordenadas o
             WHERE nv.id_nota_venta = o.id_nota_venta
               AND nv.numero IS NULL;

            ALTER TABLE nota_venta ALTER COLUMN numero SET NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS uq_nota_venta_numero ON nota_venta (numero);

            INSERT INTO correlativo (tipo_documento, ultimo_numero)
            VALUES ('nota_venta', (SELECT COALESCE(MAX(numero), 0) FROM nota_venta))
            ON CONFLICT (tipo_documento) DO UPDATE
            SET ultimo_numero = GREATEST(correlativo.ultimo_numero, EXCLUDED.ultimo_numero);

            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS id_nota_venta        INTEGER REFERENCES nota_venta(id_nota_venta);
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS id_bodega            INTEGER REFERENCES bodega(id_bodega);
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS id_cliente           INTEGER REFERENCES cliente_frecuente(id_cliente);
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS nombre_local         VARCHAR(120);
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS direccion_entrega    TEXT;
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS fecha_entrega        TIMESTAMPTZ;
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS id_usuario_entrega   INTEGER REFERENCES usuario(id_usuario);
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS motivo_anulacion     TEXT;
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS fecha_anulacion      TIMESTAMPTZ;
            ALTER TABLE pedido ADD COLUMN IF NOT EXISTS id_usuario_anulacion INTEGER REFERENCES usuario(id_usuario);

            UPDATE pedido SET nombre_local = 'Venta en local' WHERE nombre_local IS NULL;
            ALTER TABLE pedido ALTER COLUMN nombre_local SET NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_nota_venta ON pedido (id_nota_venta) WHERE id_nota_venta IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_pedido_estado ON pedido (id_estado_pedido, fecha_creacion);

            ALTER TABLE reserva ALTER COLUMN fecha_expiracion DROP NOT NULL;
            """
        )

    cursor.execute(
        """SELECT EXISTS (
               SELECT 1
               FROM nota_venta nv
               WHERE NOT EXISTS (SELECT 1 FROM pedido pe WHERE pe.id_nota_venta = nv.id_nota_venta)
           )"""
    )
    if cursor.fetchone()[0]:
        cursor.execute(
            """INSERT INTO estado_pedido (nombre) VALUES ('despachado') ON CONFLICT (nombre) DO NOTHING;

               INSERT INTO pedido
                   (id_usuario, id_estado_pedido, clave_idempotencia, fecha_creacion,
                    id_nota_venta, id_bodega, nombre_local, fecha_entrega, id_usuario_entrega)
               SELECT
                   nv.id_vendedor,
                   (SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'despachado'),
                   'nv-legacy-' || nv.id_nota_venta,
                   nv.fecha_creacion,
                   nv.id_nota_venta,
                   nv.id_bodega,
                   'Venta en local',
                   nv.fecha_creacion,
                   nv.id_vendedor
               FROM nota_venta nv
               WHERE NOT EXISTS (SELECT 1 FROM pedido pe WHERE pe.id_nota_venta = nv.id_nota_venta);

               INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_confirmado)
               SELECT pe.id_pedido, dnv.id_producto, dnv.cantidad_total, dnv.precio_confirmado
               FROM pedido pe
               JOIN detalle_nota_venta dnv ON dnv.id_nota_venta = pe.id_nota_venta
               WHERE NOT EXISTS (SELECT 1 FROM detalle_pedido dp WHERE dp.id_pedido = pe.id_pedido);

               UPDATE movimiento_inventario m
                  SET id_pedido = pe.id_pedido
                 FROM pedido pe
                WHERE m.id_nota_venta = pe.id_nota_venta
                  AND m.id_pedido IS NULL;"""
        )

    cursor.execute(
        """SELECT COUNT(*)
           FROM information_schema.views
           WHERE table_schema = 'public'
             AND table_name IN ('vw_nota_venta', 'vista_nota_venta', 'vw_detalle_nota_venta', 'vista_detalle_nota_venta')"""
    )
    if not has_view_dir or cursor.fetchone()[0] < 4:
        cursor.execute(
            """
            DROP VIEW IF EXISTS vista_nota_venta;
            DROP VIEW IF EXISTS vw_nota_venta;

            CREATE VIEW vw_nota_venta AS
            SELECT
                nv.id_nota_venta,
                nv.numero,
                nv.fecha_creacion,
                nv.id_vendedor,
                uv.nombre AS vendedor,
                nv.id_bodega,
                b.nombre AS bodega,
                pe.id_pedido,
                COALESCE(ep.nombre, 'sin_pedido') AS estado_pedido,
                COALESCE(pe.nombre_local, 'Venta en local') AS nombre_local,
                pe.direccion_entrega,
                pe.fecha_entrega,
                ue.nombre AS usuario_entrega,
                pe.motivo_anulacion,
                pe.fecha_anulacion,
                ua.nombre AS usuario_anulacion,
                COUNT(dnv.id_detalle_nota_venta)::INTEGER AS cantidad_lineas,
                COALESCE(SUM(dnv.cantidad_total), 0)::NUMERIC(12,3) AS unidades_totales,
                nv.total
            FROM nota_venta nv
            JOIN usuario uv ON uv.id_usuario = nv.id_vendedor
            JOIN bodega b ON b.id_bodega = nv.id_bodega
            LEFT JOIN detalle_nota_venta dnv ON dnv.id_nota_venta = nv.id_nota_venta
            LEFT JOIN pedido pe ON pe.id_nota_venta = nv.id_nota_venta
            LEFT JOIN estado_pedido ep ON ep.id_estado_pedido = pe.id_estado_pedido
            LEFT JOIN usuario ue ON ue.id_usuario = pe.id_usuario_entrega
            LEFT JOIN usuario ua ON ua.id_usuario = pe.id_usuario_anulacion
            GROUP BY
                nv.id_nota_venta, nv.numero, nv.fecha_creacion,
                nv.id_vendedor, uv.nombre, nv.id_bodega, b.nombre,
                pe.id_pedido, ep.nombre, pe.nombre_local, pe.direccion_entrega,
                pe.fecha_entrega, ue.nombre, pe.motivo_anulacion, pe.fecha_anulacion, ua.nombre,
                nv.total;

            CREATE VIEW vista_nota_venta AS
            SELECT * FROM vw_nota_venta;

            CREATE OR REPLACE VIEW vw_detalle_nota_venta AS
            SELECT
                dnv.id_detalle_nota_venta,
                nv.id_nota_venta,
                nv.numero AS numero_nota,
                nv.fecha_creacion,
                p.id_producto,
                p.sku,
                p.nombre AS producto,
                dnv.cajas,
                dnv.sueltos,
                dnv.unidades_por_caja,
                dnv.cantidad_total,
                dnv.precio_confirmado,
                dnv.subtotal
            FROM detalle_nota_venta dnv
            JOIN nota_venta nv ON nv.id_nota_venta = dnv.id_nota_venta
            JOIN producto p ON p.id_producto = dnv.id_producto;

            CREATE OR REPLACE VIEW vista_detalle_nota_venta AS
            SELECT * FROM vw_detalle_nota_venta;
            """
        )


def _upsert_frequent_client(cursor, nombre_local: str, direccion: str) -> dict:
    cursor.execute(
        """SELECT id_cliente FROM cliente_frecuente WHERE LOWER(nombre_local) = LOWER(%s)""",
        (nombre_local,),
    )
    existing = cursor.fetchone()
    if existing:
        cursor.execute(
            """UPDATE cliente_frecuente
                  SET nombre_local = %s, direccion = %s, activo = TRUE
                WHERE id_cliente = %s
                RETURNING id_cliente, nombre_local, direccion""",
            (nombre_local, direccion, existing[0]),
        )
    else:
        cursor.execute(
            """INSERT INTO cliente_frecuente (nombre_local, direccion, activo)
               VALUES (%s, %s, TRUE)
               RETURNING id_cliente, nombre_local, direccion""",
            (nombre_local, direccion),
        )
    row = cursor.fetchone()
    return {"id_cliente": row[0], "nombre_local": row[1], "direccion": row[2] or ""}


def sale_options(conn) -> dict:
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)
    with conn.cursor() as cursor:
        cursor.execute("SELECT id_bodega, nombre FROM bodega ORDER BY nombre")
        warehouses = [{"id_bodega": row[0], "nombre": row[1]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT u.id_usuario, u.nombre
               FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
               WHERE u.activo = TRUE AND u.eliminado = FALSE AND r.nombre = 'ventas'
               ORDER BY u.nombre"""
        )
        sellers = [{"id_usuario": row[0], "nombre": row[1]} for row in cursor.fetchall()]
        cursor.execute(
            """SELECT id_cliente, nombre_local, COALESCE(direccion, '')
               FROM cliente_frecuente
               WHERE activo = TRUE
               ORDER BY LOWER(nombre_local)"""
        )
        clients = [
            {"id_cliente": row[0], "nombre_local": row[1], "direccion": row[2]}
            for row in cursor.fetchall()
        ]
    return {"bodegas": warehouses, "vendedores": sellers, "clientes_frecuentes": clients}


def save_frequent_client(conn, request: FrequentClientRequest) -> dict:
    """Guarda o actualiza un cliente frecuente con su alias y dirección de despacho."""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)
            return _upsert_frequent_client(cursor, request.nombre_local, request.direccion)


def create_sale(conn, request: SaleRequest) -> dict:
    """Registra la nota y descuenta stock por lote en una sola transacción."""
    normalized_skus = [line.sku.casefold() for line in request.items]
    if len(normalized_skus) != len(set(normalized_skus)):
        _error(422, "duplicate_product", "Cada producto debe aparecer una sola vez en la nota.")

    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)

            cursor.execute(
                """SELECT u.nombre
                   FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
                   WHERE u.id_usuario = %s AND u.activo = TRUE AND u.eliminado = FALSE AND r.nombre = 'ventas'""",
                (request.id_vendedor,),
            )
            seller = cursor.fetchone()
            if seller is None:
                _error(403, "seller_required", "Selecciona un vendedor activo con rol ventas.")

            cursor.execute("SELECT nombre FROM bodega WHERE id_bodega = %s", (request.id_bodega,))
            warehouse = cursor.fetchone()
            if warehouse is None:
                _error(404, "warehouse_not_found", f"No existe la bodega {request.id_bodega}.")

            resolved_client_id = request.id_cliente
            resolved_local = request.nombre_local
            resolved_address = request.direccion_entrega
            saved_client = None

            if resolved_client_id is not None:
                cursor.execute(
                    """SELECT id_cliente, nombre_local, COALESCE(direccion, '')
                       FROM cliente_frecuente
                       WHERE id_cliente = %s AND activo = TRUE""",
                    (resolved_client_id,),
                )
                client_row = cursor.fetchone()
                if client_row is None:
                    _error(404, "client_not_found", f"No existe el cliente frecuente {resolved_client_id}.")
                if resolved_local == "Venta en local":
                    resolved_local = client_row[1]
                if not resolved_address:
                    resolved_address = client_row[2].strip() or None
            elif request.guardar_cliente_frecuente:
                if not resolved_address:
                    _error(422, "address_required", "Ingresa una dirección de entrega para guardar al cliente frecuente.")
                if resolved_local == "Venta en local":
                    _error(422, "alias_required", "Ingresa un nombre o alias de negocio para guardar al cliente frecuente.")
                saved_client = _upsert_frequent_client(cursor, resolved_local, resolved_address)
                resolved_client_id = saved_client["id_cliente"]

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

                # Bloquea los lotes candidatos en orden FEFO primero y re-consulta reservas
                # despues del lock para evitar leer un snapshot previo bajo READ COMMITTED.
                cursor.execute(
                    """SELECT l.id_lote
                       FROM lote l
                       WHERE l.id_producto = %s
                         AND l.id_bodega = %s
                         AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= CURRENT_DATE)
                       ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.fecha_recepcion, l.id_lote
                       FOR UPDATE OF l""",
                    (product_id, request.id_bodega),
                )
                locked_lot_ids = [row[0] for row in cursor.fetchall()]
                lots = []
                if locked_lot_ids:
                    cursor.execute(
                        """SELECT l.id_lote, l.codigo_lote, l.fecha_vencimiento, l.cantidad_fisica,
                                  COALESCE((
                                      SELECT SUM(rv.cantidad)
                                      FROM reserva rv
                                      JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                                      WHERE rv.id_lote = l.id_lote
                                        AND er.nombre = 'vigente'
                                        AND (rv.fecha_expiracion IS NULL OR rv.fecha_expiracion > NOW())
                                  ), 0) AS reservada
                           FROM lote l
                           WHERE l.id_lote = ANY(%s)
                           ORDER BY l.fecha_vencimiento ASC NULLS LAST, l.fecha_recepcion, l.id_lote""",
                        (locked_lot_ids,),
                    )
                    for lot_id, lot_code, expires_on, physical, reserved in cursor.fetchall():
                        available = max(Decimal(physical) - Decimal(reserved), Decimal("0"))
                        if available > 0:
                            lots.append({
                                "id_lote": lot_id,
                                "codigo_lote": lot_code,
                                "fecha_vencimiento": expires_on,
                                "disponible": available,
                            })
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
            cursor.execute("SELECT siguiente_correlativo('nota_venta')")
            sale_number = cursor.fetchone()[0]
            cursor.execute(
                """INSERT INTO nota_venta (numero, id_vendedor, id_bodega, total)
                   VALUES (%s, %s, %s, %s)
                   RETURNING id_nota_venta, numero, fecha_creacion""",
                (sale_number, request.id_vendedor, request.id_bodega, total),
            )
            sale_id, sale_number, created_at = cursor.fetchone()

            cursor.execute("SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'pendiente'")
            pending_status = cursor.fetchone()
            if pending_status is None:
                _error(500, "order_status_missing", "No está configurado el estado de pedido 'pendiente'.")

            cursor.execute("SELECT id_estado_reserva FROM estado_reserva WHERE nombre = 'vigente'")
            active_res_status = cursor.fetchone()
            if active_res_status is None:
                _error(500, "reservation_status_missing", "No está configurado el estado de reserva 'vigente'.")

            cursor.execute("SELECT id_tipo FROM tipo_movimiento WHERE nombre = 'reserva'")
            movement_type = cursor.fetchone()
            if movement_type is None:
                _error(500, "reservation_movement_missing", "No está configurado el tipo de movimiento 'reserva'.")

            cursor.execute(
                """INSERT INTO pedido
                       (id_usuario, id_estado_pedido, clave_idempotencia, id_nota_venta,
                        id_bodega, id_cliente, nombre_local, direccion_entrega)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   RETURNING id_pedido""",
                (
                    request.id_vendedor,
                    pending_status[0],
                    f"nv-{sale_id}-{sale_number}",
                    sale_id,
                    request.id_bodega,
                    resolved_client_id,
                    resolved_local,
                    resolved_address,
                ),
            )
            order_id = cursor.fetchone()[0]
            generated_reason = (
                f"Pedido #{order_id} generado · Nota de venta N° {sale_number} ({resolved_local})"
            )[:200]

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
                cursor.execute(
                    """INSERT INTO detalle_pedido
                           (id_pedido, id_producto, cantidad, precio_confirmado)
                       VALUES (%s, %s, %s, %s)
                       RETURNING id_detalle""",
                    (order_id, item["id_producto"], item["cantidad_total"], item["precio_confirmado"]),
                )
                order_detail_id = cursor.fetchone()[0]

                remaining = item["cantidad_total"]
                reserved_lots = []
                for lot in item["lotes"]:
                    if remaining <= 0:
                        break
                    quantity = min(remaining, lot["disponible"])
                    cursor.execute(
                        """INSERT INTO reserva
                               (id_detalle, id_lote, id_estado_reserva, cantidad, fecha_expiracion)
                           VALUES (%s, %s, %s, %s, %s)
                           RETURNING id_reserva""",
                        (
                            order_detail_id,
                            lot["id_lote"],
                            active_res_status[0],
                            quantity,
                            request.fecha_expiracion_reserva,
                        ),
                    )
                    reservation_id = cursor.fetchone()[0]
                    reserved_lots.append({
                        "id_reserva": reservation_id,
                        "id_lote": lot["id_lote"],
                        "codigo_lote": lot["codigo_lote"],
                        "fecha_vencimiento": lot["fecha_vencimiento"],
                        "cantidad": quantity,
                        "estado_reserva": "vigente",
                        "fecha_expiracion": request.fecha_expiracion_reserva,
                    })
                    cursor.execute(
                        """INSERT INTO movimiento_inventario
                               (id_lote, id_tipo, id_usuario, id_pedido, id_nota_venta, cantidad, motivo)
                           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                        (
                            lot["id_lote"], movement_type[0], request.id_vendedor,
                            order_id, sale_id, -quantity, generated_reason,
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
                    "lotes_reservados": reserved_lots,
                })

    return {
        "id_nota_venta": sale_id,
        "numero": sale_number,
        "id_pedido": order_id,
        "estado_pedido": "pendiente",
        "id_cliente": resolved_client_id,
        "nombre_local": resolved_local,
        "direccion_entrega": resolved_address,
        "cliente_frecuente_guardado": saved_client,
        "fecha_creacion": created_at,
        "vendedor": seller[0],
        "bodega": warehouse[0],
        "total": total,
        "items": response_items,
    }


def list_orders(
    conn,
    estado: str | None = None,
    q: str | None = None,
    id_bodega: int | None = None,
    numero_nota: int | None = None,
    id_pedido: int | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Lista pedidos generados desde notas de venta con resumen, ítems y auditoría."""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)
            _expire_reservations_in_tx(cursor)

    filters, parameters = [], []
    if estado is not None:
        normalized_state = estado.strip().casefold()
        if normalized_state and normalized_state != "todos":
            if normalized_state == "pendiente":
                filters.append("ep.nombre = 'pendiente'")
            elif normalized_state == "despachado":
                filters.append("ep.nombre IN ('despachado', 'entregado')")
            elif normalized_state == "cancelado":
                filters.append("ep.nombre = 'cancelado'")
            else:
                _error(422, "invalid_order_status", f"Estado de pedido no soportado: '{estado}'.")
    if id_bodega is not None:
        filters.append("COALESCE(pe.id_bodega, nv.id_bodega) = %s")
        parameters.append(id_bodega)
    if numero_nota is not None:
        filters.append("nv.numero = %s")
        parameters.append(numero_nota)
    if id_pedido is not None:
        filters.append("pe.id_pedido = %s")
        parameters.append(id_pedido)
    if fecha_desde is not None:
        filters.append("pe.fecha_creacion::date >= %s")
        parameters.append(fecha_desde)
    if fecha_hasta is not None:
        filters.append("pe.fecha_creacion::date <= %s")
        parameters.append(fecha_hasta)
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        filters.append(
            """(
                   CAST(pe.id_pedido AS TEXT) ILIKE %s
                OR CAST(COALESCE(nv.numero, 0) AS TEXT) ILIKE %s
                OR pe.nombre_local ILIKE %s
                OR COALESCE(pe.direccion_entrega, '') ILIKE %s
                OR uv.nombre ILIKE %s
                OR EXISTS (
                    SELECT 1
                    FROM detalle_pedido dp
                    JOIN producto pr ON pr.id_producto = dp.id_producto
                    WHERE dp.id_pedido = pe.id_pedido
                      AND (pr.sku ILIKE %s OR pr.nombre ILIKE %s)
                )
            )"""
        )
        parameters.extend((term, term, term, term, term, term, term))

    where = " WHERE " + " AND ".join(filters) if filters else ""

    with conn.cursor() as cursor:
        cursor.execute(
            """SELECT
                   COUNT(*) FILTER (WHERE ep.nombre = 'pendiente') AS pendientes,
                   COUNT(*) FILTER (WHERE ep.nombre IN ('despachado', 'entregado')) AS despachados,
                   COUNT(*) FILTER (WHERE ep.nombre = 'cancelado') AS anulados,
                   COALESCE(SUM(COALESCE(nv.total, 0)) FILTER (WHERE ep.nombre = 'pendiente'), 0) AS monto_pendiente,
                   COALESCE(SUM(COALESCE(nv.total, 0)) FILTER (WHERE ep.nombre IN ('despachado', 'entregado')), 0) AS monto_despachado,
                   COALESCE(SUM(COALESCE(nv.total, 0)) FILTER (WHERE ep.nombre = 'cancelado'), 0) AS monto_anulado
               FROM pedido pe
               JOIN estado_pedido ep ON ep.id_estado_pedido = pe.id_estado_pedido
               LEFT JOIN nota_venta nv ON nv.id_nota_venta = pe.id_nota_venta"""
        )
        pendientes, despachados, anulados, monto_pendiente, monto_despachado, monto_anulado = cursor.fetchone()

        cursor.execute("SELECT id_bodega, nombre FROM bodega ORDER BY nombre")
        warehouses = [{"id_bodega": row[0], "nombre": row[1]} for row in cursor.fetchall()]

        cursor.execute(
            """SELECT id_usuario, nombre
               FROM usuario
               WHERE activo = TRUE AND eliminado = FALSE
               ORDER BY nombre"""
        )
        responsibles = [{"id_usuario": row[0], "nombre": row[1]} for row in cursor.fetchall()]

        base_from = """
            FROM pedido pe
            JOIN estado_pedido ep ON ep.id_estado_pedido = pe.id_estado_pedido
            JOIN usuario uv ON uv.id_usuario = pe.id_usuario
            LEFT JOIN nota_venta nv ON nv.id_nota_venta = pe.id_nota_venta
            LEFT JOIN bodega b ON b.id_bodega = COALESCE(pe.id_bodega, nv.id_bodega)
            LEFT JOIN usuario ue ON ue.id_usuario = pe.id_usuario_entrega
            LEFT JOIN usuario ua ON ua.id_usuario = pe.id_usuario_anulacion
        """
        cursor.execute("SELECT COUNT(*) " + base_from + where, parameters)
        total = cursor.fetchone()[0]

        cursor.execute(
            """SELECT
                   pe.id_pedido,
                   pe.id_nota_venta,
                   nv.numero AS numero_nota,
                   CASE
                       WHEN ep.nombre = 'entregado' THEN 'despachado'
                       ELSE ep.nombre
                   END AS estado,
                   pe.nombre_local,
                   pe.direccion_entrega,
                   COALESCE(pe.id_bodega, nv.id_bodega) AS id_bodega,
                   COALESCE(b.nombre, '—') AS bodega,
                   uv.nombre AS vendedor,
                   ue.nombre AS usuario_entrega,
                   pe.fecha_creacion,
                   pe.fecha_entrega,
                   pe.motivo_anulacion,
                   pe.fecha_anulacion,
                   ua.nombre AS usuario_anulacion,
                   COALESCE(nv.total, 0) AS total
            """
            + base_from
            + where
            + """
            ORDER BY CASE WHEN ep.nombre = 'pendiente' THEN 0 WHEN ep.nombre IN ('despachado', 'entregado') THEN 1 ELSE 2 END,
                     pe.fecha_creacion DESC,
                     pe.id_pedido DESC
            LIMIT %s OFFSET %s""",
            [*parameters, limit, offset],
        )
        columns = [column.name for column in cursor.description]
        orders = [dict(zip(columns, row)) for row in cursor.fetchall()]

        order_ids = [order["id_pedido"] for order in orders]
        items_by_order: dict[int, list[dict]] = {order_id: [] for order_id in order_ids}
        units_by_order: dict[int, Decimal] = {order_id: Decimal("0") for order_id in order_ids}

        if order_ids:
            cursor.execute(
                """SELECT
                       dp.id_pedido,
                       p.sku,
                       p.nombre,
                       COALESCE(dnv.cajas, 0) AS cajas,
                       COALESCE(dnv.sueltos, dp.cantidad) AS sueltos,
                       COALESCE(dnv.unidades_por_caja, p.unidades_por_caja) AS unidades_por_caja,
                       dp.cantidad AS cantidad_total,
                       dp.precio_confirmado,
                       COALESCE(dnv.subtotal, ROUND(dp.cantidad * dp.precio_confirmado, 2)) AS subtotal
                   FROM detalle_pedido dp
                   JOIN pedido pe ON pe.id_pedido = dp.id_pedido
                   JOIN producto p ON p.id_producto = dp.id_producto
                   LEFT JOIN detalle_nota_venta dnv
                          ON dnv.id_nota_venta = pe.id_nota_venta
                         AND dnv.id_producto = dp.id_producto
                   WHERE dp.id_pedido = ANY(%s)
                   ORDER BY dp.id_pedido, p.nombre, p.sku""",
                (order_ids,),
            )
            for row in cursor.fetchall():
                oid, sku, nombre, cajas, sueltos, pack_size, qty_total, price, subtotal = row
                items_by_order[oid].append(
                    {
                        "sku": sku,
                        "nombre": nombre,
                        "cajas": cajas,
                        "sueltos": sueltos,
                        "unidades_por_caja": pack_size,
                        "cantidad_total": qty_total,
                        "precio_confirmado": price,
                        "subtotal": subtotal,
                    }
                )
                units_by_order[oid] += Decimal(qty_total)

        reservations_by_order: dict[int, list[dict]] = {order_id: [] for order_id in order_ids}
        reservations_by_item: dict[tuple[int, str], list[dict]] = {}
        if order_ids:
            cursor.execute(
                """SELECT
                       dp.id_pedido,
                       p.sku,
                       p.nombre,
                       rv.id_reserva,
                       rv.id_lote,
                       l.codigo_lote,
                       l.fecha_vencimiento,
                       rv.cantidad,
                       er.nombre AS estado_reserva,
                       rv.fecha_expiracion
                   FROM reserva rv
                   JOIN detalle_pedido dp ON dp.id_detalle = rv.id_detalle
                   JOIN producto p ON p.id_producto = dp.id_producto
                   JOIN lote l ON l.id_lote = rv.id_lote
                   JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                   WHERE dp.id_pedido = ANY(%s)
                   ORDER BY dp.id_pedido, l.fecha_vencimiento ASC NULLS LAST, l.fecha_recepcion ASC, rv.id_reserva ASC""",
                (order_ids,),
            )
            for oid, sku, product_name, res_id, lot_id, lot_code, expires_on, qty, res_state, exp_at in cursor.fetchall():
                res_entry = {
                    "id_reserva": res_id,
                    "id_lote": lot_id,
                    "codigo_lote": lot_code,
                    "fecha_vencimiento": expires_on,
                    "cantidad": qty,
                    "estado_reserva": res_state,
                    "fecha_expiracion": exp_at,
                }
                reservations_by_item.setdefault((oid, sku), []).append(res_entry)
                reservations_by_order[oid].append({
                    **res_entry,
                    "sku": sku,
                    "producto": product_name,
                })

        for order in orders:
            oid = order["id_pedido"]
            order_items = items_by_order.get(oid, [])
            for item in order_items:
                item["lotes_reservados"] = reservations_by_item.get((oid, item["sku"]), [])
            order["items"] = order_items
            order["reservas"] = reservations_by_order.get(oid, [])
            order["unidades_totales"] = units_by_order.get(oid, Decimal("0"))

    return {
        "summary": {
            "pendientes": pendientes,
            "despachados": despachados,
            "anulados": anulados,
            "monto_pendiente": monto_pendiente,
            "monto_despachado": monto_despachado,
            "monto_anulado": monto_anulado,
        },
        "bodegas": warehouses,
        "responsables": responsibles,
        "items": orders,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _lock_and_fetch_order(cursor, order_id: int) -> tuple | None:
    """Bloquea el pedido sin joins y luego lee su estado actual para evitar EvalPlanQual en EPQ."""
    cursor.execute("SELECT id_pedido FROM pedido WHERE id_pedido = %s FOR UPDATE", (order_id,))
    if cursor.fetchone() is None:
        return None
    cursor.execute(
        """SELECT pe.id_pedido, pe.id_usuario, ep.nombre, pe.id_nota_venta,
                  nv.numero, pe.nombre_local, b.nombre
           FROM pedido pe
           JOIN estado_pedido ep ON ep.id_estado_pedido = pe.id_estado_pedido
           LEFT JOIN nota_venta nv ON nv.id_nota_venta = pe.id_nota_venta
           LEFT JOIN bodega b ON b.id_bodega = COALESCE(pe.id_bodega, nv.id_bodega)
           WHERE pe.id_pedido = %s""",
        (order_id,),
    )
    return cursor.fetchone()


def dispatch_order(conn, order_id: int, request: DispatchOrderRequest) -> dict:
    """Valida estado pendiente y nota de venta vigente antes de despachar/cerrar el pedido."""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)

            cursor.execute(
                """SELECT nombre
                   FROM usuario
                   WHERE id_usuario = %s AND activo = TRUE AND eliminado = FALSE""",
                (request.id_usuario,),
            )
            actor = cursor.fetchone()
            if actor is None:
                _error(404, "user_not_found", f"No existe un usuario activo con ID {request.id_usuario}.")
            actor_name = actor[0]

            order = _lock_and_fetch_order(cursor, order_id)
            if order is None:
                _error(404, "order_not_found", f"No existe el pedido #{order_id}.")

            _, _, status_name, sale_id, sale_number, local_name, warehouse_name = order
            if status_name != "pendiente":
                _error(
                    409,
                    "order_not_pending",
                    f"El pedido #{order_id} está en estado '{status_name}' y no puede volver a despacharse.",
                )
            if sale_id is None or sale_number is None:
                _error(
                    409,
                    "sale_note_required",
                    f"El pedido #{order_id} no tiene una nota de venta vigente asociada.",
                )

            cursor.execute("SELECT id_estado_reserva FROM estado_reserva WHERE nombre = 'consumida'")
            consumed_status = cursor.fetchone()
            if consumed_status is None:
                _error(500, "reservation_status_missing", "No está configurado el estado de reserva 'consumida'.")

            cursor.execute("SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'despachado'")
            dispatched_status = cursor.fetchone()
            if dispatched_status is None:
                _error(500, "order_status_missing", "No está configurado el estado de pedido 'despachado'.")

            cursor.execute("SELECT id_tipo FROM tipo_movimiento WHERE nombre = 'despacho'")
            dispatch_type = cursor.fetchone()
            if dispatch_type is None:
                _error(500, "dispatch_movement_missing", "No está configurado el tipo de movimiento 'despacho'.")

            cursor.execute(
                """SELECT rv.id_reserva, rv.id_lote, rv.cantidad, l.cantidad_fisica, l.codigo_lote, p.nombre
                   FROM reserva rv
                   JOIN detalle_pedido dp ON dp.id_detalle = rv.id_detalle
                   JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                   JOIN lote l ON l.id_lote = rv.id_lote
                   JOIN producto p ON p.id_producto = dp.id_producto
                   WHERE dp.id_pedido = %s
                     AND er.nombre = 'vigente'
                   ORDER BY rv.id_reserva
                   FOR UPDATE OF rv, l""",
                (order_id,),
            )
            reservations = cursor.fetchall()
            if not reservations:
                _error(
                    409,
                    "active_reservation_missing",
                    f"El pedido #{order_id} no tiene reservas vigentes para despachar.",
                )

            custom_reason = request.motivo.strip() if request.motivo else ""
            reason = (
                custom_reason
                or f"Pedido #{order_id} vendido/despachado · Nota de venta N° {sale_number}"
            )[:200]

            for res_id, lot_id, qty, physical, lot_code, prod_name in reservations:
                qty_dec = Decimal(qty)
                if Decimal(physical) < qty_dec:
                    _error(
                        409,
                        "insufficient_physical_stock",
                        f"El lote '{lot_code}' de '{prod_name}' no tiene stock físico suficiente para despachar ({physical} < {qty_dec}).",
                    )
                cursor.execute(
                    "UPDATE lote SET cantidad_fisica = cantidad_fisica - %s WHERE id_lote = %s",
                    (qty_dec, lot_id),
                )
                cursor.execute(
                    "UPDATE reserva SET id_estado_reserva = %s WHERE id_reserva = %s",
                    (consumed_status[0], res_id),
                )
                cursor.execute(
                    """INSERT INTO movimiento_inventario
                           (id_lote, id_tipo, id_usuario, id_pedido, id_nota_venta, cantidad, motivo)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (
                        lot_id,
                        dispatch_type[0],
                        request.id_usuario,
                        order_id,
                        sale_id,
                        -qty_dec,
                        reason,
                    ),
                )

            cursor.execute(
                """UPDATE pedido
                      SET id_estado_pedido = %s,
                          fecha_entrega = NOW(),
                          id_usuario_entrega = %s
                    WHERE id_pedido = %s
                    RETURNING fecha_entrega""",
                (dispatched_status[0], request.id_usuario, order_id),
            )
            delivered_at = cursor.fetchone()[0]

    return {
        "status": "dispatched",
        "id_pedido": order_id,
        "numero_nota": sale_number,
        "estado": "despachado",
        "usuario_entrega": actor_name,
        "fecha_entrega": delivered_at,
        "nombre_local": local_name,
        "bodega": warehouse_name or "—",
    }


def cancel_order(conn, order_id: int, request: CancelOrderRequest) -> dict:
    """Anula un pedido pendiente con motivo, libera reservas vigentes y audita el movimiento."""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)

            cursor.execute(
                """SELECT nombre
                   FROM usuario
                   WHERE id_usuario = %s AND activo = TRUE AND eliminado = FALSE""",
                (request.id_usuario,),
            )
            actor = cursor.fetchone()
            if actor is None:
                _error(404, "user_not_found", f"No existe un usuario activo con ID {request.id_usuario}.")
            actor_name = actor[0]

            (
                active_res_status_id,
                released_status_id,
                _,
                pending_status_id,
                cancelled_status_id,
                cancel_type_id,
            ) = _load_reservation_transition_ids(cursor)

            order = _lock_and_fetch_order(cursor, order_id)
            if order is None:
                _error(404, "order_not_found", f"No existe el pedido #{order_id}.")

            _, _, status_name, sale_id, sale_number, local_name, warehouse_name = order
            if status_name != "pendiente":
                _error(
                    409,
                    "order_not_pending",
                    f"Solo se pueden anular pedidos pendientes (estado actual: '{status_name}').",
                )

            motivo_clean = request.motivo.strip()
            audit_reason = (
                f"Pedido #{order_id} anulado · Nota N° {sale_number or '—'} · {motivo_clean}"
            )[:200]

            _, _, cancelled_at = _release_order_reservations_in_tx(
                cursor,
                order_id=order_id,
                sale_id=sale_id,
                active_res_status_id=active_res_status_id,
                target_res_status_id=released_status_id,
                pending_status_id=pending_status_id,
                cancelled_status_id=cancelled_status_id,
                cancel_type_id=cancel_type_id,
                actor_id=request.id_usuario,
                motivo_clean=motivo_clean,
                audit_reason=audit_reason,
                only_due=False,
            )

    return {
        "status": "cancelled",
        "id_pedido": order_id,
        "numero_nota": sale_number,
        "estado": "cancelado",
        "usuario_anulacion": actor_name,
        "fecha_anulacion": cancelled_at,
        "motivo_anulacion": motivo_clean,
        "nombre_local": local_name,
        "bodega": warehouse_name or "—",
    }


def _load_reservation_transition_ids(cursor) -> tuple[int, int, int, int, int, int]:
    """Obtiene los IDs de catálogo requeridos para liberar o expirar reservas."""
    cursor.execute("SELECT id_estado_reserva FROM estado_reserva WHERE nombre = 'vigente'")
    active_res = cursor.fetchone()
    cursor.execute("SELECT id_estado_reserva FROM estado_reserva WHERE nombre = 'liberada'")
    released_res = cursor.fetchone()
    cursor.execute("SELECT id_estado_reserva FROM estado_reserva WHERE nombre = 'expirada'")
    expired_res = cursor.fetchone()
    cursor.execute("SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'pendiente'")
    pending_order = cursor.fetchone()
    cursor.execute("SELECT id_estado_pedido FROM estado_pedido WHERE nombre = 'cancelado'")
    cancelled_order = cursor.fetchone()
    cursor.execute("SELECT id_tipo FROM tipo_movimiento WHERE nombre = 'cancelacion'")
    cancel_mov = cursor.fetchone()
    if any(
        row is None
        for row in (active_res, released_res, expired_res, pending_order, cancelled_order, cancel_mov)
    ):
        _error(500, "catalog_missing", "Faltan estados o tipos de movimiento base para reservas.")
    return (
        active_res[0],
        released_res[0],
        expired_res[0],
        pending_order[0],
        cancelled_order[0],
        cancel_mov[0],
    )


def _release_order_reservations_in_tx(
    cursor,
    *,
    order_id: int,
    sale_id: int | None,
    active_res_status_id: int,
    target_res_status_id: int,
    pending_status_id: int,
    cancelled_status_id: int,
    cancel_type_id: int,
    actor_id: int,
    motivo_clean: str,
    audit_reason: str,
    only_due: bool = False,
) -> tuple[int, Decimal, datetime | None]:
    """Transiciona reservas vigentes de un pedido de forma atómica y restaura stock una sola vez."""
    due_filter = (
        "AND rv.fecha_expiracion IS NOT NULL AND rv.fecha_expiracion <= NOW()"
        if only_due
        else ""
    )
    cursor.execute(
        f"""SELECT rv.id_reserva, rv.id_lote, rv.cantidad
            FROM reserva rv
            JOIN detalle_pedido dp ON dp.id_detalle = rv.id_detalle
            WHERE dp.id_pedido = %s
              AND rv.id_estado_reserva = %s
              {due_filter}
            ORDER BY rv.id_reserva
            FOR UPDATE OF rv""",
        (order_id, active_res_status_id),
    )
    reservations = cursor.fetchall()

    released_count = 0
    restored_units = Decimal("0")
    for res_id, lot_id, qty in reservations:
        # El WHERE sobre el estado 'vigente' evita doble movimiento aunque exista contención previa.
        cursor.execute(
            """UPDATE reserva
                  SET id_estado_reserva = %s
                WHERE id_reserva = %s
                  AND id_estado_reserva = %s
                RETURNING id_reserva""",
            (target_res_status_id, res_id, active_res_status_id),
        )
        if cursor.fetchone() is None:
            continue

        qty_dec = Decimal(qty)
        released_count += 1
        restored_units += qty_dec
        cursor.execute(
            """INSERT INTO movimiento_inventario
                   (id_lote, id_tipo, id_usuario, id_pedido, id_nota_venta, cantidad, motivo)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (
                lot_id,
                cancel_type_id,
                actor_id,
                order_id,
                sale_id,
                qty_dec,
                audit_reason,
            ),
        )

    cursor.execute(
        """SELECT 1
           FROM reserva rv
           JOIN detalle_pedido dp ON dp.id_detalle = rv.id_detalle
           WHERE dp.id_pedido = %s
             AND rv.id_estado_reserva = %s
           LIMIT 1""",
        (order_id, active_res_status_id),
    )
    has_active_remaining = cursor.fetchone() is not None

    cancelled_at = None
    if not has_active_remaining:
        cursor.execute(
            """UPDATE pedido
                  SET id_estado_pedido = %s,
                      motivo_anulacion = COALESCE(motivo_anulacion, %s),
                      fecha_anulacion = COALESCE(fecha_anulacion, NOW()),
                      id_usuario_anulacion = COALESCE(id_usuario_anulacion, %s)
                WHERE id_pedido = %s
                  AND id_estado_pedido = %s
                RETURNING fecha_anulacion""",
            (cancelled_status_id, motivo_clean, actor_id, order_id, pending_status_id),
        )
        updated_order = cursor.fetchone()
        if updated_order is not None:
            cancelled_at = updated_order[0]

    return released_count, restored_units, cancelled_at


def _expire_single_order_in_tx(
    cursor,
    order_id: int,
    *,
    only_due: bool,
    id_usuario: int | None,
    motivo: str | None,
    transition_ids: tuple[int, int, int, int, int, int],
) -> dict | None:
    """Expira reservas de un pedido dentro de la transacción activa; retorna None si ya no aplica."""
    (
        active_res_status_id,
        _,
        expired_status_id,
        pending_status_id,
        cancelled_status_id,
        cancel_type_id,
    ) = transition_ids

    order = _lock_and_fetch_order(cursor, order_id)
    if order is None:
        if not only_due:
            _error(404, "order_not_found", f"No existe el pedido #{order_id}.")
        return None

    _, order_creator_id, status_name, sale_id, sale_number, _, _ = order
    if status_name in ("despachado", "entregado"):
        if not only_due:
            _error(
                409,
                "order_not_pending",
                f"No se pueden expirar reservas de un pedido en estado '{status_name}'.",
            )
        return None
    if status_name != "pendiente":
        return None

    actor_id = id_usuario if id_usuario is not None else order_creator_id
    motivo_clean = (motivo or "").strip() or "Expiración automática de reserva"
    audit_reason = (
        f"Pedido #{order_id} expirado · Nota N° {sale_number or '—'} · {motivo_clean}"
    )[:200]

    expired_count, restored_units, cancelled_at = _release_order_reservations_in_tx(
        cursor,
        order_id=order_id,
        sale_id=sale_id,
        active_res_status_id=active_res_status_id,
        target_res_status_id=expired_status_id,
        pending_status_id=pending_status_id,
        cancelled_status_id=cancelled_status_id,
        cancel_type_id=cancel_type_id,
        actor_id=actor_id,
        motivo_clean=motivo_clean,
        audit_reason=audit_reason,
        only_due=only_due,
    )
    if expired_count == 0 and cancelled_at is None:
        return None

    return {
        "id_pedido": order_id,
        "numero_nota": sale_number,
        "reservas_expiradas": expired_count,
        "unidades_restauradas": restored_units,
        "fecha_anulacion": cancelled_at,
    }


def _expire_reservations_in_tx(
    cursor,
    *,
    order_id: int | None = None,
    id_usuario: int | None = None,
    motivo: str | None = None,
) -> list[dict]:
    """Expira reservas vencidas (o las de un pedido puntual) manteniendo jerarquía de locks."""
    if id_usuario is not None:
        cursor.execute(
            """SELECT id_usuario
               FROM usuario
               WHERE id_usuario = %s AND activo = TRUE AND eliminado = FALSE""",
            (id_usuario,),
        )
        if cursor.fetchone() is None:
            _error(404, "user_not_found", f"No existe un usuario activo con ID {id_usuario}.")

    if order_id is None:
        cursor.execute(
            """SELECT DISTINCT dp.id_pedido
               FROM reserva rv
               JOIN detalle_pedido dp ON dp.id_detalle = rv.id_detalle
               JOIN pedido pe ON pe.id_pedido = dp.id_pedido
               JOIN estado_pedido ep ON ep.id_estado_pedido = pe.id_estado_pedido
               JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
               WHERE er.nombre = 'vigente'
                 AND ep.nombre = 'pendiente'
                 AND rv.fecha_expiracion IS NOT NULL
                 AND rv.fecha_expiracion <= NOW()
               ORDER BY dp.id_pedido"""
        )
        candidate_ids = [row[0] for row in cursor.fetchall()]
        if not candidate_ids:
            return []
        only_due = True
    else:
        candidate_ids = [order_id]
        only_due = False

    transition_ids = _load_reservation_transition_ids(cursor)
    details: list[dict] = []
    for candidate_id in candidate_ids:
        detail = _expire_single_order_in_tx(
            cursor,
            candidate_id,
            only_due=only_due,
            id_usuario=id_usuario,
            motivo=motivo,
            transition_ids=transition_ids,
        )
        if detail is not None:
            details.append(detail)
    return details


def expire_reservations(
    conn,
    order_id: int | None = None,
    id_usuario: int | None = None,
    motivo: str | None = None,
) -> dict:
    """Expira reservas vencidas (o las de un pedido) de forma idempotente y auditable."""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)
            details = _expire_reservations_in_tx(
                cursor,
                order_id=order_id,
                id_usuario=id_usuario,
                motivo=motivo,
            )

    return {
        "status": "expired",
        "id_pedido": order_id,
        "pedidos_expirados": len(details),
        "reservas_expiradas": sum(item["reservas_expiradas"] for item in details),
        "unidades_restauradas": sum(
            (item["unidades_restauradas"] for item in details),
            Decimal("0"),
        ),
        "idempotente": len(details) == 0,
        "detalles": details,
    }


def list_sale_notes(
    conn,
    q: str | None = None,
    id_bodega: int | None = None,
    numero: int | None = None,
    id_pedido: int | None = None,
    fecha_desde: date | None = None,
    fecha_hasta: date | None = None,
    estado: str | None = None,
    id_vendedor: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """Consulta las notas de venta emitidas desde la vista SQL vw_nota_venta y su detalle."""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)

    filters, parameters = [], []
    if id_bodega is not None:
        filters.append("v.id_bodega = %s")
        parameters.append(id_bodega)
    if id_vendedor is not None:
        filters.append("v.id_vendedor = %s")
        parameters.append(id_vendedor)
    if numero is not None:
        filters.append("v.numero = %s")
        parameters.append(numero)
    if id_pedido is not None:
        filters.append("v.id_pedido = %s")
        parameters.append(id_pedido)
    if fecha_desde is not None:
        filters.append("v.fecha_creacion::date >= %s")
        parameters.append(fecha_desde)
    if fecha_hasta is not None:
        filters.append("v.fecha_creacion::date <= %s")
        parameters.append(fecha_hasta)
    if estado is not None:
        normalized_state = estado.strip().casefold()
        if normalized_state and normalized_state != "todos":
            if normalized_state == "pendiente":
                filters.append("v.estado_pedido = 'pendiente'")
            elif normalized_state == "despachado":
                filters.append("v.estado_pedido IN ('despachado', 'entregado')")
            elif normalized_state == "cancelado":
                filters.append("v.estado_pedido = 'cancelado'")
            else:
                _error(422, "invalid_order_status", f"Estado no soportado: '{estado}'.")
    if q is not None and q.strip():
        term = f"%{q.strip()}%"
        filters.append(
            """(
                   CAST(v.numero AS TEXT) ILIKE %s
                OR CAST(COALESCE(v.id_pedido, 0) AS TEXT) ILIKE %s
                OR v.vendedor ILIKE %s
                OR v.nombre_local ILIKE %s
                OR COALESCE(v.direccion_entrega, '') ILIKE %s
                OR v.bodega ILIKE %s
                OR EXISTS (
                    SELECT 1
                    FROM vw_detalle_nota_venta dv
                    WHERE dv.id_nota_venta = v.id_nota_venta
                      AND (dv.sku ILIKE %s OR dv.producto ILIKE %s)
                )
            )"""
        )
        parameters.extend((term, term, term, term, term, term, term, term))

    where = " WHERE " + " AND ".join(filters) if filters else ""

    with conn.cursor() as cursor:
        cursor.execute(
            """SELECT
                   COUNT(*) AS total_notas,
                   COUNT(*) FILTER (WHERE v.estado_pedido = 'pendiente') AS pendientes,
                   COUNT(*) FILTER (WHERE v.estado_pedido IN ('despachado', 'entregado')) AS despachados,
                   COUNT(*) FILTER (WHERE v.estado_pedido = 'cancelado') AS anulados,
                   COALESCE(SUM(v.total) FILTER (WHERE v.estado_pedido = 'pendiente'), 0) AS monto_pendiente,
                   COALESCE(SUM(v.total) FILTER (WHERE v.estado_pedido IN ('despachado', 'entregado')), 0) AS monto_despachado,
                   COALESCE(SUM(v.total) FILTER (WHERE v.estado_pedido = 'cancelado'), 0) AS monto_anulado,
                   COALESCE(SUM(v.total) FILTER (WHERE v.estado_pedido <> 'cancelado'), 0) AS monto_neto_activo
               FROM vw_nota_venta v"""
            + where,
            parameters,
        )
        total, pendientes, despachados, anulados, monto_pendiente, monto_despachado, monto_anulado, monto_neto_activo = cursor.fetchone()

        cursor.execute("SELECT id_bodega, nombre FROM bodega ORDER BY nombre")
        warehouses = [{"id_bodega": row[0], "nombre": row[1]} for row in cursor.fetchall()]

        cursor.execute(
            """SELECT u.id_usuario, u.nombre
               FROM usuario u JOIN rol r ON r.id_rol = u.id_rol
               WHERE r.nombre = 'ventas' AND u.eliminado = FALSE
               ORDER BY u.nombre"""
        )
        sellers = [{"id_usuario": row[0], "nombre": row[1]} for row in cursor.fetchall()]

        cursor.execute(
            """SELECT
                   v.id_nota_venta,
                   v.numero,
                   v.fecha_creacion,
                   v.id_vendedor,
                   v.vendedor,
                   v.id_bodega,
                   v.bodega,
                   v.id_pedido,
                   CASE
                       WHEN v.estado_pedido = 'entregado' THEN 'despachado'
                       ELSE v.estado_pedido
                   END AS estado_pedido,
                   v.nombre_local,
                   v.direccion_entrega,
                   v.fecha_entrega,
                   v.usuario_entrega,
                   v.motivo_anulacion,
                   v.fecha_anulacion,
                   v.usuario_anulacion,
                   v.cantidad_lineas,
                   v.unidades_totales,
                   v.total
               FROM vw_nota_venta v"""
            + where
            + " ORDER BY v.numero DESC, v.id_nota_venta DESC LIMIT %s OFFSET %s",
            [*parameters, limit, offset],
        )
        columns = [column.name for column in cursor.description]
        notes = [dict(zip(columns, row)) for row in cursor.fetchall()]

        note_ids = [note["id_nota_venta"] for note in notes]
        items_by_note: dict[int, list[dict]] = {note_id: [] for note_id in note_ids}
        if note_ids:
            cursor.execute(
                """SELECT
                       id_nota_venta,
                       sku,
                       producto AS nombre,
                       cajas,
                       sueltos,
                       unidades_por_caja,
                       cantidad_total,
                       precio_confirmado,
                       subtotal
                   FROM vw_detalle_nota_venta
                   WHERE id_nota_venta = ANY(%s)
                   ORDER BY id_nota_venta, producto, sku""",
                (note_ids,),
            )
            for row in cursor.fetchall():
                nid, sku, nombre, cajas, sueltos, pack_size, qty_total, price, subtotal = row
                items_by_note[nid].append(
                    {
                        "sku": sku,
                        "nombre": nombre,
                        "cajas": cajas,
                        "sueltos": sueltos,
                        "unidades_por_caja": pack_size,
                        "cantidad_total": qty_total,
                        "precio_confirmado": price,
                        "subtotal": subtotal,
                    }
                )

        for note in notes:
            note["items"] = items_by_note.get(note["id_nota_venta"], [])

    return {
        "summary": {
            "total_notas": total,
            "pendientes": pendientes,
            "despachados": despachados,
            "anulados": anulados,
            "monto_pendiente": monto_pendiente,
            "monto_despachado": monto_despachado,
            "monto_anulado": monto_anulado,
            "monto_neto_activo": monto_neto_activo,
        },
        "bodegas": warehouses,
        "vendedores": sellers,
        "items": notes,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_sale_note(conn, numero: int) -> dict:
    """Obtiene una nota de venta por su número correlativo desde vw_nota_venta."""
    with conn.transaction():
        with conn.cursor() as cursor:
            _ensure_sales_schema(cursor)

    with conn.cursor() as cursor:
        cursor.execute(
            """SELECT
                   id_nota_venta,
                   numero,
                   fecha_creacion,
                   id_vendedor,
                   vendedor,
                   id_bodega,
                   bodega,
                   id_pedido,
                   CASE
                       WHEN estado_pedido = 'entregado' THEN 'despachado'
                       ELSE estado_pedido
                   END AS estado_pedido,
                   nombre_local,
                   direccion_entrega,
                   fecha_entrega,
                   usuario_entrega,
                   motivo_anulacion,
                   fecha_anulacion,
                   usuario_anulacion,
                   cantidad_lineas,
                   unidades_totales,
                   total
               FROM vw_nota_venta
               WHERE numero = %s""",
            (numero,),
        )
        row = cursor.fetchone()
        if row is None:
            _error(404, "sale_note_not_found", f"No existe la nota de venta N° {numero}.")
        columns = [column.name for column in cursor.description]
        note = dict(zip(columns, row))

        cursor.execute(
            """SELECT
                   sku,
                   producto AS nombre,
                   cajas,
                   sueltos,
                   unidades_por_caja,
                   cantidad_total,
                   precio_confirmado,
                   subtotal
               FROM vw_detalle_nota_venta
               WHERE id_nota_venta = %s
               ORDER BY producto, sku""",
            (note["id_nota_venta"],),
        )
        item_cols = [column.name for column in cursor.description]
        note["items"] = [dict(zip(item_cols, item_row)) for item_row in cursor.fetchall()]

    return note

