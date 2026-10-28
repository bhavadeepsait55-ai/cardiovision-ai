# ECG processing notes

This guide describes the implemented algorithms. All outputs are research/educational measurements; neither pipeline is a validated diagnostic interpretation.

## Input and calibration

- EDF channels are parsed by `backend/app/edf.py`, with physical/digital calibration taken from channel headers. EDF annotation channels are excluded from analyzable signals.
- CSV/TXT tables must contain numeric columns and use an explicitly supplied sampling frequency in the range 20–10,000 Hz. An amplitude unit may be declared; the app does not infer a unit.
- Upload is limited to 25 MiB. Parsed tables support up to five million rows and 32 numeric channels. A decoded recording is limited to 128 MiB; four active recordings are allowed per process.
- The parser supports the current continuous EDF layout. Discontinuous EDF+D is not supported.

## Standard ECG

`backend/app/processing/standard.py` median-centers a finite one-dimensional signal, applies a third-order zero-phase Butterworth bandpass, then optionally a second-order 50/60 Hz notch filter. Default bandpass is 0.5–40 Hz; the upper filter edge must remain below Nyquist.

Candidate peaks are local maxima found by SciPy `find_peaks` with a minimum-distance based on the configured minimum RR and prominence derived from 1.4826×MAD times a multiplier (default 1.5). RR intervals are differences between detected sample indices divided by the sampling frequency. Default eligible bounds are 250–2500 ms. Mean/median rate use eligible RR intervals. SDNN requires at least five eligible intervals; RMSSD requires six. Peak detections are candidates, not validated beat labels.

Quality status is a heuristic based on flat-sample fraction, extreme-value fraction, detected-peak count, and eligible intervals. It is not a clinical signal-quality assessment. Short, flat, clipped, noisy, non-finite, or poorly calibrated recordings can fail or provide insufficient/reliable-looking values; the UI and report must not imply diagnostic certainty.

## Fetal ECG research workflow

`backend/app/processing/fetal.py` requires two finite channels, equal sample counts, matching sampling rates, and a rate above 140 Hz (the API additionally restricts it to at least 150 Hz). It processes a configurable segment (default 60 seconds):

1. Apply a second-order, zero-phase 3–70 Hz Butterworth bandpass to the thoracic reference and abdominal mixture.
2. Normalize each with z-score; near-flat/unstable channels raise an input error.
3. Delay the mixture and run normalized LMS adaptive cancellation with a configurable filter length (default 96) and step size (default 0.1).
4. Detect maternal reference peaks and suppress ± a configurable window (default 90 ms) in the cancellation residual.
5. Form a short-window absolute residual envelope and detect candidate fetal peaks.
6. Exclude an initial convergence interval (default 10 seconds) from rate summaries.
7. Summarize maternal/fetal interval rates; candidate fetal intervals outside configured bounds (default 110–180 BPM) are excluded from the fetal summary but peak indices remain available.

The fetal HR bounds are configurable research parameters, not diagnostic boundaries. The adaptive cancellation assumes a meaningful thoracic maternal reference and matching sample clocks/counts. Maternal residuals, motion, channel geometry, maternal peak misdetection, convergence, insufficient segment length, or noise can make extraction unreliable or unavailable. The algorithm has no provided clinical validation dataset/reference annotations.

## Reproducible sample

Generate synthetic, patient-free data at the repository root:

```powershell
python backend\scripts\generate_sample.py --output synthetic_ecg.csv
```

The tool creates deterministic ECG-like test data, not ground-truth clinical signals. The automated test fixtures include synthetic heartbeats but are not reference annotation validation.

## Fetal CLI

`fetalecg.py` is a CLI wrapper around the same research pipeline:

```powershell
python fetalecg.py --help
python fetalecg.py --edf path\to\authorized-recording.edf
```

The command requires the caller to supply an EDF path, may accept channel/filter settings, and prints JSON summary metadata/limitations. Do not use identifiable data in shared logs or public bug reports.
