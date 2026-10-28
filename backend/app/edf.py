from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np


class RecordingError(ValueError):
    pass


def _field(data: bytes, start: int, width: int) -> str:
    return data[start : start + width].decode("ascii", "replace").strip()


@dataclass
class EDFSignal:
    label: str
    unit: str
    sample_rate: float
    samples: np.ndarray
    physical_min: float
    physical_max: float
    prefilter: str


def read_edf(data: bytes) -> tuple[list[EDFSignal], dict[str, Any]]:
    """Read ordinary EDF records, calibrating digital samples without extracting patient fields."""
    if len(data) < 256:
        raise RecordingError("The EDF header is incomplete.")

    try:
        header_bytes = int(_field(data, 184, 8))
        record_count = int(_field(data, 236, 8))
        record_duration = float(_field(data, 244, 8))
        channel_count = int(_field(data, 252, 4))
    except ValueError as exc:
        raise RecordingError("The EDF header contains invalid numeric fields.") from exc

    if channel_count < 1 or channel_count > 256 or header_bytes < 256:
        raise RecordingError("The EDF header declares an unsupported channel layout.")
    if header_bytes > len(data) or record_duration <= 0 or record_count == 0:
        raise RecordingError("The EDF recording is incomplete or has invalid timing.")
    reserved = _field(data, 192, 44).upper()
    if "EDF+D" in reserved:
        raise RecordingError("Discontinuous EDF+D recordings are not supported.")
    if _field(data, 0, 8) not in {"0", "0.0"}:
        raise RecordingError("Only standard EDF recordings are supported; EDF+D is not yet supported.")

    offset = 256
    fields: dict[str, list[str]] = {}
    for name, width in (
        ("label", 16),
        ("transducer", 80),
        ("unit", 8),
        ("physical_min", 8),
        ("physical_max", 8),
        ("digital_min", 8),
        ("digital_max", 8),
        ("prefilter", 80),
        ("samples_per_record", 8),
        ("reserved", 32),
    ):
        end = offset + width * channel_count
        if end > header_bytes:
            raise RecordingError("The EDF channel header is truncated.")
        fields[name] = [
            _field(data, offset + index * width, width)
            for index in range(channel_count)
        ]
        offset = end

    try:
        samples_per_record = [int(value) for value in fields["samples_per_record"]]
        physical_min = [float(value) for value in fields["physical_min"]]
        physical_max = [float(value) for value in fields["physical_max"]]
        digital_min = [int(value) for value in fields["digital_min"]]
        digital_max = [int(value) for value in fields["digital_max"]]
    except ValueError as exc:
        raise RecordingError("The EDF channel calibration fields are invalid.") from exc

    if any(count <= 0 for count in samples_per_record):
        raise RecordingError("The EDF contains a channel with no samples.")
    if any(lo >= hi for lo, hi in zip(digital_min, digital_max)) or any(
        lo >= hi for lo, hi in zip(physical_min, physical_max)
    ):
        raise RecordingError("The EDF contains invalid channel calibration ranges.")

    bytes_per_record = sum(samples_per_record) * 2
    available = len(data) - header_bytes
    if record_count < 0:
        if available % bytes_per_record:
            raise RecordingError("The EDF data records are truncated.")
        record_count = available // bytes_per_record
    if record_count < 1 or record_count * bytes_per_record != available:
        raise RecordingError("The EDF data records are truncated or inconsistent.")

    signals: list[EDFSignal] = []
    channel_byte_offsets = np.cumsum([0] + samples_per_record[:-1]) * 2
    for channel in range(channel_count):
        label = fields["label"][channel]
        if "annotation" in label.lower():
            continue
        per_record = samples_per_record[channel]
        chunks: list[np.ndarray] = []
        byte_offset = int(channel_byte_offsets[channel])
        for record in range(record_count):
            start = header_bytes + record * bytes_per_record + byte_offset
            digital = np.frombuffer(
                data, dtype="<i2", count=per_record, offset=start
            ).astype(np.float64)
            calibrated = (
                (digital - digital_min[channel])
                * (physical_max[channel] - physical_min[channel])
                / (digital_max[channel] - digital_min[channel])
                + physical_min[channel]
            )
            chunks.append(calibrated)
        samples = np.concatenate(chunks)
        if not np.all(np.isfinite(samples)):
            raise RecordingError("An EDF signal channel contains non-finite samples.")
        signals.append(
            EDFSignal(
                label=label or f"Channel {channel + 1}",
                unit=fields["unit"][channel],
                sample_rate=per_record / record_duration,
                samples=samples,
                physical_min=physical_min[channel],
                physical_max=physical_max[channel],
                prefilter=fields["prefilter"][channel],
            )
        )

    if not signals:
        raise RecordingError("The EDF does not contain any analyzable signal channels.")
    duration = record_count * record_duration
    return signals, {
        "format": "EDF",
        "duration_seconds": duration,
        "record_count": record_count,
        "record_duration_seconds": record_duration,
        "header_bytes": header_bytes,
    }
