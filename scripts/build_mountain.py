"""Build data/td-mountain.json: season-by-season touchdowns for everyone who could appear on the
Touchdown Mountain page (top 30 in any view, through any number of seasons), plus Josh Allen.

Sources
  1999 to last season: nflverse season stats (every player)                      -> complete
  before 1999:         scripts/history_pre1999.json, built from Wikipedia player
                       pages and checked against each page's career totals       -> leaders and notable players
The current season is added by update_data.py every hour (td-mountain-<season>.json).

Run once a year after the Super Bowl (after bumping SEASON in update_data.py):
    python scripts/build_mountain.py
"""
import json, os, re, sys, unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], os.path.join(os.path.dirname(HERE), "data")]
import update_data as U  # noqa: E402

TOP = 30          # keep anyone in the top 30 of any view
MAX_N = 30        # through 1..30 seasons, plus career
VIEWS_POS = ("ALL", "QB", "RB")
KINDS = ("tot", "pass", "rush", "rec")
POS_MAP = [(r"quarterback|^qb", "QB"), (r"running back|halfback|fullback|tailback|^rb|^hb|^fb", "RB"),
           (r"wide receiver|flanker|split end|^end\b|^wr", "WR"), (r"tight end|^te", "TE")]


ALIAS = {"rocketismail": "raghibismail"}
# Wikipedia rows that slipped past the CFL filter: Matt Dunigan's only "NFL" season (1995) was the CFL's Birmingham Barracudas
NOT_NFL = {"Matt Dunigan"}


def norm(name):
    name = re.sub(r'["“”].*?["“”]', " ", name)  # drop quoted nicknames: James "Little Man" Stewart
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b\.?", "", s)
    s = re.sub(r"[^a-z]", "", s)
    return ALIAS.get(s, s)


def pos_code(p):
    p = (p or "").strip()
    for pat, code in POS_MAP:
        if re.search(pat, p, re.I):
            return code
    return p.upper()[:3] or "?"


PARTS = {"tot": ("pass", "rush", "rec"), "pass": ("pass",), "rush": ("rush",), "rec": ("rec",)}
IDX = {"pass": 0, "rush": 1, "rec": 2}


def total(p, kind, n):
    """Same rule as the page: a category that isn't split by season (miss) counts only via its career
    total, so only in the career view or when n covers the player's whole career; otherwise None."""
    last = None if n is None else p["first"] + n - 1
    whole = last is None or last >= p["last"]
    t = 0
    for k in PARTS[kind]:
        if k in p.get("miss", ()):
            if not whole or k not in p.get("car", {}):
                return None
            t += p["car"][k]
        else:
            t += sum(s[IDX[k]] for y, s in p["seasons"].items() if last is None or y <= last)
    return t


def main():
    hist = json.load(open(os.path.join(HERE, "history_pre1999.json")))["players"]
    # games played before 1999, from the same Wikipedia tables (built on the history-build branch)
    hist_games = json.load(open(os.path.join(HERE, "games_pre1999.json")))["players"]
    people = {}   # id -> {name, pos, first, seasons{year:[p,r,c]}}
    roster = {r["gsis_id"]: r for r in U.get("players/players.csv")}

    # 1999 .. last completed season, every player
    for y in range(1999, U.SEASON):
        for r in U.get(f"stats_player/stats_player_reg_{y}.csv"):
            t = [int(U.num(r, k)) for k in ("passing_tds", "rushing_tds", "receiving_tds")]
            pid = r["player_id"]
            info = roster.get(pid, {})
            p = people.setdefault(pid, {"id": pid, "name": r.get("player_display_name") or info.get("display_name", pid),
                                        "pos": info.get("position") or r.get("position", ""),
                                        "first": int(info.get("rookie_season") or y), "last": y, "seasons": {}, "games": {}})
            p["last"] = max(p["last"], y)
            p["first"] = min(p["first"], y)
            g = int(U.num(r, "games"))
            if g:
                p["games"][y] = g
            if any(t) or g:  # a season with games but no TDs still counts toward games played
                p["seasons"][y] = t

    # nflverse "games" only counts games where a player recorded a stat. Snap counts (2012 on, from
    # Pro Football Reference) list every game he was on the field, so use whichever is higher.
    pfr = {r["pfr_id"]: r["gsis_id"] for r in roster.values() if r.get("pfr_id")}
    for y in range(2012, U.SEASON):
        snaps = defaultdict(int)
        for r in U.get(f"snap_counts/snap_counts_{y}.csv"):
            if r["game_type"] == "REG" and r["pfr_player_id"] in pfr and \
                    any(U.num(r, k) > 0 for k in ("offense_snaps", "defense_snaps", "st_snaps")):
                snaps[pfr[r["pfr_player_id"]]] += 1
        for pid, g in snaps.items():
            p = people.get(pid)
            if p and g > p["games"].get(y, 0):
                p["games"][y] = g
                p["seasons"].setdefault(y, [0, 0, 0])
                p["first"], p["last"] = min(p["first"], y), max(p["last"], y)

    # Merge Wikipedia history (pre-1999 seasons) onto players who continued past 1998
    by_name = defaultdict(list)
    for pid, p in people.items():
        if p["first"] < 1999:
            by_name[norm(p["name"])].append(pid)
    problems, merged, hist_only = [], 0, 0
    for h in hist:
        if h["name"] in NOT_NFL:
            continue
        seasons = {y: [a, b, c] for y, a, b, c in h["seasons"]}
        games = {y: g for y, g in hist_games.get(h["wiki"], [])}  # g is None where the table had no games
        key = norm(h["name"])
        cands = by_name.get(key, [])
        # one pre-1999 nflverse player with that name is a match; several are told apart by when they started
        matches = cands if len(cands) == 1 else [pid for pid in cands if abs(people[pid]["first"] - h["first"]) <= 1]
        if len(matches) > 1:
            problems.append(f"{h['name']}: several nflverse matches {matches}")
        if matches and h["last"] >= 1999:
            p = people[matches[0]]
            p["seasons"].update(seasons)
            p["games"].update({y: games.get(y) for y in seasons})
            p["first"] = min(p["first"], h["first"])  # nflverse rookie season = year he entered the league
            p["wiki"] = h["wiki"]
            if h.get("missing"):
                p["miss"], p["car"] = h["missing"], h.get("career", {})
            merged += 1
            # whole-career check against the Wikipedia infobox
            for i, k in enumerate(("pass", "rush", "rec")):
                if k in h["infobox"] and k not in h.get("missing", []):
                    tot = sum(s[i] for s in p["seasons"].values())
                    if tot != h["infobox"][k]:
                        problems.append(f"{h['name']}: career {k} {tot} (Wikipedia pre-1999 + nflverse) != infobox {h['infobox'][k]}")
        elif h["last"] >= 1999 and not matches:
            problems.append(f"{h['name']}: played past 1998 but no nflverse match; using Wikipedia seasons only")
            people["w:" + h["wiki"]] = {"id": "w:" + h["wiki"], "name": h["name"], "pos": pos_code(h["pos"]), "first": h["first"],
                                         "last": h["last"], "seasons": seasons, "wiki": h["wiki"], "gpx": 1,  # 1999+ games unknown
                                         "games": {y: games.get(y) for y in seasons},
                                         "miss": h.get("missing", []), "car": h.get("career", {})}
        else:
            people["w:" + h["wiki"]] = {"id": "w:" + h["wiki"], "name": h["name"], "pos": pos_code(h["pos"]),
                                         "first": h["first"], "last": h["last"], "seasons": seasons, "wiki": h["wiki"],
                                         "games": {y: games.get(y) for y in seasons},
                                         "miss": h.get("missing", []), "car": h.get("career", {})}
            hist_only += 1

    # Players who started before 1999 but have no history: their early seasons are unknown, so they
    # can't be placed fairly. Leave them out, and report the biggest ones so nobody notable is lost.
    unknown = [p for p in people.values() if not p["id"].startswith("w:") and p["first"] < 1999 and "wiki" not in p]
    for p in unknown:
        del people[p["id"]]
    unknown.sort(key=lambda p: -sum(sum(s) for s in p["seasons"].values()))

    for p in people.values():
        p["pos"] = pos_code(p["pos"])

    # Pool: top 30 in any view through any number of seasons, and in careers
    keep = {U.ALLEN}
    for pos in VIEWS_POS:
        group = [p for p in people.values() if pos == "ALL" or p["pos"] == pos]
        for kind in KINDS:
            for n in list(range(1, MAX_N + 1)) + [None]:
                score = []
                for p in group:
                    v = total(p, kind, n)
                    if v:
                        score.append((v, p["id"]))
                score.sort(reverse=True)
                if len(score) >= TOP:
                    cut = score[TOP - 1][0]
                    keep.update(i for v, i in score if v >= cut)
                else:
                    keep.update(i for v, i in score)
    pool = [people[i] for i in keep if i in people]
    out = []
    for p in sorted(pool, key=lambda p: p["name"]):
        q = {"id": p["id"], "name": p["name"], "pos": p["pos"], "first": p["first"], "last": p["last"],
             # [year, pass, rush, rec, games]; games is null where the source doesn't give it
             "seasons": [[y] + s + [p.get("games", {}).get(y)] for y, s in sorted(p["seasons"].items())]}
        if p.get("gpx"):
            q["gpx"] = 1
        if p["last"] >= U.SEASON - 2 and roster.get(p["id"], {}).get("pfr_id"):
            q["pfr"] = roster[p["id"]]["pfr_id"]  # lets the hourly job match this season's snap counts
        if p.get("miss"):
            q["miss"], q["car"] = p["miss"], p.get("car", {})
        out.append(q)
    obj = {"through": U.SEASON - 1,
           "note": "Regular season. 1999 on: nflverse (CC BY 4.0). Before 1999: Wikipedia player pages (CC BY-SA 4.0).",
           "players": out}
    path = os.path.join(U.OUT, "td-mountain.json")
    with open(path, "w") as f:
        f.write('{"through":%d,"note":%s,"players":[\n' % (obj["through"], json.dumps(obj["note"])))
        f.write(",\n".join(json.dumps(p, separators=(",", ":"), ensure_ascii=False) for p in out) + "\n]}\n")
    print(f"{len(out)} players kept ({merged} merged with history, {hist_only} history-only); "
          f"file {os.path.getsize(path) // 1024} KB")
    print("\nleft out (began before 1999, no history), biggest:")
    for p in unknown[:15]:
        t = [sum(s[i] for s in p["seasons"].values()) for i in range(3)]
        print(f"  {p['name']} ({p['pos']}, rookie {p['first']}): 1999+ pass/rush/rec {t}")
    print("\nchecks:")
    for x in problems:
        print("  " + x)


if __name__ == "__main__":
    main()
