from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

import numpy as np


def synthetic_ecg(sample_rate: int = 250, duration_seconds: int = 12) -> np.ndarray:
    """Create a clearly synthetic, deterministic ECG-like waveform without patient data."""
    time = np.arange(sample_rate * duration_seconds, dtype=float) / sample_rate
    signal = 0.035 * np.sin(2 * np.pi * 0.25 * time)
    for beat in np.arange(0.6, duration_seconds, 60 / 72):
        signal += 0.12 * np.exp(-0.5 * ((time - (beat - 0.19)) / 0.035) ** 2)
        signal -= 0.18 * np.exp(-0.5 * ((time - (beat - 0.025)) / 0.012) ** 2)
        signal += 1.05 * np.exp(-0.5 * ((time - beat) / 0.014) ** 2)
        signal -= 0.27 * np.exp(-0.5 * ((time - (beat + 0.028)) / 0.016) ** 2)
        signal += 0.24 * np.exp(-0.5 * ((time - (beat + 0.24)) / 0.065) ** 2)
    signal += 0.012 * np.sin(2 * math.pi * 50 * time)
    return signal


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a synthetic ECG CSV for local testing.")
    parser.add_argument("--output", default="synthetic_ecg.csv")
    parser.add_argument("--sample-rate", type=int, default=250)
    parser.add_argument("--duration", type=int, default=12)
    args = parser.parse_args()
    if not 20 <= args.sample_rate <= 10000 or not 6 <= args.duration <= 600:
        parser.error("Use a sample rate from 20–10,000 Hz and duration from 6–600 seconds.")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.writer(destination)
        writer.writerow(["Synthetic ECG (mV)"])
        writer.writerows((f"{value:.8f}",) for value in synthetic_ecg(args.sample_rate, args.duration))
    print(f"Wrote {output} ({args.sample_rate} Hz, {args.duration} s); synthetic data only.")


if __name__ == "__main__":
    main()
