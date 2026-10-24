"""Pruebas de integración de GET /productos (requieren PostgreSQL con 02_seed.sql cargado).

Con la base levantada (docker compose up -d), desde la raíz del repositorio:
    pip install -r requirements.txt -r requirements-dev.txt
    DATABASE_URL=postgresql://ghosh_user:TU_CLAVE@localhost:5432/ghosh python -m pytest -q
"""
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        if c.get("/health").status_code != 200:
            pytest.skip("No hay conexión a PostgreSQL")
        yield c


def skus(resp):
    return {i["sku"] for i in resp.json()["items"]}


def test_busca_por_nombre(client):
    r = client.get("/productos", params={"q": "arroz"})
    assert r.status_code == 200
    assert skus(r) == {"ARR-001"}


def test_busca_por_sku_sin_distinguir_mayusculas(client):
    r = client.get("/productos", params={"q": "lac-00"})
    assert skus(r) == {"LAC-001", "LAC-002"}


def test_filtra_por_categoria(client):
    r = client.get("/productos", params={"categoria": "lácteos"})
    assert skus(r) == {"LAC-001", "LAC-002"}


def test_combina_texto_y_categoria(client):
    r = client.get("/productos", params={"q": "leche", "categoria": "Lácteos"})
    assert skus(r) == {"LAC-001"}
    r = client.get("/productos", params={"q": "leche", "categoria": "Bebidas"})
    assert r.json()["total"] == 0


def test_incluye_unidad_y_disponible(client):
    item = client.get("/productos", params={"q": "ARR-001"}).json()["items"][0]
    assert item["unidad"] == "unidad"
    assert float(item["disponible"]) == 200.0


def test_disponible_suma_lotes_de_un_producto(client):
    item = client.get("/productos", params={"q": "LAC-001"}).json()["items"][0]
    assert float(item["disponible"]) == 200.0  # lotes de 80 + 120


def test_comodines_no_se_interpretan(client):
    assert client.get("/productos", params={"q": "%"}).json()["total"] == 0


def test_paginacion(client):
    r = client.get("/productos", params={"limit": 3, "offset": 0}).json()
    assert r["total"] == 7 and len(r["items"]) == 3
    r2 = client.get("/productos", params={"limit": 3, "offset": 6}).json()
    assert len(r2["items"]) == 1


def test_limit_invalido(client):
    assert client.get("/productos", params={"limit": 0}).status_code == 422
