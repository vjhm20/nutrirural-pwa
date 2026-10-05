from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORT = 8765
BASE = f"http://127.0.0.1:{PORT}"


def request(path: str, *, method: str = "GET", payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=3) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def wait_ready(deadline=12):
    end = time.time() + deadline
    while time.time() < end:
        try:
            status, body = request("/api/health")
            if status == 200 and body.get("ok"):
                return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError("El servidor no inició dentro del tiempo esperado")


def main() -> None:
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_ready()
        status, health = request("/api/health")
        assert status == 200 and health["ok"] is True
        payload = {
            "deviceId": "test-device",
            "children": [{"id": "test-child", "code": "TEST-001", "updatedAt": "2026-01-01T00:00:00Z"}],
            "assessments": [{"id": "test-assessment", "childId": "test-child", "updatedAt": "2026-01-01T00:00:00Z"}],
            "surveys": [],
        }
        status, synced = request("/api/sync", method="POST", payload=payload)
        assert status == 200 and synced["total"] == 2
        status, stats = request("/api/stats")
        assert status == 200 and stats["children"] >= 1 and stats["assessments"] >= 1
        print("OK: API health, sync y stats operativas.")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


if __name__ == "__main__":
    main()
