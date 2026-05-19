const CARDS = [
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

      <section className="page-card-grid" aria-label="Main pages">
        {CARDS.map((card) => (
          <button className="page-card" key={card.id} type="button" onClick={() => onOpen(card.id)}>
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
        ))}
      </section>
    </main>
  );
}
