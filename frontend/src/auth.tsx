// Client-side auth state. The session lives in an httpOnly cookie; this just
// mirrors "who am I" from GET /api/auth/me so the nav and route guards can
// react to it. The server still enforces every permission — this is UX only.
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "./api";

export type Role = "admin" | "timer";

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean; // true until the first /me check resolves
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api<AuthUser>("/api/auth/me"));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401) setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore — clear locally regardless */
    }
    setUser(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Pages a role may open. Order also drives the default landing page. */
export const ACCESS: Record<Role, string[]> = {
  admin: ["/admin/races", "/admin/finish", "/admin/participants", "/admin/register", "/admin/unassigned"],
  timer: ["/admin/finish"],
};

export function canAccess(role: Role | undefined, path: string): boolean {
  return role !== undefined && ACCESS[role].includes(path);
}

/** Where to send a user after login (or when they hit a page they can't see). */
export function landingFor(role: Role): string {
  return ACCESS[role][0];
}
