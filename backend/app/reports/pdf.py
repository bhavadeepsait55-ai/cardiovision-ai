from __future__ import annotations

from io import BytesIO
from typing import Any
from xml.sax.saxutils import escape

import numpy as np
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def build_pdf(metadata: dict[str, Any], result: dict[str, Any]) -> bytes:
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=letter, title="CardioVision AI ECG analysis")
    styles = getSampleStyleSheet()
    body = [
        Paragraph("CardioVision AI — ECG Analysis Report", styles["Title"]),
        Paragraph("Research and educational output; not a medical diagnosis.", styles["Italic"]),
        Spacer(1, 12),
    ]
    recording_rows = [
        ["Recording", metadata["filename"]],
        ["Format / duration", f"{metadata['format']} / {metadata['duration_seconds']:.2f} s"],
        ["Sample rate", f"{metadata['sample_rate_hz']:g} Hz"],
        ["Selected channels", ", ".join(result["selected_channels"])],
        ["Units", ", ".join(result["selected_units"])],
        ["Analysis mode", result["mode"]],
    ]
    body.extend(
        [
            Paragraph("Recording information", styles["Heading2"]),
            _table(recording_rows),
            Spacer(1, 10),
            Paragraph("Measured signal characteristics", styles["Heading2"]),
        ]
    )
    if result["mode"] == "standard":
        hr = result["heart_rate_bpm"]
        rows = [
            ["Detected peaks", str(result["beat_count"])],
            ["Peak locations", _peak_locations(result.get("peak_indices", []), result["sample_rate_hz"])],
            ["Mean / median heart rate", _pair(hr["mean"], hr["median"], "BPM")],
            ["RR intervals", _pair(result["rr_statistics_ms"]["mean"], result["rr_statistics_ms"]["median"], "ms")],
            ["SDNN / RMSSD", _pair(result["rr_statistics_ms"]["sdnn"], result["rr_statistics_ms"]["rmssd"], "ms")],
            ["Signal quality heuristic", result["quality"]["status"]],
            ["Flat / extreme sample fraction", _pair(result["quality"]["flat_sample_fraction"], result["quality"]["extreme_sample_fraction"], "fraction")],
        ]
    else:
        rows = [
            ["Maternal median rate", _format(result["maternal_heart_rate_bpm"]["median"], "BPM")],
            ["Fetal candidate median rate", _format(result["fetal_heart_rate_bpm"]["median"], "BPM")],
            ["Fetal peak locations", _peak_locations(result.get("fetal_peak_indices", []), result["sample_rate_hz"])],
            ["Maternal / fetal intervals", f"{result['maternal_interval_count']} / {result['fetal_interval_count']}"],
            ["Signal quality", result["quality"]["status"]],
        ]
    body.append(_table(rows))
    body.extend([Spacer(1, 10), Paragraph("Processing settings", styles["Heading2"])])
    for key, value in result["processing"].items():
        body.append(
            Paragraph(
                f"{escape(key.replace('_', ' ').title())}: {escape(str(value))}",
                styles["BodyText"],
            )
        )
    body.extend([Spacer(1, 10), Paragraph("Limitations and interpretation", styles["Heading2"])])
    if result["mode"] == "standard":
        notes = [
            "Peak and heart-rate estimates are algorithmic measurements and depend on signal quality.",
            result["quality"]["note"],
            "Filtering or an apparently typical heart rate does not establish a normal ECG.",
        ]
    else:
        notes = result["quality"]["limitations"]
    for note in notes:
        body.append(Paragraph(f"• {note}", styles["BodyText"]))
    body.extend([Spacer(1, 14), Paragraph("Waveform overview (normalized for display)", styles["Heading2"])])
    if result["mode"] == "standard":
        body.append(_waveform_table(result, "raw", "Raw signal"))
        body.append(Spacer(1, 5))
        body.append(_waveform_table(result, "filtered", "Filtered signal"))
    else:
        body.append(_waveform_table(result, "raw", "Abdominal mixture"))
        body.append(Spacer(1, 5))
        body.append(_waveform_table(result, "extracted", "Extracted signal"))
    body.append(Spacer(1, 10))
    body.append(
        Paragraph(
            "For research and educational use only. This software has not been clinically validated "
            "or reviewed for medical-device regulatory requirements. Consult a qualified clinician "
            "for medical concerns.",
            styles["Italic"],
        )
    )
    document.build(body)
    return output.getvalue()


def _format(value: Any, suffix: str) -> str:
    return f"{value:.2f} {suffix}" if value is not None else "Not available"


def _pair(first: Any, second: Any, suffix: str) -> str:
    return f"{_format(first, suffix)} / {_format(second, suffix)}"


def _peak_locations(indices: list[int], sample_rate: float) -> str:
    if not indices:
        return "No candidate peaks detected"
    locations = ", ".join(f"{index / sample_rate:.2f}" for index in indices[:30])
    remaining = len(indices) - min(len(indices), 30)
    if remaining:
        locations += f" … and {remaining} more (see JSON export)"
    return f"{locations} s"


def _table(rows: list[list[str]]) -> Table:
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph

    style = getSampleStyleSheet()["BodyText"]
    style.fontSize = 8
    style.leading = 10
    cells = [[Paragraph(escape(str(cell)), style) for cell in row] for row in rows]
    table = Table(cells, colWidths=[145, 315])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eaf3f8")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c6d6df")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _waveform_table(result: dict[str, Any], key: str, label: str) -> Table:
    waves = result["waveforms"]
    signal = waves[key]
    sampled = np.asarray(signal, dtype=float)
    count = min(180, len(sampled))
    if count:
        indices = np.linspace(0, len(sampled) - 1, count).astype(int)
        values = sampled[indices]
        low, high = float(np.min(values)), float(np.max(values))
        width, height = 455, 100
        points = [
            (index / max(1, count - 1) * width, height * (1 - (value - low) / max(high - low, 1e-9)))
            for index, value in enumerate(values)
        ]
    else:
        points, width, height = [], 455, 100
    from reportlab.graphics.shapes import Drawing, Line, PolyLine, String

    drawing = Drawing(width, height + 18)
    drawing.add(String(0, height + 7, label, fontSize=8, fillColor=colors.HexColor("#456276")))
    drawing.add(Line(0, height / 2, width, height / 2, strokeColor=colors.lightgrey))
    if len(points) > 1:
        drawing.add(PolyLine([coord for point in points for coord in point], strokeColor=colors.HexColor("#098a9b"), strokeWidth=1.3))
    sample_rate = result["sample_rate_hz"]
    duration = len(sampled) / sample_rate
    drawing.add(String(0, 2, "0 s", fontSize=8))
    drawing.add(String(width - 28, 2, f"{duration:.1f} s", fontSize=8))
    return Table([[drawing]])
