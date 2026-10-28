# API reference

The development API base URL is `http://localhost:8000`. Interactive OpenAPI docs are available at `/docs`. Recordings and results are process-local and transient. The API has no authentication; use it only in a trusted local development environment.

## `GET /api/health`

Returns `200` with:

```json
{"status":"ok","service":"CardioVision AI"}
```

## `POST /api/upload`

Multipart form upload. Required fields: `file` and `consent=true`. CSV/TXT additionally requires `sample_rate_hz` from 20–10,000. `amplitude_unit` is optional and defaults to `unknown`; supported declarations are `unknown`, `mV`, `µV`/`uV`, `V`, and `counts`.

```bash
curl -X POST http://localhost:8000/api/upload \
  -F "file=@synthetic_ecg.csv" \
  -F "consent=true" \
  -F "sample_rate_hz=250" \
  -F "amplitude_unit=mV"
```

Returns `200`:

```json
{
  "recording_id": "generated-uuid",
  "metadata": {
    "filename": "synthetic_ecg.csv",
    "format": "CSV",
    "duration_seconds": 12.0,
    "sample_rate_hz": 250.0,
    "channels": [
      {
        "index": 0,
        "name": "Synthetic ECG (mV)",
        "sample_rate_hz": 250.0,
        "unit": "mV",
        "sample_count": 3000,
        "preview": {
          "time_seconds": [0.0, 6.0, 12.0],
          "amplitude": [0.0, 0.1, 0.0]
        }
      }
    ],
    "research_mode_defaults": {
      "reference_channel": 0,
      "abdominal_channel": 1
    },
    "temporary_processing": true
  }
}
```

The response above illustrates the shape; actual preview arrays contain up to 1,800 points sampled from the uploaded channel. Errors include `400` missing consent/empty file, `413` size/memory limit, `415` unsupported extension, `422` invalid content/parameters, or `429` active recording capacity.

## `GET /api/recordings/{id}/metadata`

Returns upload metadata and bounded preview arrays for all parsed channels. Returns `404` for unknown, expired, or deleted IDs.

## `POST /api/recordings/{id}/analyze`

JSON body selects one standard channel or two fetal channels. Important fields and defaults:

```json
{
  "mode": "standard",
  "channels": [0],
  "low_hz": 0.5,
  "high_hz": 40,
  "powerline_hz": null,
  "prominence_mad_multiplier": 1.5,
  "minimum_rr_ms": 250,
  "maximum_rr_ms": 2500
}
```

`mode` is `standard` or `fetal_research`. Fetal mode accepts two EDF channels and also supports `filter_length` (96), `step_size` (0.1), `maternal_blank_ms` (90), `convergence_seconds` (10), `segment_seconds` (60), `maternal_peak_height` (1.5), `fetal_threshold_std` (1.2), `fetal_hr_min_bpm` (110), and `fetal_hr_max_bpm` (180). Numeric bounds are enforced by Pydantic and processing validation. On success, returns measured summaries, candidate indices, interval statistics, processing settings, quality/limitations, and waveform arrays. Errors include `404` unknown recording and `422` invalid channels, unsupported mode/input, or processing constraints.

## `GET /api/recordings/{id}/results`

Returns the completed analysis JSON, including bounded display waveforms. Returns `409` if analysis has not completed.

## `GET /api/recordings/{id}/report`

Returns an `application/pdf` attachment named `cardiovision-analysis.pdf`. Returns `409` before analysis and `404` for unknown recordings.

## `POST /api/recordings/{id}/explain`

Request JSON:

```json
{"question":"How was the heart rate calculated?"}
```

`question` length is 1–1,000 characters. Returns a JSON object with `answer` and a source note; the explanation is local/template-based, not an external LLM. Returns `409` if analysis has not completed.

## `DELETE /api/recordings/{id}`

Removes the recording/result from this backend process and returns `204 No Content`; returns `404` if absent/already removed.

## Lifecycle and limitations

Upload limit is 25 MiB; capacity is four active recordings and 128 MiB decoded data per recording. Records expire after 30 minutes and when the backend restarts. Memory/lifecycle limits are not cross-process or multi-user controls. Do not expose this unauthenticated development API to an untrusted network.
