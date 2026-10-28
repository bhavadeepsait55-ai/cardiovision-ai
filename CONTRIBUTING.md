# Contributing

Thank you for helping improve CardioVision AI. Contributions should preserve the application's research-and-education scope and avoid overstating medical or anatomical accuracy.

## Before opening a pull request

1. Check open issues and describe the problem or proposed change.
2. Keep changes focused. For signal-processing work, state the assumptions, sampling/calibration requirements, failure modes, and validation evidence.
3. Do not add patient recordings, generated reports from real recordings, personal data, credentials, or API tokens.
4. Do not add an external AI provider or upload workflow without explicit privacy/security design, consent, and documentation.
5. For 3D assets, verify the asset's anatomy, provenance, redistribution rights, and license before checking in or fetching it. Clearly identify illustrative versus clinically reviewed content.

## Development checks

From the repository root with the Python virtual environment active:

```powershell
python -m pytest backend\tests -q
```

```bash
python -m pytest backend/tests -q
```

From `frontend/`:

```text
npm ci
npm run build
```

The frontend build performs the TypeScript project check. There is currently no frontend test or lint script; do not report those checks as passing until configured and run.

## Pull request workflow

- Create a topic branch and make small, descriptive commits.
- Include tests for behavior changes and update user/developer documentation.
- Summarize the change, validation performed, known limitations, and any privacy or clinical-scope impact.
- Never include secrets, real patient data, unlicensed models, or claims of clinical validation without evidence.

## Adding a processing method

Implement a separate function in `backend/app/processing/`, validate shape/rate/finite values and parameter bounds, return unavailable measurements as unavailable (not plausible defaults), include settings/limitations in results, and add synthetic tests. Reference-annotation validation must be described separately from synthetic unit tests.
