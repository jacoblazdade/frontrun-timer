import { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { canAccess, useAuth } from "./auth";
import FinishScreen from "./pages/FinishScreen";
import Login from "./pages/Login";
import Participants from "./pages/Participants";
import PublicResults from "./pages/PublicResults";
import Races from "./pages/Races";
import Register from "./pages/Register";
import Unassigned from "./pages/Unassigned";

/** Guards a route by path: unauthenticated → login, wrong role → public. */
function Protected({ path, children }: { path: string; children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null; // avoid a redirect flicker before /me resolves
  if (user === null) return <Navigate to="/login" replace />;
  if (!canAccess(user.role, path)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";
  const isTimer = user?.role === "timer" || isAdmin;

  return (
    <nav className="main-nav">
      <Link to="/">Ergebnisse</Link>
      {isTimer && <Link to="/admin/finish">Ziel</Link>}
      {isAdmin && (
        <>
          <Link to="/admin/participants">Teilnehmer</Link>
          <Link to="/admin/register">Nachmeldung</Link>
          <Link to="/admin/races">Rennen</Link>
          <Link to="/admin/unassigned">Ohne Startnr.</Link>
        </>
      )}
      <span className="nav-right">
        {user ? (
          <button
            className="link-button"
            onClick={async () => {
              await logout();
              navigate("/");
            }}
          >
            Abmelden ({user.username})
          </button>
        ) : (
          <Link to="/login">Login</Link>
        )}
      </span>
    </nav>
  );
}

export default function App() {
  return (
    <>
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
