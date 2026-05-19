from __future__ import annotations

from http import HTTPStatus
from typing import Optional

from fastapi import APIRouter, Query
import h5py
import numpy as np

from ..common import CHANNEL_RE, SNIPPET_SAMPLE_RATE, ApiError, data_paths, file_stem, read_channels

router = APIRouter(prefix="/api", tags=["Spectral Viewer"])

MAX_SPECTRAL_SAMPLES = 262_144
BANDS = (
    ("delta", 0.5, 4.0),
    ("theta", 4.0, 8.0),
    ("alpha", 8.0, 13.0),
    ("beta", 13.0, 30.0),
    ("gamma", 30.0, 80.0),
    ("high_gamma", 80.0, 150.0),
)


def read_scaled_window(subject: str, raw_stem: str, channel: str, start: int, points: int | None) -> dict[str, object]:
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
        requested_points = points if points is not None else min(total_samples - start, 65_536)
        requested_points = max(1, min(int(requested_points), MAX_SPECTRAL_SAMPLES))
        stop = min(total_samples, start + requested_points)
        raw = dataset[0, start:stop].astype(np.float64)

        cal = float(group["cal"][channel_index])
        offset = float(group["offsets"][channel_index])
        gain = float(group["gains"][channel_index])
        values = (raw * cal + offset) * gain

    return {
        "values": values,
        "start": start,
        "stop": stop,
        "total_samples": total_samples,
        "channel": channel_index,
    }


def segment_starts(sample_count: int, window_size: int, hop_size: int) -> list[int]:
    if sample_count <= window_size:
        return [0] if sample_count else []
    return list(range(0, sample_count - window_size + 1, hop_size))


def power_spectrum(values: np.ndarray, sample_rate: int, window_size: int) -> tuple[np.ndarray, np.ndarray]:
    if values.size == 0:
        return np.array([]), np.array([])

    window_size = min(window_size, values.size)
    hop_size = max(1, window_size // 2)
    starts = segment_starts(values.size, window_size, hop_size)
    window = np.hanning(window_size)
    scale = sample_rate * np.sum(window * window)
    spectra = []
    for start in starts:
        chunk = values[start : start + window_size]
        if chunk.size < window_size:
            continue
        chunk = chunk - np.mean(chunk)
        spectra.append((np.abs(np.fft.rfft(chunk * window)) ** 2) / max(scale, 1e-12))

    if not spectra:
        return np.array([]), np.array([])
    freqs = np.fft.rfftfreq(window_size, d=1 / sample_rate)
    return freqs, np.mean(np.vstack(spectra), axis=0)


def spectrogram(values: np.ndarray, sample_rate: int, window_size: int) -> dict[str, object]:
    if values.size == 0:
        return {"times": [], "freqs": [], "power_db": []}

    window_size = min(window_size, values.size)
    hop_size = max(1, window_size // 2)
    starts = segment_starts(values.size, window_size, hop_size)
    if len(starts) > 160:
        step = int(np.ceil(len(starts) / 160))
        starts = starts[::step]

    window = np.hanning(window_size)
    scale = sample_rate * np.sum(window * window)
    freqs = np.fft.rfftfreq(window_size, d=1 / sample_rate)
    freq_mask = freqs <= min(200.0, sample_rate / 2)
    rows = []
    times = []
    for start in starts:
        chunk = values[start : start + window_size]
        if chunk.size < window_size:
            continue
        chunk = chunk - np.mean(chunk)
        power = (np.abs(np.fft.rfft(chunk * window)) ** 2) / max(scale, 1e-12)
        rows.append(10 * np.log10(power[freq_mask] + 1e-18))
        times.append((start + window_size / 2) / sample_rate)

    return {
        "times": times,
        "freqs": freqs[freq_mask].tolist(),
        "power_db": np.asarray(rows).T.tolist() if rows else [],
    }


def band_powers(freqs: np.ndarray, power: np.ndarray) -> list[dict[str, object]]:
    bands = []
    total_mask = (freqs >= 0.5) & (freqs <= min(150.0, freqs[-1] if freqs.size else 0))
    total_power = float(np.trapz(power[total_mask], freqs[total_mask])) if np.any(total_mask) else 0.0
    for name, low, high in BANDS:
        mask = (freqs >= low) & (freqs < high)
        absolute = float(np.trapz(power[mask], freqs[mask])) if np.any(mask) else 0.0
        bands.append(
            {
                "name": name,
                "low": low,
                "high": high,
                "power": absolute,
                "relative": absolute / total_power if total_power > 0 else 0.0,
            }
        )
    return bands


def line_noise_summary(freqs: np.ndarray, power: np.ndarray) -> dict[str, object]:
    def integrate(low: float, high: float) -> float:
        mask = (freqs >= low) & (freqs <= high)
        return float(np.trapz(power[mask], freqs[mask])) if np.any(mask) else 0.0

    line = integrate(59.0, 61.0)
    shoulder = integrate(55.0, 59.0) + integrate(61.0, 65.0)
    ratio = line / shoulder if shoulder > 0 else None
    return {
        "line_power": line,
        "shoulder_power": shoulder,
        "ratio": ratio,
        "flag": bool(ratio is not None and ratio > 2.0),
    }


def read_spectral_data(
    subject: str,
    raw_stem: str,
    channel: str,
    start: int,
    points: int | None,
    sample_rate: int,
    fft_size: int,
) -> dict[str, object]:
    sample_rate = max(1, int(sample_rate))
    fft_size = int(2 ** np.clip(np.round(np.log2(max(128, fft_size))), 7, 14))
    window = read_scaled_window(subject, raw_stem, channel, start, points)
    values = np.asarray(window["values"], dtype=np.float64)
    values = values[np.isfinite(values)]

    freqs, power = power_spectrum(values, sample_rate, fft_size)
    spec = spectrogram(values, sample_rate, fft_size)
    max_freq = min(200.0, sample_rate / 2)
    psd_mask = freqs <= max_freq

    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "channel": window["channel"],
        "start": window["start"],
        "stop": window["stop"],
        "total_samples": window["total_samples"],
        "window_samples": int(values.size),
        "sample_rate": sample_rate,
        "fft_size": fft_size,
        "freqs": freqs[psd_mask].tolist(),
        "power": power[psd_mask].tolist(),
        "power_db": (10 * np.log10(power[psd_mask] + 1e-18)).tolist(),
        "spectrogram": spec,
        "bands": band_powers(freqs, power) if freqs.size else [],
        "line_noise": line_noise_summary(freqs, power) if freqs.size else {},
    }


@router.get("/spectral")
def api_spectral(
    subject: str,
    file: str,
    channel: str,
    start: int = 0,
    points: Optional[int] = Query(default=65_536, ge=128, le=MAX_SPECTRAL_SAMPLES),
    sample_rate: int = Query(default=SNIPPET_SAMPLE_RATE, ge=1),
    fft_size: int = Query(default=2048, ge=128, le=16_384),
) -> dict[str, object]:
    return read_spectral_data(subject, file, channel, start, points, sample_rate, fft_size)
