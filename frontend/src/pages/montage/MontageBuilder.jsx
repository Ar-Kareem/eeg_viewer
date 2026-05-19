import { useEffect, useMemo, useState } from "react";
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

function channelLabel(channel) {
  return channel?.correct_ch || channel?.edf_ch || `CH_${channel?.id}`;
}

function formatInteger(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString();
}

function pairId(left, right) {
  return `${left}-${right}`;
}

export default function MontageBuilder({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState("");
  const [mode, setMode] = useState("bipolar");
  const [leftChannel, setLeftChannel] = useState("");
  const [rightChannel, setRightChannel] = useState("");
  const [referenceChannel, setReferenceChannel] = useState("");
  const [pairs, setPairs] = useState([]);
  const [start, setStart] = useState(0);
  const [points, setPoints] = useState(8192);
  const [maxPoints, setMaxPoints] = useState(3000);
  const [traces, setTraces] = useState([]);
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    api("/api/subjects")
      .then((payload) => {
        if (cancelled) return;
        setSubjects(payload.subjects || []);
        setSubject(payload.subjects?.[0] || "");
        setStatus(payload.subjects?.length ? "Pick a file and define a montage." : "No subjects found.");
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
    setChannels([]);
    setPairs([]);
    setTraces([]);
    setStatus("Loading H5 files...");
    api("/api/files", { subject })
      .then((payload) => {
        if (cancelled) return;
        const nextFiles = payload.files || [];
        setFiles(nextFiles);
        setFile(nextFiles[0]?.id || "");
        setStatus(nextFiles.length ? "Pick channels." : "No H5 files found.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  useEffect(() => {
    if (!subject || !file) return;
    let cancelled = false;
    setChannels([]);
    setPairs([]);
    setTraces([]);
    setStatus("Loading iEEG channels...");
    api("/api/channels", { subject, file })
      .then((payload) => {
        if (cancelled) return;
        const nextChannels = payload.channels || [];
        setChannels(nextChannels);
        setLeftChannel(nextChannels[0] ? String(nextChannels[0].id) : "");
        setRightChannel(nextChannels[1] ? String(nextChannels[1].id) : "");
        setReferenceChannel(nextChannels[0] ? String(nextChannels[0].id) : "");
        setStatus(nextChannels.length ? "Ready to build montage." : "No iEEG channels found.");
      })
      .catch((error) => {
        if (!cancelled) setStatus(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [subject, file]);

  const channelById = useMemo(() => {
    return new Map(channels.map((channel) => [String(channel.id), channel]));
  }, [channels]);

  const montageDefinition = useMemo(() => {
    if (mode === "referential") {
      return channels
        .filter((channel) => String(channel.id) !== String(referenceChannel))
        .map((channel) => `CH_${channel.id}-CH_${referenceChannel}`)
        .join("\n");
    }
    return pairs.map((pair) => `CH_${pair.left}-CH_${pair.right}`).join("\n");
  }, [channels, mode, pairs, referenceChannel]);

  const addPair = () => {
    if (leftChannel === "" || rightChannel === "" || leftChannel === rightChannel) return;
    const id = pairId(leftChannel, rightChannel);
    setPairs((rows) => {
      if (rows.some((row) => row.id === id)) return rows;
      return [...rows, { id, left: leftChannel, right: rightChannel }];
    });
  };

  const autoPairs = () => {
    const nextPairs = [];
    for (let index = 0; index < channels.length - 1; index += 1) {
      const left = String(channels[index].id);
      const right = String(channels[index + 1].id);
      nextPairs.push({ id: pairId(left, right), left, right });
    }
    setPairs(nextPairs);
  };

  const loadDerived = async () => {
    if (!subject || !file) return;
    const definitions =
      mode === "referential"
        ? channels
            .filter((channel) => String(channel.id) !== String(referenceChannel))
            .slice(0, 24)
            .map((channel) => ({ id: `CH_${channel.id}-CH_${referenceChannel}`, left: String(channel.id), right: String(referenceChannel) }))
        : pairs.slice(0, 24).map((pair) => ({ id: `CH_${pair.left}-CH_${pair.right}`, left: pair.left, right: pair.right }));

    if (!definitions.length) {
      setStatus("Add at least one pair first.");
      return;
    }

    setLoading(true);
    setStatus(`Loading ${definitions.length} derived traces...`);
    try {
      const loaded = [];
      for (const definition of definitions) {
        const [left, right] = await Promise.all([
          api("/api/data", { subject, file, channel: definition.left, start, points, max_points: maxPoints }),
          api("/api/data", { subject, file, channel: definition.right, start, points, max_points: maxPoints }),
        ]);
        const length = Math.min(left.y.length, right.y.length);
        loaded.push({
          id: definition.id,
          x: left.x.slice(0, length),
          y: left.y.slice(0, length).map((value, index) => value - right.y[index]),
        });
      }
      setTraces(loaded);
      setStatus(`Loaded ${loaded.length} derived traces.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  };

  const copyDefinition = () => {
    navigator.clipboard
      .writeText(`${montageDefinition}\n`)
      .then(() => {
        setCopyStatus("Copied");
        window.setTimeout(() => setCopyStatus(""), 1200);
      })
      .catch(() => setCopyStatus("Copy failed"));
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">MG</div>
          <div>
            <h1>Montage Builder</h1>
            <p>Referential and bipolar traces</p>
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
            <select value={file} disabled={!files.length} onChange={(event) => setFile(event.target.value)}>
              {files.map((item, index) => (
                <option key={item.id} value={item.id}>
                  FILE {index} - {item.h5}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="bipolar">Bipolar pairs</option>
              <option value="referential">Referential</option>
            </select>
          </label>

          {mode === "referential" ? (
            <label className="field">
              <span>Reference channel</span>
              <select value={referenceChannel} onChange={(event) => setReferenceChannel(event.target.value)}>
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    CH_{channel.id} {channelLabel(channel)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="field">
                <span>Left channel</span>
                <select value={leftChannel} onChange={(event) => setLeftChannel(event.target.value)}>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      CH_{channel.id} {channelLabel(channel)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Right channel</span>
                <select value={rightChannel} onChange={(event) => setRightChannel(event.target.value)}>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      CH_{channel.id} {channelLabel(channel)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary" type="button" onClick={addPair}>
                Add Pair
              </button>
              <button className="secondary" type="button" onClick={autoPairs}>
                Auto Adjacent Pairs
              </button>
            </>
          )}

          <label className="field">
            <span>Start sample</span>
            <input type="number" min="0" step="1024" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>

          <label className="field">
            <span>Window samples</span>
            <input type="number" min="128" step="1024" value={points} onChange={(event) => setPoints(event.target.value)} />
          </label>

          <button className="primary" type="button" disabled={loading || !channels.length} onClick={loadDerived}>
            {loading ? "Loading..." : "Plot Montage"}
          </button>
        </div>
      </aside>

      <section className="workspace montage-workspace">
        <div className="topbar">
          <div>
            <p className="eyebrow">Montage builder</p>
            <h2>{mode === "referential" ? `Reference CH_${referenceChannel}` : `${pairs.length} bipolar pairs`}</h2>
          </div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>

        <section className="metric-grid montage-metrics" aria-label="Montage summary">
          <article>
            <span>Channels</span>
            <strong>{formatInteger(channels.length)}</strong>
          </article>
          <article>
            <span>Pairs</span>
            <strong>{mode === "referential" ? formatInteger(Math.max(0, channels.length - 1)) : formatInteger(pairs.length)}</strong>
          </article>
          <article>
            <span>Plotted</span>
            <strong>{formatInteger(traces.length)}</strong>
          </article>
        </section>

        <section className="montage-grid">
          <article className="chart-panel montage-definition-panel">
            <div className="chart-title">
              <div>
                <h3>Montage Definition</h3>
                <p>{mode === "referential" ? "Derived as channel minus reference." : "Derived as left minus right."}</p>
              </div>
              <button className="secondary compact-button" type="button" onClick={copyDefinition}>
                {copyStatus || "Copy"}
              </button>
            </div>
            {mode === "bipolar" ? (
              <div className="pair-list">
                {pairs.length ? (
                  pairs.map((pair) => (
                    <article className="pair-row" key={pair.id}>
                      <strong>CH_{pair.left}-CH_{pair.right}</strong>
                      <span>
                        {channelLabel(channelById.get(pair.left))} - {channelLabel(channelById.get(pair.right))}
                      </span>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => setPairs((rows) => rows.filter((row) => row.id !== pair.id))}
                        aria-label={`Remove ${pair.id}`}
                      >
                        x
                      </button>
                    </article>
                  ))
                ) : (
                  <div className="empty-inline">Add pairs manually or generate adjacent pairs.</div>
                )}
              </div>
            ) : (
              <pre className="json-block">{montageDefinition || "No derived channels"}</pre>
            )}
          </article>

          <article className="chart-panel">
            <div className="chart-title">
              <div>
                <h3>Derived Traces</h3>
                <p>Up to 24 traces are plotted at once.</p>
              </div>
            </div>
            <div className="montage-chart">
              {traces.length ? (
                <Plot
                  data={traces.map((trace, index) => ({
                    x: trace.x,
                    y: trace.y,
                    type: "scattergl",
                    mode: "lines",
                    name: trace.id,
                    line: { width: 1.2 },
                    yaxis: index === 0 ? "y" : `y${index + 1}`,
                  }))}
                  layout={{
                    autosize: true,
                    margin: { l: 82, r: 24, t: 12, b: 58 },
                    paper_bgcolor: "#fbfcfd",
                    plot_bgcolor: "#fbfcfd",
                    font: {
                      family: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
                      color: "#17202a",
                      size: 12,
                    },
                    xaxis: { title: { text: "Sample index" }, gridcolor: "#dde5ec" },
                    ...Object.fromEntries(
                      traces.map((trace, index) => {
                        const domainStart = 1 - (index + 1) / traces.length;
                        const domainStop = 1 - index / traces.length - 0.01;
                        return [
                          index === 0 ? "yaxis" : `yaxis${index + 1}`,
                          {
                            title: { text: trace.id },
                            domain: [Math.max(0, domainStart), Math.max(0, domainStop)],
                            automargin: true,
                            gridcolor: "#e7edf3",
                          },
                        ];
                      })
                    ),
                    showlegend: false,
                  }}
                  config={{ responsive: true, displaylogo: false }}
                  style={{ width: "100%", height: "100%" }}
                  useResizeHandler
                />
              ) : (
                <div className="empty-inline">Plot a montage to inspect derived traces.</div>
              )}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
