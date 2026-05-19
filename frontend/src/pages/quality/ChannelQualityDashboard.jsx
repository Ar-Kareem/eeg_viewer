import { useEffect, useMemo, useState } from "react";

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
  return `${(Number(value) * 100).toFixed(2)}%`;
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

export default function ChannelQualityDashboard({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [subject, setSubject] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [fileIndex, setFileIndex] = useState(0);
  const [maxPoints, setMaxPoints] = useState(5000);
  const [quality, setQuality] = useState(null);
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ field: "quality_score", direction: "desc" });

  useEffect(() => {
    let cancelled = false;
    api("/api/subjects")
      .then((payload) => {
        if (cancelled) return;
        setSubjects(payload.subjects || []);
        setSubject(payload.subjects?.[0] || "");
        setStatus(payload.subjects?.length ? "Pick an H5 file and run QC." : "No subjects found.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!subject) {
      setFiles([]);
      setSelectedFile("");
      setQuality(null);
      return;
    }

    let cancelled = false;
    setQuality(null);
    setStatus("Loading H5 files...");
    api("/api/files", { subject })
      .then((payload) => {
        if (cancelled) return;
        const nextFiles = payload.files || [];
        setFiles(nextFiles);
        setSelectedFile(nextFiles[0]?.id || "");
        setFileIndex(0);
        setStatus(nextFiles.length ? "Pick an H5 file and run QC." : "No H5 files found for this subject.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  const loadQuality = () => {
    if (!subject || !selectedFile) return;
    setLoading(true);
    setStatus("Computing sampled channel quality metrics...");
    api("/api/channel-quality", { subject, file: selectedFile, max_points: maxPoints })
      .then((payload) => {
        setQuality(payload);
        setStatus(`Ranked ${payload.channels?.length || 0} iEEG channels.`);
      })
      .catch((error) => {
        setQuality(null);
        setStatus(error.message);
      })
      .finally(() => setLoading(false));
  };

  const handleFileChange = (value) => {
    const nextIndex = files.findIndex((file) => file.id === value);
    setSelectedFile(value);
    setFileIndex(Math.max(0, nextIndex));
    setQuality(null);
  };

  const handleSort = (field) => {
    setSort((current) => ({
      field,
      direction: current.field === field && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = (quality?.channels || []).filter((channel) => {
      if (!needle) return true;
      return `${channel.id} ${channel.label} ${channel.edf_ch} ${channel.correct_ch} ${channel.quality_label}`
        .toLowerCase()
        .includes(needle);
    });
    return [...filtered].sort((a, b) => {
      const left = a[sort.field];
      const right = b[sort.field];
      const normalizedLeft = typeof left === "string" ? left : Number(left ?? -Infinity);
      const normalizedRight = typeof right === "string" ? right : Number(right ?? -Infinity);
      if (normalizedLeft < normalizedRight) return sort.direction === "asc" ? -1 : 1;
      if (normalizedLeft > normalizedRight) return sort.direction === "asc" ? 1 : -1;
      return a.id - b.id;
    });
  }, [quality, query, sort]);

  const counts = useMemo(() => {
    const channels = quality?.channels || [];
    return {
      total: channels.length,
      bad: channels.filter((channel) => channel.quality_label === "bad").length,
      watch: channels.filter((channel) => channel.quality_label === "watch").length,
      good: channels.filter((channel) => channel.quality_label === "good").length,
    };
  }, [quality]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">QC</div>
          <div>
            <h1>Channel Quality</h1>
            <p>Sampled iEEG QC ranking</p>
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
            <select value={selectedFile} disabled={!files.length} onChange={(event) => handleFileChange(event.target.value)}>
              {files.map((file, index) => (
                <option key={file.id} value={file.id}>
                  FILE {index} - {file.h5}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Samples per channel</span>
            <input
              min="100"
              max="50000"
              step="100"
              type="number"
              value={maxPoints}
              onChange={(event) => setMaxPoints(event.target.value)}
            />
          </label>

          <button className="primary" type="button" disabled={loading || !selectedFile} onClick={loadQuality}>
            {loading ? "Running QC..." : "Run Channel QC"}
          </button>
        </div>

        <div className="advanced">
          <p className="sidebar-note">
            Scores use sampled scaled values, robust channel baselines, flatline rate, missing values, extreme values, and
            saturation hints.
          </p>
        </div>
      </aside>

      <section className="workspace quality-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Quality dashboard</p>
            <h2>{quality?.file || "Channel QC"}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid quality-metrics" aria-label="Channel quality summary">
          <article>
            <span>Channels</span>
            <strong>{formatNumber(counts.total, 0)}</strong>
          </article>
          <article>
            <span>Bad</span>
            <strong>{formatNumber(counts.bad, 0)}</strong>
          </article>
          <article>
            <span>Watch</span>
            <strong>{formatNumber(counts.watch, 0)}</strong>
          </article>
          <article>
            <span>Good</span>
            <strong>{formatNumber(counts.good, 0)}</strong>
          </article>
          <article>
            <span>Downsample step</span>
            <strong>{formatNumber(quality?.downsample_step, 0)}</strong>
          </article>
          <article>
            <span>Total samples</span>
            <strong>{formatNumber(quality?.total_samples, 0)}</strong>
          </article>
        </section>

        {quality ? (
          <section className="chart-panel quality-panel">
            <div className="chart-title">
              <div>
                <h3>Ranked iEEG channels</h3>
                <p>{formatNumber(rows.length, 0)} visible channels</p>
              </div>
            </div>

            <label className="field quality-search">
              <span>Search channel, label, or status</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>

            <div className="h5-table-wrap quality-table-wrap">
              <table className="h5-node-table quality-table">
                <thead>
                  <tr>
                    <th>
                      <SortButton field="quality_score" sort={sort} onSort={handleSort}>
                        Score
                      </SortButton>
                    </th>
                    <th>
                      <SortButton field="quality_label" sort={sort} onSort={handleSort}>
                        Status
                      </SortButton>
                    </th>
                    <th>
                      <SortButton field="id" sort={sort} onSort={handleSort}>
                        Channel
                      </SortButton>
                    </th>
                    <th>Label</th>
                    <th>
                      <SortButton field="std" sort={sort} onSort={handleSort}>
                        Std
                      </SortButton>
                    </th>
                    <th>
                      <SortButton field="noise_rms" sort={sort} onSort={handleSort}>
                        Noise RMS
                      </SortButton>
                    </th>
                    <th>
                      <SortButton field="p2p_99" sort={sort} onSort={handleSort}>
                        P99-P01
                      </SortButton>
                    </th>
                    <th>
                      <SortButton field="flatline_fraction" sort={sort} onSort={handleSort}>
                        Flatline
                      </SortButton>
                    </th>
                    <th>
                      <SortButton field="missing_fraction" sort={sort} onSort={handleSort}>
                        Missing
                      </SortButton>
                    </th>
                    <th>
                      <SortButton field="robust_extreme_fraction" sort={sort} onSort={handleSort}>
                        Extreme
                      </SortButton>
                    </th>
                    <th>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((channel) => (
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
                        <a className="table-link" href={`/eeg?S=S_${subject}&FILE=${fileIndex}&CH=CH_${channel.id}`}>
                          EEG
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="empty-chart">Run Channel QC to rank iEEG channels by sampled quality metrics.</div>
        )}
      </section>
    </main>
  );
}
