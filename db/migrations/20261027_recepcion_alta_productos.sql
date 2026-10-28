-- Permite crear productos desde listas Excel que no traen código de barras.
ALTER TABLE producto ALTER COLUMN codigo_b DROP NOT NULL;

DROP INDEX IF EXISTS uq_producto_codigo_b_catalogo;
CREATE UNIQUE INDEX uq_producto_codigo_b_catalogo
    ON producto (codigo_b)
    WHERE eliminado = FALSE AND codigo_b IS NOT NULL;
