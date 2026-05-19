import { useEffect, useState } from "react";

async function api(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function label(channel) {
  return channel.correct_ch || channel.edf_ch || `CH_${channel.id}`;
}

export default function ChannelMap({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState("");
  const [fileIndex, setFileIndex] = useState(0);
  const [channels, setChannels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [coordinateNodes, setCoordinateNodes] = useState([]);
  const [status, setStatus] = useState("Loading subjects...");

  useEffect(() => {
    api("/api/subjects").then((payload) => {
      setSubjects(payload.subjects || []);
      setSubject(payload.subjects?.[0] || "");
      setStatus(payload.subjects?.length ? "Pick a file to map channels." : "No subjects found.");
    }).catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!subject) return;
    setFiles([]);
    setFile("");
    setChannels([]);
    setGroups([]);
    setCoordinateNodes([]);
    api("/api/files", { subject }).then((payload) => {
      const nextFiles = payload.files || [];
      setFiles(nextFiles);
      setFile(nextFiles[0]?.id || "");
      setFileIndex(0);
      setStatus(nextFiles.length ? "Loading channel map..." : "No files found.");
    }).catch((error) => setStatus(error.message));
  }, [subject]);

  useEffect(() => {
    if (!subject || !file) return;
    api("/api/channel-map", { subject, file })
      .then((payload) => {
        const nextChannels = payload.channels || [];
        const nextGroups = payload.groups || [];
        const nextCoordinateNodes = payload.coordinate_nodes || [];
        setChannels(nextChannels);
        setGroups(nextGroups);
        setCoordinateNodes(nextCoordinateNodes);
        setStatus(
          `${nextChannels.length.toLocaleString()} iEEG channels, ${nextCoordinateNodes.length.toLocaleString()} coordinate-like datasets.`
        );
      })
      .catch((error) => setStatus(error.message));
  }, [subject, file]);

  const handleFileChange = (value) => {
    const index = files.findIndex((item) => item.id === value);
    setFile(value);
    setFileIndex(Math.max(0, index));
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="mark">CM</div><div><h1>Channel Map</h1><p>Electrode label groups</p></div></div>
        <button className="secondary" type="button" onClick={onBack}>Back to pages</button>
        <div className="control-stack">
          <label className="field"><span>Subject</span><select value={subject} onChange={(e) => setSubject(e.target.value)}>{subjects.map((item) => <option key={item} value={item}>S_{item}</option>)}</select></label>
          <label className="field"><span>H5 file</span><select value={file} disabled={!files.length} onChange={(e) => handleFileChange(e.target.value)}>{files.map((item, index) => <option key={item.id} value={item.id}>FILE {index} - {item.h5}</option>)}</select></label>
        </div>
        <div className="advanced">
          <p className="sidebar-note">
            Coordinate-like datasets are detected from H5 dataset names. Channel groups use label prefixes when explicit coordinates are absent.
          </p>
        </div>
      </aside>
      <section className="workspace channel-map-workspace">
        <div className="topbar"><div><p className="eyebrow">Channel map</p><h2>{channels.length.toLocaleString()} iEEG channels</h2></div><div className="status">{status}</div></div>
        <section className="metric-grid channel-map-metrics">
          <article><span>Groups</span><strong>{groups.length.toLocaleString()}</strong></article>
          <article><span>Channels</span><strong>{channels.length.toLocaleString()}</strong></article>
          <article><span>Coordinate datasets</span><strong>{coordinateNodes.length.toLocaleString()}</strong></article>
        </section>
        {coordinateNodes.length ? (
          <section className="chart-panel">
            <div className="chart-title"><div><h3>Coordinate-Like Datasets</h3><p>Possible electrode localization fields found in the H5 file.</p></div></div>
            <div className="h5-table-wrap coordinate-table-wrap">
              <table className="h5-node-table">
                <thead><tr><th>Path</th><th>Shape</th><th>Dtype</th><th>Preview</th></tr></thead>
                <tbody>
                  {coordinateNodes.map((node) => (
                    <tr key={node.path}>
                      <td className="mono">{node.path}</td>
                      <td>{Array.isArray(node.shape) ? node.shape.join(" x ") : "-"}</td>
                      <td>{node.dtype}</td>
                      <td className="mono">{typeof node.preview === "string" ? node.preview : JSON.stringify(node.preview)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        <section className="channel-group-grid">
          {groups.map((group) => (
            <article className="chart-panel channel-group-card" key={group.name}>
              <div className="chart-title"><div><h3>{group.name || "Other"}</h3><p>{group.channels.length} channels</p></div></div>
              <div className="channel-chip-grid">
                {group.channels.map((channel) => (
                  <a className="channel-chip" key={channel.id} href={`/eeg?S=S_${subject}&FILE=${fileIndex}&CH=CH_${channel.id}`}>
                    <strong>CH_{channel.id}</strong>
                    <span>{label(channel)}</span>
                  </a>
                ))}
              </div>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}
