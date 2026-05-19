from __future__ import annotations

import re

from fastapi import APIRouter
import h5py
import numpy as np

from ..common import data_paths, read_channels

router = APIRouter(prefix="/api", tags=["Channel Map"])

COORDINATE_RE = re.compile(r"\b(coord|coordinate|electrode|mni|ras|xyz|loc|location)\b", re.IGNORECASE)


def channel_label(channel: dict[str, object]) -> str:
    return str(channel.get("correct_ch") or channel.get("edf_ch") or f"CH_{channel['id']}")


def channel_group(channel: dict[str, object]) -> str:
    match = re.match(r"^([A-Za-z_]+)", channel_label(channel))
    return match.group(1).rstrip("_") if match else "Other"


def preview_dataset(dataset: h5py.Dataset) -> object:
    try:
        if dataset.shape == ():
            value = dataset[()]
            return value.item() if isinstance(value, np.generic) else str(value)
        if dataset.size == 0:
            return []
        slices = tuple(slice(0, min(int(dim), 4)) for dim in dataset.shape)
        values = np.asarray(dataset[slices]).reshape(-1)[:12]
        return [value.item() if isinstance(value, np.generic) else str(value) for value in values]
    except Exception as error:
        return {"error": str(error)}


def read_coordinate_nodes(subject: str, raw_stem: str) -> list[dict[str, object]]:
    _, h5_path = data_paths(subject, raw_stem)
    nodes: list[dict[str, object]] = []
    with h5py.File(h5_path, "r") as h5_file:
        def visitor(name: str, obj: h5py.Group | h5py.Dataset) -> None:
            if not isinstance(obj, h5py.Dataset):
                return
            path = f"/{name}"
            if not COORDINATE_RE.search(path):
                return
            nodes.append(
                {
                    "path": path,
                    "name": name.rsplit("/", 1)[-1],
                    "dtype": str(obj.dtype),
                    "shape": list(obj.shape),
                    "preview": preview_dataset(obj),
                }
            )

        h5_file.visititems(visitor)
    return sorted(nodes, key=lambda node: node["path"])


@router.get("/channel-map")
def api_channel_map(subject: str, file: str) -> dict[str, object]:
    channels = read_channels(subject, file)
    grouped: dict[str, list[dict[str, object]]] = {}
    for channel in channels:
        grouped.setdefault(channel_group(channel), []).append(channel)

    groups = [
        {"name": name, "channels": rows}
        for name, rows in sorted(grouped.items(), key=lambda item: item[0].lower())
    ]
    return {
        "subject": subject,
        "file": file,
        "channels": channels,
        "groups": groups,
        "coordinate_nodes": read_coordinate_nodes(subject, file),
    }
