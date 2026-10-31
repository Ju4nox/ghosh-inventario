-- Actualiza un volumen antiguo sin reemplazar productos ni borrar historial.
-- Los productos que ya existían se archivan para que el catálogo visible quede vacío.
BEGIN;

ALTER TABLE producto
    ADD COLUMN IF NOT EXISTS codigo_b VARCHAR(20),
    ADD COLUMN IF NOT EXISTS peso NUMERIC(12,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unidades_por_caja INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE producto ALTER COLUMN codigo_b DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'producto_peso_check'
          AND conrelid = 'producto'::regclass
    ) THEN
        ALTER TABLE producto
            ADD CONSTRAINT producto_peso_check CHECK (peso >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'producto_unidades_por_caja_check'
          AND conrelid = 'producto'::regclass
    ) THEN
        ALTER TABLE producto
            ADD CONSTRAINT producto_unidades_por_caja_check CHECK (unidades_por_caja > 0);
    END IF;
END $$;

ALTER TABLE producto DROP CONSTRAINT IF EXISTS producto_sku_key;
ALTER TABLE producto DROP CONSTRAINT IF EXISTS producto_codigo_b_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_sku_catalogo
    ON producto (sku) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_codigo_b_catalogo
    ON producto (codigo_b) WHERE eliminado = FALSE AND codigo_b IS NOT NULL;

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

-- Registra la fase de archivo para que repetir esta migración no oculte
-- productos que se agreguen posteriormente.
CREATE TABLE IF NOT EXISTS ghosh_migration_log (
    version     VARCHAR(100) PRIMARY KEY,
    applied_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM ghosh_migration_log
        WHERE version = '20261027_esquema_actual_catalogo_vacio'
    ) THEN
        UPDATE producto SET eliminado = TRUE WHERE eliminado = FALSE;
        INSERT INTO ghosh_migration_log (version)
        VALUES ('20261027_esquema_actual_catalogo_vacio');
    END IF;
END $$;

COMMIT;
