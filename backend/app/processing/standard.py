from __future__ import annotations

from typing import Any

import numpy as np
from scipy.signal import butter, find_peaks, iirnotch, sosfiltfilt, tf2sos

from backend.app.edf import RecordingError


def _finite_signal(samples: np.ndarray) -> None:
    if samples.ndim != 1 or len(samples) < 10 or not np.all(np.isfinite(samples)):
        raise RecordingError("Select a channel with at least 10 finite samples.")


def process_standard(
    samples: np.ndarray,
    sample_rate: float,
    *,
    low_hz: float = 0.5,
    high_hz: float = 40.0,
    powerline_hz: float | None = None,
    prominence_mad_multiplier: float = 1.5,
    minimum_rr_ms: float = 250,
    maximum_rr_ms: float = 2500,
) -> dict[str, Any]:
    _finite_signal(samples)
    if not np.isfinite(sample_rate) or sample_rate < 20:
        raise RecordingError("Standard ECG analysis requires a sample rate of at least 20 Hz.")
    nyquist = sample_rate / 2
    if low_hz <= 0 or high_hz <= low_hz or high_hz >= nyquist:
        raise RecordingError("The filter settings must satisfy 0 < low < high < Nyquist.")
    if powerline_hz is not None and (powerline_hz not in (50, 60) or powerline_hz >= nyquist):
        raise RecordingError("Power-line filtering supports 50 or 60 Hz below Nyquist.")
    if not 0 < prominence_mad_multiplier <= 10:
        raise RecordingError("Peak prominence multiplier must be in (0, 10].")
    if not 100 <= minimum_rr_ms < maximum_rr_ms <= 10000:
        raise RecordingError("RR interval bounds must satisfy 100 ms <= minimum < maximum <= 10,000 ms.")
    if len(samples) < max(32, int(sample_rate * 0.25)):
        raise RecordingError("The selected recording is too short for stable filtering.")

    raw = samples.astype(np.float64, copy=False)
    raw_centered = raw - np.median(raw)
    sos = butter(3, [low_hz, high_hz], btype="bandpass", fs=sample_rate, output="sos")
    try:
        filtered = sosfiltfilt(sos, raw_centered)
        if powerline_hz is not None:
            b, a = iirnotch(powerline_hz, 30, fs=sample_rate)
            filtered = sosfiltfilt(tf2sos(b, a), filtered)
    except ValueError as exc:
        raise RecordingError("The recording is too short for the selected filter settings.") from exc
    if not np.all(np.isfinite(filtered)):
        raise RecordingError("Filtering produced non-finite signal values.")

    centered = filtered - np.median(filtered)
    mad = np.median(np.abs(centered)) * 1.4826
    prominence = max(mad * prominence_mad_multiplier, np.finfo(float).eps)
    peaks, _ = find_peaks(
        centered,
        distance=max(1, int(round(minimum_rr_ms * sample_rate / 1000))),
        prominence=prominence,
    )
    rr_seconds = np.diff(peaks) / sample_rate
    plausible_rr = rr_seconds[
        (rr_seconds * 1000 >= minimum_rr_ms) & (rr_seconds * 1000 <= maximum_rr_ms)
    ]
    bpm = 60.0 / plausible_rr if len(plausible_rr) else np.array([], dtype=float)
    sdnn = float(np.std(plausible_rr, ddof=1) * 1000) if len(plausible_rr) >= 5 else None
    rmssd = (
        float(np.sqrt(np.mean(np.diff(plausible_rr) ** 2)) * 1000)
        if len(plausible_rr) >= 6
        else None
    )

    signal_range = float(np.ptp(raw))
    flat_fraction = (
        float(np.mean(np.abs(np.diff(raw)) <= np.finfo(float).eps * max(1, signal_range)))
        if len(raw) > 1
        else 1.0
    )
    clipped_fraction = float(
        np.mean(np.isclose(raw, np.min(raw)) | np.isclose(raw, np.max(raw)))
    ) if signal_range > 0 else 1.0
    quality = "Review recommended"
    if flat_fraction > 0.05 or clipped_fraction > 0.02 or len(peaks) < 2:
        quality = "Low / insufficient signal"
    elif len(plausible_rr) >= 2:
        quality = "Usable for exploratory review"

    return {
        "mode": "standard",
        "heart_rate_bpm": {
            "mean": float(np.mean(bpm)) if len(bpm) else None,
            "median": float(np.median(bpm)) if len(bpm) else None,
        },
        "beat_count": int(len(peaks)),
        "peak_indices": peaks.astype(int).tolist(),
        "rr_intervals_ms": (plausible_rr * 1000).astype(float).tolist(),
        "rr_statistics_ms": {
            "mean": float(np.mean(plausible_rr) * 1000) if len(plausible_rr) else None,
            "median": float(np.median(plausible_rr) * 1000) if len(plausible_rr) else None,
            "sdnn": sdnn,
            "rmssd": rmssd,
            "hrv_limitation": (
                "At least 5 eligible intervals are required for SDNN and 6 for RMSSD."
            ),
        },
        "quality": {
            "status": quality,
            "flat_sample_fraction": flat_fraction,
            "extreme_sample_fraction": clipped_fraction,
            "note": "Heuristic signal checks; not a diagnostic interpretation.",
        },
        "processing": {
            "baseline_correction": "Median centering",
            "bandpass_hz": [low_hz, high_hz],
            "powerline_hz": powerline_hz,
            "peak_method": "Prominence-based local peak detection",
            "prominence_mad_multiplier": prominence_mad_multiplier,
            "minimum_rr_ms": minimum_rr_ms,
            "maximum_rr_ms": maximum_rr_ms,
        },
        "waveforms": {"raw": raw, "filtered": filtered},
    }
