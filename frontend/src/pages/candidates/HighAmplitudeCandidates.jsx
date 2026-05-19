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

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function HighAmplitudeCandidates({ onBack }) {
  const [subjects, setSubjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [subject, setSubject] = useState("");
  const [file, setFile] = useState("");
  const [fileIndex, setFileIndex] = useState(0);
  const [sampleRate, setSampleRate] = useState(1024);
  const [windowSamples, setWindowSamples] = useState(2048);
  const [windowsPerChannel, setWindowsPerChannel] = useState(16);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("Loading subjects...");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api("/api/subjects").then((payload) => {
      setSubjects(payload.subjects || []);
      setSubject(payload.subjects?.[0] || "");
      setStatus(payload.subjects?.length ? "Pick a file to scan." : "No subjects found.");
    }).catch((error) => setStatus(error.message));
  }, []);

  useEffect(() => {
    if (!subject) return;
    setFiles([]);
    setFile("");
    setData(null);
    setStatus("Loading files...");
    api("/api/files", { subject }).then((payload) => {
      const nextFiles = payload.files || [];
      setFiles(nextFiles);
      setFile(nextFiles[0]?.id || "");
      setFileIndex(0);
      setStatus(nextFiles.length ? "Ready to scan candidates." : "No files found.");
    }).catch((error) => setStatus(error.message));
  }, [subject]);

  const handleFileChange = (value) => {
    const index = files.findIndex((item) => item.id === value);
    setFile(value);
    setFileIndex(Math.max(0, index));
    setData(null);
  };

  const scan = () => {
    if (!subject || !file) return;
    setLoading(true);
    setStatus("Scanning high-amplitude windows...");
    api("/api/high-amplitude", {
      subject,
      file,
      sample_rate: sampleRate,
      window_samples: windowSamples,
      windows_per_channel: windowsPerChannel,
    }).then((payload) => {
      setData(payload);
      setStatus(`Loaded ${payload.candidates.length.toLocaleString()} candidates.`);
    }).catch((error) => {
      setData(null);
      setStatus(error.message);
    }).finally(() => setLoading(false));
  };

  const eegLink = (candidate) => {
    const context = Math.max(1, Number(sampleRate) || 1024) * 5;
    const start = Math.max(0, Number(candidate.start) - context);
    const points = Number(candidate.stop) - start + context;
    return `/eeg?S=S_${subject}&FILE=${fileIndex}&CH=CH_${candidate.channel}&START=${start}&POINTS=${points}`;
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">HA</div>
          <div>
            <h1>High-Amplitude Finder</h1>
            <p>Candidate window triage</p>
          </div>
        </div>
        <button className="secondary" type="button" onClick={onBack}>Back to pages</button>
        <div className="control-stack">
          <label className="field"><span>Subject</span><select value={subject} onChange={(e) => setSubject(e.target.value)}>{subjects.map((item) => <option key={item} value={item}>S_{item}</option>)}</select></label>
          <label className="field"><span>H5 file</span><select value={file} disabled={!files.length} onChange={(e) => handleFileChange(e.target.value)}>{files.map((item, index) => <option key={item.id} value={item.id}>FILE {index} - {item.h5}</option>)}</select></label>
          <label className="field"><span>Samples / s</span><input type="number" min="1" value={sampleRate} onChange={(e) => setSampleRate(e.target.value)} /></label>
          <label className="field"><span>Window samples</span><input type="number" min="128" step="128" value={windowSamples} onChange={(e) => setWindowSamples(e.target.value)} /></label>
          <label className="field"><span>Windows / channel</span><input type="number" min="1" max="128" value={windowsPerChannel} onChange={(e) => setWindowsPerChannel(e.target.value)} /></label>
          <button className="primary" type="button" disabled={loading || !file} onClick={scan}>{loading ? "Scanning..." : "Scan Candidates"}</button>
        </div>
      </aside>
      <section className="workspace candidate-workspace">
        <div className="topbar">
          <div><p className="eyebrow">Candidate finder</p><h2>{data ? `${data.candidates.length} high-amplitude candidates` : "High-Amplitude Finder"}</h2></div>
          <div className={`status ${loading ? "busy" : ""}`}>{status}</div>
        </div>
        <section className="metric-grid candidate-metrics">
          <article><span>Candidates</span><strong>{fmt(data?.candidates?.length, 0)}</strong></article>
          <article><span>Windows scanned</span><strong>{fmt(data?.windows_scanned, 0)}</strong></article>
          <article><span>Total samples</span><strong>{fmt(data?.total_samples, 0)}</strong></article>
        </section>
        {data ? (
          <section className="chart-panel">
            <div className="chart-title"><div><h3>Ranked Windows</h3><p>Scored by amplitude, energy, and rhythmicity.</p></div></div>
            <div className="h5-table-wrap candidate-table-wrap">
              <table className="h5-node-table candidate-table">
                <thead><tr><th>Score</th><th>Channel</th><th>Window</th><th>P2P z</th><th>Energy z</th><th>Rhythmicity</th><th>Open</th></tr></thead>
                <tbody>
                  {data.candidates.map((candidate) => (
                    <tr key={candidate.id}>
                      <td className="mono">{fmt(candidate.score)}</td>
                      <td className="mono">CH_{candidate.channel}</td>
                      <td className="mono">{fmt(candidate.start, 0)}-{fmt(candidate.stop, 0)}</td>
                      <td>{fmt(candidate.p2p_z)}</td>
                      <td>{fmt(candidate.energy_z)}</td>
                      <td>{fmt(candidate.rhythmicity, 3)}</td>
                      <td><a className="table-link" href={eegLink(candidate)}>EEG</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="empty-chart">Scan a file to surface unusually high-amplitude or rhythmic candidate windows.</div>
        )}
      </section>
    </main>
  );
}
