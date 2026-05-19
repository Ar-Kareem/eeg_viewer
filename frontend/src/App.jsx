import { useState } from "react";
import EegViewer from "./pages/eeg/EegViewer.jsx";
import PageCards from "./pages/home/PageCards.jsx";

export default function App() {
  const [activePage, setActivePage] = useState("home");

  if (activePage === "eeg-viewer") {
    return <EegViewer onBack={() => setActivePage("home")} />;
  }

  return <PageCards onOpen={setActivePage} />;
}
