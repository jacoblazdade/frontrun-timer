import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type EventInfo } from "./api";

/** Admin event list (includes unpublished). error === "auth" means 401. */
export function useAdminEvents() {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api<EventInfo[]>("/api/admin/events")
      .then((evs) => {
        setEvents(evs);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof ApiError && (e.status === 401 || e.status === 403)
          ? "auth"
          : String(e))
      );
  }, []);

  useEffect(reload, [reload]);
  return { events, error, reload };
}
