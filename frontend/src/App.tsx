import { Link, Route, Routes } from "react-router-dom";
import FinishScreen from "./pages/FinishScreen";
import Login from "./pages/Login";
import Participants from "./pages/Participants";
import PublicResults from "./pages/PublicResults";
import Races from "./pages/Races";
import Register from "./pages/Register";
import Unassigned from "./pages/Unassigned";

export default function App() {
  return (
    <>
      <nav className="main-nav">
        <Link to="/">Ergebnisse</Link>
        <Link to="/admin/finish">Ziel</Link>
        <Link to="/admin/participants">Teilnehmer</Link>
        <Link to="/admin/register">Nachmeldung</Link>
        <Link to="/admin/races">Rennen</Link>
        <Link to="/admin/unassigned">Ohne Startnr.</Link>
        <Link to="/login">Login</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<PublicResults />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin/finish" element={<FinishScreen />} />
          <Route path="/admin/participants" element={<Participants />} />
          <Route path="/admin/register" element={<Register />} />
          <Route path="/admin/races" element={<Races />} />
          <Route path="/admin/unassigned" element={<Unassigned />} />
        </Routes>
      </main>
    </>
  );
}
