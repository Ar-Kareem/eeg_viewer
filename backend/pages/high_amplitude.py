from __future__ import annotations

import math

from fastapi import APIRouter, Query
import h5py
import numpy as np

from ..common import SNIPPET_SAMPLE_RATE, data_paths, file_stem, read_channels

router = APIRouter(prefix="/api", tags=["High-Amplitude Candidates"])


def scaled_window(group: h5py.Group, channel_index: int, start: int, stop: int) -> np.ndarray:
    raw = group[f"channel_{channel_index}"][0, start:stop].astype(np.float64)
    cal = float(group["cal"][channel_index])
    offset = float(group["offsets"][channel_index])
    gain = float(group["gains"][channel_index])
    return (raw * cal + offset) * gain


def baseline(rows: list[dict[str, object]], key: str) -> tuple[float, float]:
    values = np.array([row[key] for row in rows if math.isfinite(float(row[key]))], dtype=np.float64)
    if not values.size:
        return 0.0, 1.0
    q25, q50, q75 = np.percentile(values, [25, 50, 75])
    return float(q50), float(q75 - q25)


def robust_z(value: float, median: float, iqr: float) -> float:
    scale = iqr if iqr > 0 else max(abs(median), 1.0)
    return max(0.0, (value - median) / scale)


def rhythmicity(values: np.ndarray, sample_rate: int) -> float:
    finite = values[np.isfinite(values)]
    if finite.size < 128:
        return 0.0
    finite = finite - np.mean(finite)
    window = np.hanning(finite.size)
    freqs = np.fft.rfftfreq(finite.size, d=1 / sample_rate)
    power = np.abs(np.fft.rfft(finite * window)) ** 2
    mask = (freqs >= 3.0) & (freqs <= 30.0)
    if not np.any(mask):
        return 0.0
    band = power[mask]
    total = float(np.sum(band))
    return float(np.max(band) / total) if total > 0 else 0.0


def read_high_amplitude_candidates(
    subject: str,
    raw_stem: str,
    sample_rate: int,
    window_samples: int,
    windows_per_channel: int,
    max_candidates: int,
) -> dict[str, object]:
    sample_rate = max(1, int(sample_rate))
    window_samples = max(128, int(window_samples))
    windows_per_channel = max(1, min(int(windows_per_channel), 128))
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
            actual_window = min(window_samples, total_samples)
            starts = np.linspace(0, max(0, total_samples - actual_window), num=windows_per_channel, dtype=np.int64)
            for start in starts:
                stop = int(start + actual_window)
                values = scaled_window(group, channel_index, int(start), stop)
                finite = values[np.isfinite(values)]
                if finite.size < 2:
                    continue
                rows.append(
                    {
                        "channel": channel_index,
                        "label": channel.get("correct_ch") or channel.get("edf_ch") or f"channel_{channel_index}",
                        "start": int(start),
                        "stop": stop,
                        "p2p": float(np.max(finite) - np.min(finite)),
                        "energy": float(np.mean(finite * finite)),
                        "rhythmicity": rhythmicity(finite, sample_rate),
                    }
                )

    p2p_median, p2p_iqr = baseline(rows, "p2p")
    energy_median, energy_iqr = baseline(rows, "energy")
    for row in rows:
        row["p2p_z"] = robust_z(float(row["p2p"]), p2p_median, p2p_iqr)
        row["energy_z"] = robust_z(float(row["energy"]), energy_median, energy_iqr)
        row["score"] = float(row["p2p_z"] + row["energy_z"] + 8.0 * float(row["rhythmicity"]))
        row["id"] = f"CH_{row['channel']}:{row['start']}-{row['stop']}"

    candidates = [row for row in rows if row["score"] >= 4.0]
    candidates.sort(key=lambda row: row["score"], reverse=True)
    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "total_samples": total_samples,
        "sample_rate": sample_rate,
        "windows_scanned": len(rows),
        "candidates": candidates[:max_candidates],
    }


@router.get("/high-amplitude")
def api_high_amplitude(
    subject: str,
    file: str,
    sample_rate: int = Query(default=SNIPPET_SAMPLE_RATE, ge=1),
    window_samples: int = Query(default=2048, ge=128),
    windows_per_channel: int = Query(default=16, ge=1, le=128),
    max_candidates: int = Query(default=200, ge=1, le=1000),
) -> dict[str, object]:
    return read_high_amplitude_candidates(
        subject,
        file,
        sample_rate,
        window_samples,
        windows_per_channel,
        max_candidates,
    )
