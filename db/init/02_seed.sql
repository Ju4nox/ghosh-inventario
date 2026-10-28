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

INSERT INTO producto
    (sku, codigo_b, nombre, peso, id_categoria, id_unidad, precio_vigente,
     unidades_por_caja, requiere_trazabilidad, umbral_stock_critico)
VALUES
 ('TKA311001901','7804610400037','ATUN LOMITO EN AGUA',0.17,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),940,48,FALSE,0),
 ('TKA311001902','7804610400020','ATUN LOMITO EN ACEITE',0.17,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),940,48,FALSE,0),
 ('TKA311002004','7804610401256','MANTEQUILLA DE MANI',0.34,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1425,24,FALSE,0),
 ('TKA311002003','6972102831247','MANTEQUILLA DE MANI CROCANTE',0.34,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1425,24,FALSE,0),
 ('TKA311002002','6972102831674','MANTEQUILLA DE MANI CHOCOLATE',0.34,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1425,24,FALSE,0),
 ('TKA311002005','7804610400853','CREMA DE COCO',0.4,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1340,24,FALSE,0),
 ('TKA311002006','7804610400860','BATIDO DE COCO',0.4,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),1150,24,FALSE,0),
 ('TKA311002007','7804610400365','LECHE CONDENSADA',0.39,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),915,48,FALSE,0),
 ('TKA311002008','7804610400341','LECHE EVAPORADA',0.39,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),685,48,FALSE,0),
 ('TKA311002999','7804610401720','LENTEJAS',0.4,
  (SELECT id_categoria FROM categoria WHERE nombre='Lista de precios'),
  (SELECT id_unidad FROM unidad_comercial WHERE nombre='unidad'),635,24,FALSE,0);

INSERT INTO lote (id_producto, id_bodega, codigo_lote, fecha_recepcion, fecha_vencimiento, cantidad_fisica)
SELECT p.id_producto, b.id_bodega, v.codigo, v.rec, v.venc, v.cant
FROM bodega b
JOIN (VALUES
 ('TKA311001901','L-PRECIO-01', CURRENT_DATE - 5, NULL::date, 144),
 ('TKA311001902','L-PRECIO-02', CURRENT_DATE - 5, NULL::date, 48),
 ('TKA311002004','L-PRECIO-03', CURRENT_DATE - 5, NULL::date, 0),
 ('TKA311002003','L-PRECIO-04', CURRENT_DATE - 5, NULL::date, 12),
 ('TKA311002002','L-PRECIO-05', CURRENT_DATE - 5, NULL::date, 72),
 ('TKA311002005','L-PRECIO-06', CURRENT_DATE - 5, NULL::date, 24),
 ('TKA311002006','L-PRECIO-07', CURRENT_DATE - 5, NULL::date, 6),
 ('TKA311002007','L-PRECIO-08', CURRENT_DATE - 5, NULL::date, 0),
 ('TKA311002008','L-PRECIO-09', CURRENT_DATE - 5, NULL::date, 96),
 ('TKA311002999','L-PRECIO-10', CURRENT_DATE - 5, NULL::date, 24)
) AS v(sku, codigo, rec, venc, cant) ON TRUE
JOIN producto p ON p.sku = v.sku
WHERE b.nombre = 'Bodega Central Talca';
