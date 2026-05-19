from __future__ import annotations

import math

from fastapi import APIRouter, Query
import h5py
import numpy as np

from ..common import SNIPPET_SAMPLE_RATE, data_paths, file_stem, read_channels

router = APIRouter(prefix="/api", tags=["Artifact Review"])


def scaled_window(group: h5py.Group, channel_index: int, start: int, stop: int) -> tuple[np.ndarray, np.ndarray]:
    raw = group[f"channel_{channel_index}"][0, start:stop].astype(np.float64)
    cal = float(group["cal"][channel_index])
    offset = float(group["offsets"][channel_index])
    gain = float(group["gains"][channel_index])
    return raw, (raw * cal + offset) * gain


def line_noise_ratio(values: np.ndarray, sample_rate: int) -> float | None:
    finite = values[np.isfinite(values)]
    if finite.size < 128:
        return None
    finite = finite - np.mean(finite)
    window = np.hanning(finite.size)
    freqs = np.fft.rfftfreq(finite.size, d=1 / sample_rate)
    power = np.abs(np.fft.rfft(finite * window)) ** 2

    def integrate(low: float, high: float) -> float:
        mask = (freqs >= low) & (freqs <= high)
        return float(np.trapz(power[mask], freqs[mask])) if np.any(mask) else 0.0

    line = integrate(59.0, 61.0)
    shoulder = integrate(55.0, 59.0) + integrate(61.0, 65.0)
    return line / shoulder if shoulder > 0 else None


def robust_z(value: float | None, median: float, iqr: float) -> float:
    if value is None or not math.isfinite(value):
        return 0.0
    scale = iqr if iqr > 0 else max(abs(median), 1.0)
    return max(0.0, (value - median) / scale)


def metric_baseline(rows: list[dict[str, object]], key: str) -> tuple[float, float]:
    values = np.array(
        [row[key] for row in rows if row.get(key) is not None and math.isfinite(float(row[key]))],
        dtype=np.float64,
    )
    if not values.size:
        return 0.0, 1.0
    q25, q50, q75 = np.percentile(values, [25, 50, 75])
    return float(q50), float(q75 - q25)


def artifact_types(row: dict[str, object]) -> list[str]:
    types = []
    if float(row["flatline_fraction"]) >= 0.95:
        types.append("flat")
    if float(row["saturation_fraction"]) >= 0.15:
        types.append("saturation")
    if float(row["p2p_z"]) >= 6:
        types.append("movement/high amplitude")
    if float(row["noise_z"]) >= 6:
        types.append("high-frequency noise")
    if row.get("line_noise_ratio") is not None and float(row["line_noise_ratio"]) >= 2.0:
        types.append("60 Hz")
    if not types:
        types.append("outlier")
    return types


def read_artifacts(
    subject: str,
    raw_stem: str,
    sample_rate: int,
    window_samples: int,
    windows_per_channel: int,
    max_candidates: int,
) -> dict[str, object]:
    sample_rate = max(1, int(sample_rate))
    window_samples = max(128, int(window_samples))
    windows_per_channel = max(1, min(int(windows_per_channel), 64))
    max_candidates = max(1, min(int(max_candidates), 1000))

    channels = read_channels(subject, raw_stem)
    _, h5_path = data_paths(subject, raw_stem)
    rows = []
    total_samples = 0

    with h5py.File(h5_path, "r") as h5_file:
        group = h5_file["data"]
        for channel in channels:
            channel_index = int(channel["id"])
            dataset_name = f"channel_{channel_index}"
            if dataset_name not in group:
                continue
            dataset = group[dataset_name]
            total_samples = int(dataset.shape[-1])
            if total_samples <= 0:
                continue
            actual_window = min(window_samples, total_samples)
            starts = np.linspace(0, max(0, total_samples - actual_window), num=windows_per_channel, dtype=np.int64)
            for start in starts:
                stop = int(start + actual_window)
                raw, values = scaled_window(group, channel_index, int(start), stop)
                finite = values[np.isfinite(values)]
                if finite.size:
                    diffs = np.diff(finite)
                    median = float(np.median(finite))
                    mad = float(np.median(np.abs(finite - median)))
                    robust_scale = max(mad * 1.4826, 1e-12)
                    raw_min = float(np.min(raw)) if raw.size else None
                    raw_max = float(np.max(raw)) if raw.size else None
                    saturation_fraction = (
                        float(np.mean((raw == raw_min) | (raw == raw_max))) if raw.size and raw_min != raw_max else 0.0
                    )
                    flat_epsilon = max(robust_scale * 1e-6, 1e-12)
                    row = {
                        "channel": channel_index,
                        "label": channel.get("correct_ch") or channel.get("edf_ch") or f"channel_{channel_index}",
                        "start": int(start),
                        "stop": stop,
                        "std": float(np.std(finite)),
                        "p2p": float(np.max(finite) - np.min(finite)),
                        "noise_rms": float(np.sqrt(np.mean(diffs * diffs))) if diffs.size else 0.0,
                        "flatline_fraction": float(np.mean(np.abs(diffs) <= flat_epsilon)) if diffs.size else 0.0,
                        "saturation_fraction": saturation_fraction,
                        "missing_fraction": 1.0 - float(finite.size) / float(values.size),
                        "line_noise_ratio": line_noise_ratio(finite, sample_rate),
                    }
                else:
                    row = {
                        "channel": channel_index,
                        "label": channel.get("correct_ch") or channel.get("edf_ch") or f"channel_{channel_index}",
                        "start": int(start),
                        "stop": stop,
                        "std": None,
                        "p2p": None,
                        "noise_rms": None,
                        "flatline_fraction": 1.0,
                        "saturation_fraction": 0.0,
                        "missing_fraction": 1.0,
                        "line_noise_ratio": None,
                    }
                rows.append(row)

    p2p_median, p2p_iqr = metric_baseline(rows, "p2p")
    noise_median, noise_iqr = metric_baseline(rows, "noise_rms")
    std_median, std_iqr = metric_baseline(rows, "std")
    candidates = []
    for row in rows:
        row["p2p_z"] = robust_z(row.get("p2p"), p2p_median, p2p_iqr)
        row["noise_z"] = robust_z(row.get("noise_rms"), noise_median, noise_iqr)
        row["std_z"] = robust_z(row.get("std"), std_median, std_iqr)
        score = (
            float(row["p2p_z"])
            + float(row["noise_z"])
            + float(row["std_z"])
            + 12.0 * float(row["flatline_fraction"])
            + 10.0 * float(row["missing_fraction"])
            + 8.0 * float(row["saturation_fraction"])
            + (float(row["line_noise_ratio"]) if row.get("line_noise_ratio") is not None else 0.0)
        )
        row["score"] = float(score)
        row["types"] = artifact_types(row)
        if score >= 4.0 or any(kind != "outlier" for kind in row["types"]):
            row["id"] = f"CH_{row['channel']}:{row['start']}-{row['stop']}"
            candidates.append(row)

    candidates.sort(key=lambda row: row["score"], reverse=True)
    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "total_samples": total_samples,
        "sample_rate": sample_rate,
        "window_samples": window_samples,
        "windows_scanned": len(rows),
        "channels_scanned": len(channels),
        "candidates": candidates[:max_candidates],
    }


@router.get("/artifacts")
def api_artifacts(
    subject: str,
    file: str,
    sample_rate: int = Query(default=SNIPPET_SAMPLE_RATE, ge=1),
    window_samples: int = Query(default=1024, ge=128),
    windows_per_channel: int = Query(default=8, ge=1, le=64),
    max_candidates: int = Query(default=200, ge=1, le=1000),
) -> dict[str, object]:
    return read_artifacts(
        subject,
        file,
        sample_rate,
        window_samples,
        windows_per_channel,
        max_candidates,
    )
