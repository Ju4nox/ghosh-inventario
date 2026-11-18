"""Pruebas de ranking de demanda con CSV (GHOSH-18) y alertas de stock/vencimiento (GHOSH-19)."""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from decimal import Decimal
import unittest

import psycopg

from app.analytics import build_demand_csv, demand_ranking, inventory_alerts
from app.db import DATABASE_URL
from app.sales import (
    CancelOrderRequest,
    SaleLine,
    SaleRequest,
    _ensure_sales_schema,
    cancel_order,
    create_sale,
)


class DemandaYAlertasTests(unittest.TestCase):
    """Valida ranking de demanda, exclusión de cancelados, CSV y alertas de stock/lotes."""

    SKU_HIGH = "TEST-DEM-HIGH"
    SKU_LOW = "TEST-DEM-LOW"
    SKU_ZERO = "TEST-DEM-ZERO"
    SKU_OK = "TEST-ALT-OK"
    LOT_PREFIX = "TEST-ALT-LOTE-"
    EMAIL_PATTERN = "analytics.test.%@ghosh.local"

    def setUp(self) -> None:
        self.created_sale_ids: list[int] = []
        self.created_order_ids: list[int] = []
        self.created_user_ids: list[int] = []
        self.created_product_ids: list[int] = []
        self.created_lot_ids: list[int] = []
        self.lots_by_code: dict[str, int] = {}
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

                    cur.execute("DELETE FROM lote WHERE codigo_lote LIKE %s", (f"{self.LOT_PREFIX}%",))
                    cur.execute(
                        "DELETE FROM producto WHERE sku IN (%s, %s, %s, %s)",
                        (self.SKU_HIGH, self.SKU_LOW, self.SKU_ZERO, self.SKU_OK),
                    )
                    cur.execute("DELETE FROM usuario WHERE correo LIKE %s", (self.EMAIL_PATTERN,))

                    products = [
                        (self.SKU_HIGH, "780888111001", "Producto Alta Demanda", Decimal("2500"), 10),
                        (self.SKU_LOW, "780888111002", "Producto Baja Demanda", Decimal("1800"), 5),
                        (self.SKU_ZERO, "780888111003", "Producto Sin Demanda Agotado", Decimal("900"), 12),
                        (self.SKU_OK, "780888111004", "Producto Stock Saludable", Decimal("1500"), 10),
                    ]
                    pid_by_sku: dict[str, int] = {}
                    for sku, barcode, name, price, pack_size in products:
                        cur.execute(
                            """INSERT INTO producto
                                   (sku, codigo_b, nombre, peso, id_categoria, id_unidad,
                                    precio_vigente, unidades_por_caja, activo, eliminado)
                               VALUES (%s, %s, %s, 1.0, %s, %s, %s, %s, TRUE, FALSE)
                               RETURNING id_producto""",
                            (sku, barcode, name, cat_id, unit_id, price, pack_size),
                        )
                        pid = cur.fetchone()[0]
                        pid_by_sku[sku] = pid
                        self.created_product_ids.append(pid)

                    # Lotes con distintas fechas de vencimiento y niveles de stock
                    lot_specs = [
                        (self.SKU_HIGH, f"{self.LOT_PREFIX}HIGH", today - timedelta(days=5), today + timedelta(days=60), Decimal("40")),
                        (self.SKU_LOW, f"{self.LOT_PREFIX}LOW", today - timedelta(days=4), today + timedelta(days=10), Decimal("9")),  # tras vender 4 queda en 5 (stock crítico)
                        (self.SKU_OK, f"{self.LOT_PREFIX}OK", today - timedelta(days=3), today + timedelta(days=90), Decimal("50")),
                        (self.SKU_OK, f"{self.LOT_PREFIX}EXP", today - timedelta(days=10), today - timedelta(days=3), Decimal("12")),  # vencido hace 3 días
                    ]
                    for sku, lot_code, rec_date, exp_date, qty in lot_specs:
                        cur.execute(
                            """INSERT INTO lote
                                   (id_producto, id_bodega, codigo_lote, fecha_recepcion,
                                    fecha_vencimiento, cantidad_fisica)
                               VALUES (%s, %s, %s, %s, %s, %s)
                               RETURNING id_lote""",
                            (pid_by_sku[sku], self.warehouse_id, lot_code, rec_date, exp_date, qty),
                        )
                        lid = cur.fetchone()[0]
                        self.lots_by_code[lot_code] = lid
                        self.created_lot_ids.append(lid)

                    cur.execute("SELECT id_rol FROM rol WHERE nombre = 'ventas'")
                    ventas_role_id = cur.fetchone()[0]
                    cur.execute(
                        """INSERT INTO usuario (nombre, correo, password_hash, id_rol, activo, eliminado)
                           VALUES ('Analytics Test Ventas', 'analytics.test.ventas@ghosh.local', 'hash-test', %s, TRUE, FALSE)
                           RETURNING id_usuario""",
                        (ventas_role_id,),
                    )
                    self.seller_id = cur.fetchone()[0]
                    self.created_user_ids.append(self.seller_id)

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

    def _register_sale(self, result: dict) -> dict:
        self.created_sale_ids.append(result["id_nota_venta"])
        self.created_order_ids.append(result["id_pedido"])
        return result

    def test_demand_ranking_excludes_cancelled_and_exports_csv(self) -> None:
        today = date.today()
        with psycopg.connect(DATABASE_URL) as conn:
            self._register_sale(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.seller_id,
                        nombre_local="Local Demanda Confirmada",
                        items=[
                            SaleLine(sku=self.SKU_HIGH, cajas=2, sueltos=Decimal("5")),  # 25 u
                            SaleLine(sku=self.SKU_LOW, cajas=0, sueltos=Decimal("4")),   # 4 u
                        ],
                    ),
                )
            )
            cancelled_order = self._register_sale(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.seller_id,
                        nombre_local="Local Pedido Cancelado",
                        items=[
                            SaleLine(sku=self.SKU_LOW, cajas=1, sueltos=Decimal("0")),  # 5 u que luego se cancelan
                        ],
                    ),
                )
            )
            cancel_order(
                conn,
                cancelled_order["id_pedido"],
                CancelOrderRequest(id_usuario=self.seller_id, motivo="No debe sumar a demanda"),
            )

            with_zero = demand_ranking(
                conn,
                fecha_desde=today,
                fecha_hasta=today,
                q="TEST-",
                incluir_sin_demanda=True,
                limit=10,
            )
            only_active_demand = demand_ranking(
                conn,
                fecha_desde=today,
                fecha_hasta=today,
                q="TEST-",
                incluir_sin_demanda=False,
                limit=10,
            )

        self.assertEqual(
            [item["sku"] for item in with_zero["mas_demandados"]],
            [self.SKU_HIGH, self.SKU_LOW],
        )
        self.assertEqual(Decimal(with_zero["mas_demandados"][0]["unidades_demandadas"]), Decimal("25"))
        self.assertEqual(Decimal(with_zero["mas_demandados"][1]["unidades_demandadas"]), Decimal("4"))
        self.assertEqual(with_zero["summary"]["pedidos_confirmados"], 1)

        # Con incluir_sin_demanda=True aparecen primero los 0 u (ZERO y OK) y luego LOW (4 u).
        zero_skus = [item["sku"] for item in with_zero["menos_demandados"]]
        self.assertEqual(zero_skus[:2], [self.SKU_ZERO, self.SKU_OK])
        self.assertEqual(zero_skus[2], self.SKU_LOW)

        # Con incluir_sin_demanda=False solo aparecen los productos con demanda > 0 (LOW antes de HIGH).
        self.assertEqual(
            [item["sku"] for item in only_active_demand["menos_demandados"]],
            [self.SKU_LOW, self.SKU_HIGH],
        )

        csv_bytes = build_demand_csv(with_zero)
        self.assertTrue(csv_bytes.startswith(b"\xef\xbb\xbf"))
        rows = list(csv.reader(io.StringIO(csv_bytes.decode("utf-8-sig"))))
        self.assertEqual(rows[0][0], "tipo_ranking")
        self.assertTrue(any(r[0] == "mayor_demanda" and r[2] == self.SKU_HIGH for r in rows[1:]))
        self.assertTrue(any(r[0] == "menor_demanda" and r[2] == self.SKU_ZERO for r in rows[1:]))

    def test_inventory_alerts_critical_stock_and_expiring_or_expired_lots(self) -> None:
        with psycopg.connect(DATABASE_URL) as conn:
            # Deja SKU_LOW en 5 disponibles (9 físicos - 4 reservados) para alertar como stock crítico (<= 10)
            self._register_sale(
                create_sale(
                    conn,
                    SaleRequest(
                        id_bodega=self.warehouse_id,
                        id_vendedor=self.seller_id,
                        nombre_local="Local Reserva Stock Critico",
                        items=[SaleLine(sku=self.SKU_LOW, cajas=0, sueltos=Decimal("4"))],
                    ),
                )
            )
            alerts = inventory_alerts(
                conn,
                dias_vencimiento=30,
                umbral_stock=Decimal("10"),
                q="TEST-",
            )

        stock_by_sku = {item["sku"]: item for item in alerts["alertas_stock"]}
        self.assertIn(self.SKU_ZERO, stock_by_sku)
        self.assertEqual(stock_by_sku[self.SKU_ZERO]["nivel_alerta"], "agotado")
        self.assertEqual(Decimal(stock_by_sku[self.SKU_ZERO]["disponible"]), Decimal("0"))

        self.assertIn(self.SKU_LOW, stock_by_sku)
        self.assertEqual(stock_by_sku[self.SKU_LOW]["nivel_alerta"], "stock_critico")
        self.assertEqual(Decimal(stock_by_sku[self.SKU_LOW]["disponible"]), Decimal("5"))

        self.assertNotIn(self.SKU_HIGH, stock_by_sku)  # 40 u > 10
        self.assertNotIn(self.SKU_OK, stock_by_sku)    # 50 u vigentes > 10 (lote vencido no cuenta como disponible)
        self.assertEqual(alerts["summary"]["productos_agotados"], 1)
        self.assertEqual(alerts["summary"]["productos_stock_critico"], 1)

        lot_codes = [lot["codigo_lote"] for lot in alerts["alertas_lotes"]]
        self.assertEqual(
            lot_codes,
            [f"{self.LOT_PREFIX}EXP", f"{self.LOT_PREFIX}LOW"],
        )
        self.assertEqual(alerts["alertas_lotes"][0]["estado_vencimiento"], "vencido")
        self.assertEqual(alerts["alertas_lotes"][0]["dias_para_vencer"], -3)
        self.assertEqual(alerts["alertas_lotes"][1]["estado_vencimiento"], "proximo_a_vencer")
        self.assertEqual(alerts["alertas_lotes"][1]["dias_para_vencer"], 10)
        self.assertEqual(alerts["summary"]["lotes_vencidos"], 1)
        self.assertEqual(alerts["summary"]["lotes_proximos_a_vencer"], 1)


if __name__ == "__main__":
    unittest.main()
