-- GHOSH · Datos ficticios para desarrollo y pruebas (no usar en producción)

INSERT INTO rol (nombre) VALUES ('cliente'), ('ventas'), ('bodega'), ('gerencia');
INSERT INTO estado_pedido (nombre) VALUES ('pendiente'), ('aceptado'), ('preparado'), ('despachado'), ('cancelado'), ('expirado');
INSERT INTO estado_reserva (nombre) VALUES ('vigente'), ('consumida'), ('liberada'), ('expirada');
INSERT INTO tipo_movimiento (nombre) VALUES ('recepcion'), ('reserva'), ('despacho'), ('cancelacion'), ('ajuste');
INSERT INTO bodega (nombre) VALUES ('Bodega Central Talca');

INSERT INTO categoria (nombre) VALUES ('Abarrotes'), ('Lácteos'), ('Bebidas'), ('Congelados'), ('Snacks'), ('Lista de precios');
INSERT INTO unidad_comercial (nombre, decimales) VALUES ('unidad', 0), ('caja', 0), ('kilo', 3), ('litro', 2);

INSERT INTO usuario (id_rol, nombre, correo, password_hash) VALUES
 ((SELECT id_rol FROM rol WHERE nombre='cliente'), 'Cliente Demo',  'cliente@demo.cl',  'hash_demo'),
 ((SELECT id_rol FROM rol WHERE nombre='bodega'),  'Bodega Demo',   'bodega@demo.cl',   'hash_demo'),
 ((SELECT id_rol FROM rol WHERE nombre='ventas'),  'Ventas Demo',   'ventas@demo.cl',   'hash_demo'),
 ((SELECT id_rol FROM rol WHERE nombre='gerencia'),'Gerencia Demo', 'gerencia@demo.cl', 'hash_demo');

-- El catálogo parte vacío; los productos se agregan después mediante la aplicación.
