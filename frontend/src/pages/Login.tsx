import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { AuthUser, landingFor, useAuth } from "../auth";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user, refresh } = useAuth();

  // already logged in → skip the form, go to your landing page
  useEffect(() => {
    if (user) navigate(landingFor(user.role), { replace: true });
  }, [user, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const me = await api<AuthUser>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await refresh(); // update nav + guards
      navigate(landingFor(me.role), { replace: true });
    } catch {
      setError("Login fehlgeschlagen");
    }
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <h1>Login</h1>
      <input
        placeholder="Benutzername"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoFocus
      />
      <input
        placeholder="Passwort"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="primary" type="submit">
        Anmelden
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
