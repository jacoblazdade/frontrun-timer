import { Menu, X } from "lucide-react";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  const [collapsed, setCollapsed] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const isAdmin = user?.role === "admin";
  const isTimer = user?.role === "timer" || isAdmin;
  const close = () => setOpen(false);

  // Collapse to a hamburger the moment the links wouldn't fit on one line. A
  // hidden measurer holds the natural single-line width (brand + all links)
  // and is compared to the available space — so the breakpoint adapts to the
  // number of links the current role sees, never wrapping to two lines.
  useLayoutEffect(() => {
    const measure = measureRef.current;
    const nav = navRef.current;
    if (!measure || !nav) return;
    const check = () => setCollapsed(measure.scrollWidth - measure.clientWidth > 1);
    const ro = new ResizeObserver(check);
    ro.observe(nav);
    check();
    return () => ro.disconnect();
  }, [isAdmin, isTimer]);

  // if we grow back to a fitting width, make sure the dropdown is closed
  useEffect(() => {
    if (!collapsed) setOpen(false);
  }, [collapsed]);

  const links = (onClick?: () => void) => (
    <>
      <Link to="/" onClick={onClick}>
        Ergebnisse
      </Link>
      {isTimer && (
        <Link to="/admin/finish" onClick={onClick}>
          Ziel
        </Link>
      )}
      {isAdmin && (
        <>
          <Link to="/admin/participants" onClick={onClick}>
            Teilnehmer
          </Link>
          <Link to="/admin/register" onClick={onClick}>
            Nachmeldung
          </Link>
          <Link to="/admin/races" onClick={onClick}>
            Rennen
          </Link>
          <Link to="/admin/unassigned" onClick={onClick}>
            Ohne Startnr.
          </Link>
        </>
      )}
      <span className="nav-right">
        {user ? (
          <button
            className="link-button"
            onClick={async () => {
              onClick?.();
              await logout();
              navigate("/");
            }}
          >
            Abmelden ({user.username})
          </button>
        ) : (
          <Link to="/login" onClick={onClick}>
            Login
          </Link>
        )}
      </span>
    </>
  );

  return (
    <nav className="main-nav" ref={navRef}>
      <Link className="brand" to="/" onClick={close}>
        Frontrun
      </Link>

      {/* hidden: natural single-line width used to decide when to collapse */}
      <div className="nav-measure" aria-hidden="true" ref={measureRef}>
        <span className="brand">Frontrun</span>
        {links()}
      </div>

      {!collapsed && <div className="nav-links">{links()}</div>}

      {collapsed && (
        <>
          <button
            className="nav-toggle"
            aria-label="Menü"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
          {open && <div className="nav-backdrop" onClick={close} />}
          {open && <div className="nav-links open">{links(close)}</div>}
        </>
      )}
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
