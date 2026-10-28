# GHOSH · Sistema de inventario, pedidos y notas de venta

Proyecto de Ingeniería de Software I (UCM). Base de datos PostgreSQL y API FastAPI.

## Levantar la base de datos

1. Copia `.env.example` como `.env` y ajusta la clave.
2. Ejecuta `docker compose up -d`.
3. Verifica `docker compose ps` y espera a que la base aparezca como `healthy`.

El esquema (`db/init/01_schema.sql`) y los datos de prueba (`db/init/02_seed.sql`) se cargan automáticamente la primera vez que se crea el volumen.

## Interfaz web

Con los servicios levantados, abre `http://localhost:8000/`. **Catálogo** presenta los campos de la lista de precios y el stock disponible: Código I, Código B, Artículo, Peso, Unidad x caja, Stock, Precio x unidad y Precio con IVA. El stock menor a 10 aparece en rojo. Desde el catálogo se puede retirar un artículo o reactivar uno retirado. Un artículo retirado se puede eliminar del catálogo para liberar sus códigos I/B; el registro, los lotes y los movimientos auditables se conservan en PostgreSQL, pero ya no se muestra ni se puede usar en ventas o recepciones. **Nota de venta** permite combinar cajas y productos sueltos por artículo. **Recepción** registra entradas de mercadería y **Movimientos** muestra el historial auditable.

Las rutas `/catalog/products` y `/inventory/movements` son APIs consumidas por la interfaz.

## Actualizar una base existente para eliminar artículos del catálogo

La migración db/migrations/20261027_eliminar_catalogo.sql agrega la marca de eliminación y permite reutilizar Código I y Código B solo después de eliminar el artículo. La eliminación se ofrece para productos retirados y conserva sus lotes, movimientos y referencias históricas en PostgreSQL.

Con Docker Compose iniciado, aplícala una vez con:

    docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /migrations/20261027_eliminar_catalogo.sql'

## Crear productos durante una recepción desde Excel

La opción Lista de precios Excel crea automáticamente los artículos cuyo Código I no exista y luego registra su recepción. Requiere Código I, ARTICULO, PESO, UNIDAD X CAJA y PRECIO X UNIDAD; Código B puede venir vacío. Los productos existentes no se modifican: la cantidad de una caja se suma al inventario. Los artículos nuevos usan la categoría Lista de precios, la unidad unidad y trazabilidad desactivada por defecto.

En una base existente, aplica primero la migración de eliminación del catálogo si aún no está aplicada y luego db/migrations/20261027_recepcion_alta_productos.sql:

    docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /migrations/20261027_recepcion_alta_productos.sql'

El CSV estructurado de recepción se mantiene para artículos ya registrados porque sus columnas solo contienen Código I, lote y cantidad; no tiene los atributos necesarios para crear el artículo.

## Importar lista de precios desde CSV

Envía el archivo UTF-8 como cuerpo `text/csv` a `POST /catalog/import`. Se acepta coma o punto y coma. La importación valida el archivo completo antes de escribir; ante errores, devuelve HTTP 422 con el número de fila, campo y motivo. Un archivo válido inserta o actualiza por Código I; el endpoint no elimina productos omitidos del CSV.

Columnas obligatorias (y únicas admitidas):

`codigo_i,codigo_b,articulo,peso,unidades_por_caja,precio_por_unidad,precio_con_iva`

El precio con IVA debe coincidir con el precio por unidad más 19%, redondeado a dos decimales. La plantilla de diez artículos es `catalogo-valido.csv`; `catalogo-prueba.csv` incluye una fila deliberadamente inválida para comprobar la validación.

```sh
curl --data-binary @catalogo-valido.csv -H "Content-Type: text/csv" http://localhost:8000/catalog/import
```

La respuesta exitosa incluye `status`, `total_rows` y `loaded`.

## Registrar recepción de mercadería

La API registra la cantidad recibida en el lote y agrega un movimiento auditable en la misma transacción. Requiere Código I existente, bodega, código de lote, cantidad positiva y usuario activo con rol `bodega`. Si el producto requiere trazabilidad, `fecha_vencimiento` es obligatoria; para otros productos se acepta si corresponde. Al recibir el mismo código de lote para un producto y bodega, se suma la cantidad cuando coincide la fecha de vencimiento; una fecha distinta produce HTTP 409.

Ejemplo con los datos iniciales (`Bodega Central Talca`: ID 1; usuario `Bodega Demo`: ID 2):

```sh
curl -i -X POST http://localhost:8000/inventory/receipts \
  -H "Content-Type: application/json" \
  -d '{"sku":"TKA311001901","id_bodega":1,"codigo_lote":"L-ATUN-NUEVO","cantidad":12,"id_usuario":2,"motivo":"Recepción de proveedor"}'
```

La interfaz web también incluye **Recepción**, con captura individual y carga masiva. El CSV es una alternativa, no un requisito: usa las columnas **sku**, **codigo_lote**, **cantidad** y, opcionalmente, **fecha_vencimiento** y **motivo**. Acepta UTF-8, coma o punto y coma, hasta 1.000 filas y 5 MiB. La carga completa se revierte si una fila falla; **POST /inventory/receipts/import** recibe id_bodega e id_usuario como parámetros comunes.

En **Lista de precios Excel** se puede cargar un archivo .xlsx del formato de GHOSH. La interfaz detecta hojas con las columnas ARTICULO y UNIDAD X CAJA, permite elegir la hoja y muestra una vista previa antes de registrar. Se recibe **una caja por artículo**, usando como cantidad el valor de UNIDAD X CAJA. Los artículos deben existir previamente en el catálogo y se identifican por Código I, Código B o por nombre cuando la coincidencia es única. Si la planilla no tiene un lote, el sistema crea un código interno XLS-<referencia>-<fila> y avisa que no equivale al lote del proveedor. Los productos con trazabilidad requieren una fecha de vencimiento de la planilla o una fecha común ingresada en el formulario. La API ofrece **POST /inventory/receipts/excel/preview** para analizar sin escribir y **POST /inventory/receipts/excel/import** para confirmar la carga; este último exige aceptar el lote interno. La importación es atómica y admite hasta 1.000 filas / 5 MiB.

El importador Excel agrega openpyxl a las dependencias de la API. Para instalarlo en un entorno Docker existente, reconstruye el servicio con **docker compose up -d --build api**.

## Registrar una nota de venta

En **Nota de venta**, selecciona un vendedor activo y la bodega de salida. Ingresa por producto las cajas completas o unidades sueltas; el sumario muestra únicamente los artículos seleccionados. La capacidad por caja se toma de la lista de precios: en estos diez ejemplos es de 24 o 48 unidades, según el artículo.

Al registrar la nota, el sistema valida el stock de la bodega, descuenta primero los lotes más próximos a vencer y guarda movimientos de despacho asociados a la nota. La nota y sus descuentos se confirman en una sola transacción: si falta stock para alguna línea, no se registra ninguna. Después de guardar, se puede imprimir el comprobante.

La API ofrece `GET /sales/options` para listar vendedores y bodegas, y `POST /sales/notes` para registrar la venta. Ejemplo:

```json
{
  "id_vendedor": 3,
  "id_bodega": 1,
  "items": [
    {"sku":"TKA311001901","cajas":1,"sueltos":2},
    {"sku":"TKA311002004","cajas":0,"sueltos":3}
  ]
}
```

## Actualizar una base existente al catálogo de la lista de precios

La migración `db/migrations/20261026_catalogo_lista_precios.sql` sustituye el catálogo de ejemplo por los diez artículos de la lista y crea lotes de demostración en distintos estados, incluidos dos artículos agotados y otros con stock bajo. También elimina los pedidos, reservas, notas de venta, lotes y movimientos ligados al catálogo anterior. **Esta operación borra el historial de inventario y ventas que esté ligado a esos productos**, por lo que úsala solo en la base de ejemplo que se pretende reemplazar.

Con Docker Compose iniciado, aplícala una vez con:

```sh
docker compose up -d db
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /migrations/20261026_catalogo_lista_precios.sql'
```

Las bases nuevas reciben los datos de ejemplo desde `db/init/02_seed.sql` y no necesitan esta migración.

## Consultar historial de movimientos

`GET /inventory/movements` devuelve los movimientos más recientes, con un máximo de 100 por página. Permite filtrar por Código I (`sku` en la API), código de lote o ambos. Cada registro incluye producto, lote, bodega, tipo, cantidad, fecha, motivo, usuario y pedido o nota de venta cuando aplica. Usa `limit` y `offset` para recorrer páginas.

```sh
curl "http://localhost:8000/inventory/movements?sku=TKA311001901"
curl "http://localhost:8000/inventory/movements?sku=TKA311001901&codigo_lote=L-ATUN-A&limit=20&offset=0"
```

## Reiniciar la base desde cero

`docker compose down -v && docker compose up -d`

## Flujo de trabajo

- Una rama por ticket: `feature/GHOSH-6-busqueda-catalogo`.
- Cambios a `main` solo mediante Pull Request revisado por otra persona.
- Nunca subir `.env` ni claves.









