-- GHOSH-9: trazabilidad de quién y por qué retira, elimina o registra merma de productos del catálogo.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS eliminado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS auditoria_catalogo (
    id_auditoria    SERIAL PRIMARY KEY,
    id_producto     INTEGER NOT NULL REFERENCES producto(id_producto),
    sku_producto    VARCHAR(40) NOT NULL,
    nombre_producto VARCHAR(120) NOT NULL,
    accion          VARCHAR(20) NOT NULL CHECK (accion IN ('retiro', 'eliminacion', 'merma')),
    id_usuario      INTEGER NOT NULL REFERENCES usuario(id_usuario),
    nombre_usuario  VARCHAR(100) NOT NULL,
    motivo          VARCHAR(300) NOT NULL,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE auditoria_catalogo DROP CONSTRAINT IF EXISTS auditoria_catalogo_accion_check;
ALTER TABLE auditoria_catalogo ADD CONSTRAINT auditoria_catalogo_accion_check
    CHECK (accion IN ('retiro', 'eliminacion', 'merma'));

CREATE INDEX IF NOT EXISTS idx_auditoria_catalogo_producto_fecha
    ON auditoria_catalogo (id_producto, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_catalogo_sku_fecha
    ON auditoria_catalogo (sku_producto, fecha DESC);
