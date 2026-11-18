-- GHOSH-27 / GHOSH-28 · Pedido generado a partir de la nota de venta.
-- Ejecutar una vez en bases existentes. Es idempotente.
--
-- Flujo: el vendedor emite la nota de venta en el local (número correlativo
-- único, sin saltos) y, en la misma transacción, el sistema genera el pedido
-- ligado a esa nota en estado 'pendiente', reservando stock por FEFO. Cuando el
-- pedido se entrega, la reserva se consume y se descuentan las existencias.
--
-- Aplicar con:
--   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /migrations/20261112_pedido_desde_nota_venta.sql'

BEGIN;

-- ---------- Estado de pedido entregado ----------
INSERT INTO estado_pedido (nombre) VALUES ('entregado') ON CONFLICT (nombre) DO NOTHING;

-- ---------- Clientes frecuentes (locales de destino) ----------
CREATE TABLE IF NOT EXISTS cliente_frecuente (
    id_cliente     SERIAL PRIMARY KEY,
    nombre_local   VARCHAR(120) NOT NULL,
    direccion      VARCHAR(200),
    activo         BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cliente_frecuente_nombre ON cliente_frecuente (LOWER(nombre_local));

-- ---------- Correlativo de documentos (sin saltos) ----------
CREATE TABLE IF NOT EXISTS correlativo (
    tipo_documento VARCHAR(30) PRIMARY KEY,
    ultimo_numero  INTEGER NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0)
);

-- Entrega el siguiente número bloqueando la fila del correlativo hasta el fin
-- de la transacción: si la transacción se revierte, el número no se consume.
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

-- ---------- Número correlativo de la nota de venta ----------
ALTER TABLE nota_venta ADD COLUMN IF NOT EXISTS numero INTEGER;

-- Las notas ya emitidas reciben números consecutivos según su orden de creación.
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

-- ---------- Pedido ligado a la nota de venta ----------
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

UPDATE pedido SET nombre_local = '(sin local)' WHERE nombre_local IS NULL;
ALTER TABLE pedido ALTER COLUMN nombre_local SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_nota_venta ON pedido (id_nota_venta) WHERE id_nota_venta IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedido_estado ON pedido (id_estado_pedido, fecha_creacion);

-- ---------- Reservas sin expiración ----------
-- Las reservas de un pedido nacido de una nota de venta no expiran: la venta ya
-- está hecha. NULL en fecha_expiracion significa "sin vencimiento".
ALTER TABLE reserva ALTER COLUMN fecha_expiracion DROP NOT NULL;

-- ---------- Vistas de consulta de notas de venta ----------
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

CREATE OR REPLACE VIEW vista_nota_venta AS
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

COMMIT;
