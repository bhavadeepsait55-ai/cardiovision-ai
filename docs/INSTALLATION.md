# Installation

## Prerequisites

- Git 2.x.
- Python 3.10+ (Python 3.11 recommended).
- Node.js 18+ (Node.js 20 LTS recommended) with npm.
- A modern browser with WebGL enabled for the 3D view.

The backend's `requirements.txt` includes FastAPI/Uvicorn, Pydantic, NumPy, SciPy, pandas, ReportLab, pytest, and HTTPX. No external EDF library is required.

## 1. Clone the repository

Run from the parent directory where you want the checkout:

```powershell
git clone https://github.com/bhavadeepsait55-ai/cardiovision-ai.git
Set-Location cardiovision-ai
```

```bash
git clone https://github.com/bhavadeepsait55-ai/cardiovision-ai.git
cd cardiovision-ai
```

If GitHub access is not available, use the local checkout and skip cloning.

## 2. Create and activate Python virtual environment

Run from the repository root:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r backend\requirements.txt
```

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
```

Verify `python --version` shows 3.10 or later and that the prompt indicates the virtual environment is active.

## 3. Configure and install frontend

Run from the repository root:

```powershell
Set-Location frontend
npm ci
Copy-Item ..\.env.example .env
```

```bash
cd frontend
npm ci
cp ../.env.example .env
```

The example URL points to `http://localhost:8000`. Edit `frontend/.env` only if the API runs elsewhere. Do not commit the `.env` file.

## 4. Start backend and frontend

Open two terminals. In Terminal 1, activate the Python environment and run from the repository root:

```powershell
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Terminal 1 should report that Uvicorn is running on port 8000. In Terminal 2 run from `frontend/`:

```powershell
npm run dev
```

```bash
npm run dev
```

Vite reports a local URL, normally <http://localhost:5173>. Open it in your browser. The service check at <http://localhost:8000/api/health> should respond with `{"status":"ok","service":"CardioVision AI"}`.

## 5. Generate synthetic data and exercise upload

From the repository root, with the Python virtual environment active:

```powershell
python backend\scripts\generate_sample.py --output synthetic_ecg.csv
```

```bash
python backend/scripts/generate_sample.py --output synthetic_ecg.csv
```

In the UI, enter `250` Hz, confirm consent, and upload the CSV. Synthetic data is for software testing only. Remove it after use.

## 6. Tests and production build

Run backend tests from the repository root:

```powershell
python -m pytest backend\tests -q
```

```bash
python -m pytest backend/tests -q
```

Run the frontend type-check/build from `frontend/`:

```text
npm ci
npm run build
```

The build output is written to `frontend/dist/`, which is ignored by Git. There is currently no frontend lint or test script.

## 7. Ports and CORS

Default API: `127.0.0.1:8000`; default Vite site: `localhost:5173`. FastAPI's CORS allowlist contains `localhost:5173` and `127.0.0.1:5173`. If changing the frontend port or hostname, update that allowlist in `backend/app/main.py`. If changing API port/hostname, set `VITE_API_BASE_URL` in `frontend/.env` and restart Vite.
