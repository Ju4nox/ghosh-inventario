# GHOSH · Sistema de inventario en tiempo real y pedidos en línea

Proyecto de Ingeniería de Software I (UCM). Base de datos PostgreSQL + API FastAPI.

## Levantar la base de datos
1. Copia `.env.example` como `.env` y ajusta la clave.
2. Ejecuta: `docker compose up -d`
3. Verifica: `docker compose ps` (debe aparecer `healthy`).

El esquema (`db/init/01_schema.sql`) y los datos de prueba (`db/init/02_seed.sql`) se cargan solos la primera vez.

## Reiniciar la base desde cero
`docker compose down -v && docker compose up -d`

## Flujo de trabajo
- Una rama por ticket: `feature/GHOSH-6-busqueda-catalogo`.
- Cambios a `main` solo mediante Pull Request revisado por otra persona.
- Nunca subir `.env` ni claves.
