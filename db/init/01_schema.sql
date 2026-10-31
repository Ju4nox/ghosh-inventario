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

-- ---------- Pedidos y reservas ----------
CREATE TABLE pedido (
    id_pedido         SERIAL PRIMARY KEY,
    id_usuario        INTEGER NOT NULL REFERENCES usuario(id_usuario),
    id_estado_pedido  INTEGER NOT NULL REFERENCES estado_pedido(id_estado_pedido),
    clave_idempotencia VARCHAR(64) NOT NULL UNIQUE,
    fecha_creacion    TIMESTAMP NOT NULL DEFAULT NOW()
);

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
    fecha_expiracion  TIMESTAMP NOT NULL
);
CREATE INDEX idx_reserva_lote ON reserva (id_lote);

-- ---------- Notas de venta ----------
CREATE TABLE nota_venta (
    id_nota_venta SERIAL PRIMARY KEY,
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



