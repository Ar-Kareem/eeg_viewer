import { useEffect, useState } from "react";
import EegViewer from "./pages/eeg/EegViewer.jsx";
import H5Explorer from "./pages/h5/H5Explorer.jsx";
import PageCards from "./pages/home/PageCards.jsx";
import ChannelQualityDashboard from "./pages/quality/ChannelQualityDashboard.jsx";
import EventExplorer from "./pages/events/EventExplorer.jsx";
import SpectralViewer from "./pages/spectral/SpectralViewer.jsx";
import MontageBuilder from "./pages/montage/MontageBuilder.jsx";
import ArtifactReview from "./pages/artifacts/ArtifactReview.jsx";

function parseLocation() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "h5") {
    return { page: "h5-explorer", eeg: {} };
  }
  if (parts[0] === "quality") {
    return { page: "channel-quality", eeg: {} };
  }
  if (parts[0] === "events") {
    return { page: "event-explorer", eeg: {} };
  }
  if (parts[0] === "spectral") {
    return { page: "spectral-viewer", eeg: {} };
  }
  if (parts[0] === "montage") {
    return { page: "montage-builder", eeg: {} };
  }
  if (parts[0] === "artifacts") {
    return { page: "artifact-review", eeg: {} };
  }

  if (parts[0] !== "eeg") {
    return { page: "home", eeg: {} };
  }

  const params = new URLSearchParams(window.location.search);
  const subjectParam = params.get("S") || "";
  const fileParam = params.get("FILE");
  const channelParam = params.get("CH") || "";
  return {
    page: "eeg-viewer",
    eeg: {
      subject: subjectParam.startsWith("S_") ? subjectParam.slice(2) : subjectParam,
      fileIndex: fileParam === null ? null : Number(fileParam),
      channel: channelParam.startsWith("CH_") ? channelParam.slice(3) : channelParam,
      start: params.get("START") === null ? null : Number(params.get("START")),
      points: params.get("POINTS") === null ? null : Number(params.get("POINTS")),
    },
  };
}

export default function App() {
  const [route, setRoute] = useState(() => parseLocation());

  useEffect(() => {
    const handlePopState = () => setRoute(parseLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openPage = (page) => {
    if (page === "eeg-viewer") {
      window.history.pushState(null, "", "/eeg");
      setRoute(parseLocation());
    } else if (page === "h5-explorer") {
      window.history.pushState(null, "", "/h5");
      setRoute(parseLocation());
    } else if (page === "channel-quality") {
      window.history.pushState(null, "", "/quality");
      setRoute(parseLocation());
    } else if (page === "event-explorer") {
      window.history.pushState(null, "", "/events");
      setRoute(parseLocation());
    } else if (page === "spectral-viewer") {
      window.history.pushState(null, "", "/spectral");
      setRoute(parseLocation());
    } else if (page === "montage-builder") {
      window.history.pushState(null, "", "/montage");
      setRoute(parseLocation());
    } else if (page === "artifact-review") {
      window.history.pushState(null, "", "/artifacts");
      setRoute(parseLocation());
    }
  };

  const goHome = () => {
    window.history.pushState(null, "", "/");
    setRoute(parseLocation());
  };

  if (route.page === "eeg-viewer") {
    return <EegViewer initialSelection={route.eeg} onBack={goHome} />;
  }

  if (route.page === "h5-explorer") {
    return <H5Explorer onBack={goHome} />;
  }

  if (route.page === "channel-quality") {
    return <ChannelQualityDashboard onBack={goHome} />;
  }

  if (route.page === "event-explorer") {
    return <EventExplorer onBack={goHome} />;
  }

  if (route.page === "spectral-viewer") {
    return <SpectralViewer onBack={goHome} />;
  }

  if (route.page === "montage-builder") {
    return <MontageBuilder onBack={goHome} />;
  }

  if (route.page === "artifact-review") {
    return <ArtifactReview onBack={goHome} />;
  }

  return <PageCards onOpen={openPage} />;
}
