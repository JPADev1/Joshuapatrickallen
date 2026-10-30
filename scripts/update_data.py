"""Refresh every changing number on joshuapatrickallen.com from free nflverse data.

Writes three files into the output folder (default: data/):
  allen-2026.json  Josh Allen's 2026 season, game by game, plus career playoff totals
  matchup.json     the Bills' next game: opponent, kickoff, records, team comparison,
                   Allen's history against them, past box scores, injury report
  nfl-ranks.json   NFL all-time leader lists with active players' totals kept current

Runs on GitHub Actions, no API key. Standard library only.
Safety: if a download fails or Allen's totals would go DOWN, the script stops and the old files stay.
Hand-written extras (TV network, all-time series records) live in data/overrides.json.
"""
import csv, gzip, io, json, os, sys, time, urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime

SEASON = 2026
ALLEN = "00-0034857"          # Josh Allen in nflverse
BILLS = "BUF"
REL = "https://github.com/nflverse/nflverse-data/releases/download"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPO, "data")
CACHE = os.environ.get("NFL_CACHE", "")  # optional folder of already-downloaded files (for testing)

# Career playoff totals through the 2025 season, from nflverse (2019-2025 playoffs).
POST_BASE = {"games": 15, "yds": 3915, "td": 29, "rushTD": 9}
# Old team codes that are the same franchise today.
SAME = {"OAK": "LV", "SD": "LAC", "STL": "LA"}
# Where the home stadium actually is, when that differs from the team's region name.
CITY = {"BUF": "Orchard Park", "NE": "Foxborough", "ARI": "Glendale", "CAR": "Charlotte", "MIN": "Minneapolis",
        "TEN": "Nashville", "DAL": "Arlington", "NYG": "East Rutherford", "NYJ": "East Rutherford",
        "SF": "Santa Clara", "LA": "Inglewood", "LAC": "Inglewood", "WAS": "Landover", "MIA": "Miami Gardens"}


# ---------- downloading ----------
def get(path, gz=False):
    name = path.split("/")[-1]
    if CACHE and os.path.exists(os.path.join(CACHE, name)):
        raw = open(os.path.join(CACHE, name), "rb").read()
    else:
        last = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(f"{REL}/{path}", timeout=120) as r:
                    raw = r.read()
                break
            except Exception as e:  # network hiccup: wait and retry
                last = e
                time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError(f"Could not download {path}: {last}")
    if gz:
        raw = gzip.decompress(raw)
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))


def num(r, *keys):
    for k in keys:
        v = r.get(k, "")
        if v not in ("", "NA", None):
            return float(v)
    return 0.0


def rating(c, a, y, t, i):
    if not a:
        return 0.0
    k = lambda x: max(0.0, min(2.375, x))
    return (k((c / a - .3) * 5) + k((y / a - 3) * .25) + k(t / a * 20) + k(2.375 - i / a * 25)) / 6 * 100


def load(name):
    try:
        return json.load(open(os.path.join(OUT, name)))
    except (FileNotFoundError, ValueError):
        return None


def save(name, obj, rows=None):
    """Write only when something besides the 'updated' stamp changed.
    rows: name of a long list to write one item per line (small file, readable diffs)."""
    old = load(name)
    strip = lambda d: json.dumps({k: v for k, v in (d or {}).items() if k != "updated"}, sort_keys=True)
    if old is not None and strip(old) == strip(obj):
        print(f"{name}: no change")
        return
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w") as f:
        if rows:
            head = json.dumps({k: v for k, v in obj.items() if k != rows}, ensure_ascii=False)[:-1]
            f.write(head + f',"{rows}":[\n' + ",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":"))
                                                     for x in obj[rows]) + "\n]}\n")
        else:
            f.write(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
    print(f"{name}: updated")


# ---------- shared lookups ----------
def short_date(d, weekday=False):
    m = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."][d.month - 1]
    s = f"{m} {d.day}, {d.year}"
    return (d.strftime("%A") + ", " + s) if weekday else s


# nflverse keeps some stadiums under old names. Correct name by stadium and game date (YYYY-MM-DD).
RENAMES = {
    "BUF00": [("2020-08-01", "New Era Field"), ("2021-03-30", "Bills Stadium"), ("9999", "Highmark Stadium")],
    "HOU00": [("9999", "NRG Stadium")],
    "NOR00": [("2021-07-29", "Mercedes-Benz Superdome"), ("9999", "Caesars Superdome")],
    "CLE00": [("2023-01-01", "FirstEnergy Stadium"), ("2024-01-01", "Cleveland Browns Stadium"), ("9999", "Huntington Bank Field")],
    "JAX00": [("2023-03-01", "TIAA Bank Field"), ("9999", "EverBank Stadium")],
}


def stadium(g):
    for until, name in RENAMES.get(g.get("stadium_id", ""), []):
        if g["gameday"] < until:
            return name
    return g["stadium"]


def kickoff(t):
    h, m = map(int, t.split(":"))
    ap = "a.m." if h < 12 else "p.m."
    return f"{(h - 1) % 12 + 1}:{m:02d} {ap} ET"


def lum(hexcol):
    h = hexcol.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def team_table():
    T = {}
    for r in get("teams/teams_colors_logos.csv"):
        cols = [c for c in (r["team_color"], r["team_color2"], r["team_color3"], r["team_color4"]) if c and c.startswith("#")]
        color = next((c for c in cols if 0.08 < lum(c) < 0.85), cols[0] if cols else "#888888")
        T[r["team_abbr"]] = {"name": r["team_name"], "nick": r["team_nick"], "color": color}
    return T


def result_for(g, team):
    """'W 27-13' from one team's point of view, or None if not played."""
    if g["home_score"] == "":
        return None
    hs, as_ = int(g["home_score"]), int(g["away_score"])
    me, them = (hs, as_) if g["home_team"] == team else (as_, hs)
    return ("W" if me > them else "L" if me < them else "T") + f" {me}-{them}"


def record(games, team):
    w = l = t = 0
    for g in games:
        r = result_for(g, team)
        if r:
            w += r[0] == "W"; l += r[0] == "L"; t += r[0] == "T"
    return f"{w}-{l}" + (f"-{t}" if t else "")


# ---------- 1. Allen's season ----------
def build_allen(week_rows, sched):
    by_game = {g["game_id"]: g for g in sched}
    rows = [r for r in week_rows if r["player_id"] == ALLEN and int(float(r["season"])) == SEASON]
    reg = sorted([r for r in rows if r["season_type"] == "REG"], key=lambda r: int(float(r["week"])))
    post = [r for r in rows if r["season_type"] == "POST"]
    if not reg:
        sys.exit("No regular-season rows for Josh Allen in the nflverse file.")
    games = []
    for r in reg:
        g = by_game.get(r["game_id"], {})
        home = g.get("home_team") == BILLS if g else None
        games.append({
            "week": int(float(r["week"])), "opp": r.get("opponent_team", ""),
            "date": g.get("gameday"), "home": home, "result": result_for(g, BILLS) if g else None,
            "started": g.get("home_qb_id" if home else "away_qb_id") == ALLEN if g else True,
            "cmp": int(num(r, "completions")), "att": int(num(r, "attempts")),
            "yds": int(num(r, "passing_yards")), "td": int(num(r, "passing_tds")),
            "int": int(num(r, "passing_interceptions", "interceptions")),
            "sk": int(num(r, "sacks_suffered", "sacks")),
            "rushAtt": int(num(r, "carries")), "rushYds": int(num(r, "rushing_yards")),
            "rushTD": int(num(r, "rushing_tds")), "recTD": int(num(r, "receiving_tds")),
            "fum": int(num(r, "fumbles_total")) or int(num(r, "sack_fumbles") + num(r, "rushing_fumbles") + num(r, "receiving_fumbles")),
            "fumLost": int(num(r, "fumbles_lost_total")) or int(num(r, "sack_fumbles_lost") + num(r, "rushing_fumbles_lost") + num(r, "receiving_fumbles_lost")),
        })
    keys = ("cmp", "att", "yds", "td", "int", "sk", "rushAtt", "rushYds", "rushTD", "recTD", "fum", "fumLost")
    n = {k: sum(g[k] for g in games) for k in keys}
    now = {"label": f"{SEASON}*", "g": len(games), "gs": sum(1 for g in games if g["started"]), **n,
           "rate": round(rating(n["cmp"], n["att"], n["yds"], n["td"], n["int"]), 1)}
    p = {"games": POST_BASE["games"] + len(post),
         "yds": POST_BASE["yds"] + int(sum(num(r, "passing_yards") for r in post)),
         "td": POST_BASE["td"] + int(sum(num(r, "passing_tds") for r in post)),
         "rushTD": POST_BASE["rushTD"] + int(sum(num(r, "rushing_tds") for r in post))}

    old = load("allen-2026.json")
    if old and old.get("now"):
        o = old["now"]
        if now["g"] < o["g"] or now["yds"] < o["yds"] - 25 or now["td"] < o["td"] or now["rushTD"] < o["rushTD"]:
            sys.exit(f"New totals are lower than the saved ones ({now} vs {o}); refusing to overwrite.")
    last = games[-1]
    thru = f"Week {last['week']}" + (f" ({short_date(date.fromisoformat(last['date']))})" if last.get("date") else "")
    return {"updated": date.today().isoformat(), "source": "nflverse weekly player stats (play-by-play based)",
            "thru": thru, "now": now, "post": p, "games": games}


# ---------- 2. Next game ----------
def team_stats(team_rows, sched_reg):
    S = defaultdict(Counter)
    for r in team_rows:
        if r["season_type"] != "REG":
            continue
        t, o = r["team"], r["opponent_team"]
        S[t]["g"] += 1
        for k in ("passing_yards", "rushing_yards", "sacks_suffered", "def_sacks", "passing_interceptions", "def_interceptions"):
            S[t][k] += num(r, k)
        S[o]["pass_allowed"] += num(r, "passing_yards")
        S[o]["rush_allowed"] += num(r, "rushing_yards")
    for g in sched_reg:
        if g["home_score"] == "":
            continue
        h, a, hs, as_ = g["home_team"], g["away_team"], int(g["home_score"]), int(g["away_score"])
        S[h]["pf"] += hs; S[h]["pa"] += as_; S[a]["pf"] += as_; S[a]["pa"] += hs
    return S


CATS = [  # label, field, per-game?, better
    ("Points scored, per game", "pf", True, "high"),
    ("Points allowed, per game", "pa", True, "low"),
    ("Passing yards, per game", "passing_yards", True, "high"),
    ("Passing yards allowed, per game", "pass_allowed", True, "low"),
    ("Rushing yards, per game", "rushing_yards", True, "high"),
    ("Rushing yards allowed, per game", "rush_allowed", True, "low"),
    ("Sacks allowed, season", "sacks_suffered", False, "low"),
    ("Sacks, season", "def_sacks", False, "high"),
    ("Interceptions thrown, season", "passing_interceptions", False, "low"),
    ("Interceptions, season", "def_interceptions", False, "high"),
]


def compare(S, a, b):
    out = []
    teams = [t for t in S if S[t]["g"]]
    for label, f, pg, better in CATS:
        rate = {t: S[t][f] / S[t]["g"] for t in teams}
        def rank(t):  # 1 = best; ties share a rank
            v = rate[t]
            return 1 + sum(1 for x in teams if (rate[x] > v if better == "high" else rate[x] < v) and abs(rate[x] - v) > 1e-9)
        val = lambda t: round(rate[t]) if pg else int(S[t][f])
        out.append({"label": label, "better": better, "dec": 0,
                    "bills": {"v": val(a), "rank": rank(a)}, "opp": {"v": val(b), "rank": rank(b)}})
    return out


def line_score(pbp, game_id, teams):
    """[[q1,q2,q3,q4,(ot),final] per team] in the given team order, from play-by-play."""
    plays = [p for p in pbp if p["game_id"] == game_id]
    if not plays:
        return None
    home, away = plays[0]["home_team"], plays[0]["away_team"]
    end = {}
    for p in plays:
        q = int(float(p["qtr"] or 0))
        if q and p["total_home_score"] not in ("", "NA"):
            end[q] = (int(float(p["total_home_score"])), int(float(p["total_away_score"])))
    qs = sorted(end)
    prev = (0, 0); rows = {home: [], away: []}
    for q in qs:
        h, a = end[q]
        rows[home].append(h - prev[0]); rows[away].append(a - prev[1]); prev = (h, a)
    while len(rows[home]) < 4:
        rows[home].append(0); rows[away].append(0)
    if len(qs) > 5:  # several OT periods: fold into one
        rows[home] = rows[home][:4] + [sum(rows[home][4:])]; rows[away] = rows[away][:4] + [sum(rows[away][4:])]
    rows[home].append(prev[0]); rows[away].append(prev[1])
    return [rows[t] for t in teams]


def lines_for(rows, team, skip=None):
    """Short stat lines for one team's top performers in one game."""
    rows = [r for r in rows if r["team"] == team and r["player_id"] != skip]
    out = []
    for r in sorted(rows, key=lambda r: -num(r, "attempts")):
        if num(r, "attempts") >= 10:
            out.append(f"{r['player_display_name']}: {int(num(r,'completions'))}-{int(num(r,'attempts'))}, {int(num(r,'passing_yards'))} yds, "
                       f"{int(num(r,'passing_tds'))} TD, {int(num(r,'passing_interceptions'))} INT")
    for r in sorted(rows, key=lambda r: -num(r, "rushing_yards"))[:2]:
        if num(r, "carries") >= 3 and num(r, "attempts") < 10:
            td = int(num(r, "rushing_tds"))
            out.append(f"{r['player_display_name']}: {int(num(r,'carries'))} carries, {int(num(r,'rushing_yards'))} yds" + (f", {td} TD" if td else ""))
    for r in sorted(rows, key=lambda r: -num(r, "receiving_yards"))[:3]:
        if num(r, "receptions") >= 1:
            td = int(num(r, "receiving_tds"))
            out.append(f"{r['player_display_name']}: {int(num(r,'receptions'))} rec, {int(num(r,'receiving_yards'))} yds" + (f", {td} TD" if td else ""))
    return out


def allen_line(r):
    c, a, y, t, i = (int(num(r, k)) for k in ("completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions"))
    sk = int(num(r, "sacks_suffered"))
    car, ry, rt = int(num(r, "carries")), int(num(r, "rushing_yards")), int(num(r, "rushing_tds"))
    s = f"{c}-{a}, {y} yds, {t} TD, {i} INT, {sk} sack{'s' if sk != 1 else ''}, {rating(c, a, y, t, i):.1f} rating."
    if car:
        s += f" {car} carr{'ies' if car != 1 else 'y'}, {ry} yd{'s' if abs(ry) != 1 else ''}" + (f", {rt} TD" if rt else "") + "."
    return s


def build_matchup(sched, team_rows, week26, inj, T, overrides):
    canon = lambda t: SAME.get(t, t)
    bills_all = [g for g in sched if BILLS in (g["home_team"], g["away_team"])]
    cur = sorted([g for g in bills_all if g["season"] == str(SEASON)], key=lambda g: (g["gameday"], g["gametime"]))
    nxt = next((g for g in cur if g["home_score"] == ""), None)
    old = load("matchup.json")
    if nxt is None:
        print("matchup: no upcoming Bills game in the schedule; keeping the current page")
        return old
    home = nxt["home_team"] == BILLS
    opp = nxt["away_team"] if home else nxt["home_team"]
    reg26 = [g for g in sched if g["season"] == str(SEASON) and g["game_type"] == "REG"]
    S = team_stats(team_rows, reg26)
    ov = overrides.get("games", {}).get(nxt["game_id"], {})
    when = date.fromisoformat(nxt["gameday"])
    host = T.get(nxt["home_team"], {})
    city = CITY.get(nxt["home_team"], host.get("name", "").replace(" " + host.get("nick", ""), "")) if nxt["location"] != "Neutral" else ""
    gtype = nxt["game_type"]
    label = f"Week {nxt['week']}" if gtype == "REG" else {"WC": "Wild Card round", "DIV": "Divisional round", "CON": "AFC Championship", "SB": "Super Bowl"}.get(gtype, gtype)

    # Allen as the Bills' starter against this franchise, regular season
    vs_games = [g for g in bills_all if canon(g["home_team"] if g["away_team"] == BILLS else g["away_team"]) == opp
                and g["home_score"] != "" and int(g["season"]) >= 2018
                and g["home_qb_id" if g["home_team"] == BILLS else "away_qb_id"] == ALLEN]
    reuse = old if old and old.get("gameId") == nxt["game_id"] and old.get("history") else None
    seasons = sorted({int(g["season"]) for g in vs_games if int(g["season"]) < SEASON})
    ids = {g["game_id"] for g in vs_games}
    if reuse:  # same game as last run: Allen's older games are already saved, box scores too
        hist_rows = reuse["history"]["rows"]
    else:      # new opponent: read past seasons once
        hist_rows = []
        for y in seasons:
            hist_rows += [{k: r[k] for k in r if k in KEEP} for r in get(f"stats_player/stats_player_week_{y}.csv")
                          if r.get("game_id") in ids]
    history = {"rows": [r for r in hist_rows if r["player_id"] == ALLEN]}
    allrows = hist_rows + [{k: r[k] for k in r if k in KEEP} for r in week26 if r.get("game_id") in ids]
    reg_ids = {g["game_id"] for g in vs_games if g["game_type"] == "REG"}
    me = [r for r in allrows if r["player_id"] == ALLEN and r["game_id"] in reg_ids]
    s = lambda k: int(sum(num(r, k) for r in me))
    wins = sum(1 for g in vs_games if g["game_id"] in reg_ids and result_for(g, BILLS)[0] == "W")
    losses = sum(1 for g in vs_games if g["game_id"] in reg_ids and result_for(g, BILLS)[0] == "L")
    allen_vs = {"wins": wins, "losses": losses, "games": len(reg_ids), "cmp": s("completions"), "att": s("attempts"),
                "yds": s("passing_yards"), "td": s("passing_tds"), "int": s("passing_interceptions"), "sacks": s("sacks_suffered"),
                "rushAtt": s("carries"), "rushYds": s("rushing_yards"), "rushTD": s("rushing_tds"),
                "rating": round(rating(s("completions"), s("attempts"), s("passing_yards"), s("passing_tds"), s("passing_interceptions")), 1)}
    post = [g for g in vs_games if g["game_type"] != "REG"]
    allen_vs["postWins"] = sum(1 for g in post if result_for(g, BILLS)[0] == "W")
    allen_vs["postLosses"] = sum(1 for g in post if result_for(g, BILLS)[0] == "L")

    # Box scores of the three most recent meetings (Allen starts, regular season or playoffs)
    recent = sorted(vs_games, key=lambda g: g["gameday"], reverse=True)[:3]
    boxes = []
    cached = {b.get("gameId"): b for b in (old or {}).get("boxscores", []) if b.get("gameId")}
    pbp_by_season = {}
    for g in recent:
        if g["game_id"] in cached:
            boxes.append(cached[g["game_id"]]); continue
        y = int(g["season"])
        if y not in pbp_by_season:
            try:
                pbp_by_season[y] = [{k: p[k] for k in ("game_id", "qtr", "home_team", "away_team", "total_home_score", "total_away_score")}
                                    for p in get(f"pbp/play_by_play_{y}.csv.gz", gz=True)]
            except Exception as e:
                print("pbp unavailable:", e); pbp_by_season[y] = []
        order = [g["away_team"], g["home_team"]]
        line = line_score(pbp_by_season[y], g["game_id"], order) or [[int(g["away_score"])], [int(g["home_score"])]]
        grows = [r for r in allrows if r["game_id"] == g["game_id"]]
        me_r = next((r for r in grows if r["player_id"] == ALLEN), None)
        d = date.fromisoformat(g["gameday"])
        hostg = T.get(g["home_team"], {})
        boxes.append({
            "gameId": g["game_id"], "date": short_date(d),
            "site": stadium(g) + ("" if g["location"] == "Neutral" else ", " + CITY.get(g["home_team"], hostg.get("name", "").replace(" " + hostg.get("nick", ""), ""))),
            "week": f"Week {g['week']}" if g["game_type"] == "REG" else "Playoffs",
            "teams": [T.get(canon(t), {}).get("nick", t) if canon(t) == opp else "Bills" for t in order],
            "line": line,
            "allen": allen_line(me_r) if me_r else "",
            "bills": lines_for(grows, BILLS, skip=ALLEN),
            "opp": lines_for(grows, g["away_team"] if g["home_team"] == BILLS else g["home_team"]),
            "source": "nflverse"})

    # Series: all-time baseline from overrides (if known) plus every game since, else since 1999
    meet = [g for g in bills_all if canon(g["home_team"] if g["away_team"] == BILLS else g["away_team"]) == opp
            and g["home_score"] != "" and g["game_type"] == "REG"]
    base = overrides.get("series", {}).get(opp)
    nick = T[opp]["nick"]
    if base:
        later = [g for g in meet if int(g["season"]) > base["thru"]]
        w = base["w"] + sum(result_for(g, BILLS)[0] == "W" for g in later)
        l = base["l"] + sum(result_for(g, BILLS)[0] == "L" for g in later)
        t = base.get("t", 0) + sum(result_for(g, BILLS)[0] == "T" for g in later)
        lead = "Bills lead" if w > l else f"{nick} lead" if l > w else "The series is tied"
        hi, lo = max(w, l), min(w, l)
        summary = f"{lead} the regular-season series {hi}-{lo}" + (f"-{t}" if t else "") + "."
    else:
        w = sum(result_for(g, BILLS)[0] == "W" for g in meet); l = sum(result_for(g, BILLS)[0] == "L" for g in meet)
        summary = f"Bills are {w}-{l} against the {nick} in the regular season since 1999."
    last = max([g for g in bills_all if canon(g["home_team"] if g["away_team"] == BILLS else g["away_team"]) == opp
                and g["home_score"] != ""], key=lambda g: g["gameday"], default=None)
    last_txt = ""
    if last:
        bs = int(last["home_score"] if last["home_team"] == BILLS else last["away_score"])
        os_ = int(last["away_score"] if last["home_team"] == BILLS else last["home_score"])
        a, b = (("Bills", bs), (nick, os_)) if bs >= os_ else ((nick, os_), ("Bills", bs))
        last_txt = f"Last meeting: {short_date(date.fromisoformat(last['gameday']))}, {a[0]} {a[1]}, {b[0]} {b[1]}."

    # Injury report for this game's week
    wk = int(nxt["week"])
    STATUS = {"Did Not Participate In Practice": "DNP", "Limited Participation in Practice": "Limited",
              "Full Participation in Practice": "Full"}
    def injuries(team):
        rows = [r for r in inj if r["team"] == team and int(float(r["week"])) == wk and r["season_type"] == nxt["game_type"].replace("WC", "POST").replace("DIV", "POST").replace("CON", "POST").replace("SB", "POST")]
        out = []
        for r in rows:
            game = r.get("report_status", "")
            prac = STATUS.get(r.get("practice_status", ""), r.get("practice_status", ""))
            hurt = r.get("report_primary_injury") or r.get("practice_primary_injury") or ""
            if not game and prac == "Full":
                continue
            out.append({"name": r["full_name"], "pos": r["position"], "injury": hurt, "status": game or prac,
                        "game": bool(game)})
        order = {"Out": 0, "Doubtful": 1, "Questionable": 2, "DNP": 3, "Limited": 4}
        return sorted(out, key=lambda x: (order.get(x["status"], 5), x["name"]))
    bi, oi = injuries(BILLS), injuries(opp)
    any_game = any(x["game"] for x in bi + oi)

    oppseason = []
    for g in [g for g in reg26 if opp in (g["home_team"], g["away_team"]) and g["home_score"] != ""]:
        o = g["away_team"] if g["home_team"] == opp else g["home_team"]
        oppseason.append({"week": int(g["week"]), "opp": T.get(o, {}).get("nick", o), "home": g["home_team"] == opp,
                          "result": result_for(g, opp)})

    return {
        "updated": date.today().isoformat(), "gameId": nxt["game_id"], "week": int(nxt["week"]), "label": label,
        "bills": {"name": T[BILLS]["name"], "record": record(reg26_for(reg26, BILLS), BILLS)},
        "opp": {"name": T[opp]["name"], "abbr": opp, "nick": nick, "record": record(reg26_for(reg26, opp), opp)},
        "home": home, "date": short_date(when, weekday=True), "time": kickoff(nxt["gametime"]),
        "venue": stadium(nxt) + (f", {city}" if city else ""), "tv": ov.get("tv", ""),
        "series": {"summary": summary, "last": last_txt},
        "injuries": {"week": wk, "bills": bi, "opp": oi,
                     "note": ("Game status (Out, Doubtful, Questionable) is from the final injury report. " if any_game else
                              "Practice participation this week; game status (Out, Doubtful, Questionable) is added when the final report comes out, usually Friday. ")
                             + "Full participants without a game status are not listed."},
        "allenVs": allen_vs, "boxscores": boxes, "history": history,
        "sources": "Schedule, results, team stats, player stats and injury reports: nflverse (free, open NFL data). Updated automatically.",
        "teamStats": {"asOf": short_date(date.today()), "note": f"{SEASON} regular season. Averages are per game, rounded to whole numbers; sacks and interceptions are season totals. Rank is out of 32 NFL teams (1 = best) and is based on the per-game rate, since some teams have played more games than others.",
                      "cats": compare(S, BILLS, opp)},
        "colors": {"bills": T[BILLS]["color"], "opp": T[opp]["color"]},
        "oppSeason": oppseason,
    }


KEEP = {"player_id", "player_display_name", "team", "game_id", "completions", "attempts", "passing_yards", "passing_tds",
        "passing_interceptions", "sacks_suffered", "carries", "rushing_yards", "rushing_tds", "receptions",
        "receiving_yards", "receiving_tds"}


def reg26_for(reg26, team):
    return [g for g in reg26 if team in (g["home_team"], g["away_team"])]


# ---------- 3. NFL all-time ranks ----------
def build_ranks(week26, sched):
    """Retired players' totals stay fixed; active players add their 2026 numbers as they happen."""
    cfg = json.load(open(os.path.join(HERE, "nfl_ranks_base.json")))
    add = defaultdict(Counter)
    for r in week26:
        if r["season_type"] == "REG":
            for k in ("passing_yards", "passing_tds", "rushing_tds", "receiving_tds"):
                add[r["player_id"]][k] += num(r, k)
    pick = {"Career passing yards": lambda c: c["passing_yards"], "Career passing touchdowns": lambda c: c["passing_tds"],
            "Career rushing touchdowns": lambda c: c["rushing_tds"],
            "Career total touchdowns": lambda c: c["passing_tds"] + c["rushing_tds"] + c["receiving_tds"]}
    lists = {}
    for title, spec in cfg["lists"].items():
        vals = list(spec["fixed"])
        for a in spec["active"]:
            vals.append(int(a["base"] + pick[title](add[a["id"]])))
        lists[title] = sorted(vals, reverse=True)

    # QB wins as the starter: retired QBs fixed, anyone who started since 2025 counted live from results.
    wb = json.load(open(os.path.join(HERE, "wins_base.json")))
    active = {g[s + "_qb_id"] for g in sched if int(g["season"]) >= 2025 for s in ("home", "away") if g[s + "_qb_id"]}
    reg, post = Counter(), Counter()
    for g in sched:
        if g["home_score"] == "":
            continue
        hs, as_ = int(g["home_score"]), int(g["away_score"])
        for side, me, op in (("home", hs, as_), ("away", as_, hs)):
            q = g[side + "_qb_id"]
            if q in active and me > op:
                (reg if g["game_type"] == "REG" else post)[q] += 1
    lists["Career wins"] = sorted(wb["regular"] + [v for q, v in reg.items() if q != ALLEN], reverse=True)
    lists["Playoff wins"] = sorted(wb["post"] + [v for q, v in post.items() if q != ALLEN], reverse=True)
    lists["Games with a passing & rushing TD"] = list(wb["bothGamesFixed"])
    W = json.load(open(os.path.join(HERE, "watch_base.json")))["qbRushYds"]
    lists["QB rushing yards"] = sorted([q["v"] for q in W["fixed"]] + [int(a["base"] + sum(num(r, "rushing_yards") for r in week26
                                        if r["player_id"] == a["id"] and r["season_type"] == "REG")) for a in W["active"]], reverse=True)
    both = 50 + sum(1 for r in week26 if r["player_id"] == ALLEN and r["season_type"] == "REG"
                    and num(r, "passing_tds") >= 1 and num(r, "rushing_tds") >= 1)
    allen = {"wins": reg[ALLEN], "postWins": post[ALLEN], "both": both,
             "afcEast": wb["afcEast"]}
    return {"updated": date.today().isoformat(), "asOf": short_date(date.today()), "lists": lists, "allen": allen}


# ---------- 4. Records watch (Next game page) ----------
def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def build_watch(allen, ranks, week26, m):
    """Records Allen can realistically reach in the next game: only marks within his best single game."""
    W = json.load(open(os.path.join(HERE, "watch_base.json")))
    A, now, post = W["allen"], allen["now"], allen.get("post", {})
    hi = dict(A["highs"])
    for g in allen["games"]:  # a new career high widens the range
        hi["passYds"] = max(hi["passYds"], g["yds"]); hi["passTD"] = max(hi["passTD"], g["td"])
        hi["rushYds"] = max(hi["rushYds"], g["rushYds"]); hi["rushTD"] = max(hi["rushTD"], g["rushTD"])
        hi["totalTD"] = max(hi["totalTD"], g["td"] + g["rushTD"] + g.get("recTD", 0))
    cur = {"passYds": A["passYds"] + now["yds"], "passTD": A["passTD"] + now["td"], "rushTD": A["rushTD"] + now["rushTD"],
           "rushYds": A["rushYds"] + now["rushYds"]}
    cur["totalTD"] = cur["passTD"] + cur["rushTD"] + A["recTD"] + now.get("recTD", 0)
    nick = m["opp"]["nick"]
    items = []  # (difficulty 0-1, title, detail)
    unit = {"passYds": ("passing yard", "passing yards"), "passTD": ("passing TD", "passing TDs"),
            "rushYds": ("rushing yard", "rushing yards"), "rushTD": ("rushing TD", "rushing TDs"), "totalTD": ("total TD", "total TDs")}
    def needs(k, n):
        return f"Needs {n:,} {unit[k][0] if n == 1 else unit[k][1]} (career high in a game: {hi[k]:,})."

    # Bills record: passing TDs, regular season + playoffs
    combo = cur["passTD"] + post.get("td", 0)
    kelly = W["bills"]["comboPassTD"]
    if combo <= kelly["v"]:
        n = kelly["v"] + 1 - combo
        if n <= hi["passTD"]:
            items.append((n / hi["passTD"], "Bills record: passing TDs, regular season + playoffs",
                          f"{needs('passTD', n)} He has {combo}; {kelly['name']} has {kelly['v']}."))

    # QB rushing yards: next 1,000-yard milestone and the next QB ahead
    qbs = list(W["qbRushYds"]["fixed"])
    for a in W["qbRushYds"]["active"]:
        qbs.append({"name": a["name"], "v": int(a["base"] + sum(num(r, "rushing_yards") for r in week26
                                                         if r["player_id"] == a["id"] and r["season_type"] == "REG"))})
    mile = (cur["rushYds"] // 1000 + 1) * 1000
    n = mile - cur["rushYds"]
    if n <= hi["rushYds"]:
        club = sorted([q for q in qbs if q["v"] >= mile], key=lambda q: -q["v"])
        names = ", ".join(q["name"] for q in club[:-1]) + (" and " if len(club) > 1 else "") + (club[-1]["name"] if club else "")
        items.append((n / hi["rushYds"], f"{mile:,} career rushing yards",
                      f"{needs('rushYds', n)} He'd be the {ordinal(len(club) + 1)} QB ever to reach it" + (f", joining {names}." if club else ".")))
    ahead = sorted([q for q in qbs if q["v"] > cur["rushYds"]], key=lambda q: q["v"])
    if ahead and ahead[0]["v"] + 1 - cur["rushYds"] <= hi["rushYds"]:
        q = ahead[0]; n = q["v"] + 1 - cur["rushYds"]
        items.append((n / hi["rushYds"], "NFL career rushing yards by a QB", f"{needs('rushYds', n)} Passes {q['name']} ({q['v']:,})."))

    # His NFL record: games with a passing TD and a rushing TD
    both = A["bothGamesReg"] + sum(1 for g in allen["games"] if g["td"] >= 1 and g["rushTD"] >= 1)
    nx = W["bothGamesNext"]
    items.append((0.34, "NFL record: games with a passing TD and a rushing TD",
                  f"Needs at least one of each to extend his record to {both + 1} (regular season). Next closest: {nx['name']}, {nx['v']}."))

    # NFL all-time leader lists
    keymap = {"Career passing touchdowns": "passTD", "Career rushing touchdowns": "rushTD",
              "Career passing yards": "passYds", "Career total touchdowns": "totalTD"}
    for title, L in ranks["lists"].items():
        if title not in keymap:
            continue
        k = keymap[title]; me = cur[k]
        above = sorted({v for v in L if v > me})
        if not above:
            continue
        v = above[0]; tie = v - me
        if tie > hi[k]:
            continue
        spot = 1 + sum(1 for x in L if x > v)
        who = W["names"].get(title, {}).get(str(v))
        tied = sum(1 for x in L if x == v)
        label = f"{who} ({v:,})" if who else f"{v:,}"
        detail = f"{needs(k, tie)} Ties {label} for No. {spot}"
        if tie + 1 <= hi[k]:
            detail += f"; {tie + 1:,} passes {'them' if tied > 1 else ('him' if who else 'that mark')}"
        items.append((tie / hi[k], f"NFL career {title.split('Career ')[1]}", detail + "."))

    # Record against this opponent
    v = m.get("allenVs", {})
    if v.get("games"):
        items.append((0.5, f"Record against the {nick}", f"A win makes him {v['wins'] + 1}-{v['losses']} as a starter against them in the regular season."))

    items.sort(key=lambda x: x[0])
    return {"asOf": short_date(date.today()), "highs": hi,
            "items": [{"title": t, "detail": d} for _, t, d in items]}


def build_mountain_live(week26):
    """Current-season touchdowns for the Touchdown Mountain page (td-mountain-<season>.json).
    Everyone already on the page, plus anyone new with 3+ TDs this season (usually rookies)."""
    try:
        base = {p["id"]: p for p in json.load(open(os.path.join(REPO, "data", "td-mountain.json")))["players"]}
    except FileNotFoundError:
        return
    tot, meta, gp = defaultdict(lambda: [0, 0, 0]), {}, defaultdict(int)
    for r in week26:
        if r.get("season_type") != "REG":
            continue
        t = tot[r["player_id"]]
        t[0] += int(num(r, "passing_tds")); t[1] += int(num(r, "rushing_tds")); t[2] += int(num(r, "receiving_tds"))
        gp[r["player_id"]] += 1  # one row per game played
        meta[r["player_id"]] = (r.get("player_display_name") or r["player_id"], r.get("position", ""))
    # games: nflverse rows only exist for games with a stat; snap counts catch games without one
    try:
        by_pfr = {b["pfr"]: pid for pid, b in base.items() if b.get("pfr")}
        snaps = defaultdict(int)
        for r in get(f"snap_counts/snap_counts_{SEASON}.csv"):
            if r.get("game_type") == "REG" and r.get("pfr_player_id") in by_pfr and \
                    any(num(r, k) > 0 for k in ("offense_snaps", "defense_snaps", "st_snaps")):
                snaps[by_pfr[r["pfr_player_id"]]] += 1
        for pid, g in snaps.items():
            gp[pid] = max(gp[pid], g)
            tot[pid]  # on the field with no stats still counts as a game
    except Exception as e:
        print("snap counts skipped:", e)
    old = load(f"td-mountain-{SEASON}.json") or {}
    first = dict(old.get("first", {}))  # rookie season of newcomers, so the player list is only downloaded once each
    new = [pid for pid, t in tot.items() if pid not in base and sum(t) >= 3 and pid not in first]
    if new:
        for p in get("players/players.csv"):
            if p["gsis_id"] in new:
                first[p["gsis_id"]] = int(p.get("rookie_season") or SEASON)
    out = []
    for pid, t in sorted(tot.items()):
        if (pid not in base and not any(t)) or (pid not in base and (sum(t) < 3 or pid not in first)):
            continue
        b = base.get(pid)
        if b is None and pid not in meta:
            continue
        out.append({"id": pid, "name": b["name"] if b else meta[pid][0], "pos": b["pos"] if b else meta[pid][1],
                    "first": b["first"] if b else first[pid], "td": t, "g": gp[pid]})
    save(f"td-mountain-{SEASON}.json", {"updated": date.today().isoformat(), "season": SEASON,
                                        "first": {k: v for k, v in first.items() if k in tot}, "players": out})


def build_season_weeks(week26, sched):
    """This season, week by week, for the Touchdown Mountain "This season" view (td-week-<season>.json).
    Every player with a touchdown this season, with each week he played: [week, pass, rush, rec]."""
    fb = {"FB": "RB", "HB": "RB"}
    rows = [r for r in week26 if r.get("season_type") == "REG"]
    if not rows:
        return
    weeks = defaultdict(dict)
    meta = {}
    for r in rows:
        pid, wk = r["player_id"], int(r["week"])
        t = [int(num(r, "passing_tds")), int(num(r, "rushing_tds")), int(num(r, "receiving_tds"))]
        old = weeks[pid].get(wk, [0, 0, 0])
        weeks[pid][wk] = [a + b for a, b in zip(old, t)]
        meta[pid] = (r.get("player_display_name") or pid, fb.get(r.get("position", ""), r.get("position", "")))
    last = max(int(r["week"]) for r in rows)
    games = [g for g in sched if int(g["season"]) == SEASON and g["game_type"] == "REG" and int(g["week"]) == last]
    in_progress = any(g["home_score"] in ("", "NA") for g in games)
    out = []
    for pid, w in sorted(weeks.items()):
        if pid != ALLEN and not any(sum(t) for t in w.values()):
            continue
        out.append({"id": pid, "name": meta[pid][0], "pos": meta[pid][1],
                    "w": [[k] + w[k] for k in sorted(w)]})
    bye = [wk for wk in range(1, last + 1) if wk not in weeks.get(ALLEN, {})]
    save(f"td-week-{SEASON}.json", {"updated": date.today().isoformat(), "season": SEASON, "weeks": last,
                                    "inProgress": in_progress, "billsBye": bye, "players": out}, rows="players")


def main():
    T = team_table()
    sched = [g for g in get("schedules/games.csv") if int(g["season"]) >= 1999]
    week26 = get(f"stats_player/stats_player_week_{SEASON}.csv")
    try:
        overrides = json.load(open(os.path.join(REPO, "data", "overrides.json")))
    except FileNotFoundError:
        overrides = {}
    allen = build_allen(week26, sched)
    ranks = build_ranks(week26, sched)
    save("allen-2026.json", allen)
    save("nfl-ranks.json", ranks)
    try:
        build_mountain_live(week26)
    except Exception as e:  # never let the mountain page block the rest of the update
        print("touchdown mountain skipped:", e)
    try:
        build_season_weeks(week26, sched)
    except Exception as e:
        print("touchdown mountain (this season) skipped:", e)
    team_rows = get(f"stats_team/stats_team_week_{SEASON}.csv")
    try:
        inj = get(f"injuries/injuries_{SEASON}.csv")
    except RuntimeError as e:
        print(e); inj = []
    m = build_matchup(sched, team_rows, week26, inj, T, overrides)
    if m:
        try:
            m["watch"] = build_watch(allen, ranks, week26, m)
        except Exception as e:  # never let the watch list block the rest of the page
            print("records watch skipped:", e)
        save("matchup.json", m)


if __name__ == "__main__":
    main()
