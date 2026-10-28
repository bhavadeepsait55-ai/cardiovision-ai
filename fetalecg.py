"""Command-line entry point for the configurable fetal ECG research workflow."""

from __future__ import annotations

import argparse
import json

from backend.app.edf import RecordingError, read_edf
from backend.app.processing.fetal import adaptive_cancel, process_fetal

__all__ = ["adaptive_cancel", "process_fetal"]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exploratory NLMS fetal ECG extraction for suitable maternal-abdominal EDF files."
    )
    parser.add_argument("--edf", required=True, help="Path to a standard EDF recording")
    parser.add_argument("--reference-channel", type=int, help="Thoracic reference channel index")
    parser.add_argument("--abdominal-channel", type=int, help="Abdominal mixture channel index")
    parser.add_argument("--segment-seconds", type=float, default=60)
    parser.add_argument("--filter-length", type=int, default=96)
    parser.add_argument("--step-size", type=float, default=0.1)
    parser.add_argument("--maternal-blank-ms", type=float, default=90)
    parser.add_argument("--convergence-seconds", type=float, default=10)
    args = parser.parse_args()

    try:
        with open(args.edf, "rb") as source:
            signals, details = read_edf(source.read())
        reference_index = args.reference_channel
        abdominal_index = args.abdominal_channel
        if reference_index is None:
            reference_index = next(
                (i for i, signal in enumerate(signals) if "thorax_1" in signal.label.lower()), 0
            )
        if abdominal_index is None:
            abdominal_index = next(
                (i for i, signal in enumerate(signals) if "abdomen_1" in signal.label.lower()),
                min(1, len(signals) - 1),
            )
        if reference_index == abdominal_index:
            raise RecordingError("Reference and abdominal channel selections must be different.")
        if min(reference_index, abdominal_index) < 0 or max(reference_index, abdominal_index) >= len(signals):
            raise RecordingError("A selected channel index is not present in the EDF.")
        reference = signals[reference_index]
        abdomen = signals[abdominal_index]
        if reference.sample_rate != abdomen.sample_rate:
            raise RecordingError("Selected channels must have matching sample rates.")
        result = process_fetal(
            reference.samples,
            abdomen.samples,
            reference.sample_rate,
            reference_name=reference.label,
            mixture_name=abdomen.label,
            filter_length=args.filter_length,
            step_size=args.step_size,
            maternal_blank_ms=args.maternal_blank_ms,
            convergence_seconds=args.convergence_seconds,
            segment_seconds=args.segment_seconds,
        )
    except (OSError, RecordingError) as exc:
        parser.error(str(exc))

    print(json.dumps({
        "recording_duration_seconds": details["duration_seconds"],
        "reference_channel": reference.label,
        "abdominal_channel": abdomen.label,
        "maternal_heart_rate_bpm": result["maternal_heart_rate_bpm"],
        "fetal_candidate_heart_rate_bpm": result["fetal_heart_rate_bpm"],
        "limitations": result["quality"]["limitations"],
    }, indent=2))


if __name__ == "__main__":
    main()
