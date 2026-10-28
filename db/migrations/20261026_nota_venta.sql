-- Ejecutar una vez en bases existentes. Es idempotente para permitir actualizar
-- instalaciones cuyo volumen ya fue inicializado antes de agregar notas de venta.
ALTER TABLE producto
    ADD COLUMN IF NOT EXISTS unidades_por_caja INTEGER NOT NULL DEFAULT 5;

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
