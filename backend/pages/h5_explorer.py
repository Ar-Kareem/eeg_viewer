from __future__ import annotations

import math

from fastapi import APIRouter
import h5py
import numpy as np

from ..common import H5_PREVIEW_ITEMS, H5_SMALL_DATASET_LIMIT, SNIPPET_SAMPLE_RATE, data_paths, file_stem, read_channels

router = APIRouter(prefix="/api", tags=["H5 Explorer"])


def json_safe_value(value: object, preview_items: int = H5_PREVIEW_ITEMS) -> object:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.generic):
        return json_safe_value(value.item(), preview_items)
    if isinstance(value, np.ndarray):
        if value.ndim == 0:
            return json_safe_value(value.item(), preview_items)
        flat = value.reshape(-1)
        preview = [json_safe_value(item, preview_items) for item in flat[:preview_items]]
        if flat.size <= preview_items:
            return preview
        return {
            "dtype": str(value.dtype),
            "shape": list(value.shape),
            "size": int(value.size),
            "preview": preview,
        }
    if isinstance(value, (list, tuple)):
        return [json_safe_value(item, preview_items) for item in value[:preview_items]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def read_attrs(attrs: h5py.AttributeManager) -> dict[str, object]:
    return {key: json_safe_value(value) for key, value in attrs.items()}


def estimate_dataset_bytes(dataset: h5py.Dataset) -> int | None:
    try:
        return int(dataset.size * dataset.dtype.itemsize)
    except (OverflowError, TypeError, ValueError):
        return None


def dataset_preview(dataset: h5py.Dataset) -> object:
    try:
        if dataset.shape == ():
            return json_safe_value(dataset[()])
        if dataset.size == 0:
            return []

        edge = max(1, math.ceil(H5_PREVIEW_ITEMS ** (1 / max(1, dataset.ndim))))
        slices = tuple(slice(0, min(int(dim), edge)) for dim in dataset.shape)
        values = np.asarray(dataset[slices]).reshape(-1)[:H5_PREVIEW_ITEMS]
        return json_safe_value(values)
    except Exception as error:
        return {"error": str(error)}


def numeric_dataset_summary(dataset: h5py.Dataset) -> dict[str, object] | None:
    if dataset.size > H5_SMALL_DATASET_LIMIT or not np.issubdtype(dataset.dtype, np.number):
        return None

    try:
        values = np.asarray(dataset[()]).astype(np.float64).reshape(-1)
    except Exception:
        return None

    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {"finite_count": 0}

    return {
        "finite_count": int(finite.size),
        "min": float(np.min(finite)),
        "max": float(np.max(finite)),
        "mean": float(np.mean(finite)),
        "std": float(np.std(finite)),
    }


def read_h5_info(subject: str, raw_stem: str) -> dict[str, object]:
    _, h5_path = data_paths(subject, raw_stem)
    nodes = []
    group_count = 0
    dataset_count = 0
    total_elements = 0
    total_bytes = 0
    recording_samples = 0
    channel_count = 0
    ieeg_channel_count = len(read_channels(subject, raw_stem))

    with h5py.File(h5_path, "r") as h5_file:
        root_attrs = read_attrs(h5_file.attrs)
        if "data" in h5_file and isinstance(h5_file["data"], h5py.Group):
            channel_names = [name for name in h5_file["data"].keys() if name.startswith("channel_")]
            channel_count = len(channel_names)
            if channel_names:
                recording_samples = int(h5_file["data"][channel_names[0]].shape[-1])

        def visitor(name: str, obj: h5py.Group | h5py.Dataset) -> None:
            nonlocal group_count, dataset_count, total_elements, total_bytes

            if isinstance(obj, h5py.Dataset):
                dataset_count += 1
                estimated_bytes = estimate_dataset_bytes(obj)
                total_elements += int(obj.size)
                if estimated_bytes is not None:
                    total_bytes += estimated_bytes

                nodes.append(
                    {
                        "path": f"/{name}",
                        "name": name.rsplit("/", 1)[-1],
                        "kind": "dataset",
                        "dtype": str(obj.dtype),
                        "shape": list(obj.shape),
                        "ndim": int(obj.ndim),
                        "size": int(obj.size),
                        "estimated_bytes": estimated_bytes,
                        "chunks": list(obj.chunks) if obj.chunks else None,
                        "compression": obj.compression,
                        "compression_opts": json_safe_value(obj.compression_opts),
                        "shuffle": bool(obj.shuffle),
                        "fletcher32": bool(obj.fletcher32),
                        "scaleoffset": json_safe_value(obj.scaleoffset),
                        "maxshape": list(obj.maxshape) if obj.maxshape else None,
                        "fillvalue": json_safe_value(obj.fillvalue),
                        "attrs": read_attrs(obj.attrs),
                        "preview": dataset_preview(obj),
                        "numeric_summary": numeric_dataset_summary(obj),
                    }
                )
                return

            group_count += 1
            nodes.append(
                {
                    "path": f"/{name}",
                    "name": name.rsplit("/", 1)[-1],
                    "kind": "group",
                    "attrs": read_attrs(obj.attrs),
                    "child_count": len(obj.keys()),
                    "children": sorted(obj.keys()),
                }
            )

        h5_file.visititems(visitor)

        return {
            "subject": subject,
            "file": file_stem(raw_stem),
            "h5": h5_path.name,
            "path": str(h5_path),
            "file_size_bytes": h5_path.stat().st_size,
            "driver": h5_file.driver,
            "libver": list(h5_file.libver),
            "userblock_size": int(h5_file.userblock_size),
            "recording_samples": recording_samples,
            "recording_seconds": recording_samples / SNIPPET_SAMPLE_RATE if recording_samples else 0,
            "channel_count": channel_count,
            "ieeg_channel_count": ieeg_channel_count,
            "root_attrs": root_attrs,
            "summary": {
                "groups": group_count,
                "datasets": dataset_count,
                "root_attrs": len(root_attrs),
                "nodes": len(nodes),
                "dataset_elements": int(total_elements),
                "estimated_dataset_bytes": int(total_bytes),
            },
            "nodes": sorted(nodes, key=lambda node: node["path"]),
        }


@router.get("/h5-info")
def api_h5_info(subject: str, file: str) -> dict[str, object]:
    return read_h5_info(subject, file)
