from __future__ import annotations

import numpy as np
import pytest

from backend.app.edf import RecordingError, read_edf
from backend.app.processing.fetal import process_fetal
from backend.app.processing.standard import process_standard
from backend.app.reports.pdf import build_pdf


def make_edf(sample_rate: int = 100, seconds: int = 6) -> bytes:
    count = 1
    header_bytes = 256 + 256 * count
    fixed = (
        "0       " + "X" * 80 + f"{'Startdate X':<80}" + "01.01.01" + "00.00.00"
        + f"{header_bytes:8d}" + " " * 44 + f"{1:8d}" + f"{seconds:8d}" + f"{count:4d}"
    )
    fields = [
        f"{'ECG':<16}",
        f"{'':<80}",
        f"{'mV':<8}",
        f"{-2.5:8.1f}",
        f"{2.5:8.1f}",
        f"{-32768:8d}",
        f"{32767:8d}",
        f"{'':<80}",
        f"{sample_rate * seconds:8d}",
        f"{'':<32}",
    ]
    channel_header = "".join(fields)
    assert len(fixed) == 256
    assert len(channel_header) == 256
    samples = np.linspace(-1, 1, sample_rate * seconds)
    digital = np.rint(samples / 2.5 * 32767).astype("<i2")
    return (fixed + channel_header).encode("ascii") + digital.tobytes()


def synthetic_signal(sample_rate: int = 250, duration: int = 12) -> np.ndarray:
    time = np.arange(sample_rate * duration) / sample_rate
    signal = np.zeros_like(time)
    for beat in np.arange(0.6, duration, 60 / 72):
        signal += np.exp(-0.5 * ((time - beat) / 0.018) ** 2)
    signal += 0.01 * np.sin(2 * np.pi * 0.7 * time)
    return signal


def test_edf_reader_calibrates_signal_and_reports_channel_metadata() -> None:
    signals, metadata = read_edf(make_edf())
    assert metadata["duration_seconds"] == 6
    assert signals[0].label == "ECG"
    assert signals[0].sample_rate == 100
    assert signals[0].unit == "mV"
    assert np.isclose(np.max(signals[0].samples), 1.0, atol=0.001)


def test_edf_reader_rejects_truncated_file() -> None:
    with pytest.raises(RecordingError, match="header"):
        read_edf(b"not an EDF")


def test_standard_pipeline_detects_synthetic_beat_intervals_and_hrv() -> None:
    result = process_standard(synthetic_signal(), 250)
    assert result["beat_count"] >= 12
    assert result["heart_rate_bpm"]["median"] == pytest.approx(72, abs=1.5)
    assert len(result["rr_intervals_ms"]) >= 5
    assert result["rr_statistics_ms"]["sdnn"] is not None
    assert np.all(np.isfinite(result["waveforms"]["filtered"]))


def test_standard_pipeline_rejects_invalid_filter_nyquist() -> None:
    with pytest.raises(RecordingError, match="Nyquist"):
        process_standard(synthetic_signal(), 250, high_hz=130)


def test_fetal_pipeline_returns_finite_exploratory_waveforms() -> None:
    fs, duration = 250, 24
    time = np.arange(fs * duration) / fs
    reference = np.zeros_like(time)
    abdomen = np.zeros_like(time)
    for beat in np.arange(0.4, duration, 60 / 82):
        reference += np.exp(-0.5 * ((time - beat) / 0.016) ** 2)
        abdomen += 0.8 * np.exp(-0.5 * ((time - beat) / 0.02) ** 2)
    for beat in np.arange(0.2, duration, 60 / 145):
        abdomen += 0.24 * np.exp(-0.5 * ((time - beat) / 0.012) ** 2)
    result = process_fetal(
        reference, abdomen, fs, reference_name="Thorax", mixture_name="Abdomen",
        filter_length=32, step_size=0.05, convergence_seconds=3, segment_seconds=20,
    )
    assert result["mode"] == "fetal_research"
    assert len(result["waveforms"]["extracted"]) == 20 * fs
    assert "not clinically validated" in " ".join(result["quality"]["limitations"])
    assert np.all(np.isfinite(result["waveforms"]["extracted"]))


def test_reportlab_generates_pdf_from_measured_results() -> None:
    processed = process_standard(synthetic_signal(), 250)
    processed.update({
        "selected_channels": ["Synthetic ECG"],
        "selected_units": ["mV"],
        "sample_rate_hz": 250,
        "recording_filename": "synthetic.csv",
    })
    pdf = build_pdf(
        {"filename": "synthetic.csv", "format": "CSV", "duration_seconds": 12, "sample_rate_hz": 250},
        processed,
    )
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 1000
