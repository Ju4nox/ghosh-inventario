-- Los TIMESTAMP existentes fueron creados con la zona horaria UTC por defecto de PostgreSQL.
-- Interpretarlos como UTC conserva el instante real y permite mostrarlos en America/Santiago.
ALTER TABLE movimiento_inventario
    ALTER COLUMN fecha TYPE TIMESTAMPTZ
    USING fecha AT TIME ZONE 'UTC';
