"""NutriRural MVP server.

Small FastAPI + SQLite service used by the offline-first web application.
It is suitable for an academic pilot on a trusted local network; it is not a
production clinical system and does not replace institutional security controls.
"""
from __future__ import annotations

import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
DATA_DIR = Path(os.environ.get("NUTRIRURAL_DATA_DIR", ROOT / "server_data"))
DB_PATH = DATA_DIR / "nutrirural.sqlite3"

DATA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="NutriRural API",
    description="API local de sincronización para el prototipo académico NutriRural.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class SyncPayload(BaseModel):
    deviceId: str = Field(default="unknown-device", max_length=200)
    children: list[dict[str, Any]] = Field(default_factory=list)
    assessments: list[dict[str, Any]] = Field(default_factory=list)
    surveys: list[dict[str, Any]] = Field(default_factory=list)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_db() -> None:
    with connect() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS sync_records (
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                device_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                client_updated_at TEXT,
                server_updated_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (entity_type, entity_id)
            );
            CREATE INDEX IF NOT EXISTS idx_sync_records_type
                ON sync_records(entity_type);
            CREATE INDEX IF NOT EXISTS idx_sync_records_server_updated
                ON sync_records(server_updated_at);
            CREATE TABLE IF NOT EXISTS sync_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL,
                received_at TEXT NOT NULL,
                children_count INTEGER NOT NULL,
                assessments_count INTEGER NOT NULL,
                surveys_count INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS server_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )


def identidad_de_la_base() -> str:
    """Devuelve el identificador de esta copia de la base de datos.

    Se genera una sola vez, cuando la base se crea, y acompana desde entonces a
    todas las respuestas. Si el servicio se reinicia sobre un almacenamiento que
    no conserva los archivos -como ocurre en los planes gratuitos de alojamiento-
    la base vuelve a crearse vacia y recibe un identificador nuevo. Los
    dispositivos comparan ese valor con el que guardaron: cuando cambia saben que
    el servidor perdio su copia y reenvian todo lo que tienen, de modo que la
    informacion se reconstruye sola a partir de los equipos de campo.
    """
    with connect() as con:
        fila = con.execute("SELECT value FROM server_meta WHERE key = 'server_id'").fetchone()
        if fila:
            return fila["value"]
        nuevo = uuid.uuid4().hex
        con.execute("INSERT INTO server_meta(key, value) VALUES ('server_id', ?)", (nuevo,))
    return nuevo


def migrar_columna_deleted() -> None:
    """Agrega la columna de baja logica a bases creadas con la version anterior."""
    with connect() as con:
        columnas = {row["name"] for row in con.execute("PRAGMA table_info(sync_records)")}
        if "deleted" not in columnas:
            con.execute("ALTER TABLE sync_records ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")


@app.on_event("startup")
def startup() -> None:
    init_db()
    migrar_columna_deleted()
    identidad_de_la_base()


def upsert_records(
    con: sqlite3.Connection,
    entity_type: str,
    records: list[dict[str, Any]],
    device_id: str,
) -> list[str]:
    synced: list[str] = []
    server_time = now_iso()
    for record in records:
        entity_id = str(record.get("id", "")).strip()
        if not entity_id:
            raise HTTPException(status_code=422, detail=f"Registro {entity_type} sin id")
        payload = json.dumps(record, ensure_ascii=False, separators=(",", ":"))
        client_updated = str(record.get("updatedAt") or record.get("createdAt") or "")
        # El cliente da de baja de forma logica: el registro llega marcado y aqui
        # se conserva, pero deja de exportarse y de contarse.
        deleted = 1 if record.get("deleted") else 0
        con.execute(
            """
            INSERT INTO sync_records(
                entity_type, entity_id, device_id, payload_json,
                client_updated_at, server_updated_at, deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET
                device_id=excluded.device_id,
                payload_json=excluded.payload_json,
                client_updated_at=excluded.client_updated_at,
                server_updated_at=excluded.server_updated_at,
                deleted=excluded.deleted
            """,
            (entity_type, entity_id, device_id, payload, client_updated, server_time, deleted),
        )
        synced.append(entity_id)
    return synced


@app.get("/api/health")
def health() -> dict[str, Any]:
    with connect() as con:
        total = con.execute("SELECT COUNT(*) AS n FROM sync_records WHERE deleted = 0").fetchone()["n"]
    return {
        "ok": True,
        "service": "NutriRural API",
        "version": app.version,
        "serverTime": now_iso(),
        "serverId": identidad_de_la_base(),
        "storedRecords": total,
    }


@app.post("/api/sync")
def sync(payload: SyncPayload) -> dict[str, Any]:
    with connect() as con:
        children = upsert_records(con, "children", payload.children, payload.deviceId)
        assessments = upsert_records(con, "assessments", payload.assessments, payload.deviceId)
        surveys = upsert_records(con, "surveys", payload.surveys, payload.deviceId)
        con.execute(
            """
            INSERT INTO sync_events(
                device_id, received_at, children_count,
                assessments_count, surveys_count
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                payload.deviceId,
                now_iso(),
                len(children),
                len(assessments),
                len(surveys),
            ),
        )
    return {
        "ok": True,
        "syncedAt": now_iso(),
        "synced": {
            "children": children,
            "assessments": assessments,
            "surveys": surveys,
        },
        "total": len(children) + len(assessments) + len(surveys),
    }


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    with connect() as con:
        rows = con.execute(
            "SELECT entity_type, COUNT(*) AS n FROM sync_records WHERE deleted = 0 GROUP BY entity_type"
        ).fetchall()
        events = con.execute("SELECT COUNT(*) AS n FROM sync_events").fetchone()["n"]
    counts = {row["entity_type"]: row["n"] for row in rows}
    return {
        "ok": True,
        "children": counts.get("children", 0),
        "assessments": counts.get("assessments", 0),
        "surveys": counts.get("surveys", 0),
        "syncEvents": events,
    }


@app.get("/api/export")
def export_records() -> JSONResponse:
    output: dict[str, list[dict[str, Any]]] = {
        "children": [],
        "assessments": [],
        "surveys": [],
    }
    with connect() as con:
        rows = con.execute(
            "SELECT entity_type, payload_json FROM sync_records WHERE deleted = 0 ORDER BY entity_type, entity_id"
        ).fetchall()
    for row in rows:
        output.setdefault(row["entity_type"], []).append(json.loads(row["payload_json"]))
    return JSONResponse({"exportedAt": now_iso(), **output})


@app.get("/api/pull")
def pull_records(since: str = "") -> dict[str, Any]:
    """Entrega los registros consolidados para que un dispositivo se ponga al dia.

    El parametro since acota la respuesta a lo que cambio en el servidor despues
    de esa marca de tiempo, de modo que la puesta al dia sea incremental. Los
    registros dados de baja tambien viajan, con su marca puesta, para que la
    baja se propague a los demas dispositivos.
    """
    salida: dict[str, list[dict[str, Any]]] = {
        "children": [],
        "assessments": [],
        "surveys": [],
    }
    consulta = "SELECT entity_type, payload_json FROM sync_records"
    parametros: list[Any] = []
    if since:
        consulta += " WHERE server_updated_at > ?"
        parametros.append(since)
    consulta += " ORDER BY server_updated_at"
    with connect() as con:
        filas = con.execute(consulta, parametros).fetchall()
    for fila in filas:
        if fila["entity_type"] in salida:
            salida[fila["entity_type"]].append(json.loads(fila["payload_json"]))
    return {"ok": True, "serverTime": now_iso(), "serverId": identidad_de_la_base(), **salida}


@app.get("/api")
def api_info() -> dict[str, Any]:
    return {
        "name": "NutriRural API",
        "endpoints": ["/api/health", "/api/sync", "/api/pull", "/api/stats", "/api/export"],
        "warning": "Prototipo académico, no destinado a uso clínico en producción.",
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(APP_DIR / "index.html")


app.mount("/", StaticFiles(directory=APP_DIR, html=True), name="app")


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("server:app", host=host, port=port, reload=False)
