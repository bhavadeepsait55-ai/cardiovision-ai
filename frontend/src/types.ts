export interface Channel {
  index: number;
  name: string;
  sample_rate_hz: number;
  unit: string;
  sample_count: number;
  prefilter?: string | null;
  preview: { time_seconds: number[]; amplitude: number[] };
}

export interface RecordingMetadata {
  filename: string;
  format: string;
  duration_seconds: number;
  sample_rate_hz: number;
  channels: Channel[];
  research_mode_defaults: { reference_channel: number; abdominal_channel: number };
}

export interface AnalysisResult {
  mode: "standard" | "fetal_research";
  selected_channels: string[];
  selected_units: string[];
  sample_rate_hz: number;
  recording_filename: string;
  waveforms: Record<string, number[]>;
  heart_rate_bpm?: { mean: number | null; median: number | null };
  beat_count?: number;
  peak_indices?: number[];
  rr_intervals_ms?: number[];
  rr_statistics_ms?: Record<string, number | string | null>;
  maternal_heart_rate_bpm?: { mean: number | null; median: number | null; interval_count: number };
  fetal_heart_rate_bpm?: { mean: number | null; median: number | null; interval_count: number };
  maternal_peak_indices?: number[];
  fetal_peak_indices?: number[];
  maternal_interval_count?: number;
  fetal_interval_count?: number;
  quality: { status: string; note?: string; limitations?: string[] };
  processing: Record<string, unknown>;
}
