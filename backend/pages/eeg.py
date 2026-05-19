from __future__ import annotations

import math
from http import HTTPStatus
from typing import Optional

from fastapi import APIRouter
import h5py
import numpy as np

from ..config import SNIPPET_COUNT, SNIPPET_SAMPLE_RATE
from ..data_access import CHANNEL_RE, data_paths, file_stem, list_files, list_subjects, read_channels
from ..errors import ApiError

router = APIRouter(prefix="/api", tags=["EEG Viewer"])


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


@router.get("/subjects")
def api_subjects() -> dict[str, object]:
    return {"subjects": list_subjects()}


@router.get("/files")
def api_files(subject: str) -> dict[str, object]:
    return {"files": list_files(subject)}


@router.get("/channels")
def api_channels(subject: str, file: str) -> dict[str, object]:
    return {"channels": read_channels(subject, file)}


@router.get("/data")
def api_data(
    subject: str,
    file: str,
    channel: str,
    max_points: int,
    start: int = 0,
    points: Optional[int] = None,
) -> dict[str, object]:
    return read_channel_data(subject, file, channel, start, points, max_points)


@router.get("/all-data")
def api_all_data(subject: str, file: str, max_points: int) -> dict[str, object]:
    return read_all_channel_data(subject, file, max_points)
