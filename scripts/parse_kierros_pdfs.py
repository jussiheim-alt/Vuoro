#!/usr/bin/env python3
"""Parse Kierros 6 PDF lists into Vuoro seed data."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "source"
OUT = ROOT / "data"
PUBLIC = ROOT / "public"

PHONE = r"(\d{2,4}-\d{2,4}(?:\s?\d{2,5})?)"
DISABLED_NUMS = {"47", "82", "112", "123", "131"}


def all_text(path: Path) -> str:
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
    return "\n".join(parts)


def parse_themes(text: str) -> list[dict]:
    themes: list[dict] = []
    current = None
    skip = ("KIERROS", "Esitelmät", "Huom.", "Listan", "tarkistetut", "Siksi")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(skip):
            continue
        m = re.match(r"^((?:S-)?\d+(?:-\d+)?)\s+(.+)$", line)
        if m:
            num, title = m.group(1), m.group(2).strip()
            if re.match(r"^\d{2,3}-\d", title):
                continue
            current = {
                "number": num,
                "name": title,
                "disabled": num in DISABLED_NUMS
                or "ei käytössä" in title.lower()
                or "kierrosvalvoj" in title.lower(),
            }
            themes.append(current)
            continue
        if current is None:
            continue
        if "Kierrosvalvojan" in line or "Ei käytössä" in line:
            current["disabled"] = True
            current["name"] = f"{current['name']} ({line})"
    return themes


def name_from_list(raw: str) -> str:
    """PDF uses 'Sukunimi, Etunimi' or 'Sukunimi Etunimi' → 'Etunimi Sukunimi'."""
    raw = re.sub(r"\s+", " ", raw.strip().rstrip(","))
    if "," in raw:
        last, first = [x.strip() for x in raw.split(",", 1)]
        return f"{first} {last}".strip()
    parts = raw.split(" ")
    if len(parts) == 2:
        return f"{parts[1]} {parts[0]}"
    return raw


def parse_speakers(text: str) -> list[dict]:
    speakers: list[dict] = []
    current_cong = None
    header_re = re.compile(r"^([A-ZÅÄÖ0-9][A-ZÅÄÖ0-9\- ]+)$")

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(
            ("KIERROS", "Lä =", "Ap =", "Nimi ", "Yhteysveli", "Huom.", "Listan")
        ):
            continue
        if header_re.match(line) and not re.search(r"\d", line) and len(line) > 2:
            current_cong = "-".join(p.capitalize() for p in line.split("-"))
            continue

        role = None
        mrole = re.match(r"^(Ap|Lä)\s+(.*)$", line)
        if mrole:
            role, line = mrole.group(1), mrole.group(2)

        pm = re.search(PHONE, line)
        if not pm:
            continue
        before = line[: pm.start()].strip().rstrip(",")
        after = line[pm.end() :].strip()
        phone = re.sub(r"\s+", " ", pm.group(1))
        if not before or len(before) < 3:
            continue

        name_norm = name_from_list(before)
        outlines: list[str] = []
        seen: set[str] = set()
        for tok in re.findall(r"S-\d+(?:-\d+)?|\b\d{1,3}\b", after):
            if tok.startswith("S-"):
                o = tok
            else:
                n = int(tok)
                if not (1 <= n <= 200):
                    continue
                o = str(n)
            if o not in seen:
                seen.add(o)
                outlines.append(o)

        notes: list[str] = []
        if role == "Ap":
            notes.append("Avustava palvelija")
        if role == "Lä":
            notes.append("Vain lähiseurakuntiin")
        low = after.lower()
        if "eng" in low:
            notes.append("myös englanti")
        if "ruots" in low:
            notes.append("myös ruotsi")
        if "venä" in low:
            notes.append("myös venäjä")

        speakers.append(
            {
                "name": name_norm,
                "phone": phone,
                "congregation": current_cong or "",
                "outlines": outlines,
                "notes": ", ".join(notes),
                "localOnly": role == "Lä",
                "assistant": role == "Ap",
            }
        )

    by_key: dict[tuple[str, str], dict] = {}
    for s in speakers:
        key = (s["name"].lower(), re.sub(r"\D", "", s["phone"]))
        if key in by_key:
            old = by_key[key]
            old["outlines"] = list(dict.fromkeys(old["outlines"] + s["outlines"]))
            if s["notes"] and s["notes"] not in old["notes"]:
                old["notes"] = ", ".join(filter(None, [old["notes"], s["notes"]]))
        else:
            by_key[key] = s
    return sorted(by_key.values(), key=lambda x: x["name"].lower())


def main() -> None:
    pita = next(SRC.glob("*esitelmien_pita*"))
    jas = next(SRC.glob("*ja_sennyksien*"))
    themes = parse_themes(all_text(jas))
    speakers = parse_speakers(all_text(pita))

    seed = {
        "sourceDate": "2026-02-09",
        "kierros": "6",
        "themes": themes,
        "speakers": speakers,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (OUT / "kierros6-seed.json").write_text(
        json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (PUBLIC / "kierros6-seed.json").write_text(
        json.dumps(seed, ensure_ascii=False), encoding="utf-8"
    )

    with open(OUT / "teemat.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["numero", "teema", "ei_kaytossa"])
        w.writeheader()
        for t in themes:
            w.writerow(
                {
                    "numero": t["number"],
                    "teema": t["name"],
                    "ei_kaytossa": "1" if t["disabled"] else "",
                }
            )

    with open(OUT / "puhujat.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["nimi", "puhelin", "seurakunta", "jasennykset", "muistiinpanot"],
        )
        w.writeheader()
        for s in speakers:
            w.writerow(
                {
                    "nimi": s["name"],
                    "puhelin": s["phone"],
                    "seurakunta": s["congregation"],
                    "jasennykset": " ".join(s["outlines"]),
                    "muistiinpanot": s["notes"],
                }
            )

    print(f"themes={len(themes)} speakers={len(speakers)}")
    vaaksy = [s for s in speakers if s["congregation"] == "Vääksy"]
    for s in vaaksy:
        print(s["name"], s["phone"], s["outlines"])


if __name__ == "__main__":
    main()
