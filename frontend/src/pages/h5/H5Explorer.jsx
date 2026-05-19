import { useEffect, useMemo, useRef, useState } from "react";

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

export default function H5Explorer({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [subject, setSubject] = useState("");
  const [scanRows, setScanRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);
  const scanVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api("/api/subjects")
      .then((payload) => {
        if (cancelled) return;
        setSubjects(payload.subjects || []);
        setSubject(payload.subjects?.[0] || "");
        setStatus(payload.subjects?.length ? "Pick a subject to scan." : "No subjects found.");
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
    setSelectedPath(info?.nodes?.[0]?.path || "");
    setQuery("");
  }, [info]);

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

          <button className="primary" type="button" disabled={loading || !subject} onClick={() => scanSubject(subject)}>
            {loading ? "Scanning..." : "Rescan Subject"}
          </button>
        </div>

        <div className="advanced">
          <p className="sidebar-note">
            Each tiny card updates as its H5 metadata scan finishes. Large arrays are not fully loaded.
          </p>
        </div>
      </aside>

      <section className="workspace h5-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Research file explorer</p>
            <h2>{subject ? `Subject S_${subject}` : "H5 Explorer"}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid h5-metrics" aria-label="H5 scan summary">
          <article>
            <span>Files</span>
            <strong>{formatInteger(counts.total)}</strong>
          </article>
          <article>
            <span>Scanned</span>
            <strong>{formatInteger(counts.scanned)}</strong>
          </article>
          <article>
            <span>Datasets</span>
            <strong>{formatInteger(counts.datasets)}</strong>
          </article>
          <article>
            <span>Groups</span>
            <strong>{formatInteger(counts.groups)}</strong>
          </article>
          <article>
            <span>Errors</span>
            <strong>{formatInteger(counts.errors)}</strong>
          </article>
        </section>

        <section className="chart-panel h5-scan-panel">
          <div className="chart-title">
            <div>
              <h3>Files</h3>
              <p>Tiny cards update as metadata scans finish.</p>
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
                          <span>{formatInteger(row.info?.channel_count || 0)} Ch</span>
                        )
                      : row.status}
                </small>
              </button>
            ))}
          </div>
        </section>

        {info ? (
          <>
            <section className="metric-grid h5-metrics" aria-label="Selected H5 summary">
              <article>
                <span>File size</span>
                <strong>{formatBytes(info.file_size_bytes)}</strong>
              </article>
              <article>
                <span>Groups</span>
                <strong>{formatInteger(info.summary.groups)}</strong>
              </article>
              <article>
                <span>Datasets</span>
                <strong>{formatInteger(info.summary.datasets)}</strong>
              </article>
              <article>
                <span>Dataset bytes</span>
                <strong>{formatBytes(info.summary.estimated_dataset_bytes)}</strong>
              </article>
              <article>
                <span>Elements</span>
                <strong>{formatInteger(info.summary.dataset_elements)}</strong>
              </article>
              <article>
                <span>Root attrs</span>
                <strong>{formatInteger(info.summary.root_attrs)}</strong>
              </article>
            </section>

            <section className="chart-panel h5-file-panel">
              <div className="chart-title">
                <div>
                  <h3>{info.h5}</h3>
                  <p>{info.path}</p>
                </div>
              </div>
              <div className="h5-file-grid">
                <dl>
                  <dt>Driver</dt>
                  <dd>{info.driver || "-"}</dd>
                  <dt>libver</dt>
                  <dd>{compactJson(info.libver)}</dd>
                  <dt>User block</dt>
                  <dd>{formatBytes(info.userblock_size)}</dd>
                </dl>
                <div>
                  <h4>Root attributes</h4>
                  <AttributeTable attrs={info.root_attrs} />
                </div>
              </div>
            </section>

            <section className="h5-grid">
              <article className="chart-panel h5-node-list">
                <div className="chart-title">
                  <div>
                    <h3>Objects</h3>
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
          </>
        ) : (
          <div className="empty-chart">Select a scanned H5 file card to inspect groups, datasets, and attributes.</div>
        )}
      </section>
    </main>
  );
}
