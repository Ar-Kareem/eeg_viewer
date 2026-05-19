from __future__ import annotations

from typing import Any

from fastapi import APIRouter
import h5py
import numpy as np

from ..common import data_paths, file_stem, read_channels

router = APIRouter(prefix="/api", tags=["Event Explorer"])

EVENT_KEYWORDS = (
    "event",
    "events",
    "annotation",
    "annotations",
    "seizure",
    "seizures",
    "stim",
    "stimulation",
    "marker",
    "markers",
    "onset",
    "onsets",
    "trigger",
    "triggers",
)
START_FIELDS = ("start", "starts", "onset", "onsets", "sample", "samples", "time", "times", "timestamp", "timestamps")
STOP_FIELDS = ("stop", "stops", "end", "ends", "offset", "offsets")
LABEL_FIELDS = ("label", "labels", "type", "types", "description", "descriptions", "name", "names")
MAX_EVENTS = 1000


def decode_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return decode_value(value.item())
    if isinstance(value, np.ndarray):
        return [decode_value(item) for item in value.reshape(-1)[:12]]
    return value


def is_event_like(name: str, attrs: h5py.AttributeManager) -> bool:
    haystack = " ".join([name, *attrs.keys()]).lower()
    return any(keyword in haystack for keyword in EVENT_KEYWORDS)


def read_dataset_limited(dataset: h5py.Dataset, limit: int = MAX_EVENTS) -> np.ndarray | None:
    if dataset.shape == ():
        return np.asarray([dataset[()]])
    if dataset.ndim == 0:
        return np.asarray([dataset[()]])
    if dataset.shape[0] == 0:
        return np.asarray([])
    slices = (slice(0, min(int(dataset.shape[0]), limit)), *[slice(None) for _ in dataset.shape[1:]])
    try:
        return np.asarray(dataset[slices])
    except Exception:
        return None


def numeric_or_none(value: Any) -> int | None:
    value = decode_value(value)
    if isinstance(value, str):
        try:
            value = float(value)
        except ValueError:
            return None
    if isinstance(value, (int, float)) and np.isfinite(value):
        return max(0, int(round(value)))
    return None


def find_named_child(group: h5py.Group, names: tuple[str, ...]) -> h5py.Dataset | None:
    for child_name, child in group.items():
        if not isinstance(child, h5py.Dataset):
            continue
        normalized = child_name.lower()
        if any(name == normalized or name in normalized for name in names):
            return child
    return None


def field_value(row: np.void, names: tuple[str, ...]) -> Any:
    for name in row.dtype.names or ():
        normalized = name.lower()
        if any(candidate == normalized or candidate in normalized for candidate in names):
            return row[name]
    return None


def events_from_structured_dataset(path: str, dataset: h5py.Dataset) -> list[dict[str, object]]:
    values = read_dataset_limited(dataset)
    if values is None or values.dtype.names is None:
        return []

    events = []
    for index, row in enumerate(values.reshape(-1)[:MAX_EVENTS]):
        start = numeric_or_none(field_value(row, START_FIELDS))
        if start is None:
            continue
        stop = numeric_or_none(field_value(row, STOP_FIELDS))
        label = decode_value(field_value(row, LABEL_FIELDS)) or path.rsplit("/", 1)[-1]
        events.append(make_event(path, index, start, stop, str(label)))
    return events


def events_from_numeric_dataset(path: str, dataset: h5py.Dataset) -> list[dict[str, object]]:
    values = read_dataset_limited(dataset)
    if values is None or not np.issubdtype(values.dtype, np.number):
        return []
    flat = values.reshape(-1)[:MAX_EVENTS]
    events = []
    for index, value in enumerate(flat):
        start = numeric_or_none(value)
        if start is not None:
            events.append(make_event(path, index, start, None, path.rsplit("/", 1)[-1]))
    return events


def events_from_group(path: str, group: h5py.Group) -> list[dict[str, object]]:
    start_dataset = find_named_child(group, START_FIELDS)
    if start_dataset is None:
        return []

    stop_dataset = find_named_child(group, STOP_FIELDS)
    label_dataset = find_named_child(group, LABEL_FIELDS)
    starts = read_dataset_limited(start_dataset)
    stops = read_dataset_limited(stop_dataset) if stop_dataset is not None else None
    labels = read_dataset_limited(label_dataset) if label_dataset is not None else None
    if starts is None:
        return []

    events = []
    flat_starts = starts.reshape(-1)
    flat_stops = stops.reshape(-1) if stops is not None else None
    flat_labels = labels.reshape(-1) if labels is not None else None
    for index, value in enumerate(flat_starts[:MAX_EVENTS]):
        start = numeric_or_none(value)
        if start is None:
            continue
        stop = numeric_or_none(flat_stops[index]) if flat_stops is not None and index < flat_stops.size else None
        label = (
            decode_value(flat_labels[index])
            if flat_labels is not None and index < flat_labels.size
            else path.rsplit("/", 1)[-1]
        )
        events.append(make_event(path, index, start, stop, str(label)))
    return events


def make_event(source_path: str, index: int, start: int, stop: int | None, label: str) -> dict[str, object]:
    resolved_stop = max(start, stop) if stop is not None else start
    lower_label = label.lower()
    if "seiz" in lower_label or "seiz" in source_path.lower():
        event_type = "seizure"
    elif "stim" in lower_label or "stim" in source_path.lower():
        event_type = "stimulation"
    elif "annot" in lower_label or "annot" in source_path.lower():
        event_type = "annotation"
    else:
        event_type = "event"

    return {
        "id": f"{source_path}:{index}",
        "source_path": source_path,
        "type": event_type,
        "label": label,
        "start_sample": start,
        "stop_sample": resolved_stop,
        "duration_samples": resolved_stop - start,
    }


def read_events(subject: str, raw_stem: str) -> dict[str, object]:
    _, h5_path = data_paths(subject, raw_stem)
    channels = read_channels(subject, raw_stem)
    total_samples = 0
    sources = []
    events = []

    with h5py.File(h5_path, "r") as h5_file:
        if "data" in h5_file and isinstance(h5_file["data"], h5py.Group):
            channel_names = [name for name in h5_file["data"].keys() if name.startswith("channel_")]
            if channel_names:
                total_samples = int(h5_file["data"][channel_names[0]].shape[-1])

        def visitor(name: str, obj: h5py.Group | h5py.Dataset) -> None:
            if not is_event_like(name, obj.attrs):
                return

            path = f"/{name}"
            sources.append(
                {
                    "path": path,
                    "kind": "dataset" if isinstance(obj, h5py.Dataset) else "group",
                    "shape": list(obj.shape) if isinstance(obj, h5py.Dataset) else None,
                    "dtype": str(obj.dtype) if isinstance(obj, h5py.Dataset) else None,
                    "attrs": {key: decode_value(value) for key, value in obj.attrs.items()},
                }
            )
            if isinstance(obj, h5py.Dataset):
                events.extend(events_from_structured_dataset(path, obj))
                if not events or all(event["source_path"] != path for event in events):
                    events.extend(events_from_numeric_dataset(path, obj))
            else:
                events.extend(events_from_group(path, obj))

        h5_file.visititems(visitor)

    unique_events = {event["id"]: event for event in events}
    sorted_events = sorted(unique_events.values(), key=lambda event: (event["start_sample"], event["id"]))[:MAX_EVENTS]
    return {
        "subject": subject,
        "file": file_stem(raw_stem),
        "h5": h5_path.name,
        "total_samples": total_samples,
        "default_channel": channels[0]["id"] if channels else None,
        "sources": sources,
        "events": sorted_events,
        "event_count": len(sorted_events),
    }


@router.get("/events")
def api_events(subject: str, file: str) -> dict[str, object]:
    return read_events(subject, file)
