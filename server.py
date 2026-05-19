from __future__ import annotations

import csv
import json
import math
import re
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import h5py
import numpy as np


DATA_ROOT = Path("/storage/czw/mgh_focal_h5s_scaled")
STATIC_ROOT = Path(__file__).resolve().parent / "static"
SUBJECT_RE = re.compile(r"^\d+$")
HASH_RE = re.compile(r"^[A-Za-z0-9_-]+_scaled$")
CHANNEL_RE = re.compile(r"^\d+$")
PORT = 8739
SNIPPET_SAMPLE_RATE = 1024
SNIPPET_COUNT = 5


class ApiError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def require_one(params: dict[str, list[str]], name: str) -> str:
    values = params.get(name)
    if not values or not values[0]:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"Missing query parameter: {name}")
    return values[0]


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


def read_channel_data(
    subject: str,
    raw_stem: str,
    channel: str,
    start: int,
    points: int | None,
    max_points: int,
) -> dict[str, object]:
    if not CHANNEL_RE.match(channel):
        raise ApiError(HTTPStatus.BAD_REQUEST, "Channel id must be numeric")

    channel_index = int(channel)
    _, h5_path = data_paths(subject, raw_stem)
    with h5py.File(h5_path, "r") as h5_file:
        group = h5_file["data"]
        dataset_name = f"channel_{channel_index}"
        if dataset_name not in group:
            raise ApiError(HTTPStatus.NOT_FOUND, f"Channel {channel_index} was not found")

        dataset = group[dataset_name]
        total_samples = int(dataset.shape[-1])
        start = max(0, min(start, total_samples))
        stop = total_samples if points is None else min(total_samples, start + max(1, points))
        raw = dataset[0, start:stop].astype(np.float64)

        cal = float(group["cal"][channel_index])
        offset = float(group["offsets"][channel_index])
        gain = float(group["gains"][channel_index])
        values = (raw * cal + offset) * gain

    window_samples = int(values.size)
    if window_samples == 0:
        sample_indexes = np.array([], dtype=np.int64)
        sampled_values = np.array([], dtype=np.float64)
        step = 1
        snippets = []
    else:
        step = max(1, math.ceil(window_samples / max(1, max_points)))
        sampled_values = values[::step]
        sample_indexes = np.arange(start, stop, step, dtype=np.int64)
        snippet_size = min(SNIPPET_SAMPLE_RATE, window_samples)
        rng = np.random.default_rng()
        max_snippet_start = window_samples - snippet_size
        if max_snippet_start <= 0:
            snippet_starts = np.array([0], dtype=np.int64)
        else:
            snippet_starts = np.sort(
                rng.choice(
                    max_snippet_start + 1,
                    size=min(SNIPPET_COUNT, max_snippet_start + 1),
                    replace=False,
                )
            )
        snippets = []
        for snippet_start in snippet_starts:
            snippet_stop = int(snippet_start + snippet_size)
            absolute_start = int(start + snippet_start)
            absolute_stop = int(start + snippet_stop)
            snippets.append(
                {
                    "start": absolute_start,
                    "stop": absolute_stop,
                    "x": np.arange(absolute_start, absolute_stop, dtype=np.int64).tolist(),
                    "y": values[snippet_start:snippet_stop].tolist(),
                }
            )

    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "channel": channel_index,
        "start": start,
        "stop": stop,
        "total_samples": total_samples,
        "window_samples": window_samples,
        "downsample_step": step,
        "x": sample_indexes.tolist(),
        "y": sampled_values.tolist(),
        "min": float(np.min(values)) if window_samples else None,
        "max": float(np.max(values)) if window_samples else None,
        "mean": float(np.mean(values)) if window_samples else None,
        "snippet_sample_rate": SNIPPET_SAMPLE_RATE,
        "snippets": snippets,
    }


def read_all_channel_data(subject: str, raw_stem: str, max_points: int) -> dict[str, object]:
    channels = read_channels(subject, raw_stem)
    _, h5_path = data_paths(subject, raw_stem)
    traces = []
    total_samples = 0
    downsample_step = 1

    with h5py.File(h5_path, "r") as h5_file:
        group = h5_file["data"]
        for channel in channels:
            channel_index = int(channel["id"])
            dataset_name = f"channel_{channel_index}"
            if dataset_name not in group:
                continue

            dataset = group[dataset_name]
            total_samples = int(dataset.shape[-1])
            downsample_step = max(1, math.ceil(total_samples / max(1, max_points)))
            raw = dataset[0, ::downsample_step].astype(np.float64)
            cal = float(group["cal"][channel_index])
            offset = float(group["offsets"][channel_index])
            gain = float(group["gains"][channel_index])
            values = (raw * cal + offset) * gain

            window_samples = int(values.size)
            sample_indexes = np.arange(0, total_samples, downsample_step, dtype=np.int64)

            traces.append(
                {
                    "id": channel_index,
                    "label": channel.get("correct_ch") or channel.get("edf_ch") or f"channel_{channel_index}",
                    "x": sample_indexes.tolist(),
                    "y": values.tolist(),
                    "min": float(np.min(values)) if window_samples else None,
                    "max": float(np.max(values)) if window_samples else None,
                }
            )

    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "total_samples": total_samples,
        "downsample_step": downsample_step,
        "max_points": max_points,
        "traces": traces,
    }


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path == "/":
            return str(STATIC_ROOT / "index.html")
        return str(STATIC_ROOT / parsed.path.lstrip("/"))

    def send_json(self, payload: object, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return super().do_GET()

        params = parse_qs(parsed.query)
        try:
            if parsed.path == "/api/subjects":
                self.send_json({"subjects": list_subjects()})
            elif parsed.path == "/api/files":
                self.send_json({"files": list_files(require_one(params, "subject"))})
            elif parsed.path == "/api/channels":
                subject = require_one(params, "subject")
                selected_file = require_one(params, "file")
                self.send_json({"channels": read_channels(subject, selected_file)})
            elif parsed.path == "/api/data":
                subject = require_one(params, "subject")
                selected_file = require_one(params, "file")
                channel = require_one(params, "channel")
                start = int(params.get("start", ["0"])[0])
                points_param = params.get("points", [""])[0]
                points = int(points_param) if points_param else None
                max_points = int(require_one(params, "max_points"))
                self.send_json(read_channel_data(subject, selected_file, channel, start, points, max_points))
            elif parsed.path == "/api/all-data":
                subject = require_one(params, "subject")
                selected_file = require_one(params, "file")
                max_points = int(require_one(params, "max_points"))
                self.send_json(read_all_channel_data(subject, selected_file, max_points))
            else:
                raise ApiError(HTTPStatus.NOT_FOUND, "Unknown API endpoint")
        except ValueError as error:
            self.send_json({"error": f"Invalid numeric parameter: {error}"}, HTTPStatus.BAD_REQUEST)
        except ApiError as error:
            self.send_json({"error": error.message}, error.status)
        except Exception as error:
            self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving EEG browser at http://127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
