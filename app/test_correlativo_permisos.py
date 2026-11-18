"""Pruebas de correlativo sin duplicados bajo concurrencia, permisos por rol, anulación y PDF."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from decimal import Decimal
import threading
import unittest

from fastapi import HTTPException
import psycopg

from app.db import DATABASE_URL
from app.pdf_generator import build_sale_note_pdf
from app.sales import (
    CancelOrderRequest,
    SaleLine,
    SaleRequest,
    _ensure_sales_schema,
    cancel_order,
    create_sale,
    get_sale_note,
)


class CorrelativoYPermisosTests(unittest.TestCase):
    """Valida unicidad de correlativos concurrentes, control de rol ventas, anulación y PDF."""

    SKU_TEST = "TEST-CORR-SKU-001"
    LOTE_TEST = "TEST-CORR-LOTE-001"
    TEST_CLIENT_PREFIX = "__TEST_CLIENTE_CORR__"

    def setUp(self) -> None:
        self.created_sale_ids: list[int] = []
        self.created_order_ids: list[int] = []
        self.created_user_ids: list[int] = []
        self.created_client_ids: list[int] = []
        self.test_lot_id: int | None = None
        self.test_product_id: int | None = None
        self.initial_ultimo_numero: int = 0

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

                    # Producto y lote dedicados para no alterar stock real
                    cur.execute("DELETE FROM lote WHERE codigo_lote = %s", (self.LOTE_TEST,))
                    cur.execute("DELETE FROM producto WHERE sku = %s", (self.SKU_TEST,))
                    cur.execute(
                        """INSERT INTO producto
                               (sku, codigo_b, nombre, peso, id_categoria, id_unidad,
                                precio_vigente, unidades_por_caja, activo, eliminado)
                           VALUES (%s, %s, 'Producto Test Correlativo', 1.0, %s, %s, 1500, 10, TRUE, FALSE)
                           RETURNING id_producto""",
                        (self.SKU_TEST, "780999888001", cat_id, unit_id),
                    )
                    self.test_product_id = cur.fetchone()[0]

                    cur.execute(
                        """INSERT INTO lote
                               (id_producto, id_bodega, codigo_lote, fecha_recepcion,
                                fecha_vencimiento, cantidad_fisica)
                           VALUES (%s, %s, %s, %s, %s, 200)
                           RETURNING id_lote""",
                        (
                            self.test_product_id,
                            self.warehouse_id,
                            self.LOTE_TEST,
                            date.today() - timedelta(days=2),
                            date.today() + timedelta(days=90),
                        ),
                    )
                    self.test_lot_id = cur.fetchone()[0]

                    # Usuarios por rol para validar permisos estrictos
                    cur.execute("DELETE FROM usuario WHERE correo LIKE 'test.%@ghosh.local'")
                    self.role_users: dict[str, int] = {}
                    for role_name in ("ventas", "bodega", "cliente", "gerencia"):
                        cur.execute("SELECT id_rol FROM rol WHERE nombre = %s", (role_name,))
                        role_id = cur.fetchone()[0]
                        cur.execute(
                            """INSERT INTO usuario (nombre, correo, password_hash, id_rol, activo, eliminado)
                               VALUES (%s, %s, 'hash-test', %s, TRUE, FALSE)
                               RETURNING id_usuario""",
                            (f"Test {role_name}", f"test.{role_name}.corr@ghosh.local", role_id),
                        )
                        uid = cur.fetchone()[0]
                        self.role_users[role_name] = uid
                        self.created_user_ids.append(uid)

                    cur.execute("SELECT id_rol FROM rol WHERE nombre = 'ventas'")
                    ventas_role_id = cur.fetchone()[0]
                    cur.execute(
                        """INSERT INTO usuario (nombre, correo, password_hash, id_rol, activo, eliminado)
                           VALUES ('Test ventas inactivo', 'test.ventas.inactivo@ghosh.local', 'hash-test', %s, FALSE, FALSE)
                           RETURNING id_usuario""",
                        (ventas_role_id,),
                    )
                    self.inactive_seller_id = cur.fetchone()[0]
                    self.created_user_ids.append(self.inactive_seller_id)

    def tearDown(self) -> None:
        with psycopg.connect(DATABASE_URL) as conn:
            with conn.transaction():
                with conn.cursor() as cur:
                    if self.test_lot_id is not None:
                        cur.execute(
                            "DELETE FROM movimiento_inventario WHERE id_lote = %s",
                            (self.test_lot_id,),
                        )
                    if self.created_order_ids:
                        cur.execute(
                            """DELETE FROM movimiento_inventario WHERE id_pedido = ANY(%s)""",
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
                    if self.created_client_ids:
                        cur.execute(
                            "DELETE FROM cliente_frecuente WHERE id_cliente = ANY(%s)",
                            (self.created_client_ids,),
                        )
                    cur.execute(
                        "DELETE FROM cliente_frecuente WHERE nombre_local LIKE %s",
                        (f"{self.TEST_CLIENT_PREFIX}%",),
                    )
                    if self.test_lot_id is not None:
                        cur.execute("DELETE FROM lote WHERE id_lote = %s", (self.test_lot_id,))
                    if self.test_product_id is not None:
                        cur.execute(
                            "DELETE FROM producto WHERE id_producto = %s",
                            (self.test_product_id,),
                        )
                    if self.created_user_ids:
                        cur.execute(
                            "DELETE FROM usuario WHERE id_usuario = ANY(%s)",
                            (self.created_user_ids,),
                        )
                    # Restaura correlativo exacto al último número real restante
                    cur.execute(
                        """UPDATE correlativo
                              SET ultimo_numero = GREATEST(
                                  COALESCE((SELECT MAX(numero) FROM nota_venta), 0),
                                  %s
                              )
                            WHERE tipo_documento = 'nota_venta'""",
                        (self.initial_ultimo_numero,),
                    )

    def test_concurrent_correlative_emissions_no_duplicates(self) -> None:
        workers = 8
        barrier = threading.Barrier(workers)

        def emit_one(idx: int) -> dict:
            req = SaleRequest(
                id_bodega=self.warehouse_id,
                id_vendedor=self.role_users["ventas"],
                nombre_local=f"Local Concurrente {idx}",
                direccion_entrega=f"Av. Prueba {100 + idx}, Talca",
                guardar_cliente_frecuente=False,
                items=[SaleLine(sku=self.SKU_TEST, cajas=0, sueltos=Decimal("2"))],
            )
            barrier.wait(timeout=10)
            with psycopg.connect(DATABASE_URL) as worker_conn:
                return create_sale(worker_conn, req)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(emit_one, range(workers)))

        for res in results:
            self.created_sale_ids.append(res["id_nota_venta"])
            self.created_order_ids.append(res["id_pedido"])

        numbers = [res["numero"] for res in results]
        self.assertEqual(len(numbers), workers)
        self.assertEqual(len(set(numbers)), workers, f"Correlativos duplicados: {numbers}")
        expected_seq = list(range(self.initial_ultimo_numero + 1, self.initial_ultimo_numero + 1 + workers))
        self.assertEqual(sorted(numbers), expected_seq)

    def test_failed_sale_does_not_skip_correlative(self) -> None:
        req = SaleRequest(
            id_bodega=self.warehouse_id,
            id_vendedor=self.role_users["ventas"],
            nombre_local="Local Stock Insuficiente",
            items=[SaleLine(sku=self.SKU_TEST, cajas=999, sueltos=Decimal("0"))],
        )
        with psycopg.connect(DATABASE_URL) as conn:
            with self.assertRaises(HTTPException) as ctx:
                create_sale(conn, req)
            self.assertEqual(ctx.exception.status_code, 409)
            self.assertEqual(ctx.exception.detail["code"], "insufficient_stock")

            with conn.cursor() as cur:
                cur.execute(
                    "SELECT ultimo_numero FROM correlativo WHERE tipo_documento = 'nota_venta'"
                )
                self.assertEqual(cur.fetchone()[0], self.initial_ultimo_numero)

    def test_role_permissions_only_active_ventas_can_emit(self) -> None:
        unauthorized_ids = [
            ("bodega", self.role_users["bodega"]),
            ("cliente", self.role_users["cliente"]),
            ("gerencia", self.role_users["gerencia"]),
            ("ventas_inactivo", self.inactive_seller_id),
        ]
        with psycopg.connect(DATABASE_URL) as conn:
            for label, uid in unauthorized_ids:
                with self.subTest(role=label):
                    req = SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=uid,
                        nombre_local="Local No Autorizado",
                        items=[SaleLine(sku=self.SKU_TEST, cajas=0, sueltos=Decimal("1"))],
                    )
                    with self.assertRaises(HTTPException) as ctx:
                        create_sale(conn, req)
                    self.assertEqual(ctx.exception.status_code, 403)
                    self.assertEqual(ctx.exception.detail["code"], "seller_required")

    def test_frequent_client_address_cancel_and_pdf(self) -> None:
        alias = f"{self.TEST_CLIENT_PREFIX} Minimarket Sur"
        address = "Calle 2 Sur 1455, Talca"
        req = SaleRequest(
            id_bodega=self.warehouse_id,
            id_vendedor=self.role_users["ventas"],
            nombre_local=alias,
            direccion_entrega=address,
            guardar_cliente_frecuente=True,
            items=[SaleLine(sku=self.SKU_TEST, cajas=1, sueltos=Decimal("2"))],
        )
        with psycopg.connect(DATABASE_URL) as conn:
            created = create_sale(conn, req)
            self.created_sale_ids.append(created["id_nota_venta"])
            self.created_order_ids.append(created["id_pedido"])
            if created.get("id_cliente"):
                self.created_client_ids.append(created["id_cliente"])

            self.assertEqual(created["direccion_entrega"], address)
            self.assertIsNotNone(created["cliente_frecuente_guardado"])

            note = get_sale_note(conn, created["numero"])
            self.assertEqual(note["direccion_entrega"], address)
            self.assertEqual(note["nombre_local"], alias)

            pdf_bytes = build_sale_note_pdf(note)
            self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))
            self.assertIn(b"%%EOF", pdf_bytes)
            self.assertIn(self.SKU_TEST.encode("ascii"), pdf_bytes)

            cancelled = cancel_order(
                conn,
                created["id_pedido"],
                CancelOrderRequest(id_usuario=self.role_users["ventas"], motivo="Cliente reprogramó despacho"),
            )
            self.assertEqual(cancelled["estado"], "cancelado")

            with conn.cursor() as cur:
                cur.execute(
                    """SELECT er.nombre
                       FROM reserva r
                       JOIN detalle_pedido dp ON dp.id_detalle = r.id_detalle
                       JOIN estado_reserva er ON er.id_estado_reserva = r.id_estado_reserva
                       WHERE dp.id_pedido = %s""",
                    (created["id_pedido"],),
                )
                states = [row[0] for row in cur.fetchall()]
                self.assertEqual(states, ["liberada"])

            with self.assertRaises(HTTPException) as ctx:
                cancel_order(
                    conn,
                    created["id_pedido"],
                    CancelOrderRequest(id_usuario=self.role_users["ventas"], motivo="Doble anulación"),
                )
            self.assertEqual(ctx.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
