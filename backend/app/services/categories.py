"""Category derivation. Categories are never stored — they are computed from
gender × race, plus Paarlauf for participants with a pair_group.

Documented decision: Paarlauf pairs are ranked ONLY in the Paarlauf category
(they run as a pair, so individual gender rankings would not be fair).
Gender 'x' participants appear only in AllGender.
"""

from app.models import Gender, Participant

GENDER_LABELS = {Gender.m: "Männer", Gender.w: "Frauen"}
ALL_GENDER_LABEL = "AllGender"
PAARLAUF_LABEL = "Paarlauf"


def categories_for(participant: Participant, race_name: str) -> list[str]:
    if participant.pair_group:
        return [f"{PAARLAUF_LABEL} {race_name}"]
    cats = []
    label = GENDER_LABELS.get(participant.gender)
    if label:
        cats.append(f"{label} {race_name}")
    cats.append(f"{ALL_GENDER_LABEL} {race_name}")
    return cats
