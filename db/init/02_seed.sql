-- GHOSH · Datos ficticios para desarrollo y pruebas (no usar en producción)

INSERT INTO rol (nombre) VALUES ('cliente'), ('ventas'), ('bodega'), ('gerencia');
INSERT INTO estado_pedido (nombre) VALUES ('pendiente'), ('aceptado'), ('preparado'), ('despachado'), ('cancelado'), ('expirado');
INSERT INTO estado_reserva (nombre) VALUES ('vigente'), ('consumida'), ('liberada'), ('expirada');
INSERT INTO tipo_movimiento (nombre) VALUES ('recepcion'), ('reserva'), ('despacho'), ('cancelacion'), ('ajuste');
INSERT INTO bodega (nombre) VALUES ('Bodega Central Talca');

INSERT INTO categoria (nombre) VALUES ('Abarrotes'), ('Lácteos'), ('Bebidas'), ('Congelados'), ('Snacks');
INSERT INTO unidad_comercial (nombre, decimales) VALUES ('unidad', 0), ('caja', 0), ('kilo', 3), ('litro', 2);

INSERT INTO usuario (id_rol, nombre, correo, password_hash) VALUES
 ((SELECT id_rol FROM rol WHERE nombre='cliente'), 'Cliente Demo',  'cliente@demo.cl',  'hash_demo'),
 ((SELECT id_rol FROM rol WHERE nombre='bodega'),  'Bodega Demo',   'bodega@demo.cl',   'hash_demo'),
 ((SELECT id_rol FROM rol WHERE nombre='ventas'),  'Ventas Demo',   'ventas@demo.cl',   'hash_demo'),
 ((SELECT id_rol FROM rol WHERE nombre='gerencia'),'Gerencia Demo', 'gerencia@demo.cl', 'hash_demo');

INSERT INTO producto (sku, nombre, id_categoria, id_unidad, precio_vigente, requiere_trazabilidad, umbral_stock_critico) VALUES
 ('ARR-001','Arroz grado 1 1 kg',        (SELECT id_categoria FROM categoria WHERE nombre='Abarrotes'), (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'), 1490, FALSE, 50),
 ('ARR-002','Fideos espagueti 400 g',    (SELECT id_categoria FROM categoria WHERE nombre='Abarrotes'), (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),  990, FALSE, 60),
 ('LAC-001','Leche entera 1 L',          (SELECT id_categoria FROM categoria WHERE nombre='Lácteos'),   (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'), 1090, TRUE,  40),
 ('LAC-002','Yogurt frutilla 150 g',     (SELECT id_categoria FROM categoria WHERE nombre='Lácteos'),   (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),  450, TRUE,  80),
 ('BEB-001','Bebida cola 2 L',           (SELECT id_categoria FROM categoria WHERE nombre='Bebidas'),   (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'), 2190, FALSE, 30),
 ('CON-001','Pechuga de pollo congelada',(SELECT id_categoria FROM categoria WHERE nombre='Congelados'),(SELECT id_unidad FROM unidad_comercial WHERE nombre='kilo'),   5990, TRUE,  20),
 ('SNK-001','Papas fritas 150 g',        (SELECT id_categoria FROM categoria WHERE nombre='Snacks'),    (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'), 1790, FALSE, 25);

INSERT INTO lote (id_producto, id_bodega, codigo_lote, fecha_recepcion, fecha_vencimiento, cantidad_fisica)
SELECT p.id_producto, b.id_bodega, v.codigo, v.rec, v.venc, v.cant
FROM bodega b
JOIN (VALUES
 ('ARR-001','L-ARR-2610', CURRENT_DATE - 10, NULL::date,            200),
 ('ARR-002','L-FID-2610', CURRENT_DATE - 10, NULL::date,            300),
 ('LAC-001','L-LEC-A',    CURRENT_DATE - 5,  CURRENT_DATE + 10,      80),
 ('LAC-001','L-LEC-B',    CURRENT_DATE - 2,  CURRENT_DATE + 25,     120),
 ('LAC-002','L-YOG-A',    CURRENT_DATE - 4,  CURRENT_DATE + 7,      150),
 ('BEB-001','L-BEB-2610', CURRENT_DATE - 8,  NULL::date,             90),
 ('CON-001','L-POL-A',    CURRENT_DATE - 6,  CURRENT_DATE + 60,      45),
 ('SNK-001','L-SNK-2610', CURRENT_DATE - 3,  NULL::date,             70)
) AS v(sku, codigo, rec, venc, cant) ON TRUE
JOIN producto p ON p.sku = v.sku
WHERE b.nombre = 'Bodega Central Talca';
