"""Category derivation. Categories are never stored — they are computed from
gender × race, plus Paarlauf for participants with a pair_group.

Documented decision: Paarlauf groups are ranked ONLY in the Paarlauf category
(they run as a group, so individual gender rankings would not be fair).
AllGender is a category in its own right — the gender 'x' field (imported from
x / a / d / divers / allgender), NOT a combined ranking over everyone. Every
non-pair participant therefore appears in exactly one of Männer / Frauen /
AllGender.
"""

from app.models import Gender, Participant

GENDER_LABELS = {Gender.m: "Männer", Gender.w: "Frauen"}
ALL_GENDER_LABEL = "AllGender"
PAARLAUF_LABEL = "Paarlauf"


def categories_for(participant: Participant, race_name: str) -> list[str]:
    if participant.pair_group:
        return [f"{PAARLAUF_LABEL} {race_name}"]
    label = GENDER_LABELS.get(participant.gender, ALL_GENDER_LABEL)
    return [f"{label} {race_name}"]


def race_categories(race_name: str, has_pairs: bool) -> list[str]:
    """Every category a race offers — independent of finishes, so result
    pages can show all tabs (e.g. the 10 km) before the first finisher."""
    cats = [
        f"{GENDER_LABELS[Gender.m]} {race_name}",
        f"{GENDER_LABELS[Gender.w]} {race_name}",
        f"{ALL_GENDER_LABEL} {race_name}",
    ]
    if has_pairs:
        cats.append(f"{PAARLAUF_LABEL} {race_name}")
    return cats
