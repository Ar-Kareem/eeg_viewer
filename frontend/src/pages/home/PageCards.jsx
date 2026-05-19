const MAIN_CARDS = [
  {
    id: "eeg-viewer",
    title: "EEG Viewer",
    kicker: "H5 recordings",
    description: "Browse scaled H5 recordings, inspect iEEG channels, copy labels, and review snippets.",
    action: "Open Viewer",
    stats: ["Subjects", "Channels", "Snippets"],
    icon: "EEG",
  },
  {
    id: "h5-explorer",
    title: "H5 Explorer",
    kicker: "File internals",
    description: "Inspect H5 groups, datasets, attributes, shapes, compression, previews, and storage details.",
    action: "Open Explorer",
    stats: ["Groups", "Datasets", "Attrs"],
    icon: "H5",
  },
];

const SLOP_CARDS = [
  {
    id: "spectral-viewer",
    title: "Spectral Viewer",
    kicker: "Frequency analysis",
    description: "Inspect power spectra, spectrograms, EEG band power, and 60 Hz line-noise signals.",
    action: "Open Spectral",
    stats: ["PSD", "Bands", "Noise"],
    icon: "SP",
  },
  {
    id: "montage-builder",
    title: "Montage Builder",
    kicker: "Derived traces",
    description: "Build referential or bipolar derivations, plot custom pairs, and copy montage definitions.",
    action: "Open Montage",
    stats: ["Bipolar", "Reference", "Copy"],
    icon: "MG",
  },
  {
    id: "artifact-review",
    title: "Artifact Review",
    kicker: "Candidate windows",
    description: "Scan likely flatlines, saturation, high-frequency noise, and 60 Hz artifacts for review.",
    action: "Open Artifacts",
    stats: ["Flat", "Noise", "Labels"],
    icon: "AR",
  },
  {
    id: "channel-quality",
    title: "Channel Quality",
    kicker: "QC ranking",
    description: "Rank iEEG channels by noise, flatlines, missing values, outliers, and saturation signals.",
    action: "Open QC",
    stats: ["Noise", "Flatlines", "Outliers"],
    icon: "QC",
  },
  {
    id: "event-explorer",
    title: "Event Explorer",
    kicker: "Annotations",
    description: "Find event-like H5 data, review seizures or stimulation markers, and jump into centered traces.",
    action: "Open Events",
    stats: ["Events", "Timeline", "Jump"],
    icon: "EV",
  },
];

function CardButton({ card, onOpen }) {
  return (
    <button className="page-card" type="button" onClick={() => onOpen(card.id)}>
      <div className="page-card-top">
        <div className="page-card-icon" aria-hidden="true">
          {card.icon}
        </div>
        <div>
          <span>{card.kicker}</span>
          <h2>{card.title}</h2>
        </div>
      </div>
      <p>{card.description}</p>
      <div className="page-card-tags">
        {card.stats.map((item) => (
          <small key={item}>{item}</small>
        ))}
      </div>
      <strong>{card.action}</strong>
    </button>
  );
}

export default function PageCards({ onOpen }) {
  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="home-mark">Brain</div>
        <div>
          <p className="eyebrow">Available pages</p>
          <h1>Brain Website</h1>
        </div>
      </header>

      <section className="home-section" aria-labelledby="main-pages-title">
        <h2 id="main-pages-title">Main Cards</h2>
        <div className="page-card-grid main-card-grid">
          {MAIN_CARDS.map((card) => (
            <CardButton card={card} key={card.id} onOpen={onOpen} />
          ))}
        </div>
      </section>

      <section className="home-section slop-section" aria-labelledby="slop-pages-title">
        <h2 id="slop-pages-title">Slop</h2>
        <div className="page-card-grid slop-card-grid">
          {SLOP_CARDS.map((card) => (
            <CardButton card={card} key={card.id} onOpen={onOpen} />
          ))}
        </div>
      </section>
    </main>
  );
}
