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

export default function H5Explorer({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [subject, setSubject] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [info, setInfo] = useState(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api("/api/subjects")
      .then((payload) => {
        if (cancelled) return;
        setSubjects(payload.subjects || []);
        setSubject(payload.subjects?.[0] || "");
        setStatus(payload.subjects?.length ? "Pick an H5 file to inspect." : "No subjects found.");
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
      return;
    }

    let cancelled = false;
    setInfo(null);
    setSelectedPath("");
    setStatus("Loading H5 files...");
    api("/api/files", { subject })
      .then((payload) => {
        if (cancelled) return;
        const nextFiles = payload.files || [];
        setFiles(nextFiles);
        setSelectedFile(nextFiles[0]?.id || "");
        setStatus(nextFiles.length ? "Pick an H5 file to inspect." : "No H5 files found for this subject.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  const loadInfo = () => {
    if (!subject || !selectedFile) return;
    setLoading(true);
    setStatus("Reading H5 structure...");
    api("/api/h5-info", { subject, file: selectedFile })
      .then((payload) => {
        setInfo(payload);
        setSelectedPath(payload.nodes?.[0]?.path || "");
        setStatus(`Loaded ${payload.h5}`);
      })
      .catch((error) => {
        setInfo(null);
        setSelectedPath("");
        setStatus(error.message);
      })
      .finally(() => setLoading(false));
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

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">H5</div>
          <div>
            <h1>H5 Explorer</h1>
            <p>Technical file inspection</p>
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
            <select
              value={selectedFile}
              disabled={!files.length}
              onChange={(event) => setSelectedFile(event.target.value)}
            >
              {files.map((file, index) => (
                <option key={file.id} value={file.id}>
                  FILE {index} - {file.h5}
                </option>
              ))}
            </select>
          </label>

          <button className="primary" type="button" disabled={loading || !selectedFile} onClick={loadInfo}>
            {loading ? "Loading..." : "Load H5"}
          </button>
        </div>

        <div className="advanced">
          <p className="sidebar-note">
            Reads structure, attributes, dataset metadata, and small previews. Large arrays are not fully loaded.
          </p>
        </div>
      </aside>

      <section className="workspace h5-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Research file explorer</p>
            <h2>{info?.h5 || "Select an H5 file"}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid h5-metrics" aria-label="H5 summary">
          <article>
            <span>File size</span>
            <strong>{formatBytes(info?.file_size_bytes)}</strong>
          </article>
          <article>
            <span>Groups</span>
            <strong>{formatInteger(info?.summary?.groups)}</strong>
          </article>
          <article>
            <span>Datasets</span>
            <strong>{formatInteger(info?.summary?.datasets)}</strong>
          </article>
          <article>
            <span>Dataset bytes</span>
            <strong>{formatBytes(info?.summary?.estimated_dataset_bytes)}</strong>
          </article>
          <article>
            <span>Elements</span>
            <strong>{formatInteger(info?.summary?.dataset_elements)}</strong>
          </article>
          <article>
            <span>Root attrs</span>
            <strong>{formatInteger(info?.summary?.root_attrs)}</strong>
          </article>
        </section>

        {info ? (
          <>
            <section className="chart-panel h5-file-panel">
              <div className="chart-title">
                <div>
                  <h3>File metadata</h3>
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
          <div className="empty-chart">Load an H5 file to inspect groups, datasets, attributes, and previews.</div>
        )}
      </section>
    </main>
  );
}
