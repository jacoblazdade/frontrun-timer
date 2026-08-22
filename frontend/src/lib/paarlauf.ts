// Where a Paarlauf group runs, and under which category.
//
// Club rule: a Paarlauf is always the short race (the 5 km) and always ranks
// as AllGender — a group runs together, so an individual gender would never
// pick its category. The gender rule is enforced server-side on every write
// path; the UI mirrors it so nobody fills in a field that will be overridden.
//
// Race names are free text (admins create them on /admin/races), so the short
// race is found by the distance in the name rather than by matching "5 km"
// literally — "5km", "5 KM" and "Paarlauf 5" all work, and a rename does not
// silently break the rule.
import type { Race } from "../api";

export const PAARLAUF_GENDER = "x" as const;

function distance(race: Race): number | null {
  const m = race.name.match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** The race a Paarlauf belongs in: the shortest one that names a distance,
 * else simply the first race, so a club that names races differently still
 * gets a sensible default instead of nothing. */
export function paarlaufRace(races: Race[]): Race | null {
  if (races.length === 0) return null;
  const measured = races
    .map((r) => ({ race: r, km: distance(r) }))
    .filter((r): r is { race: Race; km: number } => r.km !== null);
  if (measured.length === 0) return races[0];
  return measured.reduce((best, r) => (r.km < best.km ? r : best)).race;
}
