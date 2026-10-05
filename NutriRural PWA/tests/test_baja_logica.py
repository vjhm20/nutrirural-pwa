"""Verifica que la baja logica viaje al servidor y deje de exportarse.

Requiere fastapi y httpx instalados:
    pip install -r requirements.txt httpx
Uso:
    python3 tests/test_baja_logica.py
"""
from __future__ import annotations

import pathlib
import shutil
import sys

from fastapi.testclient import TestClient

RAIZ = pathlib.Path(__file__).resolve().parents[1]
shutil.rmtree(RAIZ / "server_data", ignore_errors=True)
sys.path.insert(0, str(RAIZ))
import server  # noqa: E402

cliente = TestClient(server.app)
resultados: list[tuple[str, bool, str]] = []


def check(nombre: str, condicion: bool, detalle: str = "") -> None:
    resultados.append((nombre, condicion, detalle))


with cliente:
    r = cliente.post("/api/sync", json={
        "deviceId": "disp-1",
        "children": [
            {"id": "c1", "code": "11111111", "firstName": "Ana", "updatedAt": "2026-08-26T10:00:00Z"},
            {"id": "c2", "code": "22222222", "firstName": "Luis", "updatedAt": "2026-08-26T10:00:00Z"},
        ],
        "assessments": [{"id": "a1", "childId": "c1", "date": "2026-08-26", "updatedAt": "2026-08-26T10:00:00Z"}],
        "surveys": [],
    })
    check("El servidor acepta el lote inicial", r.status_code == 200 and r.json()["total"] == 3, str(r.status_code))

    s = cliente.get("/api/stats").json()
    check("Cuenta dos ninos y un control", s["children"] == 2 and s["assessments"] == 1, str(s))

    r = cliente.post("/api/sync", json={
        "deviceId": "disp-1",
        "children": [{"id": "c1", "code": "11111111", "firstName": "Ana", "deleted": True,
                      "deletedAt": "2026-08-26T12:00:00Z", "updatedAt": "2026-08-26T12:00:00Z"}],
        "assessments": [{"id": "a1", "childId": "c1", "date": "2026-08-26", "deleted": True,
                         "updatedAt": "2026-08-26T12:00:00Z"}],
        "surveys": [],
    })
    check("El servidor acepta la baja", r.status_code == 200, str(r.status_code))

    s = cliente.get("/api/stats").json()
    check("Las estadisticas dejan de contar el registro dado de baja",
          s["children"] == 1 and s["assessments"] == 0, str(s))

    ids = [c["id"] for c in cliente.get("/api/export").json()["children"]]
    check("La exportacion excluye el registro dado de baja", ids == ["c2"], str(ids))

    h = cliente.get("/api/health").json()
    check("El estado de salud cuenta solo registros vigentes", h["storedRecords"] == 1, str(h["storedRecords"]))

    with server.connect() as con:
        fila = con.execute("SELECT deleted FROM sync_records WHERE entity_id='c1'").fetchone()
    check("El registro se conserva marcado, no se borra de la base",
          fila is not None and fila["deleted"] == 1, "" if fila else "no existe la fila")

print("\n=== BAJA LOGICA EN EL SERVIDOR ===")
for nombre, condicion, detalle in resultados:
    marca = "OK    | " if condicion else "FALLA | "
    print(marca + nombre + (f"  ({detalle})" if detalle and not condicion else ""))
print(f"\n{sum(1 for _, c, _ in resultados if c)} de {len(resultados)} comprobaciones correctas.")
sys.exit(0 if all(c for _, c, _ in resultados) else 1)
