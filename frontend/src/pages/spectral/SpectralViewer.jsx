import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";

async function api(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || response.statusText);
  }
  return payload;
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

const plotFont = {
  family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  color: "#17202a",
  size: 12,
};

export default function SpectralViewer({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState("");
  const [channel, setChannel] = useState("");
  const [start, setStart] = useState(0);
  const [points, setPoints] = useState(65536);
  const [sampleRate, setSampleRate] = useState(1024);
  const [fftSize, setFftSize] = useState(2048);
  const [spectralData, setSpectralData] = useState(null);
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api("/api/subjects")
      .then((payload) => {
        if (cancelled) return;
        setSubjects(payload.subjects || []);
        setSubject(payload.subjects?.[0] || "");
        setStatus(payload.subjects?.length ? "Pick a recording window." : "No subjects found.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!subject) return;
    let cancelled = false;
    setFiles([]);
    setFile("");
    setChannels([]);
    setChannel("");
    setSpectralData(null);
    setStatus("Loading H5 files...");
    api("/api/files", { subject })
      .then((payload) => {
        if (cancelled) return;
        const nextFiles = payload.files || [];
        setFiles(nextFiles);
        setFile(nextFiles[0]?.id || "");
        setStatus(nextFiles.length ? "Pick a channel." : "No H5 files found.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  useEffect(() => {
    if (!subject || !file) return;
    let cancelled = false;
    setChannels([]);
    setChannel("");
    setSpectralData(null);
    setStatus("Loading iEEG channels...");
    api("/api/channels", { subject, file })
      .then((payload) => {
        if (cancelled) return;
        const nextChannels = payload.channels || [];
        setChannels(nextChannels);
        setChannel(nextChannels[0] ? String(nextChannels[0].id) : "");
        setStatus(nextChannels.length ? "Ready for spectral analysis." : "No iEEG channels found.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject, file]);

  const loadSpectral = () => {
    if (!subject || !file || channel === "") return;
    setLoading(true);
    setStatus("Computing spectrum and spectrogram...");
    api("/api/spectral", {
      subject,
      file,
      channel,
      start,
      points,
      sample_rate: sampleRate,
      fft_size: fftSize,
    })
      .then((payload) => {
        setSpectralData(payload);
        setStatus(`Loaded ${payload.window_samples.toLocaleString()} samples for spectral analysis.`);
      })
      .catch((error) => {
        setSpectralData(null);
        setStatus(error.message);
      })
      .finally(() => setLoading(false));
  };

  const selectedChannel = useMemo(
    () => channels.find((item) => String(item.id) === String(channel)),
    [channels, channel]
  );

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">SP</div>
          <div>
            <h1>Spectral Viewer</h1>
            <p>Frequency-domain iEEG review</p>
          </div>
        </div>

        <button className="secondary" type="button" onClick={onBack}>
          Back to pages
        </button>

        <div className="control-stack">
          <label className="field">
            <span>Subject</span>
            <select value={subject} onChange={(event) => setSubject(event.target.value)}>
              {subjects.map((item) => (
                <option key={item} value={item}>
                  S_{item}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>H5 file</span>
            <select value={file} disabled={!files.length} onChange={(event) => setFile(event.target.value)}>
              {files.map((item, index) => (
                <option key={item.id} value={item.id}>
                  FILE {index} - {item.h5}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>iEEG channel</span>
            <select value={channel} disabled={!channels.length} onChange={(event) => setChannel(event.target.value)}>
              {channels.map((item) => (
                <option key={item.id} value={item.id}>
                  CH_{item.id} {item.correct_ch || item.edf_ch || ""}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Start sample</span>
            <input type="number" min="0" step="1024" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>

          <label className="field">
            <span>Window samples</span>
            <input type="number" min="128" max="262144" step="1024" value={points} onChange={(event) => setPoints(event.target.value)} />
          </label>

          <label className="field">
            <span>Samples / s</span>
            <input type="number" min="1" step="1" value={sampleRate} onChange={(event) => setSampleRate(event.target.value)} />
          </label>

          <label className="field">
            <span>FFT size</span>
            <input type="number" min="128" max="16384" step="128" value={fftSize} onChange={(event) => setFftSize(event.target.value)} />
          </label>

          <button className="primary" type="button" disabled={loading || !channel} onClick={loadSpectral}>
            {loading ? "Computing..." : "Run Spectral Analysis"}
          </button>
        </div>
      </aside>

      <section className="workspace spectral-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Spectral analysis</p>
            <h2>
              {spectralData
                ? `S_${spectralData.subject} CH_${spectralData.channel}`
                : selectedChannel
                  ? `S_${subject} CH_${selectedChannel.id}`
                  : "Spectral Viewer"}
            </h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid spectral-metrics" aria-label="Spectral summary">
          <article>
            <span>Window</span>
            <strong>{spectralData ? `${formatNumber(spectralData.start, 0)}-${formatNumber(spectralData.stop, 0)}` : "-"}</strong>
          </article>
          <article>
            <span>Samples</span>
            <strong>{formatNumber(spectralData?.window_samples, 0)}</strong>
          </article>
          <article>
            <span>FFT size</span>
            <strong>{formatNumber(spectralData?.fft_size, 0)}</strong>
          </article>
          <article className={spectralData?.line_noise?.flag ? "metric-warn" : ""}>
            <span>60 Hz ratio</span>
            <strong>{formatNumber(spectralData?.line_noise?.ratio, 2)}</strong>
          </article>
        </section>

        {spectralData ? (
          <>
            <section className="spectral-grid">
              <article className="chart-panel">
                <div className="chart-title">
                  <div>
                    <h3>Power Spectrum</h3>
                    <p>Welch-style average PSD, shown in dB.</p>
                  </div>
                </div>
                <div className="spectral-chart">
                  <Plot
                    data={[
                      {
                        x: spectralData.freqs,
                        y: spectralData.power_db,
                        type: "scatter",
                        mode: "lines",
                        line: { color: "#1f6fb2", width: 1.5 },
                        hovertemplate: "%{x:.2f} Hz<br>%{y:.2f} dB<extra></extra>",
                      },
                    ]}
                    layout={{
                      autosize: true,
                      margin: { l: 70, r: 24, t: 12, b: 58 },
                      paper_bgcolor: "#fbfcfd",
                      plot_bgcolor: "#fbfcfd",
                      font: plotFont,
                      xaxis: { title: { text: "Frequency (Hz)" }, gridcolor: "#dde5ec" },
                      yaxis: { title: { text: "Power (dB)" }, gridcolor: "#dde5ec" },
                      shapes: [
                        {
                          type: "rect",
                          xref: "x",
                          yref: "paper",
                          x0: 59,
                          x1: 61,
                          y0: 0,
                          y1: 1,
                          fillcolor: "#c43b47",
                          opacity: 0.16,
                          line: { width: 0 },
                        },
                      ],
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
              </article>

              <article className="chart-panel">
                <div className="chart-title">
                  <div>
                    <h3>Spectrogram</h3>
                    <p>Power over time up to 200 Hz.</p>
                  </div>
                </div>
                <div className="spectral-chart">
                  <Plot
                    data={[
                      {
                        x: spectralData.spectrogram.times,
                        y: spectralData.spectrogram.freqs,
                        z: spectralData.spectrogram.power_db,
                        type: "heatmap",
                        colorscale: "Viridis",
                        colorbar: { title: "dB" },
                        hovertemplate: "%{x:.2f}s<br>%{y:.2f} Hz<br>%{z:.2f} dB<extra></extra>",
                      },
                    ]}
                    layout={{
                      autosize: true,
                      margin: { l: 70, r: 24, t: 12, b: 58 },
                      paper_bgcolor: "#fbfcfd",
                      plot_bgcolor: "#fbfcfd",
                      font: plotFont,
                      xaxis: { title: { text: "Time in window (s)" }, gridcolor: "#dde5ec" },
                      yaxis: { title: { text: "Frequency (Hz)" }, gridcolor: "#dde5ec" },
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                </div>
              </article>
            </section>

            <section className="chart-panel">
              <div className="chart-title">
                <div>
                  <h3>Band Power</h3>
                  <p>Relative power by standard EEG bands.</p>
                </div>
              </div>
              <div className="band-grid">
                {spectralData.bands.map((band) => (
                  <article className="band-card" key={band.name}>
                    <span>{band.name.replace("_", " ")}</span>
                    <strong>{formatPercent(band.relative)}</strong>
                    <small>
                      {band.low}-{band.high} Hz
                    </small>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : (
          <div className="empty-chart">Run spectral analysis to view PSD, spectrogram, and band power summaries.</div>
        )}
      </section>
    </main>
  );
}
