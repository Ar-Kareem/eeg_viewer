import React, { useCallback, useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";

const DEFAULT_MAX_POINTS = 7000;
const CHANNEL_COLORS = [
  "#1f6fb2",
  "#d1495b",
  "#2a9d8f",
  "#f28e2b",
  "#7b61ff",
  "#4e79a7",
  "#59a14f",
  "#af7aa1",
  "#e15759",
  "#76b7b2",
];

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

  const snippetShapes = (data.snippets || []).map((snippet, index) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: snippet.start,
    x1: snippet.stop,
    y0: 0,
    y1: 1,
    fillcolor: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
    opacity: 0.18,
    line: { width: 0 },
    layer: "below",
  }));
  const snippetAnnotations = (data.snippets || []).map((snippet, index) => ({
    xref: "x",
    yref: "paper",
    x: (snippet.start + snippet.stop) / 2,
    y: 0.985,
    text: `S${index + 1}`,
    showarrow: false,
    yanchor: "top",
    font: { size: 11, color: CHANNEL_COLORS[index % CHANNEL_COLORS.length] },
    bgcolor: "rgba(255,255,255,0.78)",
    bordercolor: CHANNEL_COLORS[index % CHANNEL_COLORS.length],
    borderwidth: 1,
    borderpad: 2,
  }));

  return (
    <div className="chart single-chart">
      <Plot
        divId="single-channel-plot"
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
          margin: { l: 82, r: 26, t: 18, b: 78 },
          paper_bgcolor: "#fbfcfd",
          plot_bgcolor: "#fbfcfd",
          hovermode: "x unified",
          shapes: snippetShapes,
          annotations: snippetAnnotations,
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
            rangeslider: { visible: true, thickness: 0.1 },
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
    </div>
  );
}

function SnippetGrid({ snippets, yRange }) {
  if (!snippets?.length) {
    return null;
  }

  return (
    <div className="snippet-grid">
      {snippets.map((snippet, index) => (
        <article className="snippet-card" key={`${snippet.start}-${snippet.stop}`}>
          <header>
            <span>Random 1s sample {index + 1}</span>
            <strong>
              {snippet.start.toLocaleString()}-{snippet.stop.toLocaleString()}
            </strong>
          </header>
          <Plot
            className="snippet-plot"
            data={[
              {
                x: snippet.x,
                y: snippet.y,
                type: "scattergl",
                mode: "lines",
                line: { color: CHANNEL_COLORS[index % CHANNEL_COLORS.length], width: 1.25 },
                hovertemplate: "sample %{x}<br>value %{y:.6e}<extra></extra>",
              },
            ]}
            layout={{
              autosize: true,
              margin: { l: 44, r: 8, t: 8, b: 30 },
              paper_bgcolor: "#fbfcfd",
              plot_bgcolor: "#fbfcfd",
              font: { size: 10, color: "#445466" },
              xaxis: {
                automargin: true,
                zeroline: false,
                gridcolor: "#edf2f6",
                tickformat: ",d",
              },
              yaxis: {
                automargin: true,
                zeroline: false,
                gridcolor: "#edf2f6",
                exponentformat: "e",
                range: yRange,
              },
            }}
            config={{
              responsive: true,
              displaylogo: false,
              scrollZoom: true,
              modeBarButtonsToRemove: ["lasso2d", "select2d"],
            }}
            useResizeHandler
            style={{ width: "100%", height: "170px" }}
          />
        </article>
      ))}
    </div>
  );
}

function AllChannelsChart({ data }) {
  const chartHeight = data?.traces?.length ? Math.max(900, data.traces.length * 34 + 160) : 620;
  const plotData = useMemo(() => {
    if (!data?.traces?.length) return [];
    const rowCount = data.traces.length;

    return data.traces.map((trace, index) => {
      const min = trace.min ?? Math.min(...trace.y);
      const max = trace.max ?? Math.max(...trace.y);
      const span = max - min || 1;
      const row = rowCount - index;
      return {
        x: trace.x,
        y: trace.y.map((value) => row + ((value - min) / span - 0.5) * 0.5),
        type: "scattergl",
        mode: "lines",
        name: `${trace.id}: ${trace.label}`,
        line: { color: CHANNEL_COLORS[index % CHANNEL_COLORS.length], width: 1 },
        hovertemplate: `${trace.id}: ${trace.label}<br>sample %{x}<br>scaled %{customdata:.6e}<extra></extra>`,
        customdata: trace.y,
      };
    });
  }, [data]);

  if (!data) {
    return <div className="empty-chart">Loading stacked iEEG traces...</div>;
  }

  const labels = data.traces.map((trace) => `${trace.id}: ${trace.label}`).reverse();

  return (
    <Plot
      divId="stacked-channel-plot"
      className="chart all-chart"
      data={plotData}
      layout={{
        autosize: true,
        dragmode: "pan",
        showlegend: false,
        margin: { l: 118, r: 24, t: 18, b: 56 },
        paper_bgcolor: "#fbfcfd",
        plot_bgcolor: "#fbfcfd",
        hovermode: "closest",
        font: {
          family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          color: "#17202a",
          size: 11,
        },
        xaxis: {
          title: { text: "Sample index" },
          automargin: true,
          zeroline: false,
          gridcolor: "#e5ebf1",
          tickformat: ",d",
        },
        yaxis: {
          tickmode: "array",
          tickvals: labels.map((_, index) => index + 1),
          ticktext: labels,
          range: [0.35, data.traces.length + 0.65],
          automargin: true,
          zeroline: false,
          gridcolor: "#edf2f6",
        },
      }}
      config={{
        responsive: true,
        displaylogo: false,
        scrollZoom: true,
        modeBarButtonsToRemove: ["lasso2d", "select2d"],
      }}
      useResizeHandler
      style={{ width: "100%", height: `${chartHeight}px` }}
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

export default function EegViewer({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState("");
  const [channel, setChannel] = useState("");
  const [maxPoints, setMaxPoints] = useState(DEFAULT_MAX_POINTS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAllChannels, setShowAllChannels] = useState(false);
  const [plotData, setPlotData] = useState(null);
  const [allChannelData, setAllChannelData] = useState(null);
  const [status, setStatus] = useState("Loading subjects...");
  const [isLoading, setIsLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  const selectedChannel = useMemo(
    () => channels.find((item) => String(item.id) === String(channel)),
    [channels, channel]
  );

  const selectionCode = `${subject},${file},${channel}`;
  const normalizedMaxPoints = Math.max(100, Math.floor(Number(maxPoints) || DEFAULT_MAX_POINTS));

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
    setAllChannelData(null);
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
    setAllChannelData(null);
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
    api("/api/data", { subject, file, channel, max_points: normalizedMaxPoints })
      .then((data) => {
        setPlotData(data);
        setStatus(`Loaded ${data.window_samples.toLocaleString()} samples`);
      })
      .catch((error) => setStatus(error.message))
      .finally(() => setIsLoading(false));
  }, [subject, file, channel, normalizedMaxPoints]);

  const loadAllChannels = useCallback(() => {
    if (!subject || !file || !showAllChannels) return;
    setIsLoading(true);
    setStatus("Reading all iEEG channels...");
    api("/api/all-data", { subject, file, max_points: normalizedMaxPoints })
      .then((data) => {
        setAllChannelData(data);
        setStatus(`Loaded ${data.traces.length.toLocaleString()} iEEG channel rows`);
      })
      .catch((error) => setStatus(error.message))
      .finally(() => setIsLoading(false));
  }, [subject, file, normalizedMaxPoints, showAllChannels]);

  useEffect(() => {
    if (subject && file && channel !== "") {
      plot();
    }
  }, [subject, file, channel, plot]);

  useEffect(() => {
    if (showAllChannels) {
      loadAllChannels();
    }
  }, [showAllChannels, loadAllChannels]);

  const copySelectionCode = useCallback((label) => {
    if (!subject || !file || channel === "") return;
    navigator.clipboard
      .writeText(`${subject}\t${file}\t${channel}\t${label}\n`)
      .then(() => {
        setCopyStatus(`Copied ${label}`);
        window.setTimeout(() => setCopyStatus(""), 1400);
      })
      .catch(() => setCopyStatus("Copy failed"));
  }, [channel, file, subject]);

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

        <button className="secondary" type="button" onClick={onBack}>
          Back to Pages
        </button>

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

          <button className="secondary" type="button" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? "Hide Advanced" : "Advanced Settings"}
          </button>
        </div>

        {showAdvanced && (
          <section className="advanced">
            <label className="field">
              <span>Max plotted points</span>
              <input
                type="number"
                min="100"
                step="100"
                value={maxPoints}
                onChange={(event) => setMaxPoints(event.target.value)}
                onBlur={() => setMaxPoints(normalizedMaxPoints)}
              />
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={showAllChannels}
                onChange={(event) => setShowAllChannels(event.target.checked)}
              />
              <span>Show all iEEG channels</span>
            </label>
            {showAllChannels && (
              <button className="secondary" type="button" onClick={loadAllChannels} disabled={isLoading}>
                Reload All Channels
              </button>
            )}
          </section>
        )}

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

        <div className="copy-toolbar">
          <div>
            <span>Google Sheets row</span>
            <code>{selectionCode}</code>
          </div>
          <div className="copy-actions">
            <div className="copy-button-row">
              <button className="copy-yes" type="button" onClick={() => copySelectionCode("YES")}>
                Copy YES
              </button>
              <button className="copy-no" type="button" onClick={() => copySelectionCode("NO")}>
                Copy NO
              </button>
            </div>
            <span className={copyStatus ? "copy-status visible" : "copy-status"}>{copyStatus || "Copied"}</span>
          </div>
        </div>

        <section className="chart-panel">
          <div className="chart-title">
            <div>
              <h3>{selectedChannel?.correct_ch || selectedChannel?.edf_ch || "Trace"}</h3>
              <p>
                {plotData
                  ? `${plotData.file}.h5 samples ${plotData.start}-${plotData.stop}, snippets assume ${plotData.snippet_sample_rate} Hz`
                  : "Waiting for data"}
              </p>
            </div>
          </div>
          <SnippetGrid snippets={plotData?.snippets} yRange={plotData ? [plotData.min, plotData.max] : undefined} />
          <EegChart data={plotData} />
        </section>

        {showAllChannels && (
          <section className="chart-panel">
            <div className="chart-title">
              <div>
                <h3>All iEEG channels</h3>
                <p>
                  {allChannelData
                    ? `${allChannelData.traces.length} rows, step ${allChannelData.downsample_step}`
                    : "Waiting for all-channel data"}
                </p>
              </div>
            </div>
            <AllChannelsChart data={allChannelData} />
          </section>
        )}
      </section>
    </main>
  );
}
