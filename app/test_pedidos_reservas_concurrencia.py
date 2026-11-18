"""Pruebas de reservas FEFO, concurrencia, expiración/anulación idempotente y vista de despacho."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from decimal import Decimal
import threading
import unittest

from fastapi import HTTPException
import psycopg

from app.db import DATABASE_URL
from app.sales import (
    CancelOrderRequest,
    DispatchOrderRequest,
    SaleLine,
    SaleRequest,
    _ensure_sales_schema,
    cancel_order,
    create_sale,
    dispatch_order,
    expire_reservations,
    list_orders,
)


class PedidosReservasConcurrenciaTests(unittest.TestCase):
    """Valida GHOSH-13 (FEFO y concurrencia), GHOSH-15 (idempotencia) y GHOSH-16 (vista y despacho)."""

    SKU_A = "TEST-PED-SKU-A"
    SKU_B = "TEST-PED-SKU-B"
    LOT_PREFIX = "TEST-PED-LOTE-"
    EMAIL_PATTERN = "pedidos.test.%@ghosh.local"

    def setUp(self) -> None:
        self.created_sale_ids: list[int] = []
        self.created_order_ids: list[int] = []
        self.created_user_ids: list[int] = []
        self.created_product_ids: list[int] = []
        self.created_lot_ids: list[int] = []
        self.lots_a: dict[str, int] = {}
        self.lot_b_id: int = 0
        self.initial_ultimo_numero: int = 0

        today = date.today()
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    _ensure_sales_schema(cur)
                    cur.execute(
                        "SELECT ultimo_numero FROM correlativo WHERE tipo_documento = 'nota_venta'"
                    )
                    self.initial_ultimo_numero = cur.fetchone()[0]

                    cur.execute("SELECT id_bodega FROM bodega ORDER BY id_bodega LIMIT 1")
                    self.warehouse_id = cur.fetchone()[0]

                    cur.execute("SELECT id_categoria FROM categoria LIMIT 1")
                    cat_id = cur.fetchone()[0]
                    cur.execute("SELECT id_unidad FROM unidad_comercial WHERE decimales = 0 LIMIT 1")
                    unit_id = cur.fetchone()[0]

                    # Limpieza defensiva si quedó un residuo previo de estas claves de prueba
                    cur.execute("DELETE FROM lote WHERE codigo_lote LIKE %s", (f"{self.LOT_PREFIX}%",))
                    cur.execute(
                        "DELETE FROM producto WHERE sku IN (%s, %s)",
                        (self.SKU_A, self.SKU_B),
                    )
                    cur.execute("DELETE FROM usuario WHERE correo LIKE %s", (self.EMAIL_PATTERN,))

                    cur.execute(
                        """INSERT INTO producto
                               (sku, codigo_b, nombre, peso, id_categoria, id_unidad,
                                precio_vigente, unidades_por_caja, activo, eliminado)
                           VALUES (%s, %s, 'Producto Test FEFO A', 1.0, %s, %s, 2000, 10, TRUE, FALSE)
                           RETURNING id_producto""",
                        (self.SKU_A, "780999777001", cat_id, unit_id),
                    )
                    self.product_a_id = cur.fetchone()[0]
                    self.created_product_ids.append(self.product_a_id)

                    cur.execute(
                        """INSERT INTO producto
                               (sku, codigo_b, nombre, peso, id_categoria, id_unidad,
                                precio_vigente, unidades_por_caja, activo, eliminado)
                           VALUES (%s, %s, 'Producto Test FEFO B', 1.0, %s, %s, 1200, 5, TRUE, FALSE)
                           RETURNING id_producto""",
                        (self.SKU_B, "780999777002", cat_id, unit_id),
                    )
                    self.product_b_id = cur.fetchone()[0]
                    self.created_product_ids.append(self.product_b_id)

                    lot_specs = [
                        ("expired", f"{self.LOT_PREFIX}EXP", today - timedelta(days=2), today - timedelta(days=1), Decimal("50")),
                        ("fefo_1", f"{self.LOT_PREFIX}F1", today - timedelta(days=5), today + timedelta(days=10), Decimal("10")),
                        ("fefo_2", f"{self.LOT_PREFIX}F2", today - timedelta(days=3), today + timedelta(days=30), Decimal("20")),
                    ]
                    for key, code, rec_date, exp_date, qty in lot_specs:
                        cur.execute(
                            """INSERT INTO lote
                                   (id_producto, id_bodega, codigo_lote, fecha_recepcion,
                                    fecha_vencimiento, cantidad_fisica)
                               VALUES (%s, %s, %s, %s, %s, %s)
                               RETURNING id_lote""",
                            (self.product_a_id, self.warehouse_id, code, rec_date, exp_date, qty),
                        )
                        lid = cur.fetchone()[0]
                        self.lots_a[key] = lid
                        self.created_lot_ids.append(lid)

                    cur.execute(
                        """INSERT INTO lote
                               (id_producto, id_bodega, codigo_lote, fecha_recepcion,
                                fecha_vencimiento, cantidad_fisica)
                           VALUES (%s, %s, %s, %s, %s, 5)
                           RETURNING id_lote""",
                        (
                            self.product_b_id,
                            self.warehouse_id,
                            f"{self.LOT_PREFIX}B1",
                            today - timedelta(days=1),
                            today + timedelta(days=15),
                        ),
                    )
                    self.lot_b_id = cur.fetchone()[0]
                    self.created_lot_ids.append(self.lot_b_id)

                    self.role_users: dict[str, int] = {}
                    for role_name in ("ventas", "bodega"):
                        cur.execute("SELECT id_rol FROM rol WHERE nombre = %s", (role_name,))
                        role_id = cur.fetchone()[0]
                        cur.execute(
                            """INSERT INTO usuario (nombre, correo, password_hash, id_rol, activo, eliminado)
                               VALUES (%s, %s, 'hash-test', %s, TRUE, FALSE)
                               RETURNING id_usuario""",
                            (f"Pedidos Test {role_name}", f"pedidos.test.{role_name}@ghosh.local", role_id),
                        )
                        uid = cur.fetchone()[0]
                        self.role_users[role_name] = uid
                        self.created_user_ids.append(uid)

    def tearDown(self) -> None:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    if self.created_lot_ids:
                        cur.execute(
                            "DELETE FROM movimiento_inventario WHERE id_lote = ANY(%s)",
                            (self.created_lot_ids,),
                        )
                    if self.created_order_ids:
                        cur.execute(
                            "DELETE FROM movimiento_inventario WHERE id_pedido = ANY(%s)",
                            (self.created_order_ids,),
                        )
                        cur.execute(
                            """DELETE FROM reserva
                               WHERE id_detalle IN (
                                   SELECT id_detalle FROM detalle_pedido WHERE id_pedido = ANY(%s)
                               )""",
                            (self.created_order_ids,),
                        )
                        cur.execute(
                            "DELETE FROM detalle_pedido WHERE id_pedido = ANY(%s)",
                            (self.created_order_ids,),
                        )
                        cur.execute(
                            "DELETE FROM pedido WHERE id_pedido = ANY(%s)",
                            (self.created_order_ids,),
                        )
                    if self.created_sale_ids:
                        cur.execute(
                            "DELETE FROM detalle_nota_venta WHERE id_nota_venta = ANY(%s)",
                            (self.created_sale_ids,),
                        )
                        cur.execute(
                            "DELETE FROM nota_venta WHERE id_nota_venta = ANY(%s)",
                            (self.created_sale_ids,),
                        )
                    if self.created_lot_ids:
                        cur.execute(
                            "DELETE FROM lote WHERE id_lote = ANY(%s)",
                            (self.created_lot_ids,),
                        )
                    if self.created_product_ids:
                        cur.execute(
                            "DELETE FROM producto WHERE id_producto = ANY(%s)",
                            (self.created_product_ids,),
                        )
                    if self.created_user_ids:
                        cur.execute(
                            "DELETE FROM usuario WHERE id_usuario = ANY(%s)",
                            (self.created_user_ids,),
                        )
                    cur.execute(
                        """UPDATE correlativo
                              SET ultimo_numero = GREATEST(
                                  COALESCE((SELECT MAX(numero) FROM nota_venta), 0),
                                  %s
                              )
                            WHERE tipo_documento = 'nota_venta'""",
                        (self.initial_ultimo_numero,),
                    )

    def _register_created(self, result: dict) -> dict:
        self.created_sale_ids.append(result["id_nota_venta"])
        self.created_order_ids.append(result["id_pedido"])
        return result

    def _lot_available(self, cur, lot_id: int) -> Decimal:
        cur.execute(
            """SELECT l.cantidad_fisica - COALESCE((
                          SELECT SUM(rv.cantidad)
                          FROM reserva rv
                          JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                          WHERE rv.id_lote = l.id_lote
                            AND er.nombre = 'vigente'
                            AND (rv.fecha_expiracion IS NULL OR rv.fecha_expiracion > NOW())
                      ), 0)
               FROM lote l
               WHERE l.id_lote = %s""",
            (lot_id,),
        )
        return Decimal(cur.fetchone()[0])

    def test_fefo_multi_lot_reservation_and_atomic_rollback(self) -> None:
        # 1. El segundo ítem falla por stock insuficiente (6 > 5): la transacción debe hacer rollback completo.
        with psycopg.connect(DATABASE_URL) as conn:
            with self.assertRaises(HTTPException) as ctx:
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.role_users["ventas"],
                        nombre_local="Local Rollback FEFO",
                        items=[
                            SaleLine(sku=self.SKU_A, cajas=1, sueltos=Decimal("5")),  # 15 u OK
                            SaleLine(sku=self.SKU_B, cajas=0, sueltos=Decimal("6")),  # 6 u > 5 u
                        ],
                    ),
                )
            self.assertEqual(ctx.exception.status_code, 409)

        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM reserva WHERE id_lote = ANY(%s)",
                    (self.created_lot_ids,),
                )
                self.assertEqual(cur.fetchone()[0], 0)
                cur.execute(
                    "SELECT COUNT(*) FROM movimiento_inventario WHERE id_lote = ANY(%s)",
                    (self.created_lot_ids,),
                )
                self.assertEqual(cur.fetchone()[0], 0)

        # 2. Solicitud válida multi-lote: debe omitir el lote vencido y consumir F1 (10u) + F2 (5u) en FEFO.
        with psycopg.connect(DATABASE_URL) as conn:
            created = self._register_created(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.role_users["ventas"],
                        nombre_local="Local Split FEFO",
                        items=[
                            SaleLine(sku=self.SKU_A, cajas=1, sueltos=Decimal("5")),  # 15 u
                            SaleLine(sku=self.SKU_B, cajas=0, sueltos=Decimal("3")),  # 3 u
                        ],
                    ),
                )
            )

        items_by_sku = {item["sku"]: item for item in created["items"]}
        lots_a_reserved = items_by_sku[self.SKU_A]["lotes_reservados"]
        self.assertEqual(
            [(lot["codigo_lote"], Decimal(lot["cantidad"])) for lot in lots_a_reserved],
            [(f"{self.LOT_PREFIX}F1", Decimal("10")), (f"{self.LOT_PREFIX}F2", Decimal("5"))],
        )

        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_1"]), Decimal("0"))
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_2"]), Decimal("15"))
                self.assertEqual(self._lot_available(cur, self.lots_a["expired"]), Decimal("50"))
                self.assertEqual(self._lot_available(cur, self.lot_b_id), Decimal("2"))

    def test_concurrent_reservations_on_stock_limit(self) -> None:
        # Stock válido de SKU_A = 10 + 20 = 30 u (el lote EXP=50 está vencido y no participa).
        # 10 hilos compiten por 5 u cada uno (50 u solicitadas en total): solo 6 deben ganar.
        workers = 10
        barrier = threading.Barrier(workers)

        def reserve_one(idx: int) -> tuple[str, dict | int]:
            with psycopg.connect(DATABASE_URL) as conn:
                barrier.wait(timeout=10)
                try:
                    res = create_sale(
                        conn,
                        SaleRequest(
                            id_bodega=self.warehouse_id,
                            id_vendedor=self.role_users["ventas"],
                            nombre_local=f"Local Concurrente {idx}",
                            items=[SaleLine(sku=self.SKU_A, cajas=0, sueltos=Decimal("5"))],
                        ),
                    )
                    return ("ok", res)
                except HTTPException as exc:
                    return ("err", exc.status_code)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            outcomes = list(executor.map(reserve_one, range(workers)))

        successes = [self._register_created(payload) for status, payload in outcomes if status == "ok"]
        failures = [payload for status, payload in outcomes if status == "err"]

        self.assertEqual(len(successes), 6)
        self.assertEqual(len(failures), 4)
        self.assertTrue(all(code == 409 for code in failures))

        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT COALESCE(SUM(rv.cantidad), 0)
                       FROM reserva rv
                       JOIN estado_reserva er ON er.id_estado_reserva = rv.id_estado_reserva
                       WHERE rv.id_lote = ANY(%s)
                         AND er.nombre = 'vigente'""",
                    ([self.lots_a["fefo_1"], self.lots_a["fefo_2"]],),
                )
                total_reserved = Decimal(cur.fetchone()[0])
                self.assertEqual(total_reserved, Decimal("30"))
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_1"]), Decimal("0"))
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_2"]), Decimal("0"))

    def test_idempotent_cancellation_and_expiration_single_restore(self) -> None:
        # A. Doble anulación concurrente sobre un pedido de 15 u: solo 1 anula y restaura 1 vez.
        with psycopg.connect(DATABASE_URL) as conn:
            order_cancel = self._register_created(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.role_users["ventas"],
                        nombre_local="Local Doble Cancelacion",
                        items=[SaleLine(sku=self.SKU_A, cajas=1, sueltos=Decimal("5"))],
                    ),
                )
            )

        cancel_barrier = threading.Barrier(2)

        def run_cancel(_: int) -> str:
            with psycopg.connect(DATABASE_URL) as conn:
                cancel_barrier.wait(timeout=10)
                try:
                    res = cancel_order(
                        conn,
                        order_cancel["id_pedido"],
                        CancelOrderRequest(
                            id_usuario=self.role_users["ventas"],
                            motivo="Prueba concurrencia anulacion",
                        ),
                    )
                    return res["estado"]
                except HTTPException as exc:
                    return f"http_{exc.status_code}"

        with ThreadPoolExecutor(max_workers=2) as executor:
            cancel_outcomes = list(executor.map(run_cancel, range(2)))

        self.assertEqual(sorted(cancel_outcomes), ["cancelado", "http_409"])

        with psycopg.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_1"]), Decimal("10"))
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_2"]), Decimal("20"))
                cur.execute(
                    """SELECT COUNT(*), COALESCE(SUM(m.cantidad), 0)
                       FROM movimiento_inventario m
                       JOIN tipo_movimiento tm ON tm.id_tipo = m.id_tipo
                       WHERE m.id_pedido = %s
                         AND tm.nombre = 'cancelacion'""",
                    (order_cancel["id_pedido"],),
                )
                mov_count, mov_sum = cur.fetchone()
                self.assertEqual(mov_count, 2)
                self.assertEqual(Decimal(mov_sum), Decimal("15"))

        # B. Expiración concurrente y repetida sobre pedido vencido de 12 u: restaura exactamente 1 vez.
        with psycopg.connect(DATABASE_URL) as conn:
            order_exp = self._register_created(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.role_users["ventas"],
                        nombre_local="Local Expiracion Idempotente",
                        fecha_expiracion_reserva=datetime.now() - timedelta(minutes=10),
                        items=[SaleLine(sku=self.SKU_A, cajas=1, sueltos=Decimal("2"))],
                    ),
                )
            )

        exp_barrier = threading.Barrier(4)

        def run_expire(_: int) -> dict:
            with psycopg.connect(DATABASE_URL) as conn:
                exp_barrier.wait(timeout=10)
                return expire_reservations(conn, order_id=order_exp["id_pedido"])

        with ThreadPoolExecutor(max_workers=4) as executor:
            exp_outcomes = list(executor.map(run_expire, range(4)))

        self.assertEqual(sum(o["reservas_expiradas"] for o in exp_outcomes), 2)
        self.assertEqual(sum((Decimal(o["unidades_restauradas"]) for o in exp_outcomes), Decimal("0")), Decimal("12"))
        self.assertEqual(sum(1 for o in exp_outcomes if not o["idempotente"]), 1)

        with psycopg.connect(DATABASE_URL) as conn:
            repeated = expire_reservations(conn, order_id=order_exp["id_pedido"])
            self.assertTrue(repeated["idempotente"])
            self.assertEqual(repeated["reservas_expiradas"], 0)
            with conn.cursor() as cur:
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_1"]), Decimal("10"))
                self.assertEqual(self._lot_available(cur, self.lots_a["fefo_2"]), Decimal("20"))
                cur.execute(
                    """SELECT COUNT(*), COALESCE(SUM(m.cantidad), 0)
                       FROM movimiento_inventario m
                       JOIN tipo_movimiento tm ON tm.id_tipo = m.id_tipo
                       WHERE m.id_pedido = %s
                         AND tm.nombre = 'cancelacion'""",
                    (order_exp["id_pedido"],),
                )
                exp_mov_count, exp_mov_sum = cur.fetchone()
                self.assertEqual(exp_mov_count, 2)
                self.assertEqual(Decimal(exp_mov_sum), Decimal("12"))

        # C. list_orders expira automáticamente solo pedidos con fecha_expiracion vencida.
        with psycopg.connect(DATABASE_URL) as conn:
            active_order = self._register_created(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.role_users["ventas"],
                        nombre_local="Local Vigente Futuro",
                        fecha_expiracion_reserva=datetime.now() + timedelta(hours=2),
                        items=[SaleLine(sku=self.SKU_A, cajas=0, sueltos=Decimal("8"))],
                    ),
                )
            )
            due_order = self._register_created(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.role_users["ventas"],
                        nombre_local="Local Vencido Batch",
                        fecha_expiracion_reserva=datetime.now() - timedelta(minutes=5),
                        items=[SaleLine(sku=self.SKU_A, cajas=0, sueltos=Decimal("6"))],
                    ),
                )
            )
            due_view = list_orders(conn, id_pedido=due_order["id_pedido"])
            active_view = list_orders(conn, id_pedido=active_order["id_pedido"])

        self.assertEqual(due_view["items"][0]["estado"], "cancelado")
        self.assertTrue(
            all(r["estado_reserva"] == "expirada" for r in due_view["items"][0]["reservas"])
        )
        self.assertEqual(active_view["items"][0]["estado"], "pendiente")
        self.assertTrue(
            all(r["estado_reserva"] == "vigente" for r in active_view["items"][0]["reservas"])
        )

    def test_order_view_and_preparation_dispatch_confirmation(self) -> None:
        with psycopg.connect(DATABASE_URL) as conn:
            created = self._register_created(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.role_users["ventas"],
                        nombre_local="Local Picking Despacho",
                        items=[SaleLine(sku=self.SKU_A, cajas=1, sueltos=Decimal("5"))],
                    ),
                )
            )

            before_dispatch = list_orders(conn, id_pedido=created["id_pedido"])
            order_before = before_dispatch["items"][0]
            self.assertEqual(order_before["estado"], "pendiente")
            self.assertEqual(
                [(r["codigo_lote"], Decimal(r["cantidad"]), r["estado_reserva"]) for r in order_before["reservas"]],
                [
                    (f"{self.LOT_PREFIX}F1", Decimal("10"), "vigente"),
                    (f"{self.LOT_PREFIX}F2", Decimal("5"), "vigente"),
                ],
            )
            self.assertEqual(
                len(order_before["items"][0]["lotes_reservados"]),
                2,
            )

            dispatched = dispatch_order(
                conn,
                created["id_pedido"],
                DispatchOrderRequest(
                    id_usuario=self.role_users["bodega"],
                    motivo="Confirmación picking FEFO",
                ),
            )
            self.assertEqual(dispatched["estado"], "despachado")

            after_dispatch = list_orders(conn, id_pedido=created["id_pedido"])
            order_after = after_dispatch["items"][0]
            self.assertEqual(order_after["estado"], "despachado")
            self.assertTrue(order_after["usuario_entrega"])
            self.assertTrue(
                all(r["estado_reserva"] == "consumida" for r in order_after["reservas"])
            )
            self.assertTrue(
                all(
                    r["estado_reserva"] == "consumida"
                    for r in order_after["items"][0]["lotes_reservados"]
                )
            )

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id_lote, cantidad_fisica FROM lote WHERE id_lote = ANY(%s)",
                    ([self.lots_a["fefo_1"], self.lots_a["fefo_2"]],),
                )
                physical_by_lot = {lid: Decimal(qty) for lid, qty in cur.fetchall()}
                self.assertEqual(physical_by_lot[self.lots_a["fefo_1"]], Decimal("0"))
                self.assertEqual(physical_by_lot[self.lots_a["fefo_2"]], Decimal("15"))


if __name__ == "__main__":
    unittest.main()
