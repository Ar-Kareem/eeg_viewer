import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Plot from "react-plotly.js";
import "./styles.css";

const MAX_POINTS = 7000;

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

function formatMetric(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toExponential(4);
}

function EegChart({ data }) {
  if (!data) {
    return <div className="empty-chart">Select a subject, H5 file, and iEEG channel.</div>;
  }

  return (
    <Plot
      className="chart"
      data={[
        {
          x: data.x,
          y: data.y,
          type: "scattergl",
          mode: "lines",
          line: { color: "#1f6fb2", width: 1.5 },
          hovertemplate: "sample %{x}<br>value %{y:.6e}<extra></extra>",
        },
      ]}
      layout={{
        autosize: true,
        dragmode: "pan",
        margin: { l: 82, r: 26, t: 18, b: 56 },
        paper_bgcolor: "#fbfcfd",
        plot_bgcolor: "#fbfcfd",
        hovermode: "x unified",
        font: {
          family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          color: "#17202a",
          size: 12,
        },
        xaxis: {
          title: { text: "Sample index" },
          automargin: true,
          zeroline: false,
          gridcolor: "#dde5ec",
          tickformat: ",d",
          rangeslider: { visible: true, thickness: 0.08 },
        },
        yaxis: {
          title: { text: "Scaled value" },
          automargin: true,
          zeroline: false,
          gridcolor: "#dde5ec",
          exponentformat: "e",
          separatethousands: true,
        },
      }}
      config={{
        responsive: true,
        displaylogo: false,
        scrollZoom: true,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
      }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
    />
  );
}

function SelectField({ label, value, onChange, children, disabled = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
        {children}
      </select>
    </label>
  );
}

function App() {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState("");
  const [channel, setChannel] = useState("");
  const [plotData, setPlotData] = useState(null);
  const [status, setStatus] = useState("Loading subjects...");
  const [isLoading, setIsLoading] = useState(false);

  const selectedChannel = useMemo(
    () => channels.find((item) => String(item.id) === String(channel)),
    [channels, channel]
  );

  const selectedFile = useMemo(
    () => files.find((item) => item.id === file),
    [files, file]
  );

  useEffect(() => {
    api("/api/subjects")
      .then(({ subjects: rows }) => {
        setSubjects(rows);
        setSubject(rows[0] || "");
        setStatus(rows.length ? `${rows.length} subjects available` : "No subjects found");
      })
      .catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!subject) return;
    setFiles([]);
    setFile("");
    setChannels([]);
    setChannel("");
    setPlotData(null);
    setStatus("Loading H5 files...");
    api("/api/files", { subject })
      .then(({ files: rows }) => {
        setFiles(rows);
        setFile(rows[0]?.id || "");
        setStatus(rows.length ? `${rows.length} H5 files available` : "No H5 files found");
      })
      .catch((error) => setStatus(error.message));
  }, [subject]);

  useEffect(() => {
    if (!subject || !file) return;
    setChannels([]);
    setChannel("");
    setPlotData(null);
    setStatus("Loading iEEG channels...");
    api("/api/channels", { subject, file })
      .then(({ channels: rows }) => {
        setChannels(rows);
        setChannel(rows[0] ? String(rows[0].id) : "");
        setStatus(rows.length ? `${rows.length} iEEG channels available` : "No iEEG channels found");
      })
      .catch((error) => setStatus(error.message));
  }, [subject, file]);

  const plot = useCallback(() => {
    if (!subject || !file || channel === "") return;
    setIsLoading(true);
    setStatus("Reading H5 channel data...");
    api("/api/data", { subject, file, channel, max_points: MAX_POINTS })
      .then((data) => {
        setPlotData(data);
        setStatus(`Loaded ${data.window_samples.toLocaleString()} samples`);
      })
      .catch((error) => setStatus(error.message))
      .finally(() => setIsLoading(false));
  }, [subject, file, channel]);

  useEffect(() => {
    if (subject && file && channel !== "") {
      plot();
    }
  }, [subject, file, channel, plot]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">EEG</div>
          <div>
            <h1>H5 Signal Browser</h1>
            <p>iEEG channels from scaled H5 exports</p>
          </div>
        </div>

        <div className="control-stack">
          <SelectField label="Subject" value={subject} onChange={setSubject}>
            {subjects.map((item) => (
              <option key={item} value={item}>
                Subject {item}
              </option>
            ))}
          </SelectField>

          <SelectField label="H5 file" value={file} onChange={setFile} disabled={!files.length}>
            {files.map((item) => (
              <option key={item.id} value={item.id}>
                {item.h5}
              </option>
            ))}
          </SelectField>

          <SelectField label="iEEG channel" value={channel} onChange={setChannel} disabled={!channels.length}>
            {channels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}: {item.correct_ch || item.edf_ch || `channel_${item.id}`}
              </option>
            ))}
          </SelectField>

          <button className="primary" type="button" onClick={plot} disabled={isLoading || !channel}>
            {isLoading ? "Loading..." : "Reload Trace"}
          </button>
        </div>

        <section className="details">
          <h2>Selection</h2>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{selectedFile?.h5 || "-"}</dd>
            </div>
            <div>
              <dt>Channel index</dt>
              <dd>{selectedChannel?.id ?? "-"}</dd>
            </div>
            <div>
              <dt>Channel label</dt>
              <dd>{selectedChannel?.correct_ch || selectedChannel?.edf_ch || "-"}</dd>
            </div>
            <div>
              <dt>Displayed points</dt>
              <dd>{MAX_POINTS.toLocaleString()} max</dd>
            </div>
          </dl>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Scaled H5 trace</p>
            <h2>
              {plotData
                ? `Subject ${plotData.subject}, channel ${plotData.channel}`
                : "No trace loaded"}
            </h2>
          </div>
          <div className={`status ${isLoading ? "busy" : ""}`}>{status}</div>
        </header>

        <div className="metric-grid">
          <article>
            <span>Samples</span>
            <strong>{plotData ? plotData.window_samples.toLocaleString() : "-"}</strong>
          </article>
          <article>
            <span>Downsample step</span>
            <strong>{plotData ? plotData.downsample_step.toLocaleString() : "-"}</strong>
          </article>
          <article>
            <span>Min</span>
            <strong>{formatMetric(plotData?.min)}</strong>
          </article>
          <article>
            <span>Mean</span>
            <strong>{formatMetric(plotData?.mean)}</strong>
          </article>
          <article>
            <span>Max</span>
            <strong>{formatMetric(plotData?.max)}</strong>
          </article>
        </div>

        <section className="chart-panel">
          <div className="chart-title">
            <div>
              <h3>{selectedChannel?.correct_ch || selectedChannel?.edf_ch || "Trace"}</h3>
              <p>
                {plotData
                  ? `${plotData.file}.h5 samples ${plotData.start}-${plotData.stop}`
                  : "Waiting for data"}
              </p>
            </div>
          </div>
          <EegChart data={plotData} />
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
