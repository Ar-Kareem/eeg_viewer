import { useEffect, useMemo, useRef, useState } from "react";
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

function formatInteger(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString();
}

function formatNumber(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function formatBytes(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = Number(value);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function formatDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function percentileRange(values, lowerPercentile, upperPercentile) {
  const sortedValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sortedValues.length) return [0, 1];
  const percentile = (p) =>
    sortedValues[Math.min(sortedValues.length - 1, Math.max(0, Math.floor((p / 100) * (sortedValues.length - 1))))];
  const lower = percentile(lowerPercentile);
  const upper = percentile(upperPercentile);
  return lower === upper ? [lower - 1, upper + 1] : [lower, upper];
}

function shapeLabel(shape) {
  if (!Array.isArray(shape)) return "-";
  if (!shape.length) return "scalar";
  return shape.map((value) => formatInteger(value)).join(" x ");
}

function compactJson(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function PrettyBlock({ value }) {
  if (value === null || value === undefined) {
    return <div className="empty-inline">None</div>;
  }
  return <pre className="json-block">{JSON.stringify(value, null, 2)}</pre>;
}

function AttributeTable({ attrs }) {
  const entries = Object.entries(attrs || {});
  if (!entries.length) {
    return <div className="empty-inline">No attributes</div>;
  }

  return (
    <table className="attr-table">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <th>{key}</th>
            <td>{compactJson(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Spinner() {
  return <span className="tiny-spinner" aria-label="Scanning" />;
}

function channelLabel(channel) {
  return channel.correct_ch || channel.edf_ch || `CH_${channel.id}`;
}

function SortButton({ field, sort, children, onSort }) {
  const active = sort.field === field;
  return (
    <button className={`table-sort ${active ? "active" : ""}`} type="button" onClick={() => onSort(field)}>
      {children}
      <span>{active ? (sort.direction === "asc" ? "↑" : "↓") : ""}</span>
    </button>
  );
}

function CollapsiblePanel({ title, subtitle, className = "", children }) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <section className={`chart-panel collapsible-panel ${collapsed ? "collapsed" : ""} ${className}`}>
      <button className="collapsible-header" type="button" onClick={() => setCollapsed((value) => !value)}>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span>{collapsed ? "Show" : "Hide"}</span>
      </button>
      {collapsed ? null : <div className="collapsible-body">{children}</div>}
    </section>
  );
}

function qualitySymbol(status) {
  if (status === "bad") return "x";
  if (status === "watch") return "triangle-up";
  return "circle";
}

function qualityColor(status) {
  if (status === "bad") return "#c43b47";
  if (status === "watch") return "#9a6500";
  return "#21865b";
}

function ChannelQualityPlot({ data, qualityRows }) {
  const qualityById = useMemo(() => {
    const map = new Map();
    for (const row of qualityRows || []) {
      map.set(Number(row.id), row);
    }
    return map;
  }, [qualityRows]);

  const chartHeight = data?.traces?.length ? Math.max(760, data.traces.length * 34 + 150) : 520;
  const plotData = useMemo(() => {
    if (!data?.traces?.length) return [];
    const sortedValues = data.traces
      .flatMap((trace) => trace.y)
      .filter((value) => Number.isFinite(value));
    const [globalMin, globalMax] = percentileRange(sortedValues, 0.25, 99.75);
    const globalSpan = globalMax - globalMin || 1;
    const rowCount = data.traces.length;

    const lineTraces = data.traces.map((trace, index) => {
      const quality = qualityById.get(Number(trace.id));
      const row = rowCount - index;
      return {
        x: trace.x,
        y: trace.y.map((value) => (Number.isFinite(value) ? row + ((value - globalMin) / globalSpan - 0.5) * 0.82 : null)),
        type: "scattergl",
        mode: "lines",
        name: `CH_${trace.id}: ${trace.label}`,
        line: { color: qualityColor(quality?.quality_label), width: 1 },
        customdata: trace.y.map((value) => [
          value,
          quality?.quality_label || "unknown",
          quality?.quality_score,
          quality?.std,
          quality?.noise_rms,
          quality?.p2p_99,
          quality?.flatline_fraction,
          quality?.missing_fraction,
          quality?.robust_extreme_fraction,
        ]),
        hovertemplate:
          `CH_${trace.id}: ${trace.label}<br>` +
          "sample %{x}<br>" +
          "scaled %{customdata[0]:.6e}<br>" +
          "status %{customdata[1]}<br>" +
          "score %{customdata[2]:.2f}<br>" +
          "std %{customdata[3]:.3e}<br>" +
          "noise %{customdata[4]:.3e}<br>" +
          "p99-p01 %{customdata[5]:.3e}<br>" +
          "flat %{customdata[6]:.2%}<br>" +
          "missing %{customdata[7]:.2%}<br>" +
          "extreme %{customdata[8]:.2%}<extra></extra>",
      };
    });
    const markerTrace = {
      x: data.traces.map(() => 0),
      y: data.traces.map((_, index) => rowCount - index),
      type: "scatter",
      xaxis: "x2",
      mode: "markers",
      name: "QC status",
      marker: {
        color: data.traces.map((trace) => qualityColor(qualityById.get(Number(trace.id))?.quality_label)),
        size: 12,
        symbol: data.traces.map((trace) => qualitySymbol(qualityById.get(Number(trace.id))?.quality_label)),
        line: { color: "#ffffff", width: 1 },
      },
      customdata: data.traces.map((trace) => {
        const quality = qualityById.get(Number(trace.id));
        return [
          `CH_${trace.id}: ${trace.label}`,
          quality?.quality_label || "unknown",
          quality?.quality_score,
          quality?.std,
          quality?.noise_rms,
          quality?.p2p_99,
          quality?.flatline_fraction,
          quality?.missing_fraction,
          quality?.robust_extreme_fraction,
        ];
      }),
      hovertemplate:
        "%{customdata[0]}<br>" +
        "status %{customdata[1]}<br>" +
        "score %{customdata[2]:.2f}<br>" +
        "std %{customdata[3]:.3e}<br>" +
        "noise %{customdata[4]:.3e}<br>" +
        "p99-p01 %{customdata[5]:.3e}<br>" +
        "flat %{customdata[6]:.2%}<br>" +
        "missing %{customdata[7]:.2%}<br>" +
        "extreme %{customdata[8]:.2%}<extra></extra>",
    };
    return [...lineTraces, markerTrace];
  }, [data, qualityById]);

  if (!data) {
    return <div className="empty-inline">Loading selected iEEG window for this file.</div>;
  }

  const labels = data.traces
    .map((trace) => {
      return `CH_${trace.id}: ${trace.label}`;
    })
    .reverse();

  return (
    <Plot
      className="chart h5-qc-plot"
      data={plotData}
      layout={{
        autosize: true,
        dragmode: "pan",
        showlegend: false,
        margin: { l: 162, r: 24, t: 10, b: 52 },
        paper_bgcolor: "#fbfcfd",
        plot_bgcolor: "#fbfcfd",
        hovermode: "closest",
        font: {
          family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          color: "#17202a",
          size: 11,
        },
        xaxis: {
          domain: [0.055, 1],
          title: { text: "Sample index" },
          automargin: true,
          zeroline: false,
          gridcolor: "#e5ebf1",
          tickformat: ",d",
        },
        xaxis2: {
          domain: [0, 0.035],
          range: [-1, 1],
          fixedrange: true,
          showgrid: false,
          showline: false,
          showticklabels: false,
          zeroline: false,
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

function fileCardClass(row) {
  if (row.status === "pending" || row.status === "scanning") return row.status;
  if (row.status === "error") return "error";
  const datasets = row.info?.summary?.datasets || 0;
  const attrs = row.info?.summary?.root_attrs || 0;
  if (datasets >= 200) return "many-datasets";
  if (datasets > 0) return "has-datasets";
  if (attrs > 0) return "has-attrs";
  return "no-datasets";
}

export default function H5Explorer({ initialSelection = {}, onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [subjectFileCounts, setSubjectFileCounts] = useState({});
  const [subject, setSubject] = useState("");
  const [scanRows, setScanRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [query, setQuery] = useState("");
  const [qualitySort, setQualitySort] = useState({ field: "quality_score", direction: "desc" });
  const [qualityMaxPoints, setQualityMaxPoints] = useState(5000);
  const [quality, setQuality] = useState(null);
  const [qualityView, setQualityView] = useState("table");
  const [qualityPlotData, setQualityPlotData] = useState(null);
  const [qualityPlotKey, setQualityPlotKey] = useState("");
  const [qualityPlotLoading, setQualityPlotLoading] = useState(false);
  const [qualityPlotStartMinute, setQualityPlotStartMinute] = useState(0);
  const [qualityPlotEndMinute, setQualityPlotEndMinute] = useState(30);
  const [appliedQualityPlotWindow, setAppliedQualityPlotWindow] = useState({ startMinute: 0, endMinute: 30 });
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityStatus, setQualityStatus] = useState("Run QC for the selected H5 file.");
  const [channelMap, setChannelMap] = useState(null);
  const [channelMapStatus, setChannelMapStatus] = useState("Select a scanned H5 file.");
  const [channelMapLoading, setChannelMapLoading] = useState(false);
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);
  const scanVersion = useRef(0);
  const initialFileIndexRef = useRef(
    initialSelection.fileIndex === null || initialSelection.fileIndex === undefined || Number.isNaN(Number(initialSelection.fileIndex))
      ? null
      : Number(initialSelection.fileIndex)
  );

  useEffect(() => {
    let cancelled = false;
    api("/api/subjects")
      .then((payload) => {
        if (cancelled) return;
        const nextSubjects = payload.subjects || [];
        setSubjects(nextSubjects);
        const requestedSubject = initialSelection.subject || "";
        setSubject(nextSubjects.includes(requestedSubject) ? requestedSubject : nextSubjects[0] || "");
        setStatus(nextSubjects.length ? "Pick a subject to scan." : "No subjects found.");
        return Promise.all(
          nextSubjects.map((item) =>
            api("/api/files", { subject: item })
              .then((filesPayload) => [item, filesPayload.files?.length || 0])
              .catch(() => [item, null])
          )
        );
      })
      .then((entries) => {
        if (cancelled || !entries) return;
        setSubjectFileCounts(Object.fromEntries(entries));
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scanSubject = async (nextSubject) => {
    if (!nextSubject) return;
    const version = scanVersion.current + 1;
    scanVersion.current = version;
    setLoading(true);
    setSelectedId("");
    setSelectedPath("");
    setQuality(null);
    setQualityPlotData(null);
    setQualityPlotKey("");
    setQualityPlotStartMinute(0);
    setQualityPlotEndMinute(30);
    setAppliedQualityPlotWindow({ startMinute: 0, endMinute: 30 });
    setQualityStatus("Run QC for the selected H5 file.");
    setChannelMap(null);
    setChannelMapStatus("Select a scanned H5 file.");
    setChannelMapLoading(false);
    setStatus("Loading H5 files...");

    try {
      const payload = await api("/api/files", { subject: nextSubject });
      if (scanVersion.current !== version) return;
      const files = payload.files || [];
      setScanRows(
        files.map((file, index) => ({
          id: file.id,
          h5: file.h5,
          index,
          status: "pending",
          info: null,
          error: "",
        }))
      );
      const requestedFileIndex = initialFileIndexRef.current;
      if (requestedFileIndex !== null && files[requestedFileIndex]) {
        setSelectedId(files[requestedFileIndex].id);
        initialFileIndexRef.current = null;
      }
      setStatus(files.length ? `Scanning 0/${files.length} H5 files...` : "No H5 files found for this subject.");
      if (!files.length) {
        setLoading(false);
        return;
      }

      let cursor = 0;
      let completed = 0;
      const workerCount = Math.min(3, files.length);
      const runWorker = async () => {
        while (scanVersion.current === version) {
          const fileIndex = cursor;
          cursor += 1;
          if (fileIndex >= files.length) return;
          const file = files[fileIndex];
          setScanRows((rows) =>
            rows.map((row) => (row.id === file.id ? { ...row, status: "scanning" } : row))
          );

          try {
            const info = await api("/api/h5-info", { subject: nextSubject, file: file.id });
            if (scanVersion.current !== version) return;
            setScanRows((rows) =>
              rows.map((row) => (row.id === file.id ? { ...row, status: "done", info } : row))
            );
          } catch (error) {
            if (scanVersion.current !== version) return;
            setScanRows((rows) =>
              rows.map((row) => (row.id === file.id ? { ...row, status: "error", error: error.message } : row))
            );
          } finally {
            completed += 1;
            if (scanVersion.current === version) {
              setStatus(`Scanning ${completed}/${files.length} H5 files...`);
            }
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, runWorker));
      if (scanVersion.current === version) {
        setLoading(false);
        setStatus(`Finished scanning ${files.length} H5 files.`);
      }
    } catch (error) {
      if (scanVersion.current !== version) return;
      setLoading(false);
      setScanRows([]);
      setStatus(error.message);
    }
  };

  useEffect(() => {
    scanSubject(subject);
  }, [subject]);

  const selectedRow = useMemo(
    () => scanRows.find((row) => row.id === selectedId) || scanRows.find((row) => row.info) || null,
    [scanRows, selectedId]
  );
  const info = selectedRow?.info || null;

  useEffect(() => {
    if (!subject) return;
    const params = new URLSearchParams();
    params.set("S", `S_${subject}`);
    if (selectedRow) {
      params.set("FILE", String(selectedRow.index));
    }
    const nextUrl = `/h5?${params.toString()}`;
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [selectedRow, subject]);

  useEffect(() => {
    setSelectedPath(info?.nodes?.[0]?.path || "");
    setQuery("");
    setQuality(null);
    setQualityPlotData(null);
    setQualityPlotKey("");
    setQualityPlotStartMinute(0);
    setQualityPlotEndMinute(30);
    setAppliedQualityPlotWindow({ startMinute: 0, endMinute: 30 });
    setQualityStatus(info ? "Run QC for the selected H5 file." : "Select a scanned H5 file.");
    setChannelMap(null);
    setChannelMapStatus(info ? "Loading channel map..." : "Select a scanned H5 file.");
  }, [info]);

  useEffect(() => {
    if (!info || !subject || !selectedRow?.id) return;
    let cancelled = false;
    setChannelMapLoading(true);
    setChannelMapStatus("Loading channel map...");
    api("/api/channel-map", { subject, file: selectedRow.id })
      .then((payload) => {
        if (cancelled) return;
        setChannelMap(payload);
        setChannelMapStatus(
          `${(payload.channels || []).length.toLocaleString()} iEEG channels, ${(payload.coordinate_nodes || []).length.toLocaleString()} coordinate-like datasets.`
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setChannelMap(null);
          setChannelMapStatus(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setChannelMapLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [info, selectedRow, subject]);

  const runQuality = () => {
    if (!subject || !selectedRow?.id) return;
    setQualityLoading(true);
    setQualityStatus("Computing sampled channel quality metrics...");
    api("/api/channel-quality", { subject, file: selectedRow.id, max_points: qualityMaxPoints })
      .then((payload) => {
        setQuality(payload);
        setQualityPlotData(null);
        setQualityPlotKey("");
        setQualityStatus(`Ranked ${payload.channels?.length || 0} iEEG channels.`);
      })
      .catch((error) => {
        setQuality(null);
        setQualityStatus(error.message);
      })
      .finally(() => setQualityLoading(false));
  };

  useEffect(() => {
    if (qualityView !== "plot" || !quality || !subject || !selectedRow?.id) return;
    const maxPoints = 7000;
    const sampleRate = 1024;
    const startMinute = Math.max(0, Number(appliedQualityPlotWindow.startMinute) || 0);
    const endMinute = Math.max(startMinute + 1 / 60, Number(appliedQualityPlotWindow.endMinute) || startMinute + 30);
    const start = Math.floor(startMinute * 60 * sampleRate);
    const points = Math.max(1, Math.floor((endMinute - startMinute) * 60 * sampleRate));
    const nextKey = `${subject}:${selectedRow.id}:all-data:${maxPoints}:${start}:${points}`;
    if (qualityPlotKey === nextKey && qualityPlotData) return;
    let cancelled = false;
    setQualityPlotLoading(true);
    api("/api/all-data", { subject, file: selectedRow.id, max_points: maxPoints, start, points })
      .then((payload) => {
        if (cancelled) return;
        setQualityPlotData(payload);
        setQualityPlotKey(nextKey);
      })
      .catch((error) => {
        if (!cancelled) {
          setQualityStatus(error.message);
          setQualityPlotData(null);
          setQualityPlotKey("");
        }
      })
      .finally(() => {
        if (!cancelled) setQualityPlotLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedQualityPlotWindow, quality, qualityPlotData, qualityPlotKey, qualityView, selectedRow, subject]);

  const applyQualityPlotWindow = () => {
    const startMinute = Math.max(0, Number(qualityPlotStartMinute) || 0);
    const endMinute = Math.max(startMinute + 1 / 60, Number(qualityPlotEndMinute) || startMinute + 30);
    setQualityPlotStartMinute(startMinute);
    setQualityPlotEndMinute(endMinute);
    setQualityPlotData(null);
    setQualityPlotKey("");
    setAppliedQualityPlotWindow({ startMinute, endMinute });
  };

  const handleQualitySort = (field) => {
    setQualitySort((current) => ({
      field,
      direction: current.field === field && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const filteredNodes = useMemo(() => {
    const nodes = info?.nodes || [];
    const needle = query.trim().toLowerCase();
    if (!needle) return nodes;
    return nodes.filter((node) => {
      const haystack = `${node.path} ${node.kind} ${node.dtype || ""} ${shapeLabel(node.shape)}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [info, query]);

  const selectedNode = useMemo(() => {
    return (info?.nodes || []).find((node) => node.path === selectedPath) || null;
  }, [info, selectedPath]);

  const counts = useMemo(() => {
    const scannedRows = scanRows.filter((row) => row.status === "done" || row.status === "error");
    return {
      total: scanRows.length,
      scanned: scannedRows.length,
      datasets: scanRows.reduce((sum, row) => sum + (row.info?.summary?.datasets || 0), 0),
      groups: scanRows.reduce((sum, row) => sum + (row.info?.summary?.groups || 0), 0),
      errors: scanRows.filter((row) => row.status === "error").length,
    };
  }, [scanRows]);

  const totalRecordingSeconds = useMemo(() => {
    return scanRows.reduce((sum, row) => sum + (Number(row.info?.recording_seconds) || 0), 0);
  }, [scanRows]);

  const qualityRows = useMemo(() => {
    return [...(quality?.channels || [])].sort((a, b) => {
      const left = a[qualitySort.field];
      const right = b[qualitySort.field];
      const normalizedLeft = typeof left === "string" ? left : Number(left ?? -Infinity);
      const normalizedRight = typeof right === "string" ? right : Number(right ?? -Infinity);
      if (normalizedLeft < normalizedRight) return qualitySort.direction === "asc" ? -1 : 1;
      if (normalizedLeft > normalizedRight) return qualitySort.direction === "asc" ? 1 : -1;
      return a.id - b.id;
    });
  }, [quality, qualitySort]);

  const qualityCounts = useMemo(() => {
    const channels = quality?.channels || [];
    return {
      total: channels.length,
      bad: channels.filter((channel) => channel.quality_label === "bad").length,
      watch: channels.filter((channel) => channel.quality_label === "watch").length,
      good: channels.filter((channel) => channel.quality_label === "good").length,
    };
  }, [quality]);

  const visibleQualityDownsampleStep = useMemo(() => {
    if (qualityView !== "plot") return quality?.downsample_step;
    const startMinute = Math.max(0, Number(qualityPlotStartMinute) || 0);
    const endMinute = Math.max(startMinute + 1 / 60, Number(qualityPlotEndMinute) || startMinute + 30);
    const windowSamples = Math.max(1, Math.floor((endMinute - startMinute) * 60 * 1024));
    return Math.max(1, Math.ceil(windowSamples / 7000));
  }, [quality?.downsample_step, qualityPlotEndMinute, qualityPlotStartMinute, qualityView]);

  const channelMapGroups = channelMap?.groups || [];
  const coordinateNodes = channelMap?.coordinate_nodes || [];
  const mappedChannels = channelMap?.channels || [];

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">H5</div>
          <div>
            <h1>H5 Explorer</h1>
            <p>Subject-wide file inspection</p>
          </div>
        </div>

        <button className="secondary" type="button" onClick={onBack}>
          Back to pages
        </button>

      </aside>

      <section className="workspace h5-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Research file explorer</p>
            <h2>{subject ? `Subject S_${subject}` : "H5 Explorer"}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="chart-panel h5-subject-panel">
          <div className="chart-title">
            <div>
              <h3>Subjects</h3>
            </div>
            <button className="secondary compact-button" type="button" disabled={loading || !subject} onClick={() => scanSubject(subject)}>
              {loading ? "Scanning..." : "Rescan"}
            </button>
          </div>
          <div className="h5-subject-card-grid">
            {subjects.map((item) => (
              <button
                className={`h5-subject-card ${subject === item ? "selected" : ""}`}
                key={item}
                onClick={() => setSubject(item)}
                type="button"
              >
                <strong>S_{item}</strong>
                <small>
                  {subjectFileCounts[item] === undefined || subjectFileCounts[item] === null
                    ? "-"
                    : `${formatInteger(subjectFileCounts[item])} files`}
                </small>
              </button>
            ))}
          </div>
        </section>

        <section className="h5-summary-strip" aria-label="H5 scan summary">
          <div>
            <span>Files</span>
            <strong>{formatInteger(counts.total)}</strong>
          </div>
          <div>
            <span>Scanned</span>
            <strong>{formatInteger(counts.scanned)}</strong>
          </div>
          <div>
            <span>Datasets</span>
            <strong>{formatInteger(counts.datasets)}</strong>
          </div>
          <div>
            <span>Groups</span>
            <strong>{formatInteger(counts.groups)}</strong>
          </div>
          <div>
            <span>Errors</span>
            <strong>{formatInteger(counts.errors)}</strong>
          </div>
        </section>

        <section className="chart-panel h5-scan-panel">
          <div className="chart-title">
            <div>
              <h3>Files</h3>
            </div>
          </div>
          <div className="h5-file-card-grid">
            {scanRows.map((row) => (
              <button
                className={`h5-file-card ${fileCardClass(row)} ${selectedRow?.id === row.id ? "selected" : ""}`}
                disabled={!row.info && row.status !== "error"}
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                title={row.h5}
                type="button"
              >
                <span>FILE {row.index}</span>
                <strong>
                  {row.status === "pending" || row.status === "scanning" ? (
                    <Spinner />
                  ) : (
                    formatDuration(row.info?.recording_seconds)
                  )}
                </strong>
                <small>
                  {row.status === "error"
                    ? "error"
                    : row.status === "done"
                      ? (
                          <>
                            <span>{formatInteger(row.info?.channel_count || 0)} Ch</span>
                            {row.info?.ieeg_channel_count ? (
                              <span>{formatInteger(row.info.ieeg_channel_count)} iEEG Ch</span>
                            ) : null}
                          </>
                        )
                      : row.status}
                </small>
              </button>
            ))}
          </div>
          <div className="h5-file-total">SUM {formatDuration(totalRecordingSeconds)}</div>
        </section>

        {info ? (
          <>
            <section className="chart-panel h5-metadata-panel" aria-label="Selected H5 metadata">
              <div className="chart-title">
                <div>
                  <h3>Metadata</h3>
                  <p>{info.h5}</p>
                </div>
              </div>
              <dl className="h5-metadata-grid">
                <div>
                  <dt>Path</dt>
                  <dd>{info.path}</dd>
                </div>
                <div>
                  <dt>File size</dt>
                  <dd>{formatBytes(info.file_size_bytes)}</dd>
                </div>
                <div>
                  <dt>Groups</dt>
                  <dd>{formatInteger(info.summary.groups)}</dd>
                </div>
                <div>
                  <dt>Datasets</dt>
                  <dd>{formatInteger(info.summary.datasets)}</dd>
                </div>
                <div>
                  <dt>Dataset bytes</dt>
                  <dd>{formatBytes(info.summary.estimated_dataset_bytes)}</dd>
                </div>
                <div>
                  <dt>Elements</dt>
                  <dd>{formatInteger(info.summary.dataset_elements)}</dd>
                </div>
                <div>
                  <dt>Root attrs</dt>
                  <dd>{formatInteger(info.summary.root_attrs)}</dd>
                </div>
                <div>
                  <dt>Driver</dt>
                  <dd>{info.driver || "-"}</dd>
                </div>
                <div>
                  <dt>libver</dt>
                  <dd>{compactJson(info.libver)}</dd>
                </div>
                <div>
                  <dt>User block</dt>
                  <dd>{formatBytes(info.userblock_size)}</dd>
                </div>
              </dl>
            </section>

            <CollapsiblePanel title="Channel Map" subtitle={channelMapStatus}>
              {channelMapLoading ? (
                <div className="empty-inline">Loading channel map...</div>
              ) : channelMap ? (
                <div className="h5-channel-map">
                  <section className="metric-grid channel-map-metrics" aria-label="Channel map summary">
                    <article>
                      <span>Groups</span>
                      <strong>{formatInteger(channelMapGroups.length)}</strong>
                    </article>
                    <article>
                      <span>Channels</span>
                      <strong>{formatInteger(mappedChannels.length)}</strong>
                    </article>
                    <article>
                      <span>Coordinate datasets</span>
                      <strong>{formatInteger(coordinateNodes.length)}</strong>
                    </article>
                  </section>

                  {coordinateNodes.length ? (
                    <section className="chart-panel h5-embedded-panel">
                      <div className="chart-title">
                        <div>
                          <h3>Coordinate-Like Datasets</h3>
                          <p>Possible electrode localization fields found in this H5 file.</p>
                        </div>
                      </div>
                      <div className="h5-table-wrap coordinate-table-wrap">
                        <table className="h5-node-table">
                          <thead>
                            <tr>
                              <th>Path</th>
                              <th>Shape</th>
                              <th>Dtype</th>
                              <th>Preview</th>
                            </tr>
                          </thead>
                          <tbody>
                            {coordinateNodes.map((node) => (
                              <tr key={node.path}>
                                <td className="mono">{node.path}</td>
                                <td>{Array.isArray(node.shape) ? node.shape.join(" x ") : "-"}</td>
                                <td>{node.dtype}</td>
                                <td className="mono">
                                  {typeof node.preview === "string" ? node.preview : JSON.stringify(node.preview)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  ) : null}

                  <section className="channel-group-grid">
                    {channelMapGroups.map((group) => (
                      <article className="chart-panel channel-group-card h5-embedded-panel" key={group.name}>
                        <div className="chart-title">
                          <div>
                            <h3>{group.name || "Other"}</h3>
                            <p>{formatInteger(group.channels.length)} channels</p>
                          </div>
                        </div>
                        <div className="channel-chip-grid">
                          {group.channels.map((channel) => (
                            <a
                              className="channel-chip"
                              href={`/eeg?S=S_${subject}&FILE=${selectedRow.index}&CH=CH_${channel.id}`}
                              key={channel.id}
                            >
                              <strong>CH_{channel.id}</strong>
                              <span>{channelLabel(channel)}</span>
                            </a>
                          ))}
                        </div>
                      </article>
                    ))}
                  </section>
                </div>
              ) : (
                <div className="empty-inline">No channel map loaded for this H5 file.</div>
              )}
            </CollapsiblePanel>

            <CollapsiblePanel title="Objects" subtitle={`${formatInteger(filteredNodes.length)} visible objects`}>
              <section className="h5-grid">
                <article className="chart-panel h5-node-list">
                  <div className="chart-title">
                    <div>
                      <h3>Object List</h3>
                      <p>{formatInteger(filteredNodes.length)} visible objects</p>
                    </div>
                  </div>
                  <label className="field h5-search">
                    <span>Search path, dtype, or shape</span>
                    <input value={query} onChange={(event) => setQuery(event.target.value)} />
                  </label>
                  <div className="h5-table-wrap">
                    <table className="h5-node-table">
                      <thead>
                        <tr>
                          <th>Path</th>
                          <th>Type</th>
                          <th>Shape</th>
                          <th>Dtype</th>
                          <th>Storage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredNodes.map((node) => (
                          <tr
                            className={node.path === selectedPath ? "selected" : ""}
                            key={node.path}
                            onClick={() => setSelectedPath(node.path)}
                          >
                            <td className="mono">{node.path}</td>
                            <td>
                              <span className={`node-pill ${node.kind}`}>{node.kind}</span>
                            </td>
                            <td>{node.kind === "dataset" ? shapeLabel(node.shape) : `${node.child_count} children`}</td>
                            <td>{node.dtype || "-"}</td>
                            <td>
                              {node.kind === "dataset"
                                ? `${formatBytes(node.estimated_bytes)}${node.compression ? `, ${node.compression}` : ""}`
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>

                <aside className="chart-panel h5-inspector">
                  <div className="chart-title">
                    <div>
                      <h3>Inspector</h3>
                      <p>{selectedNode?.path || "Select an object"}</p>
                    </div>
                  </div>

                  {selectedNode ? (
                    <div className="inspector-stack">
                      <dl className="h5-definition-list">
                        <dt>Type</dt>
                        <dd>{selectedNode.kind}</dd>
                        {selectedNode.kind === "dataset" ? (
                          <>
                            <dt>Shape</dt>
                            <dd>{shapeLabel(selectedNode.shape)}</dd>
                            <dt>Dtype</dt>
                            <dd>{selectedNode.dtype}</dd>
                            <dt>Chunks</dt>
                            <dd>{compactJson(selectedNode.chunks)}</dd>
                            <dt>Compression</dt>
                            <dd>{selectedNode.compression || "none"}</dd>
                            <dt>Max shape</dt>
                            <dd>{compactJson(selectedNode.maxshape)}</dd>
                          </>
                        ) : (
                          <>
                            <dt>Children</dt>
                            <dd>{compactJson(selectedNode.children)}</dd>
                          </>
                        )}
                      </dl>

                      <section>
                        <h4>Attributes</h4>
                        <AttributeTable attrs={selectedNode.attrs} />
                      </section>

                      {selectedNode.kind === "dataset" ? (
                        <>
                          <section>
                            <h4>Preview</h4>
                            <PrettyBlock value={selectedNode.preview} />
                          </section>
                          <section>
                            <h4>Numeric summary</h4>
                            <PrettyBlock value={selectedNode.numeric_summary} />
                          </section>
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <div className="empty-inline">Select a group or dataset.</div>
                  )}
                </aside>
              </section>
            </CollapsiblePanel>

            <CollapsiblePanel className="h5-qc-panel" title="Channel Quality" subtitle={qualityStatus}>
              <div className="h5-qc-action-row">
                <label className="field">
                  <span>Samples per channel</span>
                  <input
                    max="50000"
                    min="100"
                    step="100"
                    type="number"
                    value={qualityMaxPoints}
                    onChange={(event) => setQualityMaxPoints(event.target.value)}
                  />
                </label>
                <button className="primary" type="button" disabled={qualityLoading || !selectedRow?.id} onClick={runQuality}>
                  {qualityLoading ? "Running QC..." : "Run Channel QC"}
                </button>
              </div>

              {quality ? (
                <>
                  <div className="view-toggle qc-view-toggle" role="radiogroup" aria-label="Channel quality view">
                    <label>
                      <input
                        checked={qualityView === "table"}
                        name="quality-view"
                        type="radio"
                        value="table"
                        onChange={() => setQualityView("table")}
                      />
                      <span>Table</span>
                    </label>
                    <label>
                      <input
                        checked={qualityView === "plot"}
                        name="quality-view"
                        type="radio"
                        value="plot"
                        onChange={() => setQualityView("plot")}
                      />
                      <span>Plot</span>
                    </label>
                  </div>

                  <section className="h5-summary-strip h5-qc-summary-strip" aria-label="Channel quality summary">
                    <div>
                      <span>Channels</span>
                      <strong>{formatNumber(qualityCounts.total, 0)}</strong>
                    </div>
                    <div>
                      <span>Bad</span>
                      <strong>{formatNumber(qualityCounts.bad, 0)}</strong>
                    </div>
                    <div>
                      <span>Watch</span>
                      <strong>{formatNumber(qualityCounts.watch, 0)}</strong>
                    </div>
                    <div>
                      <span>Good</span>
                      <strong>{formatNumber(qualityCounts.good, 0)}</strong>
                    </div>
                    <div>
                      <span>Downsample step</span>
                      <strong>{formatNumber(visibleQualityDownsampleStep, 0)}</strong>
                    </div>
                    <div>
                      <span>Total samples</span>
                      <strong>{formatNumber(quality.total_samples, 0)}</strong>
                    </div>
                  </section>

                  {qualityView === "table" ? (
                    <div className="h5-table-wrap quality-table-wrap h5-qc-table-wrap">
                      <table className="h5-node-table quality-table">
                        <thead>
                          <tr>
                            <th>
                              <SortButton field="quality_score" sort={qualitySort} onSort={handleQualitySort}>
                                Score
                              </SortButton>
                            </th>
                            <th>
                              <SortButton field="quality_label" sort={qualitySort} onSort={handleQualitySort}>
                                Status
                              </SortButton>
                            </th>
                            <th>
                              <SortButton field="id" sort={qualitySort} onSort={handleQualitySort}>
                                Channel
                              </SortButton>
                            </th>
                            <th>Label</th>
                            <th>
                              <SortButton field="std" sort={qualitySort} onSort={handleQualitySort}>
                                Std
                              </SortButton>
                            </th>
                            <th>
                              <SortButton field="noise_rms" sort={qualitySort} onSort={handleQualitySort}>
                                Noise RMS
                              </SortButton>
                            </th>
                            <th>
                              <SortButton field="p2p_99" sort={qualitySort} onSort={handleQualitySort}>
                                P99-P01
                              </SortButton>
                            </th>
                            <th>
                              <SortButton field="flatline_fraction" sort={qualitySort} onSort={handleQualitySort}>
                                Flatline
                              </SortButton>
                            </th>
                            <th>
                              <SortButton field="missing_fraction" sort={qualitySort} onSort={handleQualitySort}>
                                Missing
                              </SortButton>
                            </th>
                            <th>
                              <SortButton field="robust_extreme_fraction" sort={qualitySort} onSort={handleQualitySort}>
                                Extreme
                              </SortButton>
                            </th>
                            <th>Open</th>
                          </tr>
                        </thead>
                        <tbody>
                          {qualityRows.map((channel) => (
                            <tr key={channel.id}>
                              <td className="mono">{formatNumber(channel.quality_score, 2)}</td>
                              <td>
                                <span className={`quality-pill ${channel.quality_label}`}>{channel.quality_label}</span>
                              </td>
                              <td className="mono">CH_{channel.id}</td>
                              <td>{channel.label}</td>
                              <td>{formatNumber(channel.std)}</td>
                              <td>{formatNumber(channel.noise_rms)}</td>
                              <td>{formatNumber(channel.p2p_99)}</td>
                              <td>{formatPercent(channel.flatline_fraction)}</td>
                              <td>{formatPercent(channel.missing_fraction)}</td>
                              <td>{formatPercent(channel.robust_extreme_fraction)}</td>
                              <td>
                                <a className="table-link" href={`/eeg?S=S_${subject}&FILE=${selectedRow.index}&CH=CH_${channel.id}`}>
                                  EEG
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      <div className="h5-qc-window-row">
                        <label className="field">
                          <span>Start minute</span>
                          <input
                            min="0"
                            step="1"
                            type="number"
                            value={qualityPlotStartMinute}
                            onChange={(event) => setQualityPlotStartMinute(event.target.value)}
                          />
                        </label>
                        <label className="field">
                          <span>End minute</span>
                          <input
                            min="0"
                            step="1"
                            type="number"
                            value={qualityPlotEndMinute}
                            onChange={(event) => setQualityPlotEndMinute(event.target.value)}
                          />
                        </label>
                        <button className="secondary" type="button" onClick={applyQualityPlotWindow}>
                          Apply plot window
                        </button>
                        <span className="inline-note">
                          Showing {appliedQualityPlotWindow.startMinute}-{appliedQualityPlotWindow.endMinute} min
                        </span>
                      </div>
                      <div className="h5-qc-plot-wrap">
                        {qualityPlotLoading ? (
                          <div className="empty-inline">Loading selected iEEG window...</div>
                        ) : (
                          <ChannelQualityPlot data={qualityPlotData} qualityRows={qualityRows} />
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="empty-inline">Run QC to rank iEEG channels by sampled quality metrics.</div>
              )}
            </CollapsiblePanel>
          </>
        ) : (
          <div className="empty-chart">Select a scanned H5 file card to inspect groups, datasets, and attributes.</div>
        )}
      </section>
    </main>
  );
}
