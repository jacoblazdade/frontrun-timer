import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      navigate("/admin/finish");
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
