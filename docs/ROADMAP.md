# Roadmap

Wishlist collected **during the 2026 race** (2026-08-08), while the problems
were still fresh. Nothing here is urgent — the app ran the event fine — but
each item is a gap somebody actually felt on the day.

Three items shipped already and are described in
[`CLAUDE.md`](../CLAUDE.md) as domain rules rather than plans:

- Paarlauf groups are always AllGender (forced on every write path).
- Paarlauf groups always run the short race (UI default).
- `Participant.registered` — ticking off who turned up at the desk.

The four below are open.

---

## 1. Admin results preview without publishing

**Do this first.** It unblocks the medalist panel and is useful on its own.

`GET /api/events/{id}/results` ([`routers/public.py`](../backend/app/routers/public.py))
returns 404 unless `event.is_published`, so today there is no way to look at
final results before they are public. Race control is admin-only
([`routers/races.py`](../backend/app/routers/races.py)), so an admin can
publish but cannot preview.

Wanted: the same ranking behind authentication, with publishing staying a
separate, deliberate step. `is_published` should stop being the sole gate on
*seeing* results without becoming a weaker gate on *publishing* them.

**Open decision:** does the `timer` role get this too? The finish screen needs
it for item 2, but `timer` is otherwise strictly finish-line-only (POST/GET
finishes, PATCH finish). Widening it is a real change to the role, so make it
on purpose rather than as a side effect.

## 2. Medalists per group on the finish screen

Show the top 3 per category on `/admin/finish`, so the podium is known without
leaving the page. "Group" here means the derived category list from
[`services/categories.py`](../backend/app/services/categories.py) — including
`Paarlauf {race}`, where one group takes one place.

Depends on item 1: during a live race the event is normally still unpublished,
so without an authenticated results endpoint this panel would show nothing.

## 3. DNF for starters who never finished

[`services/ranking.py`](../backend/app/services/ranking.py) builds result rows
only from `status=ok` finish records, so somebody who started and dropped out
simply never appears. With `Participant.registered` now recording who turned
up, a dropout can finally be told apart from a no-show — which is what made
this impossible before.

Design points already settled:

- Only participants marked `registered` are DNF candidates. An unticked
  no-show gets no row at all.
- A DNF row has no elapsed time, so it sorts after every ranked row and takes
  no rank. The tie logic (ties share a rank: 1, 2, 2, 4) stays untouched.

## 4. Bib queue on the finish screen

When a big pack crosses together, the timer cannot type fast enough. Wanted: a
queue of bib numbers entered *before* the pack arrives, then ticked off one by
one as each runner crosses.

**The finish time is taken at check-off, not at enqueue** (decided 2026-08-08).
Enqueueing is only staging, so `/admin/finish` keeps its core property that
timestamps are captured client-side at tap time, and a bib that is queued but
never crosses costs nothing.

This complements the existing flow rather than replacing it: an empty tap
already logs a finish with no bib, to be assigned later under „Einläufe" —
that is *times first, numbers later*. The queue is the mirror image, *numbers
first, times as they cross*.

⚠️ This is the largest and riskiest of the four. `/admin/finish` is the
critical page: an offline-first PWA with an IndexedDB outbox
([`frontend/src/outbox.ts`](../frontend/src/outbox.ts)). Build it well ahead of
race day and rehearse it offline — not as a late addition.

---

## Suggested order

```
1 (results preview) ──> 2 (medalists)

3 (DNF)      independent, unblocked since `registered` shipped
4 (bib queue) independent, but start early — it touches the offline outbox
```
