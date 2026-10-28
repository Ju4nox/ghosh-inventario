-- Sustituye el catálogo de prueba por los diez artículos de la lista de precios.
-- Esta migración elimina productos anteriores y los pedidos, reservas, notas,
-- lotes y movimientos asociados, tal como se autorizó para esta base de ejemplo.
BEGIN;

ALTER TABLE producto
    ADD COLUMN IF NOT EXISTS unidades_por_caja INTEGER NOT NULL DEFAULT 5;
ALTER TABLE producto
    ADD COLUMN IF NOT EXISTS codigo_b VARCHAR(20);
ALTER TABLE producto
    ADD COLUMN IF NOT EXISTS peso NUMERIC(12,4) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'producto_unidades_por_caja_check'
          AND conrelid = 'producto'::regclass
    ) THEN
        ALTER TABLE producto
            ADD CONSTRAINT producto_unidades_por_caja_check CHECK (unidades_por_caja > 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'producto_peso_check'
          AND conrelid = 'producto'::regclass
    ) THEN
        ALTER TABLE producto
            ADD CONSTRAINT producto_peso_check CHECK (peso >= 0);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS nota_venta (
    id_nota_venta SERIAL PRIMARY KEY,
    id_vendedor   INTEGER NOT NULL REFERENCES usuario(id_usuario),
    id_bodega     INTEGER NOT NULL REFERENCES bodega(id_bodega),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    total         NUMERIC(14,2) NOT NULL CHECK (total >= 0)
);

CREATE TABLE IF NOT EXISTS detalle_nota_venta (
    id_detalle_nota_venta SERIAL PRIMARY KEY,
    id_nota_venta         INTEGER NOT NULL REFERENCES nota_venta(id_nota_venta) ON DELETE CASCADE,
    id_producto           INTEGER NOT NULL REFERENCES producto(id_producto),
    cajas                 INTEGER NOT NULL DEFAULT 0 CHECK (cajas >= 0),
    sueltos               NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (sueltos >= 0),
    unidades_por_caja     INTEGER NOT NULL CHECK (unidades_por_caja > 0),
    cantidad_total        NUMERIC(12,3) NOT NULL CHECK (cantidad_total > 0),
    precio_confirmado     NUMERIC(12,2) NOT NULL CHECK (precio_confirmado >= 0),
    subtotal              NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    UNIQUE (id_nota_venta, id_producto),
    CHECK (cantidad_total = cajas * unidades_por_caja + sueltos)
);

ALTER TABLE movimiento_inventario
    ADD COLUMN IF NOT EXISTS id_nota_venta INTEGER REFERENCES nota_venta(id_nota_venta);

INSERT INTO categoria (nombre)
VALUES ('Lista de precios')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO unidad_comercial (nombre, decimales)
VALUES ('unidad', 0)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO bodega (nombre)
VALUES ('Bodega Central Talca')
ON CONFLICT (nombre) DO NOTHING;

-- Captura los registros vinculados a los productos del catálogo que se sustituye.
CREATE TEMP TABLE productos_reemplazados ON COMMIT DROP AS
    SELECT id_producto FROM producto;
CREATE TEMP TABLE lotes_reemplazados ON COMMIT DROP AS
    SELECT id_lote FROM lote
    WHERE id_producto IN (SELECT id_producto FROM productos_reemplazados);
CREATE TEMP TABLE pedidos_reemplazados ON COMMIT DROP AS
    SELECT DISTINCT id_pedido FROM detalle_pedido
    WHERE id_producto IN (SELECT id_producto FROM productos_reemplazados);
CREATE TEMP TABLE notas_reemplazadas ON COMMIT DROP AS
    SELECT DISTINCT id_nota_venta FROM detalle_nota_venta
    WHERE id_producto IN (SELECT id_producto FROM productos_reemplazados);

DELETE FROM movimiento_inventario
WHERE id_lote IN (SELECT id_lote FROM lotes_reemplazados)
   OR id_pedido IN (SELECT id_pedido FROM pedidos_reemplazados)
   OR id_nota_venta IN (SELECT id_nota_venta FROM notas_reemplazadas);
DELETE FROM reserva
WHERE id_lote IN (SELECT id_lote FROM lotes_reemplazados);
DELETE FROM detalle_nota_venta
WHERE id_producto IN (SELECT id_producto FROM productos_reemplazados);
DELETE FROM nota_venta
WHERE id_nota_venta IN (SELECT id_nota_venta FROM notas_reemplazadas);
DELETE FROM detalle_pedido
WHERE id_producto IN (SELECT id_producto FROM productos_reemplazados);
DELETE FROM pedido
WHERE id_pedido IN (SELECT id_pedido FROM pedidos_reemplazados);
DELETE FROM lote
WHERE id_lote IN (SELECT id_lote FROM lotes_reemplazados);
DELETE FROM producto
WHERE id_producto IN (SELECT id_producto FROM productos_reemplazados);

ALTER TABLE producto ALTER COLUMN codigo_b SET NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'producto_codigo_b_key'
          AND conrelid = 'producto'::regclass
    ) THEN
        ALTER TABLE producto
            ADD CONSTRAINT producto_codigo_b_key UNIQUE (codigo_b);
    END IF;
END $$;

INSERT INTO producto
    (sku, codigo_b, nombre, peso, id_categoria, id_unidad, precio_vigente,
     unidades_por_caja, requiere_trazabilidad, umbral_stock_critico)
VALUES
 ('TKA311001901','7804610400037','ATUN LOMITO EN AGUA',0.17,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),940,48,FALSE,0),
 ('TKA311001902','7804610400020','ATUN LOMITO EN ACEITE',0.17,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),940,48,FALSE,0),
 ('TKA311002004','7804610401256','MANTEQUILLA DE MANI',0.34,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1425,24,FALSE,0),
 ('TKA311002003','6972102831247','MANTEQUILLA DE MANI CROCANTE',0.34,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1425,24,FALSE,0),
 ('TKA311002002','6972102831674','MANTEQUILLA DE MANI CHOCOLATE',0.34,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1425,24,FALSE,0),
 ('TKA311002005','7804610400853','CREMA DE COCO',0.4,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1340,24,FALSE,0),
 ('TKA311002006','7804610400860','BATIDO DE COCO',0.4,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1150,24,FALSE,0),
 ('TKA311002007','7804610400365','LECHE CONDENSADA',0.39,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),915,48,FALSE,0),
 ('TKA311002008','7804610400341','LECHE EVAPORADA',0.39,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),685,48,FALSE,0),
 ('TKA311002999','7804610401720','LENTEJAS',0.4,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),635,24,FALSE,0);

INSERT INTO lote (id_producto, id_bodega, codigo_lote, fecha_recepcion, fecha_vencimiento, cantidad_fisica)
SELECT p.id_producto, b.id_bodega, v.codigo, CURRENT_DATE - 5, NULL, v.cantidad
FROM (VALUES
 ('TKA311001901','L-PRECIO-01',144),
 ('TKA311001902','L-PRECIO-02',48),
 ('TKA311002004','L-PRECIO-03',0),
 ('TKA311002003','L-PRECIO-04',12),
 ('TKA311002002','L-PRECIO-05',72),
 ('TKA311002005','L-PRECIO-06',24),
 ('TKA311002006','L-PRECIO-07',6),
 ('TKA311002007','L-PRECIO-08',0),
 ('TKA311002008','L-PRECIO-09',96),
 ('TKA311002999','L-PRECIO-10',24)
) AS v(sku, codigo, cantidad)
JOIN producto p ON p.sku = v.sku
JOIN bodega b ON b.nombre = 'Bodega Central Talca';

COMMIT;


