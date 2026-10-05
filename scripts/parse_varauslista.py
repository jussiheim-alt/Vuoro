#!/usr/bin/env python3
"""Parse Esitelmien varauslista (.xlsb) into seed history / lastUsedAt."""

from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from pyxlsb import open_workbook

ROOT = Path(__file__).resolve().parents[1]
SEED_PATH = ROOT / "data" / "kierros6-seed.json"
PUBLIC_SEED = ROOT / "public" / "kierros6-seed.json"
XLSB = ROOT / "data" / "source" / "Esitelmien_varauslista_b5e5.xlsb"

SKIP_RE = re.compile(
    r"kierrosviikko|konventti|kierroskonventti|kenttäpalvelus|palveluspuhe|"
    r"kokoontumisen johto|\bbetel\b",
    re.I,
)
PHONE_RE = re.compile(r"\d{2,4}[\-\s]?\d{2,4}[\-\s]?\d{2,5}")


def excel_date(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, str):
        s = v.strip()
        for fmt in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
            try:
                return datetime.strptime(s, fmt).date().isoformat()
            except ValueError:
                pass
        return None
    if isinstance(v, (int, float)):
        try:
            d = datetime(1899, 12, 30) + timedelta(days=float(v))
            if 2018 <= d.year <= 2030:
                return d.date().isoformat()
        except Exception:
            return None
    return None


def extract_outline(text: str):
    candidates = []
    for m in re.finditer(
        r"(?:^|[\s,])(0*\d{1,3}|S-\d+)(?=\s+[A-ZÅÄÖa-zåäö\"“”])", text
    ):
        tok = m.group(1)
        if tok.startswith("S-"):
            candidates.append(tok)
        else:
            n = int(tok)
            if 1 <= n <= 200:
                candidates.append(str(n))
    if candidates:
        return candidates[-1]
    m = re.search(r"(?:^|[\s,])(\d{1,3})\s*$", text)
    if m and 1 <= int(m.group(1)) <= 200:
        return str(int(m.group(1)))
    return None


def extract_name(text: str, outline: str | None):
    t = re.sub(
        r"^(?:\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s*(?:siirtyi|->|—>|–>|>>>|--->>>|,|\.{2,})\s*)+",
        "",
        text,
        flags=re.I,
    )
    t = re.sub(r"\.{2,}", " ", t)
    t2 = PHONE_RE.sub(" ", t)
    if outline:
        pat = rf"(?:^|[\s,])0*{re.escape(outline)}(?=\s|$)"
        m = re.search(pat, t2)
        if m:
            t2 = t2[: m.start()]
    t2 = re.sub(r"\d{1,2}\.\d{1,2}(?:\.\d{2,4})?", " ", t2)
    t2 = re.sub(r"\s+", " ", t2).strip(" ,;-")
    if "," in t2:
        name_part = t2.split(",", 1)[0].strip()
    else:
        toks = t2.split()
        name_part = " ".join(toks[:2]) if len(toks) >= 2 else t2
    return re.sub(r"[^A-Za-zÅÄÖåäöÁÉÜáéü'\-\s]", "", name_part).strip()


def tokens(name: str):
    return [
        p.lower()
        for p in re.split(r"[\s\-]+", name.strip())
        if p and p.lower() not in {"ap"}
    ]


def main() -> None:
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    for s in seed["speakers"]:
        s["lastUsedAt"] = None
        s["timesUsed"] = 0
    for t in seed["themes"]:
        t["lastUsedAt"] = None
        t["timesUsed"] = 0

    by_last: dict[str, list] = defaultdict(list)
    for s in seed["speakers"]:
        toks = tokens(s["name"])
        if not toks:
            continue
        by_last[toks[-1]].append(s)
        by_last[toks[0]].append(s)

    def match_speaker(raw_name: str):
        raw = tokens(raw_name)
        if len(raw) < 2:
            return None
        candidates = []
        for last in {raw[0], raw[-1]}:
            candidates.extend(by_last.get(last, []))
        seen = set()
        uniq = []
        for s in candidates:
            if s["phone"] in seen:
                continue
            seen.add(s["phone"])
            uniq.append(s)
        best = None
        best_score = 0
        raw_set = set(raw)
        for s in uniq:
            st = tokens(s["name"])
            score = len(raw_set & set(st))
            if len(raw) >= 2 and len(st) >= 2:
                if (raw[0] == st[0] and raw[-1] == st[-1]) or (
                    raw[0] == st[-1] and raw[-1] == st[0]
                ):
                    score += 2
            if score > best_score:
                best_score = score
                best = s
        return best if best_score >= 2 else None

    events = []
    with open_workbook(XLSB) as wb:
        for sheet_name in wb.sheets:
            if not re.match(r"^20\d{2}$", sheet_name):
                continue
            with wb.get_sheet(sheet_name) as sheet:
                for row in sheet.rows():
                    vals = [c.v for c in row]
                    if not vals:
                        continue
                    date = excel_date(vals[0])
                    text = vals[1] if len(vals) > 1 else None
                    if text is None or not date:
                        continue
                    text = str(text).strip()
                    if not text or text.upper().startswith("ESITELMIEN"):
                        continue
                    if re.fullmatch(
                        r"\s*(konventi|kierrosviikko.*|kierroskonventti)\s*",
                        text,
                        re.I,
                    ):
                        continue
                    if SKIP_RE.search(text) and extract_outline(text) is None:
                        continue
                    outline = extract_outline(text)
                    if not outline or outline in {"47", "82", "112", "123", "131"}:
                        continue
                    raw_name = extract_name(text, outline)
                    if not raw_name or len(tokens(raw_name)) < 2:
                        continue
                    sp = match_speaker(raw_name)
                    events.append(
                        {
                            "date": date,
                            "outline": outline,
                            "rawName": raw_name,
                            "speakerName": sp["name"] if sp else None,
                            "matched": bool(sp),
                            "year": sheet_name,
                        }
                    )

    last_outline: dict[str, str] = {}
    last_speaker: dict[str, str] = {}
    count_outline: dict[str, int] = defaultdict(int)
    count_speaker: dict[str, int] = defaultdict(int)
    for e in sorted(events, key=lambda x: x["date"]):
        last_outline[e["outline"]] = e["date"]
        count_outline[e["outline"]] += 1
        if e["speakerName"]:
            last_speaker[e["speakerName"].lower()] = e["date"]
            count_speaker[e["speakerName"].lower()] += 1

    for t in seed["themes"]:
        num = str(t["number"])
        t["lastUsedAt"] = last_outline.get(num)
        t["timesUsed"] = count_outline.get(num, 0)
    for s in seed["speakers"]:
        s["lastUsedAt"] = last_speaker.get(s["name"].lower())
        s["timesUsed"] = count_speaker.get(s["name"].lower(), 0)

    history = [
        {
            "date": e["date"],
            "outline": e["outline"],
            "speakerName": e["speakerName"],
            "rawName": e["rawName"],
        }
        for e in events
        if e["matched"]
    ]
    seed["history"] = history
    seed["historyStats"] = {
        "events": len(events),
        "matched": len(history),
        "outlinesWithHistory": len(last_outline),
        "speakersWithHistory": len(last_speaker),
        "sourceFile": XLSB.name,
    }

    SEED_PATH.write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")
    PUBLIC_SEED.write_text(json.dumps(seed, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(seed["historyStats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
