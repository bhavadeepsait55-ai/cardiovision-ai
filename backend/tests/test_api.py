from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import app, recordings


client = TestClient(app)


def test_upload_requires_consent_and_sampling_rate_for_csv() -> None:
    response = client.post(
        "/api/upload",
        files={"file": ("sample.csv", b"ecg\n0.1\n0.2\n")},
        data={"consent": "false", "sample_rate_hz": "250"},
    )
    assert response.status_code == 400
    response = client.post(
        "/api/upload",
        files={"file": ("sample.csv", b"ecg\n0.1\n0.2\n")},
        data={"consent": "true"},
    )
    assert response.status_code == 422


def test_csv_upload_standard_analysis_json_report_and_delete() -> None:
    values = "\n".join(f"{value:.7f}" for value in [0.0] * 100 + [1.0] + [0.0] * 900)
    uploaded = client.post(
        "/api/upload",
        files={"file": ("sample.csv", f"synthetic\n{values}".encode())},
        data={"consent": "true", "sample_rate_hz": "100"},
    )
    assert uploaded.status_code == 200
    recording_id = uploaded.json()["recording_id"]
    result = client.post(
        f"/api/recordings/{recording_id}/analyze",
        json={"mode": "standard", "channels": [0]},
    )
    assert result.status_code == 200
    assert result.json()["mode"] == "standard"
    report = client.get(f"/api/recordings/{recording_id}/report")
    assert report.status_code == 200
    assert report.content.startswith(b"%PDF")
    assert client.delete(f"/api/recordings/{recording_id}").status_code == 204
    assert recording_id not in recordings


def test_fetal_mode_rejects_non_edf_recording() -> None:
    rows = "a,b\n" + "\n".join("0.1,0.2" for _ in range(500))
    uploaded = client.post(
        "/api/upload",
        files={"file": ("sample.csv", rows.encode())},
        data={"consent": "true", "sample_rate_hz": "100"},
    )
    assert uploaded.status_code == 200
    recording_id = uploaded.json()["recording_id"]
    response = client.post(
        f"/api/recordings/{recording_id}/analyze",
        json={"mode": "fetal_research", "channels": [0, 1]},
    )
    assert response.status_code == 422
    client.delete(f"/api/recordings/{recording_id}")
