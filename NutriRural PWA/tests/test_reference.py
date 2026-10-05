from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "app" / "data" / "who_reference.json"


def lms_z(value: float, row: dict) -> float:
    l, m, s = row["l"], row["m"], row["s"]
    if abs(l) < 1e-12:
        return math.log(value / m) / s
    return ((value / m) ** l - 1) / (l * s)


def find_row(rows: list[dict], x: float) -> dict:
    return next(row for row in rows if row["x"] == x)


def main() -> None:
    data = json.loads(REFERENCE.read_text(encoding="utf-8"))
    assert data["meta"]["source"].startswith("WHO Child Growth Standards")
    assert len(data["wfa"]["M"]) == 61
    assert len(data["wfa"]["F"]) == 61
    assert len(data["wfl"]["M"]) == 131
    assert len(data["wfh"]["F"]) == 111

    samples = [
        (data["wfa"]["M"], 0.0),
        (data["wfa"]["F"], 6.0),
        (data["hfa"]["M"], 24.0),
        (data["wfl"]["F"], 65.0),
        (data["wfh"]["M"], 90.0),
    ]
    for rows, x in samples:
        row = find_row(rows, x)
        assert abs(lms_z(row["m"], row)) < 1e-9, (x, row)
        assert row["n3"] < row["n2"] < row["n1"] < row["z0"] < row["p1"] < row["p2"] < row["p3"]

    print("OK: referencias OMS cargadas, rangos correctos y mediana LMS = z 0.")


if __name__ == "__main__":
    main()
