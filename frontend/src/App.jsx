import { useEffect, useState } from "react";
import EegViewer from "./pages/eeg/EegViewer.jsx";
import PageCards from "./pages/home/PageCards.jsx";

function parseLocation() {
  const parts = window.location.pathname.split("/").filter(Boolean);
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
    }
  };

  const goHome = () => {
    window.history.pushState(null, "", "/");
    setRoute(parseLocation());
  };

  if (route.page === "eeg-viewer") {
    return <EegViewer initialSelection={route.eeg} onBack={goHome} />;
  }

  return <PageCards onOpen={openPage} />;
}
