"""Conexión a PostgreSQL (pool de conexiones compartido por toda la API)."""
import os

from psycopg_pool import ConnectionPool

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://ghosh_user:cambia_esta_clave@localhost:5432/ghosh",
)

# open=False: el pool se abre en el arranque de la API (ver main.py).
pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=False)
