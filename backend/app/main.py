from __future__ import annotations

import csv
import io
import math
import re
import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.app.edf import EDFSignal, RecordingError, read_edf
from backend.app.processing.fetal import process_fetal
from backend.app.processing.standard import process_standard
from backend.app.reports.pdf import build_pdf

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_SAMPLE_COUNT = 5_000_000
MAX_RECORDING_MEMORY_BYTES = 128 * 1024 * 1024
MAX_ACTIVE_RECORDINGS = 4
RECORDING_TTL_SECONDS = 30 * 60
PREVIEW_LIMIT = 1800
ALLOWED_EXTENSIONS = {".edf", ".csv", ".txt"}
TABLE_UNITS = {"unknown": "", "mv": "mV", "µv": "µV", "uv": "µV", "v": "V", "counts": "counts"}


@dataclass
class Recording:
    filename: str
    format: str
    duration_seconds: float
    signals: list[EDFSignal]
    sample_rate_hz: float
    metadata: dict[str, Any]
    expires_at: float
    result: dict[str, Any] | None = None


recordings: dict[str, Recording] = {}
app = FastAPI(title="CardioVision AI", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    mode: Literal["standard", "fetal_research"] = "standard"
    channels: list[int] = Field(min_length=1, max_length=2)
    low_hz: float = Field(default=0.5, gt=0, le=100)
    high_hz: float = Field(default=40, gt=0, le=500)
    powerline_hz: Literal[50, 60] | None = None
    prominence_mad_multiplier: float = Field(default=1.5, gt=0, le=10)
    minimum_rr_ms: float = Field(default=250, ge=100, le=10000)
    maximum_rr_ms: float = Field(default=2500, ge=100, le=10000)
    filter_length: int = Field(default=96, ge=2, le=512)
    step_size: float = Field(default=0.1, gt=0, le=1)
    maternal_blank_ms: float = Field(default=90, ge=0, le=300)
    convergence_seconds: float = Field(default=10, ge=0, le=300)
    segment_seconds: float = Field(default=60, gt=15, le=600)
    maternal_peak_height: float = Field(default=1.5, gt=0, le=10)
    fetal_threshold_std: float = Field(default=1.2, gt=0, le=10)
    fetal_hr_min_bpm: float = Field(default=110, ge=30, le=300)
    fetal_hr_max_bpm: float = Field(default=180, ge=30, le=300)


class ExplainRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


def _safe_filename(filename: str) -> str:
    basename = filename.replace("\\", "/").split("/")[-1]
    cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", basename).strip(" .")
    return cleaned[:120] or "recording"


def _preview(samples: np.ndarray, sample_rate: float, limit: int = PREVIEW_LIMIT) -> dict[str, list[float]]:
    indices = np.linspace(0, len(samples) - 1, min(len(samples), limit)).astype(int)
    return {
        "time_seconds": (indices / sample_rate).astype(float).tolist(),
        "amplitude": samples[indices].astype(float).tolist(),
    }


def _parse_table(
    data: bytes, filename: str, sample_rate: float | None, amplitude_unit: str
) -> tuple[list[EDFSignal], dict[str, Any]]:
    if sample_rate is None or not math.isfinite(sample_rate) or not 20 <= sample_rate <= 10000:
        raise RecordingError("For CSV/TXT, provide a sampling frequency between 20 and 10,000 Hz.")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise RecordingError("CSV/TXT must be UTF-8 encoded numeric data.") from exc
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    delimiter = "," if "," in first_line else None
    try:
        first_row = next(csv.reader([first_line], delimiter=delimiter or " "))
    except csv.Error as exc:
        raise RecordingError("The delimited text file could not be parsed.") from exc
    header = False
    try:
        [float(value.strip()) for value in first_row]
    except (ValueError, TypeError):
        header = True
    try:
        frame = pd.read_csv(
            io.StringIO(text),
            sep=delimiter,
            header=0 if header else None,
            engine="python",
            comment="#",
            skipinitialspace=True,
            nrows=MAX_SAMPLE_COUNT + 1,
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, ValueError) as exc:
        raise RecordingError("The CSV/TXT table could not be parsed as numeric columns.") from exc
    if frame.empty or len(frame) < 10 or len(frame) > MAX_SAMPLE_COUNT:
        raise RecordingError(f"Provide between 10 and {MAX_SAMPLE_COUNT:,} signal samples.")
    columns: list[tuple[str, np.ndarray]] = []
    for index, column in enumerate(frame.columns):
        values = pd.to_numeric(frame[column], errors="coerce").to_numpy(dtype=float)
        if np.all(np.isfinite(values)):
            label = str(column) if header else f"Channel {index + 1}"
            columns.append((label, values))
    if not columns:
        raise RecordingError("No complete numeric signal columns were found.")
    if len(columns) > 32:
        raise RecordingError("At most 32 signal columns can be uploaded.")
    unit_key = amplitude_unit.strip().lower()
    if unit_key not in TABLE_UNITS:
        raise RecordingError("Select a supported amplitude unit or leave it unknown.")
    unit = TABLE_UNITS[unit_key]
    signals = [
        EDFSignal(label, unit, float(sample_rate), values, float(np.min(values)), float(np.max(values)), "")
        for label, values in columns
    ]
    return signals, {
        "format": "CSV" if filename.lower().endswith(".csv") else "TXT",
        "duration_seconds": (len(frame) - 1) / sample_rate,
        "record_count": len(frame),
    }


def _purge_expired_recordings() -> None:
    now = time.monotonic()
    expired = [recording_id for recording_id, item in recordings.items() if item.expires_at <= now]
    for recording_id in expired:
        del recordings[recording_id]


def _get_recording(recording_id: str) -> Recording:
    _purge_expired_recordings()
    try:
        return recordings[recording_id]
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Recording not found or already deleted.") from exc


def _jsonable_result(result: dict[str, Any]) -> dict[str, Any]:
    output = {key: value for key, value in result.items() if key != "waveforms"}
    waves = result["waveforms"]
    max_points = 6000
    raw = np.asarray(waves["raw"])
    indices = np.linspace(0, len(raw) - 1, min(len(raw), max_points)).astype(int)
    output["waveforms"] = {
        key: np.asarray(value)[indices].astype(float).tolist()
        for key, value in waves.items()
    }
    output["waveforms"]["time_seconds"] = (indices / result["sample_rate_hz"]).astype(float).tolist()
    return output


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "CardioVision AI"}


@app.post("/api/upload")
async def upload_recording(
    file: UploadFile = File(...),
    consent: bool = Form(...),
    sample_rate_hz: float | None = Form(default=None),
    amplitude_unit: str = Form(default="unknown"),
) -> dict[str, Any]:
    _purge_expired_recordings()
    if not consent:
        raise HTTPException(status_code=400, detail="Consent to temporary processing is required.")
    if len(recordings) >= MAX_ACTIVE_RECORDINGS:
        raise HTTPException(status_code=429, detail="Temporary processing capacity is full; remove a recording and try again.")
    filename = _safe_filename(file.filename or "")
    extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Supported formats are EDF, CSV, and TXT.")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The maximum upload size is 25 MB.")
    try:
        if extension == ".edf":
            signals, details = read_edf(data)
        else:
            signals, details = _parse_table(data, filename, sample_rate_hz, amplitude_unit)
    except RecordingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    memory_size = sum(signal.samples.nbytes for signal in signals)
    if memory_size > MAX_RECORDING_MEMORY_BYTES:
        raise HTTPException(status_code=413, detail="The decoded recording exceeds the temporary memory limit.")
    sample_rate = signals[0].sample_rate
    metadata = {
        "filename": filename,
        "format": details["format"],
        "duration_seconds": float(details["duration_seconds"]),
        "sample_rate_hz": sample_rate,
        "channels": [
            {
                "index": index,
                "name": signal.label,
                "sample_rate_hz": signal.sample_rate,
                "unit": signal.unit or "Unknown",
                "sample_count": len(signal.samples),
                "prefilter": signal.prefilter or None,
                "preview": _preview(signal.samples, signal.sample_rate),
            }
            for index, signal in enumerate(signals)
        ],
        "research_mode_defaults": {
            "reference_channel": next(
                (i for i, signal in enumerate(signals) if "thorax_1" in signal.label.lower()), 0
            ),
            "abdominal_channel": next(
                (i for i, signal in enumerate(signals) if "abdomen_1" in signal.label.lower()), 1
            ),
        },
        "temporary_processing": True,
    }
    recording_id = str(uuid.uuid4())
    recordings[recording_id] = Recording(
        filename=filename,
        format=details["format"],
        duration_seconds=float(details["duration_seconds"]),
        signals=signals,
        sample_rate_hz=sample_rate,
        metadata=metadata,
        expires_at=time.monotonic() + RECORDING_TTL_SECONDS,
    )
    return {"recording_id": recording_id, "metadata": metadata}


@app.get("/api/recordings/{recording_id}/metadata")
def get_metadata(recording_id: str) -> dict[str, Any]:
    return _get_recording(recording_id).metadata


@app.post("/api/recordings/{recording_id}/analyze")
def analyze(recording_id: str, request: AnalyzeRequest) -> dict[str, Any]:
    recording = _get_recording(recording_id)
    if len(request.channels) != (2 if request.mode == "fetal_research" else 1):
        raise HTTPException(
            status_code=422,
            detail="Select exactly one channel for standard mode or two for fetal research mode.",
        )
    if len(set(request.channels)) != len(request.channels) or any(
        channel < 0 or channel >= len(recording.signals) for channel in request.channels
    ):
        raise HTTPException(status_code=422, detail="One or more selected channel indices are invalid.")
    selected = [recording.signals[index] for index in request.channels]
    if any(not np.isclose(signal.sample_rate, selected[0].sample_rate) for signal in selected):
        raise HTTPException(status_code=422, detail="Selected channels must have matching sample rates.")
    try:
        if request.mode == "standard":
            processed = process_standard(
                selected[0].samples,
                selected[0].sample_rate,
                low_hz=request.low_hz,
                high_hz=request.high_hz,
                powerline_hz=request.powerline_hz,
                prominence_mad_multiplier=request.prominence_mad_multiplier,
                minimum_rr_ms=request.minimum_rr_ms,
                maximum_rr_ms=request.maximum_rr_ms,
            )
        else:
            if recording.format != "EDF":
                raise RecordingError("Fetal research mode requires an EDF with thoracic and abdominal signals.")
            if len(selected[0].samples) != len(selected[1].samples):
                raise RecordingError("Selected fetal-mode channels must have the same number of samples.")
            processed = process_fetal(
                selected[0].samples,
                selected[1].samples,
                selected[0].sample_rate,
                reference_name=selected[0].label,
                mixture_name=selected[1].label,
                filter_length=request.filter_length,
                step_size=request.step_size,
                maternal_blank_ms=request.maternal_blank_ms,
                convergence_seconds=request.convergence_seconds,
                segment_seconds=request.segment_seconds,
                maternal_peak_height=request.maternal_peak_height,
                fetal_threshold_std=request.fetal_threshold_std,
                fetal_hr_min_bpm=request.fetal_hr_min_bpm,
                fetal_hr_max_bpm=request.fetal_hr_max_bpm,
            )
    except RecordingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    processed["selected_channels"] = [signal.label for signal in selected]
    processed["selected_units"] = [signal.unit or "Unknown" for signal in selected]
    processed["sample_rate_hz"] = selected[0].sample_rate
    processed["recording_filename"] = recording.filename
    recording.result = processed
    response = _jsonable_result(processed)
    return response


@app.get("/api/recordings/{recording_id}/results")
def get_results(recording_id: str) -> dict[str, Any]:
    recording = _get_recording(recording_id)
    if recording.result is None:
        raise HTTPException(status_code=409, detail="Analysis has not completed.")
    return _jsonable_result(recording.result)


@app.get("/api/recordings/{recording_id}/report")
def download_report(recording_id: str) -> Response:
    recording = _get_recording(recording_id)
    if recording.result is None:
        raise HTTPException(status_code=409, detail="Run an analysis before generating its report.")
    report_result = dict(recording.result)
    report_result["selected_channels"] = recording.result["selected_channels"]
    report_result["selected_units"] = recording.result["selected_units"]
    pdf = build_pdf(recording.metadata, report_result)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="cardiovision-analysis.pdf"'},
    )


@app.post("/api/recordings/{recording_id}/explain")
def explain(recording_id: str, request: ExplainRequest) -> dict[str, str]:
    recording = _get_recording(recording_id)
    if recording.result is None:
        raise HTTPException(status_code=409, detail="Run an analysis before requesting an explanation.")
    question = request.question.lower()
    result = recording.result
    if any(word in question for word in ("heart rate", "bpm", "calculated")):
        if result["mode"] == "standard":
            value = result["heart_rate_bpm"]["median"]
            answer = (
                f"The detected R-peak locations are converted to successive RR intervals using the "
                f"{result['sample_rate_hz']:g} Hz sampling rate. Median rate is "
                f"{value:.1f} BPM based on detected intervals."
                if value is not None
                else "There are not enough eligible detected R-peak intervals to estimate heart rate."
            )
        else:
            value = result["fetal_heart_rate_bpm"]["median"]
            answer = (
                f"The fetal-mode candidate median is {value:.1f} BPM, computed from intervals between "
                "detected peaks after the configured convergence period. This is exploratory, not a diagnosis."
                if value is not None
                else "No stable fetal candidate rate was estimated; too few intervals were detected."
            )
    elif any(word in question for word in ("maternal residual", "adaptive", "cancellation", "fetal")):
        answer = (
            "Fetal research mode applies a normalized LMS adaptive filter to a selected thoracic reference "
            "and abdominal mixture, then suppresses windows around detected maternal peaks. Residual "
            "maternal activity and artifacts can remain; this workflow is not clinically validated."
            if result["mode"] == "fetal_research"
            else "This recording was processed in standard ECG mode. Fetal extraction is a separate research "
            "workflow and should only be used with suitable maternal-abdominal EDF recordings."
        )
    elif any(word in question for word in ("r-peak", "r peak", "waveform")):
        answer = (
            f"The analysis detected {result['beat_count']} candidate peaks using the documented "
            "prominence-based method. R-peaks are prominent events often associated with ventricular "
            "depolarization in an ECG; an algorithmic marker may also reflect artifact."
            if result["mode"] == "standard"
            else "The chart shows the selected abdominal mixture and the extracted signal with candidate "
            "peaks. These peaks may include artifacts or residual maternal activity."
        )
    elif any(word in question for word in ("noise", "quality", "artifact")):
        quality = result["quality"]["status"]
        answer = f"The heuristic signal-quality status is “{quality}.” Filtering may reduce selected noise "
        answer += "but cannot prove that the recording is clinically interpretable or normal."
    else:
        answer = "This educational explanation is limited to the uploaded recording metadata and completed measurements. "
        answer += "I cannot diagnose a condition; ask about detected peaks, heart-rate calculation, signal quality, or the fetal research method."
    return {"answer": answer, "source": "Local educational explanation based on this analysis; no external AI service used."}


@app.delete("/api/recordings/{recording_id}", status_code=204)
def delete_recording(recording_id: str) -> Response:
    if recordings.pop(recording_id, None) is None:
        raise HTTPException(status_code=404, detail="Recording not found or already deleted.")
    return Response(status_code=204)
