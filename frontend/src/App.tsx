import { DragEvent, FormEvent, ReactNode, Suspense, lazy, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownToLine, AudioLines, BrainCircuit, Check, ChevronDown, CircleHelp,
  FileHeart, FilePlus2, HeartPulse, LayoutDashboard, Moon, RotateCcw, ShieldCheck,
  Sparkles, Sun, Trash2, UploadCloud, X,
} from "lucide-react";
import type { AnalysisResult, RecordingMetadata } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const Plot = lazy(() => import("./PlotComponent"));
const HeartScene = lazy(() => import("./HeartScene").then((module) => ({ default: module.HeartScene })));
type Page = "Dashboard" | "Upload ECG" | "Signal Analysis" | "3D Heart" | "Reports" | "About";
const navigation: { name: Page; icon: typeof LayoutDashboard }[] = [
  { name: "Dashboard", icon: LayoutDashboard },
  { name: "Upload ECG", icon: FilePlus2 },
  { name: "Signal Analysis", icon: AudioLines },
  { name: "3D Heart", icon: HeartPulse },
  { name: "Reports", icon: FileHeart },
  { name: "About", icon: CircleHelp },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.detail ?? message;
    } catch { /* The response may not be JSON. */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

function chartIndex(sampleIndex: number, sampleRate: number, times: number[]) {
  const duration = times[times.length - 1] ?? 0;
  if (times.length < 2 || duration <= 0) return 0;
  return Math.max(0, Math.min(times.length - 1, Math.round(sampleIndex / sampleRate / duration * (times.length - 1))));
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Chart({ title, times, values, unit, peaks = [], selectedEvent, onPeakSelect, color = "#43d7d0", maternalPeaks = [], range = null, onRangeChange, lightTheme = false }: {
  title: string; times: number[]; values: number[]; unit: string; peaks?: number[];
  selectedEvent?: number | null; onPeakSelect?: (index: number) => void; color?: string;
  maternalPeaks?: number[];
  range?: [number, number] | null; onRangeChange?: (range: [number, number] | null) => void;
  lightTheme?: boolean;
}) {
  const markerX = peaks.map((index) => times[index]).filter((value): value is number => value !== undefined);
  const markerY = peaks.map((index) => values[index]).filter((value): value is number => value !== undefined);
  const maternalX = maternalPeaks.map((index) => times[index]).filter((value): value is number => value !== undefined);
  const maternalY = maternalPeaks.map((index) => values[index]).filter((value): value is number => value !== undefined);
  const selectedX = selectedEvent !== null && selectedEvent !== undefined ? times[selectedEvent] : undefined;
  const selectedY = selectedEvent !== null && selectedEvent !== undefined ? values[selectedEvent] : undefined;
  return <div className="chart-wrap">
    <Suspense fallback={<div className="chart-loading">Preparing interactive waveform…</div>}>
    <Plot
      data={[
        { x: times, y: values, type: "scattergl", mode: "lines", name: title, line: { color, width: 1.4 }, hovertemplate: "%{x:.3f} s<br>%{y:.4g} " + unit + "<extra></extra>" },
        { x: markerX, y: markerY, type: "scatter", mode: "markers", name: "Detected events", marker: { color: "#b28aff", size: 7, symbol: "circle-open", line: { width: 2 } }, customdata: peaks, hovertemplate: "Event at %{x:.3f} s<extra></extra>" },
        ...(maternalPeaks.length ? [{ x: maternalX, y: maternalY, type: "scatter" as const, mode: "markers" as const, name: "Maternal suppression", marker: { color: "#f0a861", size: 7, symbol: "x" }, hovertemplate: "Maternal suppression at %{x:.3f} s<extra></extra>" }] : []),
        ...(selectedX !== undefined && selectedY !== undefined ? [{ x: [selectedX], y: [selectedY], type: "scatter" as const, mode: "markers" as const, name: "Selected", marker: { color: "#ffe38a", size: 11, symbol: "diamond" }, hovertemplate: "Selected event %{x:.3f} s<extra></extra>" }] : []),
      ]}
      layout={{
        title: { text: title, font: { color: lightTheme ? "#19313f" : "#e7f2fa", size: 14 }, x: 0.02 },
        paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: lightTheme ? "#526a77" : "#95aabd", family: "Inter, sans-serif", size: 11 },
        margin: { l: 56, r: 18, t: 42, b: 42 }, autosize: true,
        xaxis: { title: "Time (s)", gridcolor: "rgba(160,190,210,.09)", zerolinecolor: "rgba(160,190,210,.13)", rangeslider: { visible: true, thickness: 0.07 }, fixedrange: false, range: range ?? undefined, autorange: !range },
        yaxis: { title: unit === "Unknown" ? "Amplitude (unit unknown)" : `Amplitude (${unit})`, gridcolor: "rgba(160,190,210,.09)", zerolinecolor: "rgba(160,190,210,.13)" },
        legend: { orientation: "h", y: -0.22 }, dragmode: "pan", hovermode: "x unified",
      }}
      config={{ responsive: true, displaylogo: false, scrollZoom: true, modeBarButtonsToRemove: ["lasso2d", "select2d"] }}
      useResizeHandler
      style={{ width: "100%", height: "310px" }}
      onClick={(event) => {
        const x = event.points?.[0]?.x;
        if (typeof x !== "number" || !peaks.length || !onPeakSelect) return;
        const nearest = peaks.reduce((best, current) => Math.abs(times[current] - x) < Math.abs(times[best] - x) ? current : best, peaks[0]);
        onPeakSelect(nearest);
      }}
      onRelayout={(event) => {
        const left = event["xaxis.range[0]"];
        const right = event["xaxis.range[1]"];
        if (typeof left === "number" && typeof right === "number") onRangeChange?.([left, right]);
        else if (event["xaxis.autorange"] === true) onRangeChange?.(null);
      }}
    />
    </Suspense>
  </div>;
}

function App() {
  const [page, setPage] = useState<Page>("Dashboard");
  const [dark, setDark] = useState(true);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<RecordingMetadata | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [mode, setMode] = useState<"standard" | "fetal_research">("standard");
  const [standardChannel, setStandardChannel] = useState(0);
  const [referenceChannel, setReferenceChannel] = useState(0);
  const [abdominalChannel, setAbdominalChannel] = useState(1);
  const [sampleRate, setSampleRate] = useState("");
  const [amplitudeUnit, setAmplitudeUnit] = useState("unknown");
  const [lowHz, setLowHz] = useState("0.5");
  const [highHz, setHighHz] = useState("40");
  const [powerlineHz, setPowerlineHz] = useState("none");
  const [prominenceMultiplier, setProminenceMultiplier] = useState("1.5");
  const [minimumRrMs, setMinimumRrMs] = useState("250");
  const [maximumRrMs, setMaximumRrMs] = useState("2500");
  const [filterLength, setFilterLength] = useState("96");
  const [stepSize, setStepSize] = useState("0.1");
  const [maternalBlankMs, setMaternalBlankMs] = useState("90");
  const [convergenceSeconds, setConvergenceSeconds] = useState("10");
  const [segmentSeconds, setSegmentSeconds] = useState("60");
  const [maternalPeakHeight, setMaternalPeakHeight] = useState("1.5");
  const [fetalThresholdStd, setFetalThresholdStd] = useState("1.2");
  const [fetalHrMin, setFetalHrMin] = useState("110");
  const [fetalHrMax, setFetalHrMax] = useState("180");
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [selectedPeak, setSelectedPeak] = useState<number | null>(null);
  const [sharedRange, setSharedRange] = useState<[number, number] | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const previewChannel = metadata?.channels[mode === "standard" ? standardChannel : abdominalChannel];
  const pendingExtension = file?.name.split(".").pop()?.toLowerCase();
  const pendingTableRateValid = Boolean(sampleRate && Number(sampleRate) >= 20 && Number(sampleRate) <= 10000);
  const canUploadPendingFile = Boolean(
    file && consent && (pendingExtension === "edf" || pendingTableRateValid),
  );
  const fetalModeAvailable = Boolean(metadata?.format === "EDF" && metadata.channels.length >= 2
    && metadata.channels.every((channel) => channel.sample_rate_hz === metadata.channels[0].sample_rate_hz)
    && metadata.channels[0].sample_rate_hz >= 150
    && metadata.channels.every((channel) => channel.sample_count === metadata.channels[0].sample_count));
  const activePeaks = result?.mode === "standard" ? result.peak_indices ?? [] : result?.fetal_peak_indices ?? [];
  const selectedOrdinal = selectedPeak === null ? -1 : activePeaks.indexOf(selectedPeak);
  const selectedInterval = selectedOrdinal > 0 && result
    ? ((selectedPeak! - activePeaks[selectedOrdinal - 1]) / result.sample_rate_hz * 1000)
    : null;

  const upload = async (selectedFile: File | null) => {
    setError("");
    setResult(null);
    setRecordingId(null);
    setMetadata(null);
    setFile(null);
    setMode("standard");
    if (!selectedFile) return;
    const extension = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["edf", "csv", "txt"].includes(extension ?? "")) {
      setError("Choose an EDF, CSV, or TXT recording.");
      return;
    }
    if (selectedFile.size > 25 * 1024 * 1024) {
      setError("The maximum upload size is 25 MB.");
      return;
    }
    if (extension !== "edf" && (!sampleRate || Number(sampleRate) < 20 || Number(sampleRate) > 10000)) {
      setFile(selectedFile);
      setError("Enter the CSV/TXT sampling frequency (20–10,000 Hz) before uploading.");
      return;
    }
    if (!consent) {
      setFile(selectedFile);
      setError("The file is selected but has not uploaded. Confirm the notice, then choose Upload selected recording.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", selectedFile);
      body.append("consent", "true");
      if (extension !== "edf") {
        body.append("sample_rate_hz", sampleRate);
        body.append("amplitude_unit", amplitudeUnit);
      }
      const response = await request<{ recording_id: string; metadata: RecordingMetadata }>("/api/upload", { method: "POST", body });
      setFile(selectedFile);
      setRecordingId(response.recording_id);
      setMetadata(response.metadata);
      const defaults = response.metadata.research_mode_defaults;
      setStandardChannel(0);
      setReferenceChannel(defaults.reference_channel);
      setAbdominalChannel(defaults.abdominal_channel);
      setPage("Upload ECG");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The recording could not be uploaded.");
      setFile(selectedFile);
    } finally { setBusy(false); }
  };

  const analyze = async () => {
    if (!recordingId || !metadata) return;
    setError("");
    setBusy(true);
    setPage("Signal Analysis");
    try {
      const payload = {
        mode,
        channels: mode === "standard" ? [standardChannel] : [referenceChannel, abdominalChannel],
        low_hz: Number(lowHz),
        high_hz: Number(highHz),
        powerline_hz: powerlineHz === "none" ? null : Number(powerlineHz),
        prominence_mad_multiplier: Number(prominenceMultiplier),
        minimum_rr_ms: Number(minimumRrMs),
        maximum_rr_ms: Number(maximumRrMs),
        filter_length: Number(filterLength),
        step_size: Number(stepSize),
        maternal_blank_ms: Number(maternalBlankMs),
        convergence_seconds: Number(convergenceSeconds),
        segment_seconds: Number(segmentSeconds),
        maternal_peak_height: Number(maternalPeakHeight),
        fetal_threshold_std: Number(fetalThresholdStd),
        fetal_hr_min_bpm: Number(fetalHrMin),
        fetal_hr_max_bpm: Number(fetalHrMax),
      };
      const next = await request<AnalysisResult>(`/api/recordings/${recordingId}/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      setResult(next);
      setSelectedPeak(null);
      setSharedRange(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis could not be completed.");
    } finally { setBusy(false); }
  };

  const removeRecording = async () => {
    if (recordingId) {
      try { await request(`/api/recordings/${recordingId}`, { method: "DELETE" }); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the temporary recording."); return; }
    }
    setRecordingId(null); setMetadata(null); setResult(null); setFile(null); setPage("Dashboard"); setError("");
  };

  const downloadReport = async () => {
    if (!recordingId) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/recordings/${recordingId}/report`);
      if (!response.ok) throw new Error((await response.json()).detail ?? "Report generation failed.");
      const blob = await response.blob();
      saveBlob(blob, "cardiovision-analysis.pdf");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The report could not be downloaded."); }
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ metadata, analysis: result }, null, 2)], { type: "application/json" });
    saveBlob(blob, "cardiovision-analysis.json");
  };

  const explain = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!recordingId || !question.trim()) return;
    setAnswer("");
    try {
      const response = await request<{ answer: string }>(`/api/recordings/${recordingId}/explain`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }),
      });
      setAnswer(response.answer);
    } catch (reason) { setAnswer(reason instanceof Error ? reason.message : "Explanation unavailable."); }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void upload(dropped);
  };

  const chartData = useMemo(() => {
    if (!result) return null;
    const times = result.waveforms.time_seconds ?? [];
    const unit = result.mode === "fetal_research" ? "z-score" : result.selected_units[0] ?? "Unknown";
    return { times, unit, raw: result.waveforms.raw ?? [], processed: result.waveforms.filtered ?? result.waveforms.extracted ?? [] };
  }, [result]);

  return <div className={dark ? "app-shell dark-theme" : "app-shell light-theme"}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setPage("Dashboard"); }}>
        <span className="brand-mark"><Activity size={20} /></span>
        <span><strong>CardioVision</strong><small>AI · ECG WORKSTATION</small></span>
      </a>
      <div className="workspace-pill"><span className="live-dot" /> RESEARCH WORKSPACE</div>
      <p className="nav-caption">WORKSPACE</p>
      <nav>{navigation.map(({ name, icon: Icon }) =>
        <button key={name} onClick={() => setPage(name)} className={`nav-item ${page === name ? "selected" : ""}`}>
          <Icon size={17} strokeWidth={1.8} /><span>{name}</span>{name === "Signal Analysis" && result && <span className="nav-indicator" />}
        </button>)}</nav>
      <div className="sidebar-bottom">
        <div className="privacy-chip"><ShieldCheck size={16} /><span><b>Private by design</b><small>Temporary in-memory processing</small></span></div>
        <div className="profile"><div className="profile-avatar">CV</div><div><b>Research mode</b><small>No patient history stored</small></div><ChevronDown size={15} /></div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{page}</b></div>
        <div className="top-actions">
          <span className="system-status"><span className="live-dot" /> SYSTEM READY</span>
          <button className="icon-button" aria-label="Toggle theme" onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          {recordingId && <button className="icon-button danger-hover" aria-label="Remove current recording" onClick={() => void removeRecording()}><Trash2 size={16} /></button>}
        </div>
      </header>
      <div className="content">
        {error && <div className="alert" role="alert"><X size={16} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button></div>}
        {page === "Dashboard" && <Dashboard
          metadata={metadata} result={result} busy={busy} onNavigate={setPage} onAnalyze={analyze}
          onUpload={() => setPage("Upload ECG")} onHeart={() => setPage("3D Heart")} />
        }
        {page === "Upload ECG" && <section className="page-section">
          <PageTitle eyebrow="RECORDING INTAKE" title="Upload ECG" subtitle="Import a signal recording to explore its measured characteristics." />
          {!metadata ? <div className="upload-layout">
            <div className={`dropzone ${dragging ? "drag-active" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <input ref={inputRef} type="file" accept=".edf,.csv,.txt" hidden onChange={(e) => { void upload(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              <div className="upload-icon"><UploadCloud size={26} /></div>
              <h3>Drop your recording here</h3><p>or browse from your device</p>
              <button className="button-primary" onClick={() => inputRef.current?.click()}><FilePlus2 size={16} /> Browse files</button>
              <span className="file-types">EDF / EDF+ · CSV · TXT <i /> UP TO 25 MB</span>
            </div>
            <div className="panel intake-card">
              <p className="eyebrow">BEFORE YOU BEGIN</p>
              <h3>Safe, transparent processing</h3>
              <ul className="check-list">
                <li><Check size={15} />Temporary server-memory processing</li>
                <li><Check size={15} />No external AI or cloud transmission</li>
                <li><Check size={15} />Remove recording at any time</li>
              </ul>
              <label className="field-label" htmlFor="sample-rate">CSV / TXT sampling rate <span>required for tabular data</span></label>
              <div className="input-with-unit"><input id="sample-rate" type="number" min="20" max="10000" placeholder="e.g. 250" value={sampleRate} onChange={(e) => setSampleRate(e.target.value)} /><span>Hz</span></div>
              <label className="field-label unit-field" htmlFor="amplitude-unit">CSV / TXT amplitude unit <span>unknown unless you specify it</span></label>
              <select id="amplitude-unit" className="unit-select" value={amplitudeUnit} onChange={(e) => setAmplitudeUnit(e.target.value)}><option value="unknown">Unknown / do not label</option><option value="mV">mV</option><option value="µV">µV</option><option value="V">V</option><option value="counts">Counts</option></select>
              <label className="consent-row"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I have authorization to process this data and consent to temporary in-memory handling. I understand this tool is for research and education, not diagnosis.</span></label>
              {file && !metadata && <div className="pending-upload">
                <p className="pending-file"><FileHeart size={15} /> {file.name}</p>
                {canUploadPendingFile && <button className="button-primary" onClick={() => void upload(file)} disabled={busy}><UploadCloud size={15} /> Upload selected recording</button>}
                {file && !consent && <small>Check the authorization and temporary-processing box above to continue.</small>}
                {file && consent && pendingExtension !== "edf" && !pendingTableRateValid && <small>Enter a valid CSV/TXT sample rate above to continue.</small>}
              </div>}
              {busy && <div className="inline-progress"><span className="spinner" /> Validating and reading signal…</div>}
            </div>
          </div> : <div className="panel recording-card">
            <div className="recording-header">
              <div className="recording-file-icon"><FileHeart size={22} /></div>
              <div className="recording-name"><h3>{metadata.filename}</h3><span>{metadata.format} <i /> {formatDuration(metadata.duration_seconds)} <i /> {metadata.channels.length} channels</span></div>
              <button className="small-button danger-hover" onClick={() => void removeRecording()}><Trash2 size={14} /> Remove</button>
            </div>
            <div className="metadata-strip">
              <MetaStat label="Duration" value={formatDuration(metadata.duration_seconds)} />
              <MetaStat label="Base sample rate" value={`${metadata.sample_rate_hz.toLocaleString()} Hz`} />
              <MetaStat label="Data channels" value={String(metadata.channels.length)} />
              <MetaStat label="Format" value={metadata.format} />
            </div>
            <div className="mode-selector">
              <p className="eyebrow">CHOOSE WORKFLOW</p>
              <div className="mode-cards">
                <button className={mode === "standard" ? "mode-card active" : "mode-card"} onClick={() => setMode("standard")}>
                  <Activity size={19} /><b>Standard ECG</b><span>Waveform, peak and interval exploration for a selected ECG channel.</span>
                  {mode === "standard" && <span className="mode-check"><Check size={13} /></span>}
                </button>
                <button className={mode === "fetal_research" ? "mode-card active" : "mode-card"} disabled={!fetalModeAvailable} onClick={() => setMode("fetal_research")}>
                  <BrainCircuit size={19} /><b>Fetal ECG research</b><span>{fetalModeAvailable ? "NLMS cancellation for suitable maternal-abdominal EDF signals only." : "Requires a multi-channel EDF with matching signals sampled above 140 Hz."}</span>
                  {mode === "fetal_research" && <span className="mode-check"><Check size={13} /></span>}
                </button>
              </div>
            </div>
            {mode === "standard" ? <div className="channel-section">
              <label className="field-label" htmlFor="standard-channel">ECG channel</label>
              <select id="standard-channel" value={standardChannel} onChange={(e) => setStandardChannel(Number(e.target.value))}>
                {metadata.channels.map((channel) => <option key={channel.index} value={channel.index}>{channel.name} · {channel.sample_rate_hz} Hz · {channel.unit}</option>)}
              </select>
              <details className="settings-disclosure"><summary>Filtering parameters</summary><div className="settings-fields">
                <label>High-pass (Hz)<input type="number" min="0.05" max="100" step="0.05" value={lowHz} onChange={(e) => setLowHz(e.target.value)} /></label>
                <label>Low-pass (Hz)<input type="number" min="1" max="500" step="1" value={highHz} onChange={(e) => setHighHz(e.target.value)} /></label>
                <label>Power-line filter<select value={powerlineHz} onChange={(e) => setPowerlineHz(e.target.value)}><option value="none">Off</option><option value="50">50 Hz</option><option value="60">60 Hz</option></select></label>
                <label>Prominence × MAD<input type="number" min="0.1" max="10" step="0.1" value={prominenceMultiplier} onChange={(e) => setProminenceMultiplier(e.target.value)} /></label>
                <label>Min RR (ms)<input type="number" min="100" max="10000" value={minimumRrMs} onChange={(e) => setMinimumRrMs(e.target.value)} /></label>
                <label>Max RR (ms)<input type="number" min="100" max="10000" value={maximumRrMs} onChange={(e) => setMaximumRrMs(e.target.value)} /></label>
              </div><p>Filter bounds must remain below the selected channel's Nyquist frequency. RR bounds and prominence are exploratory detector settings.</p></details>
            </div> : <div className="channel-section fetal-channel-select">
              <div><label className="field-label" htmlFor="reference-channel">Thoracic reference</label><select id="reference-channel" value={referenceChannel} onChange={(e) => setReferenceChannel(Number(e.target.value))}>{metadata.channels.map((channel) => <option key={channel.index} value={channel.index}>{channel.name} · {channel.unit}</option>)}</select></div>
              <div><label className="field-label" htmlFor="abdomen-channel">Abdominal mixture</label><select id="abdomen-channel" value={abdominalChannel} onChange={(e) => setAbdominalChannel(Number(e.target.value))}>{metadata.channels.map((channel) => <option key={channel.index} value={channel.index}>{channel.name} · {channel.unit}</option>)}</select></div>
              <p className="fetal-warning">Research extraction only. Candidate peaks may contain residual maternal signal and artifacts. This fixed research bandpass is 3–70 Hz.</p>
              <details className="settings-disclosure fetal-settings"><summary>Fetal research parameters</summary><div className="settings-fields">
                <label>NLMS length<input type="number" min="2" max="512" value={filterLength} onChange={(e) => setFilterLength(e.target.value)} /></label>
                <label>NLMS step<input type="number" min="0.001" max="1" step="0.01" value={stepSize} onChange={(e) => setStepSize(e.target.value)} /></label>
                <label>Maternal blank (ms)<input type="number" min="0" max="300" value={maternalBlankMs} onChange={(e) => setMaternalBlankMs(e.target.value)} /></label>
                <label>Convergence (s)<input type="number" min="0" max="300" value={convergenceSeconds} onChange={(e) => setConvergenceSeconds(e.target.value)} /></label>
                <label>Segment (s)<input type="number" min="16" max="600" value={segmentSeconds} onChange={(e) => setSegmentSeconds(e.target.value)} /></label>
                <label>Maternal peak threshold<input type="number" min="0.1" max="10" step="0.1" value={maternalPeakHeight} onChange={(e) => setMaternalPeakHeight(e.target.value)} /></label>
                <label>Fetal envelope threshold (SD)<input type="number" min="0.1" max="10" step="0.1" value={fetalThresholdStd} onChange={(e) => setFetalThresholdStd(e.target.value)} /></label>
                <label>Research HR minimum (BPM)<input type="number" min="30" max="300" value={fetalHrMin} onChange={(e) => setFetalHrMin(e.target.value)} /></label>
                <label>Research HR maximum (BPM)<input type="number" min="30" max="300" value={fetalHrMax} onChange={(e) => setFetalHrMax(e.target.value)} /></label>
              </div><p>Requires matching thoracic/abdominal channels sampled above 140 Hz. HR bounds are configurable research filters, not diagnostic boundaries.</p></details>
            </div>}
            <div className="preview-heading"><div><p className="eyebrow">SIGNAL PREVIEW</p><h3>{previewChannel?.name ?? "Selected signal"}</h3></div><span className="unit-badge">{previewChannel?.unit ?? "Unknown units"}</span></div>
            {previewChannel && <Chart title="Raw signal preview" times={previewChannel.preview.time_seconds} values={previewChannel.preview.amplitude} unit={previewChannel.unit} lightTheme={!dark} />}
            <div className="recording-footer"><span><ShieldCheck size={14} /> No signal measurement is displayed as a diagnosis.</span><button className="button-primary" onClick={() => void analyze()} disabled={busy}>{busy ? <><span className="spinner" /> Processing…</> : <><Activity size={16} /> Run analysis</>}</button></div>
          </div>}
        </section>}
        {page === "Signal Analysis" && <section className="page-section">
          <PageTitle eyebrow="SIGNAL LABORATORY" title="Signal analysis" subtitle={metadata ? `${metadata.filename} · Interactive, zoomable ECG review` : "Upload a recording to begin signal analysis."} />
          {!result || !chartData ? <EmptyState onUpload={() => setPage("Upload ECG")} busy={busy} /> : <>
            <AnalysisSummary result={result} metadata={metadata} onReports={() => setPage("Reports")} />
            <div className="panel chart-panel">
              <div className="panel-heading"><div><p className="eyebrow">WAVEFORM LAB</p><h2>{result.mode === "standard" ? "Raw and processed signal" : "Abdominal mixture and fetal candidate"}</h2></div><button className="small-button" onClick={() => { setSelectedPeak(null); setSharedRange(null); }}><RotateCcw size={14} /> Reset view</button></div>
              {result.mode === "standard" ? <>
                <Chart title="Raw ECG" times={chartData.times} values={chartData.raw} unit={chartData.unit} range={sharedRange} onRangeChange={setSharedRange} lightTheme={!dark} />
                <Chart title="Filtered ECG · R-peak candidates" times={chartData.times} values={chartData.processed} unit={chartData.unit} range={sharedRange} onRangeChange={setSharedRange} peaks={result.peak_indices?.map((index) => chartIndex(index, result.sample_rate_hz, chartData.times))} selectedEvent={selectedPeak === null ? null : chartIndex(selectedPeak, result.sample_rate_hz, chartData.times)} onPeakSelect={(index) => {
                  const original = result.peak_indices?.reduce((best, current) => Math.abs(current / result.sample_rate_hz - chartData.times[index]) < Math.abs(best / result.sample_rate_hz - chartData.times[index]) ? current : best, result.peak_indices?.[0] ?? 0);
                  setSelectedPeak(original ?? null);
                }} color="#ae8aff" lightTheme={!dark} />
              </> : <>
                <Chart title="Abdominal mixture · normalized" times={chartData.times} values={chartData.raw} unit="z-score" range={sharedRange} onRangeChange={setSharedRange} lightTheme={!dark} />
                <Chart title="Extracted fetal candidate · detected peaks" times={chartData.times} values={chartData.processed} unit="z-score" range={sharedRange} onRangeChange={setSharedRange} peaks={result.fetal_peak_indices?.map((index) => chartIndex(index, result.sample_rate_hz, chartData.times))} maternalPeaks={result.maternal_peak_indices?.map((index) => chartIndex(index, result.sample_rate_hz, chartData.times))} selectedEvent={selectedPeak === null ? null : chartIndex(selectedPeak, result.sample_rate_hz, chartData.times)} onPeakSelect={(index) => {
                  const original = result.fetal_peak_indices?.reduce((best, current) => Math.abs(current / result.sample_rate_hz - chartData.times[index]) < Math.abs(best / result.sample_rate_hz - chartData.times[index]) ? current : best, result.fetal_peak_indices?.[0] ?? 0);
                  setSelectedPeak(original ?? null);
                }} color="#be8bff" lightTheme={!dark} />
                <p className="disclaimer-inline"><ShieldCheck size={15} /> This extracted trace may retain maternal residuals and artifacts. It is not a validated clinical measurement.</p>
              </>}
              {selectedPeak !== null && <div className="event-detail"><span className="event-pulse" /><div><b>Selected event</b><small>{(selectedPeak / result.sample_rate_hz).toFixed(3)} s{selectedInterval !== null ? ` · ${selectedInterval.toFixed(1)} ms since prior detected beat` : ""}</small></div></div>}
            </div>
            <div className="below-grid">
              <div className="panel settings-panel"><p className="eyebrow">PROCESSING SETTINGS</p><h3>Reproducible parameters</h3>
                {Object.entries(result.processing).map(([key, value]) => <div className="setting-row" key={key}><span>{key.replace(/_/g, " ")}</span><b>{Array.isArray(value) ? value.join("–") : String(value)}</b></div>)}
              </div>
              <Assistant recordingId={recordingId} question={question} setQuestion={setQuestion} answer={answer} setAnswer={setAnswer} onSubmit={explain} />
            </div>
          </>}
        </section>}
        {page === "3D Heart" && <section className="page-section">
          <PageTitle eyebrow="ANATOMICAL EXPLORER" title="Interactive adult heart" subtitle="Explore an educational procedural illustration and synchronize its timeline with measured ECG events." />
          <Suspense fallback={<div className="panel chart-loading">Loading educational 3D model…</div>}>
            <HeartScene
              event={selectedPeak}
              waveform={result && chartData ? {
                times: chartData.times,
                values: chartData.processed,
                unit: chartData.unit,
                peaks: activePeaks,
                sampleRate: result.sample_rate_hz,
              } : null}
              onEventSelect={setSelectedPeak}
            />
          </Suspense>
          <div className="info-card"><Sparkles size={16} /><span>This generated adult illustration is not a reviewed anatomical atlas or fetal model. ECG event markers reflect detected timestamps; surface ECG does not establish patient-specific anatomy or internal activation pathways.</span></div>
        </section>}
        {page === "Reports" && <section className="page-section">
          <PageTitle eyebrow="EVIDENCE & EXPORTS" title="Analysis reports" subtitle="Create a portable report from the currently processed measurements." />
          {!result ? <EmptyState onUpload={() => setPage("Upload ECG")} busy={false} /> : <div className="report-layout">
            <div className="panel report-card"><div className="report-icon"><FileHeart size={24} /></div><div><p className="eyebrow">CURRENT ANALYSIS</p><h2>{metadata?.filename}</h2><p>{result.mode === "standard" ? "Standard ECG analysis" : "Fetal ECG research extraction"} · {metadata ? formatDuration(metadata.duration_seconds) : ""}</p></div>
              <div className="report-actions"><button className="button-primary" onClick={() => void downloadReport()}><ArrowDownToLine size={16} /> Download PDF</button><button className="button-secondary" onClick={downloadJson}><ArrowDownToLine size={16} /> Export JSON</button></div>
            </div>
            <div className="panel"><p className="eyebrow">REPORT CONTENTS</p><div className="report-content-grid">
              {["Recording metadata & selected channels", "Signal processing configuration", "Detected beat markers & interval statistics", "Signal-quality heuristics and limitations", "Waveform overview", "Research / educational disclaimer"].map((item) => <div key={item}><Check size={15} />{item}</div>)}
            </div></div>
            <div className="disclaimer-inline"><ShieldCheck size={15} /> Reports are informational research output; they do not establish a normal or abnormal ECG.</div>
          </div>}
        </section>}
        {page === "About" && <About />}
      </div>
    </main>
  </div>;
}

function PageTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return <div className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div><div className="title-badge"><Activity size={16} /> Signal intelligence</div></div>;
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}

function Dashboard({ metadata, result, busy, onNavigate, onAnalyze, onUpload, onHeart }: {
  metadata: RecordingMetadata | null; result: AnalysisResult | null; busy: boolean;
  onNavigate: (page: Page) => void; onAnalyze: () => void; onUpload: () => void; onHeart: () => void;
}) {
  const rate = result?.mode === "standard"
    ? result.heart_rate_bpm?.median
    : result?.fetal_heart_rate_bpm?.median;
  const rateDisplay = rate == null ? "—" : `${rate.toFixed(0)} bpm`;
  return <section className="dashboard">
    <div className="hero">
      <div className="hero-copy"><div className="hero-label"><span className="live-dot" /> BIOMEDICAL SIGNAL WORKSTATION</div>
        <h1>See the signal.<br /><span>Understand the rhythm.</span></h1>
        <p>Explore ECG recordings with transparent signal processing, interactive visualization and research-ready reporting.</p>
        <div className="hero-buttons"><button className="button-primary" onClick={onUpload}><UploadCloud size={16} /> Upload ECG</button>{metadata && <button className="button-secondary" onClick={onAnalyze}><Activity size={16} /> Run analysis</button>}</div>
      </div>
      <div className="hero-visual"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="hero-heart"><HeartPulse size={72} strokeWidth={1.1} /></div><svg className="hero-ecg" viewBox="0 0 520 100" preserveAspectRatio="none" aria-label="Illustrative animated ECG waveform"><path d="M0 54 H110 L125 51 L138 55 H180 L192 55 L205 54 L216 53 L227 56 L239 51 L250 54 L260 54 L273 53 L282 55 L294 51 L302 54 L317 54 L329 48 L338 65 L349 15 L360 84 L371 48 L382 54 H520" /></svg><span className="visual-caption">SIGNAL VISUALIZATION · ILLUSTRATIVE</span></div>
    </div>
    <div className="dashboard-heading"><div><p className="eyebrow">OVERVIEW</p><h2>Analysis workspace</h2></div><span className="session-tag"><span className="live-dot" /> SESSION ONLY</span></div>
    <div className="metric-grid">
      <MetricCard icon={<Activity size={17} />} label="RECORDING DURATION" value={metadata ? formatDuration(metadata.duration_seconds) : "—"} detail={metadata?.filename ?? "Upload a recording to get started"} accent="cyan" />
      <MetricCard icon={<HeartPulse size={17} />} label="ESTIMATED HEART RATE" value={rateDisplay} detail={result?.mode === "fetal_research" ? "Fetal candidate · exploratory only" : result ? "Algorithm-derived estimate" : "No completed analysis"} accent="violet" />
      <MetricCard icon={<AudioLines size={17} />} label="DETECTED EVENTS" value={result ? String(result.beat_count ?? result.fetal_peak_indices?.length ?? 0) : "—"} detail={result ? "Candidate peak markers" : "Awaiting signal analysis"} accent="blue" />
      <MetricCard icon={<ShieldCheck size={17} />} label="SIGNAL QUALITY" value={result?.quality.status ?? "Not assessed"} detail="Heuristic indicator · not diagnostic" accent="teal" />
    </div>
    {busy && <div className="processing-banner"><span className="processing-wave"><i /><i /><i /><i /><i /></span><span><b>Processing signal</b><small>Measurements will appear when analysis completes.</small></span></div>}
    <div className="dashboard-grid">
      <div className="panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVE RECORDING</p><h3>{metadata?.filename ?? "No recording selected"}</h3></div>{metadata && <button className="text-button" onClick={() => onNavigate("Upload ECG")}>View details <span>↗</span></button>}</div>
        {metadata ? <><div className="active-recording-info"><span><Activity size={15} /> {metadata.format}</span><span><AudioLines size={15} /> {metadata.channels.length} channels</span><span><HeartPulse size={15} /> {result?.mode === "fetal_research" ? "Fetal research" : result ? "Standard ECG" : "Not processed"}</span></div>
          {result ? <div className="mini-result"><b>{result.quality.status}</b><span>Last analysis available in this session only</span><button className="text-button" onClick={() => onNavigate("Signal Analysis")}>Open analysis →</button></div> : <div className="mini-empty"><span className="mini-wave">∿ ∿ ∿</span><p>Select channels and choose a workflow to begin.</p><button className="button-secondary" onClick={() => onNavigate("Upload ECG")}>Review recording</button></div>}
        </> : <div className="mini-empty"><div className="empty-wave"><Activity size={28} /></div><p>Upload an ECG recording to see metadata, channels and analysis options.</p><button className="button-secondary" onClick={onUpload}><UploadCloud size={15} /> Start with a recording</button></div>}
      </div>
      <div className="panel quick-panel"><p className="eyebrow">EXPLORE</p><h3>Research tools</h3>
        <button className="quick-link" onClick={() => onNavigate("Signal Analysis")}><span className="quick-icon cyan"><AudioLines size={16} /></span><span><b>Signal laboratory</b><small>Inspect waveform and detected peaks</small></span><span className="arrow">↗</span></button>
        <button className="quick-link" onClick={onHeart}><span className="quick-icon pink"><HeartPulse size={16} /></span><span><b>3D heart explorer</b><small>Explore illustrative anatomy</small></span><span className="arrow">↗</span></button>
        <button className="quick-link" onClick={() => onNavigate("Reports")}><span className="quick-icon purple"><FileHeart size={16} /></span><span><b>Evidence report</b><small>Download PDF or structured JSON</small></span><span className="arrow">↗</span></button>
      </div>
    </div>
    <div className="disclaimer-inline"><ShieldCheck size={15} /> Research and education only. Signal filtering or an apparently typical heart rate does not establish a normal ECG.</div>
  </section>;
}

function MetricCard({ icon, label, value, detail, accent }: { icon: ReactNode; label: string; value: string; detail: string; accent: string }) {
  return <div className={`metric-card ${accent}`}><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function AnalysisSummary({ result, metadata, onReports }: { result: AnalysisResult; metadata: RecordingMetadata | null; onReports: () => void }) {
  const metrics = result.mode === "standard" ? [
    { label: "Median rate", value: result.heart_rate_bpm?.median == null ? "—" : `${result.heart_rate_bpm.median.toFixed(1)} bpm` },
    { label: "Mean rate", value: result.heart_rate_bpm?.mean == null ? "—" : `${result.heart_rate_bpm.mean.toFixed(1)} bpm` },
    { label: "Detected peaks", value: String(result.beat_count ?? 0) },
    { label: "Signal quality", value: result.quality.status },
  ] : [
    { label: "Maternal median", value: result.maternal_heart_rate_bpm?.median == null ? "—" : `${result.maternal_heart_rate_bpm.median.toFixed(1)} bpm` },
    { label: "Fetal candidate", value: result.fetal_heart_rate_bpm?.median == null ? "—" : `${result.fetal_heart_rate_bpm.median.toFixed(1)} bpm` },
    { label: "Fetal candidates", value: String(result.fetal_peak_indices?.length ?? 0) },
    { label: "Research status", value: result.quality.status },
  ];
  return <div className="analysis-summary"><div className="summary-intro"><div><span className="mode-pill">{result.mode === "standard" ? "STANDARD ECG" : "FETAL ECG · RESEARCH"}</span><h2>{metadata?.filename ?? result.recording_filename}</h2><p>{result.selected_channels.join(" + ")} · {metadata ? formatDuration(metadata.duration_seconds) : ""} · {result.sample_rate_hz.toLocaleString()} Hz</p></div><button className="small-button" onClick={onReports}><ArrowDownToLine size={14} /> Report</button></div>
    <div className="summary-metrics">{metrics.map(({ label, value }) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
  </div>;
}

function EmptyState({ onUpload, busy }: { onUpload: () => void; busy: boolean }) {
  return <div className="empty-state panel"><div className="empty-state-icon">{busy ? <span className="spinner large" /> : <AudioLines size={27} />}</div><h2>{busy ? "Processing your signal" : "No completed analysis yet"}</h2><p>{busy ? "The measurements will appear when processing finishes." : "Upload a recording, choose an analysis mode and select the channels to inspect."}</p>{!busy && <button className="button-primary" onClick={onUpload}><UploadCloud size={15} /> Upload a recording</button>}</div>;
}

function Assistant({ recordingId, question, setQuestion, answer, setAnswer, onSubmit }: {
  recordingId: string | null; question: string; setQuestion: (value: string) => void; answer: string;
  setAnswer: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <div className="panel assistant-panel"><div className="assistant-heading"><span className="assistant-icon"><Sparkles size={16} /></span><span><p className="eyebrow">EDUCATIONAL ASSISTANT</p><h3>Explain my ECG data</h3></span></div>
    <p>Ask about calculated values, detected peaks, or signal-processing limits. Answers use only the completed local analysis.</p>
    <form onSubmit={onSubmit}><input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How was heart rate calculated?" disabled={!recordingId} /><button type="submit" disabled={!recordingId || !question.trim()} aria-label="Ask question">↗</button></form>
    {!recordingId && <small className="muted">Complete an analysis to ask a question.</small>}
    {answer && <div className="assistant-answer">{answer}<button onClick={() => setAnswer("")} aria-label="Clear answer"><X size={12} /></button></div>}
  </div>;
}

function About() {
  return <section className="page-section"><PageTitle eyebrow="PLATFORM NOTES" title="About CardioVision AI" subtitle="Transparent ECG exploration built for research and education." />
    <div className="about-grid"><div className="panel"><span className="quick-icon cyan"><Activity size={18} /></span><h3>Measured, not imagined</h3><p>Signal characteristics are calculated from uploaded samples. If a valid estimate is unavailable, the application reports it as unavailable instead of substituting a plausible value.</p></div>
      <div className="panel"><span className="quick-icon purple"><BrainCircuit size={18} /></span><h3>Separate research workflow</h3><p>Fetal extraction is an exploratory NLMS workflow for suitable maternal-abdominal recordings. It is not applied to ordinary ECG files and is not clinically validated.</p></div>
      <div className="panel"><span className="quick-icon teal"><ShieldCheck size={18} /></span><h3>Privacy & deployment</h3><p>Recordings are held in application memory and deleted when the session is removed or the backend restarts. Production use requires access controls, encryption, retention limits, operational safeguards and applicable regulatory review.</p></div>
      <div className="panel"><span className="quick-icon pink"><HeartPulse size={18} /></span><h3>Illustrative 3D anatomy</h3><p>The heart model is a conceptual educational visualization. Surface ECG data does not reveal a patient's 3D anatomy or exact activation sequence.</p></div>
    </div>
    <div className="medical-disclaimer"><ShieldCheck size={17} /><div><b>Research and educational use only</b><p>This software is not a medical device and does not provide diagnosis or treatment advice. A clinician should interpret medical concerns and ECG recordings.</p></div></div>
  </section>;
}

export default App;
