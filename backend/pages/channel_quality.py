from __future__ import annotations

import math

from fastapi import APIRouter, Query
import h5py
import numpy as np

from ..common import QUALITY_MAX_POINTS, data_paths, file_stem, read_channels

router = APIRouter(prefix="/api", tags=["Channel Quality"])


def robust_metric_z(value: float | None, median: float, iqr: float) -> float:
    if value is None or not math.isfinite(value):
        return 0.0
    scale = iqr if iqr > 0 else max(abs(median), 1.0)
    return max(0.0, (value - median) / scale)


def sampled_channel_values(dataset: h5py.Dataset, max_points: int) -> np.ndarray:
    total_samples = int(dataset.shape[-1])
    if total_samples <= max_points:
        return dataset[0, :].astype(np.float64)

    window_count = min(10, max(1, max_points // 200))
    window_size = max(20, max_points // window_count)
    starts = np.linspace(0, max(0, total_samples - window_size), num=window_count, dtype=np.int64)
    chunks = [dataset[0, int(start) : int(start) + window_size] for start in starts]
    return np.concatenate(chunks).astype(np.float64)


def sampled_channel_preview(dataset: h5py.Dataset, max_points: int) -> tuple[list[int | None], np.ndarray]:
    total_samples = int(dataset.shape[-1])
    if total_samples <= max_points:
        values = dataset[0, :].astype(np.float64)
        return list(range(total_samples)), values

    start = max(0, (total_samples - max_points) // 2)
    stop = min(total_samples, start + max_points)
    values = dataset[0, start:stop].astype(np.float64)
    return list(range(start, stop)), values


def read_channel_quality(subject: str, raw_stem: str, max_points: int) -> dict[str, object]:
    max_points = max(100, min(max_points, 50_000))
    channels = read_channels(subject, raw_stem)
    _, h5_path = data_paths(subject, raw_stem)
    rows = []
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
            downsample_step = max(1, math.ceil(total_samples / max_points))
            raw = sampled_channel_values(dataset, max_points)
            cal = float(group["cal"][channel_index])
            offset = float(group["offsets"][channel_index])
            gain = float(group["gains"][channel_index])
            values = (raw * cal + offset) * gain

            finite_mask = np.isfinite(values)
            finite = values[finite_mask]
            missing_fraction = 1.0 - (float(finite.size) / float(values.size)) if values.size else 1.0

            if finite.size:
                diffs = np.diff(finite)
                median = float(np.median(finite))
                mad = float(np.median(np.abs(finite - median)))
                robust_scale = max(mad * 1.4826, 1e-12)
                lower, upper = np.percentile(finite, [0.5, 99.5])
                raw_min = float(np.min(raw)) if raw.size else None
                raw_max = float(np.max(raw)) if raw.size else None
                saturation_fraction = (
                    float(np.mean((raw == raw_min) | (raw == raw_max))) if raw.size and raw_min != raw_max else 0.0
                )
                flat_epsilon = max(robust_scale * 1e-6, 1e-12)

                metrics = {
                    "samples": int(values.size),
                    "finite_samples": int(finite.size),
                    "missing_fraction": missing_fraction,
                    "mean": float(np.mean(finite)),
                    "std": float(np.std(finite)),
                    "min": float(np.min(finite)),
                    "max": float(np.max(finite)),
                    "p01": float(np.percentile(finite, 1)),
                    "p99": float(np.percentile(finite, 99)),
                    "p2p_99": float(np.percentile(finite, 99) - np.percentile(finite, 1)),
                    "noise_rms": float(np.sqrt(np.mean(diffs * diffs))) if diffs.size else 0.0,
                    "flatline_fraction": float(np.mean(np.abs(diffs) <= flat_epsilon)) if diffs.size else 0.0,
                    "saturation_fraction": saturation_fraction,
                    "extreme_fraction": float(np.mean((finite < lower) | (finite > upper))),
                    "robust_extreme_fraction": float(np.mean(np.abs((finite - median) / robust_scale) > 8.0)),
                }
            else:
                metrics = {
                    "samples": int(values.size),
                    "finite_samples": 0,
                    "missing_fraction": 1.0,
                    "mean": None,
                    "std": None,
                    "min": None,
                    "max": None,
                    "p01": None,
                    "p99": None,
                    "p2p_99": None,
                    "noise_rms": None,
                    "flatline_fraction": 1.0,
                    "saturation_fraction": 0.0,
                    "extreme_fraction": 0.0,
                    "robust_extreme_fraction": 0.0,
                }

            rows.append(
                {
                    "id": channel_index,
                    "label": channel.get("correct_ch") or channel.get("edf_ch") or f"channel_{channel_index}",
                    "edf_ch": channel.get("edf_ch", ""),
                    "correct_ch": channel.get("correct_ch", ""),
                    **metrics,
                }
            )

    metric_names = ["std", "noise_rms", "p2p_99", "flatline_fraction", "missing_fraction", "robust_extreme_fraction"]
    baselines = {}
    for metric_name in metric_names:
        values = np.array(
            [row[metric_name] for row in rows if row.get(metric_name) is not None and math.isfinite(row[metric_name])],
            dtype=np.float64,
        )
        if values.size:
            q25, q50, q75 = np.percentile(values, [25, 50, 75])
            baselines[metric_name] = {"median": float(q50), "iqr": float(q75 - q25)}
        else:
            baselines[metric_name] = {"median": 0.0, "iqr": 1.0}

    for row in rows:
        std_z = robust_metric_z(row.get("std"), baselines["std"]["median"], baselines["std"]["iqr"])
        noise_z = robust_metric_z(row.get("noise_rms"), baselines["noise_rms"]["median"], baselines["noise_rms"]["iqr"])
        p2p_z = robust_metric_z(row.get("p2p_99"), baselines["p2p_99"]["median"], baselines["p2p_99"]["iqr"])
        score = (
            std_z
            + noise_z
            + p2p_z
            + 12.0 * float(row.get("flatline_fraction") or 0.0)
            + 20.0 * float(row.get("missing_fraction") or 0.0)
            + 10.0 * float(row.get("robust_extreme_fraction") or 0.0)
            + 8.0 * float(row.get("saturation_fraction") or 0.0)
        )
        row["std_z"] = float(std_z)
        row["noise_z"] = float(noise_z)
        row["p2p_z"] = float(p2p_z)
        row["quality_score"] = float(score)
        row["quality_label"] = "bad" if score >= 10 else "watch" if score >= 4 else "good"

    rows.sort(key=lambda row: row["quality_score"], reverse=True)
    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "total_samples": total_samples,
        "downsample_step": downsample_step,
        "max_points": max_points,
        "baselines": baselines,
        "channels": rows,
    }


def read_channel_quality_preview(subject: str, raw_stem: str, max_points: int) -> dict[str, object]:
    max_points = max(100, min(max_points, 5_000))
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
            downsample_step = max(1, math.ceil(total_samples / max_points))
            sample_indexes, raw = sampled_channel_preview(dataset, max_points)
            cal = float(group["cal"][channel_index])
            offset = float(group["offsets"][channel_index])
            gain = float(group["gains"][channel_index])
            values = (raw * cal + offset) * gain
            finite = values[np.isfinite(values)]

            traces.append(
                {
                    "id": channel_index,
                    "label": channel.get("correct_ch") or channel.get("edf_ch") or f"channel_{channel_index}",
                    "x": sample_indexes,
                    "y": [None if not np.isfinite(value) else float(value) for value in values],
                    "min": float(np.min(finite)) if finite.size else None,
                    "max": float(np.max(finite)) if finite.size else None,
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


def channel_envelope(dataset: h5py.Dataset, max_bins: int) -> tuple[list[int | None], np.ndarray]:
    total_samples = int(dataset.shape[-1])
    if total_samples == 0:
        return [], np.array([], dtype=np.float64)

    max_bins = max(100, min(max_bins, total_samples))
    bin_min = np.full(max_bins, np.inf, dtype=np.float64)
    bin_max = np.full(max_bins, -np.inf, dtype=np.float64)
    chunk_size = 1_000_000

    for start in range(0, total_samples, chunk_size):
        stop = min(total_samples, start + chunk_size)
        raw = dataset[0, start:stop].astype(np.float64)
        indexes = ((np.arange(start, stop, dtype=np.int64) * max_bins) // total_samples).astype(np.int64)
        np.minimum.at(bin_min, indexes, raw)
        np.maximum.at(bin_max, indexes, raw)

    x_values: list[int | None] = []
    y_values = []
    for index, (low, high) in enumerate(zip(bin_min, bin_max)):
        if not np.isfinite(low) or not np.isfinite(high):
            continue
        sample = int(((index + 0.5) * total_samples) / max_bins)
        x_values.extend([sample, sample, None])
        y_values.extend([low, high, np.nan])
    return x_values, np.array(y_values, dtype=np.float64)


def read_channel_quality_envelope(subject: str, raw_stem: str, max_bins: int) -> dict[str, object]:
    max_bins = max(100, min(max_bins, 2_000))
    channels = read_channels(subject, raw_stem)
    _, h5_path = data_paths(subject, raw_stem)
    traces = []
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
            sample_indexes, raw_envelope = channel_envelope(dataset, max_bins)
            cal = float(group["cal"][channel_index])
            offset = float(group["offsets"][channel_index])
            gain = float(group["gains"][channel_index])
            values = (raw_envelope * cal + offset) * gain
            finite = values[np.isfinite(values)]

            traces.append(
                {
                    "id": channel_index,
                    "label": channel.get("correct_ch") or channel.get("edf_ch") or f"channel_{channel_index}",
                    "x": sample_indexes,
                    "y": [None if not np.isfinite(value) else float(value) for value in values],
                    "min": float(np.min(finite)) if finite.size else None,
                    "max": float(np.max(finite)) if finite.size else None,
                }
            )

    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "total_samples": total_samples,
        "max_bins": max_bins,
        "traces": traces,
    }


@router.get("/channel-quality")
def api_channel_quality(
    subject: str,
    file: str,
    max_points: int = Query(default=QUALITY_MAX_POINTS, ge=100, le=50_000),
) -> dict[str, object]:
    return read_channel_quality(subject, file, max_points)


@router.get("/channel-quality-preview")
def api_channel_quality_preview(
    subject: str,
    file: str,
    max_points: int = Query(default=1200, ge=100, le=5_000),
) -> dict[str, object]:
    return read_channel_quality_preview(subject, file, max_points)


@router.get("/channel-quality-envelope")
def api_channel_quality_envelope(
    subject: str,
    file: str,
    max_bins: int = Query(default=800, ge=100, le=2_000),
) -> dict[str, object]:
    return read_channel_quality_envelope(subject, file, max_bins)
