-- GHOSH · Esquema PostgreSQL (3FN)
-- Se ejecuta automáticamente la primera vez que se crea el volumen de datos.

CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- búsqueda por texto (GHOSH-6)

-- ---------- Tablas de catálogo ----------
CREATE TABLE rol (
    id_rol  SERIAL PRIMARY KEY,
    nombre  VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE categoria (
    id_categoria SERIAL PRIMARY KEY,
    nombre       VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE unidad_comercial (
    id_unidad SERIAL PRIMARY KEY,
    nombre    VARCHAR(30) NOT NULL UNIQUE,
    decimales SMALLINT NOT NULL DEFAULT 0 CHECK (decimales BETWEEN 0 AND 3)
);

CREATE TABLE estado_pedido (
    id_estado_pedido SERIAL PRIMARY KEY,
    nombre           VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE estado_reserva (
    id_estado_reserva SERIAL PRIMARY KEY,
    nombre            VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE tipo_movimiento (
    id_tipo SERIAL PRIMARY KEY,
    nombre  VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE bodega (
    id_bodega SERIAL PRIMARY KEY,
    nombre    VARCHAR(80) NOT NULL UNIQUE
);

-- ---------- Usuarios ----------
CREATE TABLE usuario (
    id_usuario    SERIAL PRIMARY KEY,
    id_rol        INTEGER NOT NULL REFERENCES rol(id_rol),
    nombre        VARCHAR(100) NOT NULL,
    correo        VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    activo               BOOLEAN NOT NULL DEFAULT TRUE,
    eliminado            BOOLEAN NOT NULL DEFAULT FALSE
);

-- ---------- Productos y lotes ----------
CREATE TABLE producto (
    id_producto          SERIAL PRIMARY KEY,
    sku                  VARCHAR(40)  NOT NULL,
    codigo_b             VARCHAR(20),
    nombre               VARCHAR(120) NOT NULL,
    peso                 NUMERIC(12,4) NOT NULL CHECK (peso >= 0),
    id_categoria         INTEGER NOT NULL REFERENCES categoria(id_categoria),
    id_unidad            INTEGER NOT NULL REFERENCES unidad_comercial(id_unidad),
    precio_vigente       NUMERIC(12,2) NOT NULL CHECK (precio_vigente >= 0),
    unidades_por_caja    INTEGER NOT NULL DEFAULT 5 CHECK (unidades_por_caja > 0),
    requiere_trazabilidad BOOLEAN NOT NULL DEFAULT FALSE,
    umbral_stock_critico NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (umbral_stock_critico >= 0),
    activo               BOOLEAN NOT NULL DEFAULT TRUE,
    eliminado            BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_producto_nombre_trgm ON producto USING gin (nombre gin_trgm_ops);
CREATE INDEX idx_producto_sku_trgm    ON producto USING gin (sku gin_trgm_ops);
CREATE INDEX idx_producto_categoria   ON producto (id_categoria);
CREATE UNIQUE INDEX uq_producto_sku_catalogo ON producto (sku) WHERE eliminado = FALSE;
CREATE UNIQUE INDEX uq_producto_codigo_b_catalogo ON producto (codigo_b) WHERE eliminado = FALSE AND codigo_b IS NOT NULL;

-- ---------- Auditoría de retiros y eliminaciones del catálogo ----------
CREATE TABLE auditoria_catalogo (
    id_auditoria    SERIAL PRIMARY KEY,
    id_producto     INTEGER NOT NULL REFERENCES producto(id_producto),
    sku_producto    VARCHAR(40) NOT NULL,
    nombre_producto VARCHAR(120) NOT NULL,
    accion          VARCHAR(20) NOT NULL CHECK (accion IN ('alta', 'retiro', 'eliminacion', 'merma')),
    id_usuario      INTEGER NOT NULL REFERENCES usuario(id_usuario),
    nombre_usuario  VARCHAR(100) NOT NULL,
    motivo          VARCHAR(300) NOT NULL,
    fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_auditoria_catalogo_producto_fecha ON auditoria_catalogo (id_producto, fecha DESC);
CREATE INDEX idx_auditoria_catalogo_sku_fecha ON auditoria_catalogo (sku_producto, fecha DESC);

CREATE TABLE lote (
    id_lote          SERIAL PRIMARY KEY,
    id_producto      INTEGER NOT NULL REFERENCES producto(id_producto),
    id_bodega        INTEGER NOT NULL REFERENCES bodega(id_bodega),
    codigo_lote      VARCHAR(40) NOT NULL,
    fecha_recepcion  DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE,
    cantidad_fisica  NUMERIC(12,3) NOT NULL CHECK (cantidad_fisica >= 0),
    UNIQUE (id_producto, id_bodega, codigo_lote),
    CHECK (fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_recepcion)
);
CREATE INDEX idx_lote_fefo ON lote (id_producto, fecha_vencimiento);

-- ---------- Clientes frecuentes (locales de destino de los pedidos) ----------
CREATE TABLE cliente_frecuente (
    id_cliente     SERIAL PRIMARY KEY,
    nombre_local   VARCHAR(120) NOT NULL,
    direccion      VARCHAR(200),
    activo         BOOLEAN NOT NULL DEFAULT TRUE,
    fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_cliente_frecuente_nombre ON cliente_frecuente (LOWER(nombre_local));

-- ---------- Correlativo de documentos (GHOSH-27) ----------
CREATE TABLE correlativo (
    tipo_documento VARCHAR(30) PRIMARY KEY,
    ultimo_numero  INTEGER NOT NULL DEFAULT 0 CHECK (ultimo_numero >= 0)
);

-- Entrega el siguiente número bloqueando la fila del correlativo hasta el fin
-- de la transacción: si la transacción se revierte, el número no se consume.
CREATE FUNCTION siguiente_correlativo(p_tipo VARCHAR) RETURNS INTEGER
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

-- ---------- Notas de venta ----------
CREATE TABLE nota_venta (
    id_nota_venta SERIAL PRIMARY KEY,
    numero        INTEGER NOT NULL UNIQUE,  -- correlativo único y sin saltos
    id_vendedor   INTEGER NOT NULL REFERENCES usuario(id_usuario),
    id_bodega     INTEGER NOT NULL REFERENCES bodega(id_bodega),
    fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
    total         NUMERIC(14,2) NOT NULL CHECK (total >= 0)
);

CREATE TABLE detalle_nota_venta (
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

-- ---------- Pedidos y reservas ----------
-- El pedido se genera a partir de la nota de venta (1 nota = 1 pedido) y queda
-- 'pendiente' hasta que se entrega en el local de destino.
CREATE TABLE pedido (
    id_pedido            SERIAL PRIMARY KEY,
    id_usuario           INTEGER NOT NULL REFERENCES usuario(id_usuario),
    id_estado_pedido     INTEGER NOT NULL REFERENCES estado_pedido(id_estado_pedido),
    clave_idempotencia   VARCHAR(64) NOT NULL UNIQUE,
    fecha_creacion       TIMESTAMP NOT NULL DEFAULT NOW(),
    id_nota_venta        INTEGER REFERENCES nota_venta(id_nota_venta),
    id_bodega            INTEGER REFERENCES bodega(id_bodega),
    id_cliente           INTEGER REFERENCES cliente_frecuente(id_cliente),
    nombre_local         VARCHAR(120) NOT NULL,  -- copia del nombre al momento del pedido
    direccion_entrega    TEXT,
    fecha_entrega        TIMESTAMPTZ,
    id_usuario_entrega   INTEGER REFERENCES usuario(id_usuario),
    motivo_anulacion     TEXT,
    fecha_anulacion      TIMESTAMPTZ,
    id_usuario_anulacion INTEGER REFERENCES usuario(id_usuario)
);
CREATE UNIQUE INDEX uq_pedido_nota_venta ON pedido (id_nota_venta) WHERE id_nota_venta IS NOT NULL;
CREATE INDEX idx_pedido_estado ON pedido (id_estado_pedido, fecha_creacion);

CREATE TABLE detalle_pedido (
    id_detalle        SERIAL PRIMARY KEY,
    id_pedido         INTEGER NOT NULL REFERENCES pedido(id_pedido) ON DELETE CASCADE,
    id_producto       INTEGER NOT NULL REFERENCES producto(id_producto),
    cantidad          NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
    precio_confirmado NUMERIC(12,2) NOT NULL CHECK (precio_confirmado >= 0),
    UNIQUE (id_pedido, id_producto)
);

CREATE TABLE reserva (
    id_reserva        SERIAL PRIMARY KEY,
    id_detalle        INTEGER NOT NULL REFERENCES detalle_pedido(id_detalle) ON DELETE CASCADE,
    id_lote           INTEGER NOT NULL REFERENCES lote(id_lote),
    id_estado_reserva INTEGER NOT NULL REFERENCES estado_reserva(id_estado_reserva),
    cantidad          NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
    fecha_expiracion  TIMESTAMP  -- NULL = sin vencimiento (reserva de una venta ya emitida)
);
CREATE INDEX idx_reserva_lote ON reserva (id_lote);

-- ---------- Movimientos auditables ----------
CREATE TABLE movimiento_inventario (
    id_movimiento SERIAL PRIMARY KEY,
    id_lote       INTEGER NOT NULL REFERENCES lote(id_lote),
    id_tipo       INTEGER NOT NULL REFERENCES tipo_movimiento(id_tipo),
    id_usuario    INTEGER NOT NULL REFERENCES usuario(id_usuario),
    id_pedido     INTEGER REFERENCES pedido(id_pedido),  -- opcional: solo cuando aplica
    id_nota_venta INTEGER REFERENCES nota_venta(id_nota_venta),
    cantidad      NUMERIC(12,3) NOT NULL,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    motivo        VARCHAR(200) NOT NULL
);
CREATE INDEX idx_mov_lote ON movimiento_inventario (id_lote, fecha);

-- ---------- Vistas de consulta de notas de venta ----------
CREATE OR REPLACE VIEW vw_nota_venta AS
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



