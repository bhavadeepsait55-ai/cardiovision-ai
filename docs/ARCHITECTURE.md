# Architecture

## Runtime overview

```text
Browser (React / TypeScript / Vite :5173)
  ├── Plotly.js charts
  ├── React Three Fiber / Three.js educational heart
  └── HTTP multipart/JSON requests
          │ VITE_API_BASE_URL (default http://localhost:8000)
          ▼
FastAPI / Uvicorn (:8000)
  ├── Upload parsing and validation
  ├── In-process recording registry (one process)
  ├── Standard ECG processing (NumPy / SciPy)
  ├── Fetal ECG research processing (NLMS / SciPy)
  ├── Local template-based explanation endpoint
  └── ReportLab PDF and JSON results
```

## Frontend

`frontend/src/App.tsx` provides navigation and the upload, analysis, report, and educational flows. `PlotComponent.tsx` registers the Plotly chart modules; `HeartScene.tsx` renders procedural Three.js geometry, controls, conduction animation, and the ECG event timeline. Vite defines the browser `global` shim required by the Plotly dependency and permits the two default local CORS origins.

## Backend

`backend/app/main.py` validates HTTP input, stores recordings in a process-local dictionary, calls the independent processing modules, and generates reports. `edf.py` parses EDF data into calibrated channels. `processing/standard.py` and `processing/fetal.py` implement separate pipelines. `reports/pdf.py` builds a report from measured results.

There is no database, filesystem upload store, background worker, login, durable history, or multi-worker coordination. Recordings are memory-resident, limited by application constants, lazily expired, and lost on restart. This lifecycle does not constitute a production privacy/security architecture.

## Data flow and trust boundaries

1. Browser submits a file plus explicit consent; CSV/TXT additionally supplies sample rate and unit declaration.
2. API bounds file size, parses numeric input/EDF metadata and calibration, and keeps decoded arrays in memory.
3. The user selects channels and one analysis mode. Fetal research analysis is restricted to EDF.
4. Results and bounded chart arrays are returned as JSON. PDF generation is on demand.
5. Delete removes that recording from the current process. The browser does not implement patient-history persistence.

Uploaded file names are sanitized for display. Upload parsing treats content as data, not executable code. API errors avoid exposing local paths. No external AI or model service is configured.

## API/runtime configuration

The API binds to Uvicorn command-line host/port options. The frontend API base URL is `VITE_API_BASE_URL`, configured at Vite build/start time. The server CORS allowlist currently includes only `localhost:5173` and `127.0.0.1:5173`.

## Testing

`backend/tests/` exercises EDF calibration parsing, synthetic standard and fetal processing, upload/API validation, PDF generation, and deletion. The current repository does not have frontend unit/e2e tests or configured linting. CI runs backend tests and the strict TypeScript/Vite production build.
