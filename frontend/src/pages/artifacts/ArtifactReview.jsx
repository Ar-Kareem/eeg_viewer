import { useEffect, useState } from "react";
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

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

export default function ArtifactReview({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState("");
  const [fileIndex, setFileIndex] = useState(0);
  const [sampleRate, setSampleRate] = useState(1024);
  const [windowSamples, setWindowSamples] = useState(1024);
  const [windowsPerChannel, setWindowsPerChannel] = useState(8);
  const [artifactData, setArtifactData] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [traceData, setTraceData] = useState(null);
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api("/api/subjects")
      .then((payload) => {
        if (cancelled) return;
        setSubjects(payload.subjects || []);
        setSubject(payload.subjects?.[0] || "");
        setStatus(payload.subjects?.length ? "Pick a file to scan." : "No subjects found.");
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
    setArtifactData(null);
    setSelectedCandidate(null);
    setTraceData(null);
    setStatus("Loading H5 files...");
    api("/api/files", { subject })
      .then((payload) => {
        if (cancelled) return;
        const nextFiles = payload.files || [];
        setFiles(nextFiles);
        setFile(nextFiles[0]?.id || "");
        setFileIndex(0);
        setStatus(nextFiles.length ? "Ready to scan artifacts." : "No H5 files found.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  const handleFileChange = (value) => {
    const nextIndex = files.findIndex((item) => item.id === value);
    setFile(value);
    setFileIndex(Math.max(0, nextIndex));
    setArtifactData(null);
    setSelectedCandidate(null);
    setTraceData(null);
  };

  const scanArtifacts = () => {
    if (!subject || !file) return;
    setLoading(true);
    setStatus("Scanning artifact candidate windows...");
    api("/api/artifacts", {
      subject,
      file,
      sample_rate: sampleRate,
      window_samples: windowSamples,
      windows_per_channel: windowsPerChannel,
    })
      .then((payload) => {
        setArtifactData(payload);
        setSelectedCandidate(null);
        setTraceData(null);
        setStatus(`Loaded ${payload.candidates.length.toLocaleString()} artifact candidates.`);
      })
      .catch((error) => {
        setArtifactData(null);
        setStatus(error.message);
      })
      .finally(() => setLoading(false));
  };

  const loadCandidateTrace = (candidate) => {
    if (!subject || !file) return;
    const rate = Math.max(1, Number(sampleRate) || 1024);
    const contextSamples = rate * 300;
    const startSample = Math.max(0, Number(candidate.start) - contextSamples);
    const points = Number(candidate.stop) - startSample + contextSamples;
    setSelectedCandidate(candidate);
    setStatus(`Loading CH_${candidate.channel} around ${candidate.start.toLocaleString()}...`);
    api("/api/data", {
      subject,
      file,
      channel: candidate.channel,
      start: startSample,
      points,
      max_points: Math.max(1, points),
    })
      .then((payload) => {
        setTraceData(payload);
        setStatus(`Showing CH_${candidate.channel} with candidate window shaded.`);
      })
      .catch((error) => setStatus(error.message));
  };

  const eegLink = (candidate) => {
    const points = Math.max(128, Number(windowSamples) || 1024);
    return `/eeg?S=S_${subject}&FILE=${fileIndex}&CH=CH_${candidate.channel}&START=${candidate.start}&POINTS=${points}`;
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">AR</div>
          <div>
            <h1>Artifact Review</h1>
            <p>Candidate artifact windows</p>
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
            <select value={file} disabled={!files.length} onChange={(event) => handleFileChange(event.target.value)}>
              {files.map((item, index) => (
                <option key={item.id} value={item.id}>
                  FILE {index} - {item.h5}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Samples / s</span>
            <input type="number" min="1" value={sampleRate} onChange={(event) => setSampleRate(event.target.value)} />
          </label>

          <label className="field">
            <span>Window samples</span>
            <input type="number" min="128" step="128" value={windowSamples} onChange={(event) => setWindowSamples(event.target.value)} />
          </label>

          <label className="field">
            <span>Windows / channel</span>
            <input type="number" min="1" max="64" value={windowsPerChannel} onChange={(event) => setWindowsPerChannel(event.target.value)} />
          </label>

          <button className="primary" type="button" disabled={loading || !file} onClick={scanArtifacts}>
            {loading ? "Scanning..." : "Scan Artifacts"}
          </button>
        </div>
      </aside>

      <section className="workspace artifact-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Artifact review</p>
            <h2>{artifactData ? `${artifactData.candidates.length} candidate windows` : "Artifact Review"}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid artifact-metrics" aria-label="Artifact summary">
          <article>
            <span>Candidates</span>
            <strong>{formatNumber(artifactData?.candidates?.length, 0)}</strong>
          </article>
          <article>
            <span>Windows scanned</span>
            <strong>{formatNumber(artifactData?.windows_scanned, 0)}</strong>
          </article>
          <article>
            <span>Selected</span>
            <strong>{selectedCandidate ? `CH_${selectedCandidate.channel}` : "-"}</strong>
          </article>
        </section>

        {artifactData ? (
          <>
            <section className="chart-panel artifact-viewer-panel">
              <div className="chart-title">
                <div>
                  <h3>EEG Window</h3>
                  <p>
                    {selectedCandidate
                      ? `Candidate ${selectedCandidate.start.toLocaleString()}-${selectedCandidate.stop.toLocaleString()} shaded`
                      : "Click a candidate row to load a +/- 1 second view."}
                  </p>
                </div>
              </div>
              <div className="artifact-eeg-chart">
                {traceData ? (
                  <Plot
                    data={[
                      {
                        x: traceData.x,
                        y: traceData.y,
                        type: "scattergl",
                        mode: "lines",
                        line: { color: "#1f6fb2", width: 1.4 },
                        hovertemplate: "sample %{x}<br>value %{y:.6e}<extra></extra>",
                      },
                    ]}
                    layout={{
                      autosize: true,
                      dragmode: "pan",
                      margin: { l: 82, r: 24, t: 12, b: 58 },
                      paper_bgcolor: "#fbfcfd",
                      plot_bgcolor: "#fbfcfd",
                      font: {
                        family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
                        color: "#17202a",
                        size: 12,
                      },
                      xaxis: {
                        title: { text: "Sample index" },
                        gridcolor: "#dde5ec",
                        range: selectedCandidate
                          ? [
                              Math.max(0, Number(selectedCandidate.start) - Math.max(1, Number(sampleRate) || 1024)),
                              Number(selectedCandidate.stop) + Math.max(1, Number(sampleRate) || 1024),
                            ]
                          : undefined,
                      },
                      yaxis: { title: { text: "Scaled value" }, gridcolor: "#dde5ec", automargin: true },
                      shapes: selectedCandidate
                        ? [
                            {
                              type: "rect",
                              xref: "x",
                              yref: "paper",
                              x0: selectedCandidate.start,
                              x1: selectedCandidate.stop,
                              y0: 0,
                              y1: 1,
                              fillcolor: "#c43b47",
                              opacity: 0.18,
                              line: { width: 0 },
                              layer: "below",
                            },
                          ]
                        : [],
                    }}
                    config={{ responsive: true, displaylogo: false }}
                    style={{ width: "100%", height: "100%" }}
                    useResizeHandler
                  />
                ) : (
                  <div className="empty-inline">Click a row below to inspect that candidate in context.</div>
                )}
              </div>
            </section>

            <section className="chart-panel artifact-panel">
              <div className="chart-title">
                <div>
                  <h3>Artifact Candidates</h3>
                  <p>Ranked windows by sampled artifact score.</p>
                </div>
              </div>

              <div className="h5-table-wrap artifact-table-wrap">
                <table className="h5-node-table artifact-table">
                  <thead>
                    <tr>
                      <th>Score</th>
                      <th>Type</th>
                      <th>Channel</th>
                      <th>Window</th>
                      <th>Flat</th>
                      <th>Sat</th>
                      <th>60 Hz</th>
                      <th>Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artifactData.candidates.map((candidate) => (
                      <tr
                        className={selectedCandidate?.id === candidate.id ? "selected" : ""}
                        key={candidate.id}
                        onClick={() => loadCandidateTrace(candidate)}
                      >
                        <td className="mono">{formatNumber(candidate.score)}</td>
                        <td>{candidate.types.join(", ")}</td>
                        <td className="mono">CH_{candidate.channel}</td>
                        <td className="mono">
                          {formatNumber(candidate.start, 0)}-{formatNumber(candidate.stop, 0)}
                        </td>
                        <td>{formatPercent(candidate.flatline_fraction)}</td>
                        <td>{formatPercent(candidate.saturation_fraction)}</td>
                        <td>{formatNumber(candidate.line_noise_ratio, 2)}</td>
                        <td>
                          <a className="table-link" href={eegLink(candidate)} onClick={(event) => event.stopPropagation()}>
                            EEG
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <div className="empty-chart">Scan a file to review likely flatlines, saturation, noise, and 60 Hz artifacts.</div>
        )}
      </section>
    </main>
  );
}
