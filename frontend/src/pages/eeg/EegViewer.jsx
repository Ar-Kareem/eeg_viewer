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

function percentileRange(values, lowerPercentile, upperPercentile) {
  const sortedValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sortedValues.length) return undefined;
  const percentile = (p) =>
    sortedValues[Math.min(sortedValues.length - 1, Math.max(0, Math.floor((p / 100) * (sortedValues.length - 1))))];
  const lower = percentile(lowerPercentile);
  const upper = percentile(upperPercentile);
  return lower === upper ? undefined : [lower, upper];
}

function formatXValues(values, xScaleMode, sampleRate) {
  if (xScaleMode !== "seconds") return values;
  const rate = Math.max(1, Number(sampleRate) || 1);
  return values.map((value) => value / rate);
}

function formatXValue(value, xScaleMode, sampleRate) {
  if (xScaleMode !== "seconds") return value;
  return value / Math.max(1, Number(sampleRate) || 1);
}

function xAxisTitle(xScaleMode) {
  return xScaleMode === "seconds" ? "Seconds" : "Sample index";
}

function xHoverLabel(xScaleMode) {
  return xScaleMode === "seconds" ? "seconds" : "sample";
}

function EegChart({ data, xScaleMode, sampleRate, yRange }) {
  if (!data) {
    return <div className="empty-chart">Select a subject, H5 file, and iEEG channel.</div>;
  }

  const xValues = formatXValues(data.x, xScaleMode, sampleRate);
  const snippetShapes = (data.snippets || []).map((snippet, index) => ({
    type: "rect",
    xref: "x",
    yref: "paper",
    x0: formatXValue(snippet.start, xScaleMode, sampleRate),
    x1: formatXValue(snippet.stop, xScaleMode, sampleRate),
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
    x: formatXValue((snippet.start + snippet.stop) / 2, xScaleMode, sampleRate),
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
            x: xValues,
            y: data.y,
            type: "scattergl",
            mode: "lines",
            line: { color: "#1f6fb2", width: 1.5 },
            hovertemplate: `${xHoverLabel(xScaleMode)} %{x}<br>value %{y:.6e}<extra></extra>`,
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
            title: { text: xAxisTitle(xScaleMode) },
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
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

function SnippetGrid({ snippets, yRange, xScaleMode, sampleRate }) {
  if (!snippets?.length) {
    return null;
  }

  return (
    <div className="snippet-grid">
      {snippets.map((snippet, index) => (
        <article className="snippet-card" key={`${snippet.start}-${snippet.stop}`}>
          <header>
            <span>sample {index + 1}</span>
            <strong>
              {xScaleMode === "seconds"
                ? `${formatXValue(snippet.start, xScaleMode, sampleRate).toFixed(2)}-${formatXValue(
                    snippet.stop,
                    xScaleMode,
                    sampleRate
                  ).toFixed(2)}s`
                : `${snippet.start.toLocaleString()}-${snippet.stop.toLocaleString()}`}
            </strong>
          </header>
          <Plot
            className="snippet-plot"
            data={[
              {
                x: formatXValues(snippet.x, xScaleMode, sampleRate),
                y: snippet.y,
                type: "scattergl",
                mode: "lines",
                line: { color: CHANNEL_COLORS[index % CHANNEL_COLORS.length], width: 1.25 },
                hovertemplate: `${xHoverLabel(xScaleMode)} %{x}<br>value %{y:.6e}<extra></extra>`,
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

function AllChannelsChart({ data, lowerPercentile, upperPercentile, xScaleMode, sampleRate }) {
  const chartHeight = data?.traces?.length ? Math.max(900, data.traces.length * 34 + 160) : 620;
  const plotData = useMemo(() => {
    if (!data?.traces?.length) return [];
    const rowCount = data.traces.length;
    const sortedValues = data.traces
      .flatMap((trace) => trace.y)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const percentile = (p) => {
      if (!sortedValues.length) return 0;
      return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, Math.floor(p * (sortedValues.length - 1))))];
    };
    const globalMin = percentile(lowerPercentile / 100);
    const globalMax = percentile(upperPercentile / 100);
    const globalSpan = globalMax - globalMin || 1;

    return data.traces.map((trace, index) => {
      const row = rowCount - index;
      return {
        x: formatXValues(trace.x, xScaleMode, sampleRate),
        y: trace.y.map((value) => row + ((value - globalMin) / globalSpan - 0.5) * 0.82),
        type: "scattergl",
        mode: "lines",
        name: `${trace.id}: ${trace.label}`,
        line: { color: CHANNEL_COLORS[index % CHANNEL_COLORS.length], width: 1 },
        hovertemplate: `${trace.id}: ${trace.label}<br>${xHoverLabel(
          xScaleMode
        )} %{x}<br>scaled %{customdata:.6e}<extra></extra>`,
        customdata: trace.y,
      };
    });
  }, [data, lowerPercentile, sampleRate, upperPercentile, xScaleMode]);

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
          title: { text: xAxisTitle(xScaleMode) },
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

function StackedSettingsModal({
  lowerPercentile,
  upperPercentile,
  samplesPerChannel,
  onClose,
  onApply,
}) {
  const [draftLowerPercentile, setDraftLowerPercentile] = useState(lowerPercentile);
  const [draftUpperPercentile, setDraftUpperPercentile] = useState(upperPercentile);
  const [draftSamplesPerChannel, setDraftSamplesPerChannel] = useState(samplesPerChannel);

  const applyDraft = () => {
    const normalizedLower = Math.max(0, Math.min(99.99, Number(draftLowerPercentile) || 0));
    const normalizedUpper = Math.max(normalizedLower + 0.01, Math.min(100, Number(draftUpperPercentile) || 100));
    const normalizedSamples = Math.max(25, Math.floor(Number(draftSamplesPerChannel) || DEFAULT_MAX_POINTS));
    onApply({
      lowerPercentile: normalizedLower,
      upperPercentile: normalizedUpper,
      samplesPerChannel: normalizedSamples,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="stacked-settings-title">
        <header>
          <div>
            <p className="eyebrow">Stacked plot</p>
            <h2 id="stacked-settings-title">Settings</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings">
            x
          </button>
        </header>

        <div className="modal-fields">
          <label className="field">
            <span>Lower percentile</span>
            <input
              type="number"
              min="0"
              max="99.99"
              step="0.05"
              value={draftLowerPercentile}
              onChange={(event) => setDraftLowerPercentile(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Upper percentile</span>
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.05"
              value={draftUpperPercentile}
              onChange={(event) => setDraftUpperPercentile(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Samples per channel</span>
            <input
              type="number"
              min="25"
              step="25"
              value={draftSamplesPerChannel}
              onChange={(event) => setDraftSamplesPerChannel(event.target.value)}
            />
          </label>
        </div>

        <footer>
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="button" onClick={applyDraft}>
            Apply
          </button>
        </footer>
      </section>
    </div>
  );
}

function MainPlotSettingsModal({
  lowerPercentile,
  upperPercentile,
  maxPoints,
  onClose,
  onApply,
}) {
  const [draftLowerPercentile, setDraftLowerPercentile] = useState(lowerPercentile);
  const [draftUpperPercentile, setDraftUpperPercentile] = useState(upperPercentile);
  const [draftMaxPoints, setDraftMaxPoints] = useState(maxPoints);

  const applyDraft = () => {
    const normalizedLower = Math.max(0, Math.min(99.99, Number(draftLowerPercentile) || 0));
    const normalizedUpper = Math.max(normalizedLower + 0.01, Math.min(100, Number(draftUpperPercentile) || 100));
    const normalizedMaxPoints = Math.max(100, Math.floor(Number(draftMaxPoints) || DEFAULT_MAX_POINTS));
    onApply({
      lowerPercentile: normalizedLower,
      upperPercentile: normalizedUpper,
      maxPoints: normalizedMaxPoints,
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="main-settings-title">
        <header>
          <div>
            <p className="eyebrow">Single-channel plot</p>
            <h2 id="main-settings-title">Settings</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings">
            x
          </button>
        </header>

        <div className="modal-fields">
          <label className="field">
            <span>Lower y percentile</span>
            <input
              type="number"
              min="0"
              max="99.99"
              step="0.05"
              value={draftLowerPercentile}
              onChange={(event) => setDraftLowerPercentile(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Upper y percentile</span>
            <input
              type="number"
              min="0.01"
              max="100"
              step="0.05"
              value={draftUpperPercentile}
              onChange={(event) => setDraftUpperPercentile(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Max plotted points</span>
            <input
              type="number"
              min="100"
              step="100"
              value={draftMaxPoints}
              onChange={(event) => setDraftMaxPoints(event.target.value)}
            />
          </label>
        </div>

        <footer>
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="button" onClick={applyDraft}>
            Apply
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function EegViewer({ initialSelection = {}, onBack }) {
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
  const [showMainPlotSettings, setShowMainPlotSettings] = useState(false);
  const [mainLowerPercentile, setMainLowerPercentile] = useState(0.25);
  const [mainUpperPercentile, setMainUpperPercentile] = useState(99.75);
  const [showStackedSettings, setShowStackedSettings] = useState(false);
  const [stackedLowerPercentile, setStackedLowerPercentile] = useState(0.25);
  const [stackedUpperPercentile, setStackedUpperPercentile] = useState(99.75);
  const [stackedSamplesPerChannel, setStackedSamplesPerChannel] = useState(7000);
  const [xScaleMode, setXScaleMode] = useState("sample");
  const [sampleRate, setSampleRate] = useState(1024);
  const [startSample, setStartSample] = useState(initialSelection.start);
  const [windowPoints, setWindowPoints] = useState(initialSelection.points);
  const [status, setStatus] = useState("Loading subjects...");
  const [isLoading, setIsLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  const selectedChannel = useMemo(
    () => channels.find((item) => String(item.id) === String(channel)),
    [channels, channel]
  );

  const selectionCode = `S_${subject},${file},CH_${channel}`;
  const normalizedMaxPoints = Math.max(100, Math.floor(Number(maxPoints) || DEFAULT_MAX_POINTS));
  const normalizedMainLowerPercentile = Math.max(0, Math.min(99.99, Number(mainLowerPercentile) || 0));
  const normalizedMainUpperPercentile = Math.max(
    normalizedMainLowerPercentile + 0.01,
    Math.min(100, Number(mainUpperPercentile) || 100)
  );
  const normalizedSampleRate = Math.max(1, Number(sampleRate) || 1024);
  const normalizedStackedSamples = Math.max(25, Math.floor(Number(stackedSamplesPerChannel) || DEFAULT_MAX_POINTS));
  const normalizedLowerPercentile = Math.max(0, Math.min(99.99, Number(stackedLowerPercentile) || 0));
  const normalizedUpperPercentile = Math.max(
    normalizedLowerPercentile + 0.01,
    Math.min(100, Number(stackedUpperPercentile) || 100)
  );
  const updateEegUrl = useCallback((nextSubject, nextFile, nextChannel, nextFiles = files) => {
    if (!nextSubject || !nextFile || nextChannel === "") return;
    const fileIndex = nextFiles.findIndex((item) => item.id === nextFile);
    if (fileIndex < 0) return;
    const params = new URLSearchParams({
      S: `S_${nextSubject}`,
      FILE: String(fileIndex),
      CH: `CH_${nextChannel}`,
    });
    if (startSample !== null && startSample !== undefined && startSample !== "" && Number.isFinite(Number(startSample))) {
      params.set("START", String(Math.max(0, Math.floor(Number(startSample)))));
    }
    if (windowPoints !== null && windowPoints !== undefined && windowPoints !== "" && Number.isFinite(Number(windowPoints))) {
      params.set("POINTS", String(Math.max(1, Math.floor(Number(windowPoints)))));
    }
    const nextUrl = `/eeg?${params.toString()}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [files, startSample, windowPoints]);
  const applyStackedSettings = ({ lowerPercentile, upperPercentile, samplesPerChannel }) => {
    setStackedLowerPercentile(lowerPercentile);
    setStackedUpperPercentile(upperPercentile);
    setStackedSamplesPerChannel(samplesPerChannel);
    setShowStackedSettings(false);
  };
  const applyMainPlotSettings = ({ lowerPercentile, upperPercentile, maxPoints }) => {
    setMainLowerPercentile(lowerPercentile);
    setMainUpperPercentile(upperPercentile);
    setMaxPoints(maxPoints);
    setShowMainPlotSettings(false);
  };
  const mainYRange = useMemo(() => {
    if (!plotData?.y?.length) return undefined;
    return percentileRange(plotData.y, normalizedMainLowerPercentile, normalizedMainUpperPercentile);
  }, [normalizedMainLowerPercentile, normalizedMainUpperPercentile, plotData]);

  useEffect(() => {
    api("/api/subjects")
      .then(({ subjects: rows }) => {
        setSubjects(rows);
        const requestedSubject = initialSelection.subject;
        setSubject(requestedSubject && rows.includes(requestedSubject) ? requestedSubject : rows[0] || "");
        setStatus(rows.length ? `${rows.length} subjects available` : "No subjects found");
      })
      .catch((error) => setStatus(error.message));
  }, [initialSelection.subject]);

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
        const requestedIndex = Number.isInteger(initialSelection.fileIndex) ? initialSelection.fileIndex : null;
        setFile(requestedIndex !== null && rows[requestedIndex] ? rows[requestedIndex].id : rows[0]?.id || "");
        setStatus(rows.length ? `${rows.length} H5 files available` : "No H5 files found");
      })
      .catch((error) => setStatus(error.message));
  }, [initialSelection.fileIndex, subject]);

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
        const requestedChannel = initialSelection.channel;
        const channelExists = rows.some((item) => String(item.id) === String(requestedChannel));
        setChannel(channelExists ? String(requestedChannel) : rows[0] ? String(rows[0].id) : "");
        setStatus(rows.length ? `${rows.length} iEEG channels available` : "No iEEG channels found");
      })
      .catch((error) => setStatus(error.message));
  }, [file, initialSelection.channel, subject]);

  const plot = useCallback(() => {
    if (!subject || !file || channel === "") return;
    setIsLoading(true);
    setStatus("Reading H5 channel data...");
    api("/api/data", {
      subject,
      file,
      channel,
      max_points: normalizedMaxPoints,
      start: startSample,
      points: windowPoints,
    })
      .then((data) => {
        setPlotData(data);
        setStatus(`Loaded ${data.window_samples.toLocaleString()} samples`);
      })
      .catch((error) => setStatus(error.message))
      .finally(() => setIsLoading(false));
  }, [subject, file, channel, normalizedMaxPoints, startSample, windowPoints]);

  const loadAllChannels = useCallback(() => {
    if (!subject || !file || !showAllChannels) return;
    setIsLoading(true);
    setStatus("Reading all iEEG channels...");
    api("/api/all-data", { subject, file, max_points: normalizedStackedSamples })
      .then((data) => {
        setAllChannelData(data);
        setStatus(`Loaded ${data.traces.length.toLocaleString()} iEEG channel rows`);
      })
      .catch((error) => setStatus(error.message))
      .finally(() => setIsLoading(false));
  }, [subject, file, normalizedStackedSamples, showAllChannels]);

  useEffect(() => {
    if (subject && file && channel !== "") {
      updateEegUrl(subject, file, channel);
      plot();
    }
  }, [channel, file, plot, subject, updateEegUrl]);

  useEffect(() => {
    if (showAllChannels) {
      loadAllChannels();
    }
  }, [showAllChannels, loadAllChannels]);

  const copySelectionCode = useCallback((label) => {
    if (!subject || !file || channel === "") return;
    navigator.clipboard
      .writeText(`S_${subject}\t${file}\tCH_${channel}\t${label}\n`)
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
              <span>X-axis scale</span>
              <select value={xScaleMode} onChange={(event) => setXScaleMode(event.target.value)}>
                <option value="sample">Sample ID</option>
                <option value="seconds">Seconds</option>
              </select>
            </label>
            {xScaleMode === "seconds" && (
              <label className="field">
                <span>Samples / s</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={sampleRate}
                  onChange={(event) => setSampleRate(event.target.value)}
                  onBlur={() => setSampleRate(normalizedSampleRate)}
                />
              </label>
            )}
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
          <article className="copy-card">
            <span>Copy</span>
            <div className="copy-button-row">
              <button className="copy-yes" type="button" onClick={() => copySelectionCode("YES")}>
                Copy YES
              </button>
              <button className="copy-no" type="button" onClick={() => copySelectionCode("NO")}>
                Copy NO
              </button>
            </div>
            <span className={copyStatus ? "copy-status visible" : "copy-status"}>{copyStatus || "Copied"}</span>
          </article>
        </div>

        <section className="chart-panel">
          <div className="chart-title">
            <div>
              <h3>{selectedChannel?.correct_ch || selectedChannel?.edf_ch || "Trace"}</h3>
              <p>
                {plotData
                  ? `${plotData.file}.h5 samples ${plotData.start}-${plotData.stop}, y-scale ${normalizedMainLowerPercentile}-${normalizedMainUpperPercentile} percentile`
                  : "Waiting for data"}
              </p>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Single-channel plot settings"
              onClick={() => setShowMainPlotSettings(true)}
            >
              ⚙
            </button>
          </div>
          <SnippetGrid
            snippets={plotData?.snippets}
            yRange={mainYRange}
            xScaleMode={xScaleMode}
            sampleRate={normalizedSampleRate}
          />
          <EegChart data={plotData} xScaleMode={xScaleMode} sampleRate={normalizedSampleRate} yRange={mainYRange} />
        </section>

        {showAllChannels && (
          <section className="chart-panel">
            <div className="chart-title">
              <div>
                <h3>All iEEG channels</h3>
                <p>
                  {allChannelData
                    ? `${allChannelData.traces.length} rows, step ${allChannelData.downsample_step}, scale ${normalizedLowerPercentile}-${normalizedUpperPercentile} percentile`
                    : "Waiting for all-channel data"}
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Stacked plot settings"
                onClick={() => setShowStackedSettings(true)}
              >
                ⚙
              </button>
            </div>
            <AllChannelsChart
              data={allChannelData}
              lowerPercentile={normalizedLowerPercentile}
              upperPercentile={normalizedUpperPercentile}
              xScaleMode={xScaleMode}
              sampleRate={normalizedSampleRate}
            />
          </section>
        )}

        {showStackedSettings && (
          <StackedSettingsModal
            lowerPercentile={stackedLowerPercentile}
            upperPercentile={stackedUpperPercentile}
            samplesPerChannel={stackedSamplesPerChannel}
            onClose={() => setShowStackedSettings(false)}
            onApply={applyStackedSettings}
          />
        )}
        {showMainPlotSettings && (
          <MainPlotSettingsModal
            lowerPercentile={mainLowerPercentile}
            upperPercentile={mainUpperPercentile}
            maxPoints={maxPoints}
            onClose={() => setShowMainPlotSettings(false)}
            onApply={applyMainPlotSettings}
          />
        )}
      </section>
    </main>
  );
}
