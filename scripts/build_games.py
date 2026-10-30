"""Games played per season, before 1999, for every player in out/history_pre1999.json.

Reads the same Wikipedia stats table that build_history.py used for touchdowns (same table choice,
same CFL/AAFC rows left out) and takes its games column (G or GP, never GS). TD numbers are not touched.
Output:
  out/games_pre1999.json   {"players": {wiki title: [[year, games], ...]}}
  out/games_report.txt     players with no games column, and seasons that look wrong
"""
import io, json, os, re, sys, warnings

import pandas as pd
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_history as H  # noqa: E402

warnings.filterwarnings("ignore")
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
H.OUT, H.CACHE = OUT, os.path.join(OUT, "pages")


def season_max(y):  # NFL/AFL regular-season length
    return 17 if y >= 2021 else 16 if y >= 1978 else 14 if y >= 1961 else 12 if y >= 1947 else 11


def games_col(df):
    cols = [H.colname(c) for c in df.columns]
    for want in (r"^(gp|g)$", r"^games$"):
        for i, parts in enumerate(cols):
            if parts and re.match(want, parts[-1], re.I):
                return i
    return None


def games(title):
    d = H.page(title)
    if "text" not in d:
        return None, f"fetch failed: {d.get('error')}"
    tables, _ = H.pick_tables(BeautifulSoup(d["text"], "lxml"))
    for t in tables:  # first table in the section that has a games column
        try:
            df = pd.read_html(io.StringIO(str(t)))[0]
        except Exception:
            continue
        gi = games_col(df)
        if gi is None:
            continue
        per = {}
        for _, r in df.iterrows():
            y, team = str(r.iloc[0]), str(r.iloc[1])
            m = re.match(r"^(19|20)\d\d", y.strip())
            if not m:
                continue
            yr = int(m.group())
            if H.CFL.search(team) or team.strip().upper() in H.CFL_CODES:
                continue
            if 1946 <= yr <= 1949 and (H.AAFC.search(team) or team.strip().upper() in H.AAFC_CODES):
                continue
            per[yr] = per.get(yr, 0) + H.num(r.iloc[gi])  # traded mid-season: one row per team
        if per:
            return per, None
    return None, "no games column"


def main():
    hist = json.load(open(os.path.join(OUT, "history_pre1999.json")))["players"]
    out, report = {}, []
    for h in hist:
        per, err = games(h["wiki"])
        if err:
            report.append(f"missing\t{h['name']}\t{err}")
            continue
        rows = []
        for y, *_ in h["seasons"]:
            g = per.get(y)
            if g is None:
                report.append(f"no-row\t{h['name']}\t{y}")
            elif g < 0 or g > season_max(y):
                report.append(f"odd\t{h['name']}\t{y}: {g} games")
            rows.append([y, g])
        out[h["wiki"]] = rows
    json.dump({"source": "Wikipedia player pages (CC BY-SA 4.0), regular season games played",
               "players": out}, open(os.path.join(OUT, "games_pre1999.json"), "w"), indent=0)
    report.sort()
    open(os.path.join(OUT, "games_report.txt"), "w").write(
        f"{len(out)} of {len(hist)} players have games; {len(report)} notes\n\n" + "\n".join(report) + "\n")
    print(open(os.path.join(OUT, "games_report.txt")).read()[:4000])


if __name__ == "__main__":
    main()
