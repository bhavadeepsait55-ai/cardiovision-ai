from __future__ import annotations

from typing import Any

import numpy as np
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, find_peaks, sosfiltfilt

from backend.app.edf import RecordingError


def _zscore(values: np.ndarray) -> np.ndarray:
    sd = float(np.std(values, ddof=1))
    if not np.isfinite(sd) or sd <= np.finfo(float).eps:
        raise RecordingError("A selected fetal-mode channel is flat or numerically unstable.")
    return (values - float(np.mean(values))) / sd


def adaptive_cancel(reference: np.ndarray, mixture: np.ndarray, length: int, step: float) -> np.ndarray:
    if length < 2 or length > 512 or not 0 < step <= 1:
        raise RecordingError("NLMS filter length must be 2–512 and step size must be in (0, 1].")
    if len(reference) <= length + 1 or len(mixture) != len(reference):
        raise RecordingError("The selected signals are too short or have mismatched lengths.")
    weights = np.zeros(length, dtype=np.float64)
    error = np.zeros_like(mixture, dtype=np.float64)
    epsilon = 1e-6
    for index in range(length - 1, len(reference)):
        vector = reference[index - length + 1 : index + 1][::-1]
        error[index] = mixture[index] - float(weights @ vector)
        weights += (step / (epsilon + float(vector @ vector))) * error[index] * vector
    return error


def process_fetal(
    reference: np.ndarray,
    mixture: np.ndarray,
    sample_rate: float,
    *,
    reference_name: str,
    mixture_name: str,
    filter_length: int = 96,
    step_size: float = 0.1,
    maternal_blank_ms: float = 90,
    convergence_seconds: float = 10,
    segment_seconds: float = 60,
    maternal_peak_height: float = 1.5,
    fetal_threshold_std: float = 1.2,
    fetal_hr_min_bpm: float = 110,
    fetal_hr_max_bpm: float = 180,
) -> dict[str, Any]:
    if not np.isfinite(sample_rate) or sample_rate < 150:
        raise RecordingError("Fetal research mode requires at least 150 Hz sampling.")
    if not 3 < 70 < sample_rate / 2:
        raise RecordingError("The 3–70 Hz fetal-mode filter requires a sample rate above 140 Hz.")
    if maternal_blank_ms < 0 or maternal_blank_ms > 300:
        raise RecordingError("The maternal suppression window must be between 0 and 300 ms.")
    if not 0 <= convergence_seconds < segment_seconds <= 600:
        raise RecordingError("Use a segment up to 600 seconds with a shorter convergence interval.")
    if not 0 < maternal_peak_height <= 10 or not 0 < fetal_threshold_std <= 10:
        raise RecordingError("Peak detection thresholds must be in (0, 10].")
    if not 30 <= fetal_hr_min_bpm < fetal_hr_max_bpm <= 300:
        raise RecordingError("Research heart-rate bounds must satisfy 30 <= minimum < maximum <= 300 BPM.")
    count = min(len(reference), len(mixture), int(round(segment_seconds * sample_rate)))
    if count < int((convergence_seconds + 5) * sample_rate):
        raise RecordingError("The recording must extend at least 5 seconds beyond convergence.")

    reference_signal = reference[:count].astype(np.float64, copy=False)
    mixture_signal = mixture[:count].astype(np.float64, copy=False)
    sos = butter(2, [3, 70], btype="bandpass", fs=sample_rate, output="sos")
    try:
        reference_filtered = sosfiltfilt(sos, reference_signal)
        mixture_filtered = sosfiltfilt(sos, mixture_signal)
    except ValueError as exc:
        raise RecordingError("The selected recording segment is too short for fetal-mode filtering.") from exc
    reference_normalized = _zscore(reference_filtered)
    mixture_normalized = _zscore(mixture_filtered)

    delay = int(round(filter_length / 2))
    delayed_mixture = np.concatenate([np.zeros(delay), mixture_normalized[:-delay]])
    extracted = adaptive_cancel(reference_normalized, delayed_mixture, filter_length, step_size)
    extracted = np.concatenate([extracted[delay:], np.zeros(delay)])

    maternal_peaks, _ = find_peaks(
        reference_normalized,
        height=maternal_peak_height,
        distance=max(1, int(round(0.4 * sample_rate))),
    )
    cleaned = extracted.copy()
    blank_samples = int(round(maternal_blank_ms * sample_rate / 1000))
    for index in maternal_peaks:
        cleaned[max(0, index - blank_samples) : min(count, index + blank_samples + 1)] = 0

    window = max(1, int(round(0.02 * sample_rate)))
    envelope = uniform_filter1d(np.abs(cleaned), size=window, mode="nearest")
    nonzero = envelope[envelope > 0]
    fetal_peaks = np.array([], dtype=int)
    if len(nonzero) >= 2 and float(np.std(nonzero)) > np.finfo(float).eps:
        threshold = float(np.mean(nonzero) + fetal_threshold_std * np.std(nonzero, ddof=1))
        fetal_peaks, _ = find_peaks(
            envelope,
            distance=max(1, int(round(sample_rate * 60 / fetal_hr_max_bpm))),
            height=threshold,
        )

    start = int(round(convergence_seconds * sample_rate))
    maternal_eval = maternal_peaks[maternal_peaks >= start]
    fetal_eval = fetal_peaks[fetal_peaks >= start]
    maternal_rr = np.diff(maternal_eval) / sample_rate
    fetal_rr_all = np.diff(fetal_eval) / sample_rate
    fetal_bpm_all = 60 / fetal_rr_all if len(fetal_rr_all) else np.array([])
    eligible_fetal = (fetal_bpm_all >= fetal_hr_min_bpm) & (fetal_bpm_all <= fetal_hr_max_bpm)
    fetal_rr = fetal_rr_all[eligible_fetal]
    maternal_bpm = 60 / maternal_rr if len(maternal_rr) else np.array([])
    fetal_bpm = 60 / fetal_rr if len(fetal_rr) else np.array([])

    def summary(values: np.ndarray) -> dict[str, Any]:
        return {
            "median": float(np.median(values)) if len(values) else None,
            "mean": float(np.mean(values)) if len(values) else None,
            "interval_count": int(len(values)),
        }

    limitations = [
        "Exploratory research extraction; not clinically validated.",
        "Maternal residuals and artifacts may remain in the extracted signal.",
        "Heart-rate thresholds are configurable research parameters, not diagnostic boundaries.",
    ]
    if len(fetal_rr) < 2:
        limitations.append("Too few candidate fetal intervals were detected for a stable rate estimate.")
    if len(fetal_rr_all) != len(fetal_rr):
        limitations.append(
            "The fetal candidate rate summary excludes intervals outside the configured research heart-rate bounds."
        )
    if len(maternal_rr) < 2:
        limitations.append("Too few maternal intervals were detected for a stable rate estimate.")
    return {
        "mode": "fetal_research",
        "maternal_heart_rate_bpm": summary(maternal_bpm),
        "fetal_heart_rate_bpm": summary(fetal_bpm),
        "maternal_peak_indices": maternal_peaks.astype(int).tolist(),
        "fetal_peak_indices": fetal_peaks.astype(int).tolist(),
        "maternal_interval_count": int(len(maternal_rr)),
        "fetal_interval_count": int(len(fetal_rr)),
        "fetal_candidate_interval_count": int(len(fetal_rr_all)),
        "quality": {
            "status": "Review required" if len(fetal_rr) < 2 else "Exploratory only",
            "limitations": limitations,
            "convergence_seconds_excluded": convergence_seconds,
        },
        "processing": {
            "method": "NLMS adaptive cancellation",
            "reference_channel": reference_name,
            "abdominal_channel": mixture_name,
            "bandpass_hz": [3, 70],
            "filter_length": filter_length,
            "step_size": step_size,
            "maternal_blank_window_ms": maternal_blank_ms,
            "segment_seconds": count / sample_rate,
            "convergence_seconds": convergence_seconds,
            "normalization": "z-score",
            "maternal_peak_height_threshold": maternal_peak_height,
            "fetal_envelope_threshold_std": fetal_threshold_std,
            "fetal_research_hr_bounds_bpm": [fetal_hr_min_bpm, fetal_hr_max_bpm],
        },
        "waveforms": {
            "raw": mixture_normalized,
            "reference": reference_normalized,
            "extracted": cleaned,
        },
    }
