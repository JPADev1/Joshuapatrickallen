"""Build season-by-season passing/rushing/receiving TDs for NFL players whose careers began before 1999.

1999 and later comes from nflverse (complete). This fills in the history before that, from Wikipedia
player pages (CC BY-SA), and checks every player's season sum against the Career row and infobox
totals on his page. Output:
  out/history_pre1999.json   players, seasons before 1999 only
  out/report.txt             what was checked, what didn't match, what couldn't be parsed
"""
import csv, io, json, os, re, sys, urllib.request
import warnings
from collections import defaultdict

import pandas as pd
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_wiki import fetch  # noqa: E402

warnings.filterwarnings("ignore")
OUT = sys.argv[1] if len(sys.argv) > 1 else "out"
CACHE = os.path.join(OUT, "pages")
LISTS = [
    "List of National Football League career passing touchdowns leaders",
    "List of National Football League career rushing touchdowns leaders",
    "List of National Football League career receiving touchdowns leaders",
    "List of National Football League annual passing touchdowns leaders",
    "List of National Football League annual rushing touchdowns leaders",
    "List of National Football League annual receiving touchdowns leaders",
    "List of dual-threat quarterback records",
    "List of NFL individual records",
]
# Hot starters, old-timers and running quarterbacks who might not be on any list above
EXTRA = ["Charlie Conerly", "Tobin Rote", "Jack Kemp", "Bobby Layne", "Norm Van Brocklin", "Bob Waterfield",
         "Sammy Baugh", "Sid Luckman", "Otto Graham", "Y. A. Tittle", "Johnny Lujack", "Frankie Albert",
         "Billy Kilmer", "Greg Landry", "Bobby Douglass", "Steve Grogan", "Randall Cunningham", "Steve McNair",
         "Kordell Stewart", "Earl Campbell", "Gale Sayers", "Billy Sims", "Eric Dickerson", "Curt Warner",
         "Joe Morris (American football)", "Lenny Moore", "Paul Hornung", "Don Hutson", "Lance Alworth",
         "Elroy Hirsch", "Bill Groman", "John Hadl", "Babe Parilli", "Frank Tripucka", "George Blanda",
         "Cotton Davidson", "Daryle Lamonica", "Joe Namath", "Len Dawson", "Roman Gabriel", "Jim Hart",
         "Ken Stabler", "Bert Jones", "Archie Manning", "Jim Plunkett", "Bob Griese", "Terry Bradshaw",
         "Roger Staubach", "Ken Anderson (quarterback)", "Dan Fouts", "Joe Montana", "John Elway",
         "Jim Kelly", "Boomer Esiason", "Bernie Kosar", "Phil Simms", "Warren Moon", "Troy Aikman",
         "Brett Favre", "Drew Bledsoe", "Peyton Manning", "Kerry Collins", "Mark Brunell", "Jeff George",
         "Rick Mirer", "Jim Everett", "Dave Krieg", "Neil Lomax", "Tommy Kramer", "Danny White",
         "Vinny Testaverde", "Jim Harbaugh", "Rich Gannon", "Steve Beuerlein", "Jake Plummer",
         "Ryan Leaf", "Charlie Batch", "Trent Green", "Jon Kitna", "Doug Flutie", "Chris Chandler",
         "Steve DeBerg", "Ron Jaworski", "Joe Ferguson", "Craig Morton", "Fran Tarkenton", "Sonny Jurgensen",
         "Johnny Unitas", "Bart Starr", "Norm Snead", "Charley Johnson", "Bill Nelsen", "Frank Ryan (American football)",
         "Milt Plum", "Ed Brown (quarterback)", "Earl Morrall", "Don Meredith", "Craig Morton", "Jim Brown",
         "Walter Payton", "Marcus Allen", "Barry Sanders", "Emmitt Smith", "Thurman Thomas", "John Riggins",
         "Franco Harris", "O. J. Simpson", "Tony Dorsett", "Terry Allen", "Jerome Bettis", "Marshall Faulk",
         "Ricky Watters", "Curtis Martin", "Terrell Davis", "Natrone Means", "Chuck Muncie", "Pete Johnson",
         "Jim Taylor (fullback)", "Leroy Kelly", "Steve Van Buren", "Jerry Rice", "Cris Carter", "Steve Largent",
         "Art Monk", "Andre Reed", "Mark Clayton", "Sterling Sharpe", "Tim Brown", "Herman Moore",
         "Carl Pickens", "Michael Irvin", "Randy Moss", "Terrell Owens", "Tommy McDonald (wide receiver)",
         "Don Maynard", "Charley Taylor", "Paul Warfield", "Bobby Mitchell", "Sonny Randle", "Art Powell",
         "Lance Alworth", "Otis Taylor", "Harold Jackson", "Wes Chandler", "John Jefferson", "Mark Duper",
         "Roger Craig (American football)", "Keith Byars", "Larry Csonka", "Chuck Foreman", "Wilbert Montgomery"]
DRAFT_URL = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv"
EXCLUDE_HEAD = re.compile(r"\b(cfl|usfl|college|xfl|arena|wfl|ufl|aaf|canadian|high school|postseason|playoffs|super bowl)\b", re.I)
AAFC = re.compile(r"\b(aafc|dons|yankees|rockets|hornets|seahawks|dodgers)\b", re.I)
AAFC_CODES = {"CLE", "SF", "SFO", "BAL", "BUF", "NYY", "LAD", "CHR", "CHH", "MIA", "BKN", "BRK", "BKD", "CHI"}


def slug(t):
    return re.sub(r"[^A-Za-z0-9]+", "_", t).strip("_")


def page(title):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, slug(title) + ".json")
    if os.path.exists(p):
        return json.load(open(p))
    d, err = fetch(title)
    d = {"title": d["title"], "text": d["text"]} if d else {"error": err}
    json.dump(d, open(p, "w"))
    return d


def num(v):
    s = str(v).replace(",", "").replace("−", "-").replace("–", "-").strip()
    s = re.sub(r"\[.*?\]", "", s)
    m = re.match(r"^-?\d+", s)
    return int(m.group()) if m else 0


def headings(t):
    return [h.get_text(" ", strip=True) for h in t.find_all_previous(["h2", "h3", "h4"])][:3]


def pick_table(soup):
    cands = []
    for t in soup.find_all("table"):
        txt = t.get_text(" ", strip=True)
        if "Year" not in txt[:200] or "TD" not in txt:
            continue
        cands.append((headings(t), t))
    for hs, t in cands:   # "Regular season" under an NFL/AFL career section
        if hs and re.search(r"regular season", hs[0], re.I) and not any(EXCLUDE_HEAD.search(h) for h in hs[1:2]) \
                and not EXCLUDE_HEAD.search(hs[0].replace("Regular season", "")):
            return t, hs
    for hs, t in cands:   # otherwise the first stats table that isn't college/CFL/playoffs
        if hs and not EXCLUDE_HEAD.search(hs[0]) and re.search(r"statistic|career|nfl|afl", " ".join(hs[:2]), re.I):
            return t, hs
    return None, None


def colname(c):
    parts = [re.sub(r"\[.*?\]", "", str(x)).strip() for x in (c if isinstance(c, tuple) else (c,))]
    return [p for p in parts if p and not p.startswith("Unnamed")]


def parse_table(t):
    df = pd.read_html(io.StringIO(str(t)))[0]
    cols = [colname(c) for c in df.columns]
    kind_cols = {}
    for i, parts in enumerate(cols):
        if not parts or parts[-1] not in ("TD", "TDs", "Td"):
            continue
        grp = " ".join(parts[:-1]).lower()
        k = "pass" if "pass" in grp else "rush" if "rush" in grp else "rec" if "rec" in grp else None
        if k and k not in kind_cols:
            kind_cols[k] = i
    if not kind_cols:
        return None
    rows, career = [], None
    for _, r in df.iterrows():
        y, team = str(r.iloc[0]), str(r.iloc[1])
        vals = {k: num(r.iloc[i]) for k, i in kind_cols.items()}
        if re.search(r"career|total", y, re.I):
            career = vals
            continue
        m = re.match(r"^(19|20)\d\d", y.strip())
        if not m:
            continue
        rows.append({"year": int(m.group()), "team": team, **vals})
    return {"kinds": sorted(kind_cols), "rows": rows, "career": career}


def infobox(soup):
    out, ib = {}, soup.select_one("table.infobox")
    if not ib:
        return out
    for tr in ib.find_all("tr"):
        th, td = tr.find("th"), tr.find("td")
        if not th or not td:
            continue
        k, v = th.get_text(" ", strip=True), td.get_text(" ", strip=True)
        if k.startswith("Position") and "pos" not in out:
            out["pos"] = re.sub(r"\(.*?\)|\[.*?\]", "", v).strip()
        elif re.match(r"^(TD\s*[–-]\s*INT|Touchdown\s*[–-]\s*interception)", k) and "pass" not in out:
            out["pass"] = num(v.split("–")[0].split("-")[0])
        elif k.startswith("Passing touchdowns") and "pass" not in out:
            out["pass"] = num(v)
        elif k.startswith("Rushing touchdowns") and "rush" not in out:
            out["rush"] = num(v)
        elif k.startswith("Receiving touchdowns") and "rec" not in out:
            out["rec"] = num(v)
    return out


def player(title):
    d = page(title)
    if "text" not in d:
        return None, f"fetch failed: {d.get('error')}"
    soup = BeautifulSoup(d["text"], "lxml")
    t, hs = pick_table(soup)
    if t is None:
        return None, "no NFL stats table"
    try:
        p = parse_table(t)
    except Exception as e:
        return None, f"table parse error: {e}"
    if not p or not p["rows"]:
        return None, "table has no TD columns"
    ib = infobox(soup)
    seasons = defaultdict(lambda: {"pass": 0, "rush": 0, "rec": 0})
    dropped = []
    for r in p["rows"]:
        if 1946 <= r["year"] <= 1949 and (AAFC.search(r["team"]) or r["team"].strip().upper() in AAFC_CODES
                                           and not re.search(r"bears|cardinals|rams|eagles|steelers", r["team"], re.I)):
            # AAFC seasons aren't NFL stats; only drop them when the infobox total says so (checked below)
            dropped.append(r)
        for k in ("pass", "rush", "rec"):
            seasons[r["year"]][k] += r.get(k, 0)
    all_sum = {k: sum(r.get(k, 0) for r in p["rows"]) for k in ("pass", "rush", "rec")}
    notes = []
    if p["career"]:
        for k in p["kinds"]:
            if p["career"].get(k, 0) != all_sum[k]:
                notes.append(f"career row {k} {p['career'][k]} != season sum {all_sum[k]}")
    aafc_sum = {k: sum(r.get(k, 0) for r in dropped) for k in ("pass", "rush", "rec")}
    use_aafc = True
    for k in ("pass", "rush", "rec"):
        if k in ib and ib[k] != all_sum[k]:
            if dropped and ib[k] == all_sum[k] - aafc_sum[k]:
                use_aafc = False
            else:
                notes.append(f"infobox {k} {ib[k]} != table {all_sum[k]}")
    if not use_aafc:
        for r in dropped:
            for k in ("pass", "rush", "rec"):
                seasons[r["year"]][k] -= r.get(k, 0)
        notes.append(f"AAFC seasons left out: {sorted({r['year'] for r in dropped})}")
    return {"title": d["title"], "pos": ib.get("pos", ""), "first": min(seasons), "last": max(seasons),
            "seasons": {y: v for y, v in sorted(seasons.items())}, "infobox": {k: ib[k] for k in ("pass", "rush", "rec") if k in ib},
            "heading": " > ".join(reversed(hs or [])), "notes": notes}, None


def list_links(title):
    d = page(title)
    if "text" not in d:
        return []
    soup = BeautifulSoup(d["text"], "lxml")
    out = []
    for t in soup.select("table.wikitable, table.sortable"):
        for a in t.select("a[href^='/wiki/']"):
            h = a["href"][6:]
            if ":" in h or re.search(r"\d{4}|season|League|List_of|Hall_of_Fame|_(Bears|Packers|Giants|Lions|Rams|Colts|"
                                     r"Browns|Eagles|Steelers|Cardinals|Redskins|Commanders|Cowboys|49ers|Vikings|"
                                     r"Falcons|Saints|Dolphins|Bills|Jets|Patriots|Chiefs|Raiders|Broncos|Chargers|"
                                     r"Oilers|Titans|Bengals|Seahawks|Buccaneers|Ravens|Panthers|Jaguars|Texans|Football_Team|Yanks|Dodgers)$", h):
                continue
            out.append(urllib.request.unquote(h).replace("_", " ").split("#")[0])
    return out


def draft_candidates():
    raw = urllib.request.urlopen(DRAFT_URL, timeout=120).read().decode()
    out = []
    for r in csv.DictReader(io.StringIO(raw)):
        if not 1980 <= int(r["season"]) <= 1998:
            continue
        p, ru, re_ = (num(r[k] or 0) for k in ("pass_tds", "rush_tds", "rec_tds"))
        if p >= 40 or ru >= 25 or re_ >= 30 or p + ru + re_ >= 45:
            out.append({"name": r["pfr_player_name"], "pass": p, "rush": ru, "rec": re_, "pos": r["position"]})
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    titles = []
    for L in LISTS:
        got = list_links(L)
        print(f"{L}: {len(got)} links")
        titles += got
    titles += EXTRA
    seen, players, report = set(), {}, []

    def take(t, expect=None):
        if t in seen:
            return None
        seen.add(t)
        pl, err = player(t)
        if err:
            return err
        if expect:  # draft-data check that this is the right person
            for k in ("pass", "rush", "rec"):
                tot = sum(v[k] for v in pl["seasons"].values())
                if abs(tot - expect[k]) > 1:
                    return f"not the same player? {k} {tot} vs draft data {expect[k]}"
        if pl["first"] >= 1999:
            return "career began 1999 or later (nflverse covers it)"
        key = pl["title"]
        if key not in players:
            players[key] = pl
        return "ok"

    for t in dict.fromkeys(titles):
        res = take(t)
        if res and res != "ok":
            report.append(f"skip\t{t}\t{res}")
    for c in draft_candidates():
        res = None
        for t in (f"{c['name']} (American football)", c["name"]):
            res = take(t, c)
            if res == "ok" or (res and res.startswith("career began")):
                break
        if res and res != "ok" and not res.startswith("career began"):
            report.append(f"draft-miss\t{c['name']}\t{res}")
    # keep pre-1999 seasons only; nflverse supplies 1999+
    out = []
    for pl in players.values():
        s = {y: v for y, v in pl["seasons"].items() if y < 1999}
        if not any(v["pass"] or v["rush"] or v["rec"] for v in s.values()):
            continue
        out.append({"name": re.sub(r"\s*\(.*?\)$", "", pl["title"]), "wiki": pl["title"], "pos": pl["pos"],
                    "first": pl["first"], "last": pl["last"], "infobox": pl["infobox"],
                    "seasons": [[y, v["pass"], v["rush"], v["rec"]] for y, v in s.items()], "notes": pl["notes"]})
        if pl["notes"]:
            report.append(f"check\t{pl['title']}\t" + "; ".join(pl["notes"]))
    out.sort(key=lambda p: p["name"])
    json.dump({"source": "Wikipedia player pages (CC BY-SA 4.0), regular season, NFL/AFL",
               "players": out}, open(os.path.join(OUT, "history_pre1999.json"), "w"), indent=0)
    report.sort()
    open(os.path.join(OUT, "report.txt"), "w").write(
        f"{len(out)} players with pre-1999 seasons; {sum(1 for r in report if r.startswith('check'))} need a look\n\n" + "\n".join(report) + "\n")
    print(open(os.path.join(OUT, "report.txt")).read()[:3000])


if __name__ == "__main__":
    main()
