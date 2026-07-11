import { Menu, X } from "lucide-react";
import { ReactNode, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { canAccess, useAuth } from "./auth";
import FinishScreen from "./pages/FinishScreen";
import Login from "./pages/Login";
import Participants from "./pages/Participants";
import PublicResults from "./pages/PublicResults";
import Races from "./pages/Races";
import Register from "./pages/Register";
import Unassigned from "./pages/Unassigned";

/** Guards a route by path: anyone who can't see it → public results. */
function Protected({ path, children }: { path: string; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null; // avoid a redirect flicker before /me resolves
  if (!canAccess(user?.role, path)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === "admin";
  const isTimer = user?.role === "timer" || isAdmin;
  const close = () => setOpen(false);

  return (
    <nav className="main-nav">
      <Link className="brand" to="/" onClick={close}>
        Frontrun
      </Link>
      <button
        className="nav-toggle"
        aria-label="Menü"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
      {open && <div className="nav-backdrop" onClick={close} />}
      <div className={`nav-links${open ? " open" : ""}`}>
        <Link to="/" onClick={close}>
          Ergebnisse
        </Link>
        {isTimer && (
          <Link to="/admin/finish" onClick={close}>
            Ziel
          </Link>
        )}
        {isAdmin && (
          <>
            <Link to="/admin/participants" onClick={close}>
              Teilnehmer
            </Link>
            <Link to="/admin/register" onClick={close}>
              Nachmeldung
            </Link>
            <Link to="/admin/races" onClick={close}>
              Rennen
            </Link>
            <Link to="/admin/unassigned" onClick={close}>
              Ohne Startnr.
            </Link>
          </>
        )}
        <span className="nav-right">
          {user ? (
            <button
              className="link-button"
              onClick={async () => {
                close();
                await logout();
                navigate("/");
              }}
            >
              Abmelden ({user.username})
            </button>
          ) : (
            <Link to="/login" onClick={close}>
              Login
            </Link>
          )}
        </span>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <>
      <div className="rainbow-strip" aria-hidden="true" />
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<PublicResults />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/admin/finish"
            element={
              <Protected path="/admin/finish">
                <FinishScreen />
              </Protected>
            }
          />
          <Route
            path="/admin/participants"
            element={
              <Protected path="/admin/participants">
                <Participants />
              </Protected>
            }
          />
          <Route
            path="/admin/register"
            element={
              <Protected path="/admin/register">
                <Register />
              </Protected>
            }
          />
          <Route
            path="/admin/races"
            element={
              <Protected path="/admin/races">
                <Races />
              </Protected>
            }
          />
          <Route
            path="/admin/unassigned"
            element={
              <Protected path="/admin/unassigned">
                <Unassigned />
              </Protected>
            }
          />
          {/* unknown routes fall back to the public page */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
