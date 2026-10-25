# GHOSH · Sistema de inventario en tiempo real y pedidos en línea

Proyecto de Ingeniería de Software I (UCM). Base de datos PostgreSQL + API FastAPI.

## Levantar la base de datos
1. Copia `.env.example` como `.env` y ajusta la clave.
2. Ejecuta: `docker compose up -d`
3. Verifica: `docker compose ps` (debe aparecer `healthy`).

El esquema (`db/init/01_schema.sql`) y los datos de prueba (`db/init/02_seed.sql`) se cargan solos la primera vez.

## Importar el catálogo desde CSV
Envía el archivo como cuerpo `text/csv` UTF-8 al endpoint `POST /catalog/import`. El separador puede ser coma o punto y coma. La importación valida el archivo completo antes de insertar; si hay errores, no importa ninguna fila y devuelve HTTP 422 con el número de fila, campo, código y mensaje de cada problema.

Columnas obligatorias: `sku`, `nombre`, `categoria`, `unidad`, `precio_vigente`. Columnas opcionales: `requiere_trazabilidad` (por defecto `false`) y `umbral_stock_critico` (por defecto `0`). Los SKU deben ser únicos dentro del archivo y no existir ya en el catálogo. Las categorías y unidades deben existir previamente en las tablas `categoria` y `unidad_comercial`; los valores iniciales están en `db/init/02_seed.sql`. Precios usan punto decimal y admiten hasta dos decimales; el umbral admite hasta tres.

Ejemplo de envío desde la raíz del proyecto:

```sh
curl --data-binary @catalogo.csv -H "Content-Type: text/csv" http://localhost:8000/catalog/import
```

Ejemplo (`text/csv`):

```csv
sku,nombre,categoria,unidad,precio_vigente,requiere_trazabilidad,umbral_stock_critico
ARR-008,Harina sin polvos,Abarrotes,unidad,1250,false,10
```

Respuesta exitosa: `{"status":"imported","total_rows":1,"loaded":1,"errors":[]}`. Ante una fila inválida, el campo `errors` identifica cada error y `loaded` queda en cero.

## Reiniciar la base desde cero
`docker compose down -v && docker compose up -d`

## Flujo de trabajo
- Una rama por ticket: `feature/GHOSH-6-busqueda-catalogo`.
- Cambios a `main` solo mediante Pull Request revisado por otra persona.
- Nunca subir `.env` ni claves.
