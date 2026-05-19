from __future__ import annotations

import csv
import re
from http import HTTPStatus
from pathlib import Path

import h5py

DATA_ROOT = Path("/storage/czw/mgh_focal_h5s_scaled")
PORT = 8739
SNIPPET_SAMPLE_RATE = 1024
SNIPPET_COUNT = 5
H5_PREVIEW_ITEMS = 16
H5_SMALL_DATASET_LIMIT = 100_000
QUALITY_MAX_POINTS = 5000

SUBJECT_RE = re.compile(r"^\d+$")
HASH_RE = re.compile(r"^[A-Za-z0-9_-]+_scaled$")
CHANNEL_RE = re.compile(r"^\d+$")


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def subject_path(subject: str) -> Path:
    if not SUBJECT_RE.match(subject):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Subject must be numeric")
    path = DATA_ROOT / subject
    if not path.is_dir():
        raise ApiError(HTTPStatus.NOT_FOUND, f"Subject {subject} was not found")
    return path


def file_stem(raw_stem: str) -> str:
    stem = raw_stem[:-4] if raw_stem.endswith(".csv") else raw_stem
    if not stem.endswith("_scaled"):
        stem = f"{stem}_scaled"
    if not HASH_RE.match(stem):
        raise ApiError(HTTPStatus.BAD_REQUEST, "File must be a valid *_scaled.h5 entry")
    return stem


def data_paths(subject: str, raw_stem: str, require_csv: bool = False) -> tuple[Path | None, Path]:
    directory = subject_path(subject)
    stem = file_stem(raw_stem)
    csv_path = directory / f"{stem}.csv"
    h5_path = directory / f"{stem}.h5"
    if require_csv and not csv_path.is_file():
        raise ApiError(HTTPStatus.NOT_FOUND, f"Channel CSV not found: {csv_path.name}")
    if not h5_path.is_file():
        raise ApiError(HTTPStatus.NOT_FOUND, f"H5 data file not found: {h5_path.name}")
    return csv_path if csv_path.is_file() else None, h5_path


def list_subjects() -> list[str]:
    return sorted(
        [p.name for p in DATA_ROOT.iterdir() if p.is_dir() and SUBJECT_RE.match(p.name)],
        key=lambda value: int(value),
    )


def list_files(subject: str) -> list[dict[str, object]]:
    directory = subject_path(subject)
    files = []
    for h5_path in sorted(directory.glob("*_scaled.h5")):
        csv_path = h5_path.with_suffix(".csv")
        files.append(
            {
                "id": h5_path.stem,
                "csv": csv_path.name if csv_path.exists() else "",
                "h5": h5_path.name,
                "has_csv": csv_path.exists(),
            }
        )
    return files


def read_channels(subject: str, raw_stem: str) -> list[dict[str, object]]:
    csv_path, h5_path = data_paths(subject, raw_stem)
    if csv_path is not None:
        channels = []
        with csv_path.open(newline="") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                if row.get("is_ieeg", "").strip().lower() != "true":
                    continue
                channels.append(
                    {
                        "id": int(row["id"]),
                        "edf_ch": row.get("edf_ch", ""),
                        "correct_ch": row.get("correct_ch", ""),
                        "is_ieeg": row.get("is_ieeg", ""),
                    }
                )
        return channels

    with h5py.File(h5_path, "r") as h5_file:
        channel_ids = []
        for name in h5_file["data"].keys():
            if name.startswith("channel_"):
                channel_ids.append(int(name.split("_", 1)[1]))

    return [
        {"id": channel_id, "edf_ch": "", "correct_ch": f"channel_{channel_id}", "is_ieeg": ""}
        for channel_id in sorted(channel_ids)
    ]
