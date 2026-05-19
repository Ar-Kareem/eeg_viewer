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

function eventClass(type) {
  if (type === "seizure") return "seizure";
  if (type === "stimulation") return "stimulation";
  if (type === "annotation") return "annotation";
  return "event";
}

function fileCardClass(row) {
  if (row.status === "pending" || row.status === "scanning") return row.status;
  if (row.status === "error") return "error";
  if ((row.event_count || 0) >= 10) return "many-events";
  if ((row.event_count || 0) > 0) return "has-events";
  if ((row.source_count || 0) > 0) return "has-sources";
  return "no-events";
}

function Spinner() {
  return <span className="tiny-spinner" aria-label="Scanning" />;
}

export default function EventExplorer({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [subject, setSubject] = useState("");
  const [scanRows, setScanRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [windowSamples, setWindowSamples] = useState(4096);
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
    setStatus("Loading H5 files...");

    try {
      const payload = await api("/api/files", { subject: nextSubject });
      if (scanVersion.current !== version) return;
      const files = payload.files || [];
      const initialRows = files.map((file, index) => ({
        id: file.id,
        h5: file.h5,
        index,
        status: "pending",
        event_count: null,
        source_count: null,
        data: null,
        error: "",
      }));
      setScanRows(initialRows);
      setStatus(files.length ? `Scanning 0/${files.length} H5 files...` : "No H5 files found for this subject.");
      if (!files.length) {
        setLoading(false);
        return;
      }

      let cursor = 0;
      let completed = 0;
      const workerCount = Math.min(4, files.length);
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
            const eventPayload = await api("/api/events", { subject: nextSubject, file: file.id });
            if (scanVersion.current !== version) return;
            setScanRows((rows) =>
              rows.map((row) =>
                row.id === file.id
                  ? {
                      ...row,
                      status: "done",
                      event_count: eventPayload.event_count,
                      source_count: eventPayload.sources.length,
                      data: eventPayload,
                    }
                  : row
              )
            );
          } catch (error) {
            if (scanVersion.current !== version) return;
            setScanRows((rows) =>
              rows.map((row) =>
                row.id === file.id ? { ...row, status: "error", error: error.message } : row
              )
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
    () => scanRows.find((row) => row.id === selectedId) || scanRows.find((row) => row.event_count > 0) || null,
    [scanRows, selectedId]
  );
  const selectedData = selectedRow?.data || null;
  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const events = selectedData?.events || [];
    if (!needle) return events;
    return events.filter((event) =>
      `${event.label} ${event.type} ${event.source_path} ${event.start_sample}`.toLowerCase().includes(needle)
    );
  }, [selectedData, query]);

  const counts = useMemo(() => {
    return {
      total: scanRows.length,
      scanned: scanRows.filter((row) => row.status === "done" || row.status === "error").length,
      withEvents: scanRows.filter((row) => (row.event_count || 0) > 0).length,
      sourcesOnly: scanRows.filter((row) => !row.event_count && (row.source_count || 0) > 0).length,
      errors: scanRows.filter((row) => row.status === "error").length,
    };
  }, [scanRows]);

  const normalizedWindow = Math.max(128, Math.floor(Number(windowSamples) || 4096));
  const timelineEvents = filteredEvents.slice(0, 200);

  const eegLink = (event) => {
    const channel = selectedData?.default_channel ?? 0;
    const start = Math.max(0, Math.floor(Number(event.start_sample) - normalizedWindow / 2));
    return `/eeg?S=S_${subject}&FILE=${selectedRow.index}&CH=CH_${channel}&START=${start}&POINTS=${normalizedWindow}`;
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">EV</div>
          <div>
            <h1>Event Explorer</h1>
            <p>Subject-wide event scan</p>
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
            <span>Centered window samples</span>
            <input
              min="128"
              step="128"
              type="number"
              value={windowSamples}
              onChange={(event) => setWindowSamples(event.target.value)}
            />
          </label>

          <button className="primary" type="button" disabled={loading || !subject} onClick={() => scanSubject(subject)}>
            {loading ? "Scanning..." : "Rescan Subject"}
          </button>
        </div>

        <div className="advanced">
          <p className="sidebar-note">
            Each file card updates as the backend finishes scanning that H5 for event, seizure, stimulation, marker,
            trigger, and annotation-like data.
          </p>
        </div>
      </aside>

      <section className="workspace event-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Event and annotation explorer</p>
            <h2>{subject ? `Subject S_${subject}` : "Event Explorer"}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid event-metrics" aria-label="Event scan summary">
          <article>
            <span>Files</span>
            <strong>{formatInteger(counts.total)}</strong>
          </article>
          <article>
            <span>Scanned</span>
            <strong>{formatInteger(counts.scanned)}</strong>
          </article>
          <article>
            <span>With events</span>
            <strong>{formatInteger(counts.withEvents)}</strong>
          </article>
          <article>
            <span>Sources only</span>
            <strong>{formatInteger(counts.sourcesOnly)}</strong>
          </article>
          <article>
            <span>Errors</span>
            <strong>{formatInteger(counts.errors)}</strong>
          </article>
        </section>

        <section className="chart-panel event-file-panel">
          <div className="chart-title">
            <div>
              <h3>Files</h3>
              <p>Tiny cards update as scans finish.</p>
            </div>
          </div>
          <div className="event-file-grid">
            {scanRows.map((row) => (
              <button
                className={`event-file-card ${fileCardClass(row)} ${selectedRow?.id === row.id ? "selected" : ""}`}
                disabled={!row.data && row.status !== "error"}
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                type="button"
                title={row.h5}
              >
                <span>FILE {row.index}</span>
                <strong>{row.status === "pending" || row.status === "scanning" ? <Spinner /> : formatInteger(row.event_count || 0)}</strong>
                <small>
                  {row.status === "error"
                    ? "error"
                    : row.status === "done"
                      ? `${formatInteger(row.source_count || 0)} sources`
                      : row.status}
                </small>
              </button>
            ))}
          </div>
        </section>

        {selectedData ? (
          <>
            <section className="chart-panel event-timeline-panel">
              <div className="chart-title">
                <div>
                  <h3>{selectedData.h5}</h3>
                  <p>{selectedData.event_count ? "First 200 visible events" : "No event rows in this file"}</p>
                </div>
              </div>
              <div className="event-timeline">
                {timelineEvents.map((event) => {
                  const total = Math.max(1, Number(selectedData.total_samples) || 1);
                  const left = Math.max(0, Math.min(100, (Number(event.start_sample) / total) * 100));
                  const width = Math.max(0.25, Math.min(100 - left, ((Number(event.duration_samples) || 1) / total) * 100));
                  return (
                    <a
                      aria-label={`Open ${event.label} at sample ${event.start_sample}`}
                      className={`event-marker ${eventClass(event.type)}`}
                      href={eegLink(event)}
                      key={event.id}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${event.label} @ ${formatInteger(event.start_sample)}`}
                    />
                  );
                })}
              </div>
            </section>

            <section className="event-grid">
              <article className="chart-panel event-table-panel">
                <div className="chart-title">
                  <div>
                    <h3>Events</h3>
                    <p>{formatInteger(filteredEvents.length)} visible rows</p>
                  </div>
                </div>
                <label className="field event-search">
                  <span>Search label, type, source, or sample</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} />
                </label>
                <div className="h5-table-wrap event-table-wrap">
                  <table className="h5-node-table event-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Label</th>
                        <th>Start</th>
                        <th>Stop</th>
                        <th>Duration</th>
                        <th>Source</th>
                        <th>Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((event) => (
                        <tr key={event.id}>
                          <td>
                            <span className={`event-pill ${eventClass(event.type)}`}>{event.type}</span>
                          </td>
                          <td>{event.label}</td>
                          <td className="mono">{formatInteger(event.start_sample)}</td>
                          <td className="mono">{formatInteger(event.stop_sample)}</td>
                          <td className="mono">{formatInteger(event.duration_samples)}</td>
                          <td className="mono">{event.source_path}</td>
                          <td>
                            <a className="table-link" href={eegLink(event)}>
                              EEG
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <aside className="chart-panel event-source-panel">
                <div className="chart-title">
                  <div>
                    <h3>Detected Sources</h3>
                    <p>{formatInteger(selectedData.sources.length)} event-like H5 objects</p>
                  </div>
                </div>
                <div className="source-stack">
                  {selectedData.sources.length ? (
                    selectedData.sources.map((source) => (
                      <article className="source-card" key={source.path}>
                        <strong>{source.path}</strong>
                        <span>{source.kind}</span>
                        <small>{source.shape ? source.shape.join(" x ") : "group"} {source.dtype || ""}</small>
                      </article>
                    ))
                  ) : (
                    <div className="empty-inline">No event-like H5 groups or datasets were found.</div>
                  )}
                </div>
              </aside>
            </section>
          </>
        ) : (
          <div className="empty-chart">Select a scanned file card with events or sources to inspect details.</div>
        )}
      </section>
    </main>
  );
}
