-- Marca productos retirados definitivamente del catálogo sin perder referencias históricas.
ALTER TABLE producto
    ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE producto DROP CONSTRAINT IF EXISTS producto_sku_key;
ALTER TABLE producto DROP CONSTRAINT IF EXISTS producto_codigo_b_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_sku_catalogo
    ON producto (sku) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_codigo_b_catalogo
    ON producto (codigo_b) WHERE eliminado = FALSE AND codigo_b IS NOT NULL;

