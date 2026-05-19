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

function eventClass(type) {
  if (type === "seizure") return "seizure";
  if (type === "stimulation") return "stimulation";
  if (type === "annotation") return "annotation";
  return "event";
}

export default function EventExplorer({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [subject, setSubject] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [fileIndex, setFileIndex] = useState(0);
  const [eventsData, setEventsData] = useState(null);
  const [query, setQuery] = useState("");
  const [windowSamples, setWindowSamples] = useState(4096);
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
      setEventsData(null);
      return;
    }

    let cancelled = false;
    setEventsData(null);
    setStatus("Loading H5 files...");
    api("/api/files", { subject })
      .then((payload) => {
        if (cancelled) return;
        const nextFiles = payload.files || [];
        setFiles(nextFiles);
        setSelectedFile(nextFiles[0]?.id || "");
        setFileIndex(0);
        setStatus(nextFiles.length ? "Pick an H5 file to inspect." : "No H5 files found for this subject.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  const handleFileChange = (value) => {
    const nextIndex = files.findIndex((file) => file.id === value);
    setSelectedFile(value);
    setFileIndex(Math.max(0, nextIndex));
    setEventsData(null);
  };

  const loadEvents = () => {
    if (!subject || !selectedFile) return;
    setLoading(true);
    setStatus("Scanning H5 for event-like datasets...");
    api("/api/events", { subject, file: selectedFile })
      .then((payload) => {
        setEventsData(payload);
        setStatus(
          payload.event_count
            ? `Loaded ${payload.event_count.toLocaleString()} events.`
            : `No explicit events found; ${payload.sources.length.toLocaleString()} event-like sources detected.`
        );
      })
      .catch((error) => {
        setEventsData(null);
        setStatus(error.message);
      })
      .finally(() => setLoading(false));
  };

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const events = eventsData?.events || [];
    if (!needle) return events;
    return events.filter((event) =>
      `${event.label} ${event.type} ${event.source_path} ${event.start_sample}`.toLowerCase().includes(needle)
    );
  }, [eventsData, query]);

  const normalizedWindow = Math.max(128, Math.floor(Number(windowSamples) || 4096));
  const timelineEvents = filteredEvents.slice(0, 200);

  const eegLink = (event) => {
    const channel = eventsData?.default_channel ?? 0;
    const start = Math.max(0, Math.floor(Number(event.start_sample) - normalizedWindow / 2));
    return `/eeg?S=S_${subject}&FILE=${fileIndex}&CH=CH_${channel}&START=${start}&POINTS=${normalizedWindow}`;
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">EV</div>
          <div>
            <h1>Event Explorer</h1>
            <p>Annotations and marked intervals</p>
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
            <span>Centered window samples</span>
            <input
              min="128"
              step="128"
              type="number"
              value={windowSamples}
              onChange={(event) => setWindowSamples(event.target.value)}
            />
          </label>

          <button className="primary" type="button" disabled={loading || !selectedFile} onClick={loadEvents}>
            {loading ? "Scanning..." : "Load Events"}
          </button>
        </div>

        <div className="advanced">
          <p className="sidebar-note">
            Scans the H5 file for event, seizure, stimulation, marker, trigger, and annotation-like groups or datasets.
          </p>
        </div>
      </aside>

      <section className="workspace event-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Event and annotation explorer</p>
            <h2>{eventsData?.h5 || "Event Explorer"}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid event-metrics" aria-label="Event summary">
          <article>
            <span>Events</span>
            <strong>{formatInteger(eventsData?.event_count)}</strong>
          </article>
          <article>
            <span>Sources</span>
            <strong>{formatInteger(eventsData?.sources?.length)}</strong>
          </article>
          <article>
            <span>Total samples</span>
            <strong>{formatInteger(eventsData?.total_samples)}</strong>
          </article>
          <article>
            <span>Default channel</span>
            <strong>{eventsData?.default_channel === null || eventsData?.default_channel === undefined ? "-" : `CH_${eventsData.default_channel}`}</strong>
          </article>
        </section>

        {eventsData ? (
          <>
            <section className="chart-panel event-timeline-panel">
              <div className="chart-title">
                <div>
                  <h3>Timeline</h3>
                  <p>{timelineEvents.length ? "First 200 visible events" : "No event rows available"}</p>
                </div>
              </div>
              <div className="event-timeline">
                {timelineEvents.map((event) => {
                  const total = Math.max(1, Number(eventsData.total_samples) || 1);
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
                    <p>{formatInteger(eventsData.sources.length)} event-like H5 objects</p>
                  </div>
                </div>
                <div className="source-stack">
                  {eventsData.sources.length ? (
                    eventsData.sources.map((source) => (
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
          <div className="empty-chart">Load an H5 file to inspect event-like datasets and annotations.</div>
        )}
      </section>
    </main>
  );
}
