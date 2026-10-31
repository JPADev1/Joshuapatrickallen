"""Dump Wikipedia stat tables (as compact JSON) for the stat mountains: passing/rushing yards,
QB wins (regular season + playoffs) and AFC East titles. Parsing happens later, offline.

    python scripts/dump_tables.py out

Pages: every player already in out/history_pre1999.json, every player linked from the yardage and
QB-wins leader lists, the AFC East page and each AFC East team's starting-quarterback list.
Output: out/tables/<slug>.json  {"title", "infobox": {k: v}, "tables": [{"h": [headings], "cols": [...], "rows": [[...]], "links": [[...]]}]}
"""
import io, json, os, re, sys, warnings, urllib.request

import pandas as pd
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_history as H  # noqa: E402

warnings.filterwarnings("ignore")
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
H.OUT, H.CACHE = OUT, os.path.join(OUT, "pages")
DEST = os.path.join(OUT, "tables")

LISTS = [
    "List of National Football League career passing yards leaders",
    "List of National Football League career rushing yards leaders",
    "List of National Football League annual passing yards leaders",
    "List of National Football League annual rushing yards leaders",
    "List of National Football League career quarterback wins leaders",
    "List of National Football League quarterback playoff records",
    "List of National Football League rushing yards leaders by quarterbacks",
]
OTHER = [
    "AFC East", "List of Buffalo Bills starting quarterbacks", "List of Miami Dolphins starting quarterbacks",
    "List of New England Patriots starting quarterbacks", "List of New York Jets starting quarterbacks",
    "List of Indianapolis Colts starting quarterbacks", "List of Baltimore Colts starting quarterbacks",
    "List of National Football League division champions",
]
EXTRA = ["Jim Kelly", "Joe Ferguson", "Bob Griese", "Earl Morrall", "Johnny Unitas", "Bert Jones", "Steve Grogan",
         "Tony Eason", "David Woodley", "Don Strock", "Richard Todd", "Ken O'Brien", "Jay Schroeder", "Jim Harbaugh",
         "Vinny Testaverde", "Drew Bledsoe", "Dan Marino", "Jay Fiedler", "Chad Pennington", "Doug Flutie",
         "Bobby Douglass", "Steve Young", "Michael Vick", "Randall Cunningham", "Fran Tarkenton", "Tobin Rote",
         "Roger Staubach", "Steve McNair", "Kordell Stewart", "Jim Zorn", "John Elway", "Steve Grogan", "Greg Landry"]


def cell(x):
    s = re.sub(r"\[.*?\]", "", str(x)).strip()
    return "" if s in ("nan", "NaN") else s


def dump(title):
    d = H.page(title)
    if "text" not in d:
        return f"fetch failed: {d.get('error')}"
    soup = BeautifulSoup(d["text"], "lxml")
    out = {"title": d["title"], "infobox": {}, "tables": []}
    ib = soup.select_one("table.infobox")
    if ib:
        for tr in ib.find_all("tr"):
            th, td = tr.find("th"), tr.find("td")
            if th and td:
                out["infobox"][th.get_text(" ", strip=True)] = td.get_text(" ", strip=True)
    for t in soup.find_all("table"):
        if "infobox" in (t.get("class") or []) or "navbox" in " ".join(t.get("class") or []):
            continue
        try:
            df = pd.read_html(io.StringIO(str(t)))[0]
        except Exception:
            continue
        if df.shape[0] < 1 or df.shape[1] < 3 or df.shape[0] * df.shape[1] > 20000:
            continue
        cols = ["|".join(H.colname(c)) for c in df.columns]
        rows = [[cell(v) for v in r] for r in df.itertuples(index=False)]
        links = []
        for tr in t.find_all("tr"):
            links.append([urllib.request.unquote(a["href"][6:]).replace("_", " ").split("#")[0]
                          for a in tr.select("a[href^='/wiki/']") if ":" not in a["href"][6:]])
        out["tables"].append({"h": H.headings(t), "cols": cols, "rows": rows, "links": links})
    os.makedirs(DEST, exist_ok=True)
    json.dump(out, open(os.path.join(DEST, H.slug(title) + ".json"), "w"), separators=(",", ":"), ensure_ascii=False)
    return "ok"


def main():
    hist = json.load(open(os.path.join(OUT, "history_pre1999.json")))["players"]
    titles = list(OTHER) + list(LISTS)
    for L in LISTS:
        got = H.list_links(L)
        print(f"{L}: {len(got)} links")
        titles += got
    titles += [p["wiki"] for p in hist] + EXTRA
    log = []
    for t in dict.fromkeys(titles):
        if os.path.exists(os.path.join(DEST, H.slug(t) + ".json")):
            continue
        res = dump(t)
        if res != "ok":
            log.append(f"{t}\t{res}")
    open(os.path.join(OUT, "tables_log.txt"), "w").write(f"{len(dict.fromkeys(titles))} titles, {len(log)} failed\n" + "\n".join(log) + "\n")
    print(open(os.path.join(OUT, "tables_log.txt")).read()[:3000])


if __name__ == "__main__":
    main()
