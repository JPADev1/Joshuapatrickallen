"""Extras for the Next game page (matchup.json), all from free sources:

  standings     every division's table, from the nflverse schedule
  lines         current + opening spread, total and moneylines (ESPN's free scoreboard feed,
                nflverse's schedule as a fallback), plus a history of every move this job has seen
  primetime     Thursday / Sunday / Monday night or holiday game flag, with the TV network
  injury time   when the injury report last changed (the job checks every hour)
  playoffs      Monte Carlo of the rest of the season: Bills' chances now, with a win and with a loss
  significance  one or two sentences on what a Bills win (or loss) would mean, built from the numbers

Standard library only. Every piece is optional: if one fails, the page just leaves that panel out.
"""
import hashlib, json, math, random, urllib.request
from collections import defaultdict
from datetime import datetime, timezone, timedelta

BILLS = "BUF"
UA = {"User-Agent": "joshuapatrickallen.com stats job"}
ET = timezone(timedelta(hours=-5))  # display only; NFL kickoffs in the schedule are already Eastern


def fetch_json(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def et_now():
    # Eastern time, with US daylight saving (second Sunday of March to first Sunday of November)
    u = datetime.now(timezone.utc)
    y = u.year
    mar = datetime(y, 3, 8, 7, tzinfo=timezone.utc); mar += timedelta(days=(6 - mar.weekday()) % 7)
    nov = datetime(y, 11, 1, 6, tzinfo=timezone.utc); nov += timedelta(days=(6 - nov.weekday()) % 7)
    return u.astimezone(timezone(timedelta(hours=-4 if mar <= u < nov else -5)))


def stamp(dt):
    m = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."][dt.month - 1]
    h = (dt.hour - 1) % 12 + 1
    return f"{dt.strftime('%a.')} {m} {dt.day}, {h}:{dt.minute:02d} {'a.m.' if dt.hour < 12 else 'p.m.'} ET"


# ---------- teams, divisions ----------
def team_info(teams_rows, season_games):
    """abbr -> {conf, div, name, nick, c1, c2} for the teams playing this season."""
    playing = {g["home_team"] for g in season_games} | {g["away_team"] for g in season_games}
    info = {}
    for r in teams_rows:
        if r["team_abbr"] in playing:
            cols = [c for c in (r["team_color"], r["team_color2"], r["team_color3"], r["team_color4"]) if c and c.startswith("#")]
            info[r["team_abbr"]] = {"conf": r["team_conf"], "div": r["team_division"], "name": r["team_name"],
                                    "nick": r["team_nick"], "c1": cols[0] if cols else "#333333",
                                    "c2": cols[1] if len(cols) > 1 else "#999999"}
    return info


# ---------- standings and tiebreakers ----------
class Table:
    """Win-loss bookkeeping for one season (real or simulated)."""
    def __init__(self, teams, info):
        self.info = info
        self.w = dict.fromkeys(teams, 0.0); self.g = dict.fromkeys(teams, 0)
        self.dw = dict.fromkeys(teams, 0.0); self.dg = dict.fromkeys(teams, 0)
        self.cw = dict.fromkeys(teams, 0.0); self.cg = dict.fromkeys(teams, 0)
        self.h2h = defaultdict(float); self.h2hg = defaultdict(int)
        self.beat = defaultdict(list)  # teams each team has beaten (for strength of victory)
        self.pf = dict.fromkeys(teams, 0); self.pa = dict.fromkeys(teams, 0)

    def add(self, a, b, wa, pa=None, pb=None):
        """a vs b; wa = 1 if a won, 0 if b won, 0.5 tie."""
        for t, o, wt in ((a, b, wa), (b, a, 1 - wa)):
            self.w[t] += wt; self.g[t] += 1
            self.h2h[(t, o)] += wt; self.h2hg[(t, o)] += 1
            if self.info[t]["div"] == self.info[o]["div"]:
                self.dw[t] += wt; self.dg[t] += 1
            if self.info[t]["conf"] == self.info[o]["conf"]:
                self.cw[t] += wt; self.cg[t] += 1
            if wt == 1:
                self.beat[t].append(o)
        if pa is not None:
            self.pf[a] += pa; self.pa[a] += pb; self.pf[b] += pb; self.pa[b] += pa

    def pct(self, t): return self.w[t] / self.g[t] if self.g[t] else 0.0
    def dpct(self, t): return self.dw[t] / self.dg[t] if self.dg[t] else 0.0
    def cpct(self, t): return self.cw[t] / self.cg[t] if self.cg[t] else 0.0
    def sov(self, t):
        b = self.beat[t]
        return sum(self.pct(o) for o in b) / len(b) if b else 0.0
    def h2hpct(self, t, group):
        w = sum(self.h2h[(t, o)] for o in group if o != t); g = sum(self.h2hg[(t, o)] for o in group if o != t)
        return w / g if g else 0.5

    def rank(self, group, division, rng=None):
        """Order teams best first: win pct, then a simplified NFL tiebreak (head-to-head, division record
        for division ties, conference record, strength of victory, then a coin flip)."""
        out, rest = [], sorted(group, key=lambda t: -self.pct(t))
        while rest:
            top = self.pct(rest[0]); tied = [t for t in rest if abs(self.pct(t) - top) < 1e-9]
            while tied:
                best = self._break(tied, division, rng)
                out.append(best); tied.remove(best); rest.remove(best)
                if tied and len(tied) == 1:
                    out.append(tied[0]); rest.remove(tied[0]); tied = []
        return out

    def _break(self, tied, division, rng):
        if len(tied) == 1:
            return tied[0]
        keys = [lambda t: self.h2hpct(t, tied)]
        if division:
            keys.append(self.dpct)
        keys += [self.cpct, self.sov]
        cand = tied[:]
        for k in keys:
            best = max(k(t) for t in cand)
            cand = [t for t in cand if abs(k(t) - best) < 1e-9]
            if len(cand) == 1:
                return cand[0]
        return (rng or random).choice(sorted(cand))

    def seeds(self, conf, rng=None):
        """Seven playoff seeds for a conference: four division winners, then three wild cards."""
        teams = [t for t in self.info if self.info[t]["conf"] == conf]
        divs = sorted({self.info[t]["div"] for t in teams})
        winners, others = [], []
        for d in divs:
            order = self.rank([t for t in teams if self.info[t]["div"] == d], True, rng)
            winners.append(order[0]); others += order[1:]
        return self.rank(winners, False, rng) + self.rank(others, False, rng)[:3], winners


def season_games(sched, season):
    return [g for g in sched if g["season"] == str(season) and g["game_type"] == "REG"]


def real_table(reg, info):
    T = Table(list(info), info)
    for g in reg:
        if g["home_score"] == "":
            continue
        hs, as_ = int(g["home_score"]), int(g["away_score"])
        T.add(g["home_team"], g["away_team"], 1 if hs > as_ else 0 if hs < as_ else 0.5, hs, as_)
    return T


def wl(T, t):
    """(wins, losses, ties); a tie counts as half a win in T.w."""
    ties = int(round((T.w[t] - int(T.w[t])) * 2))
    return int(T.w[t]), T.g[t] - int(T.w[t]) - ties, ties


def rec(T, t):
    w, l, ties = wl(T, t)
    return f"{w}-{l}" + (f"-{ties}" if ties else "")


def gb(T, a, b):
    """Games team b is behind team a."""
    wa, la, _ = wl(T, a); wb, lb, _ = wl(T, b)
    return ((wa - wb) + (lb - la)) / 2


def streak(reg, t):
    res = []
    for g in sorted([g for g in reg if t in (g["home_team"], g["away_team"]) and g["home_score"] != ""], key=lambda g: g["gameday"]):
        me = int(g["home_score"] if g["home_team"] == t else g["away_score"]); op = int(g["away_score"] if g["home_team"] == t else g["home_score"])
        res.append("W" if me > op else "L" if me < op else "T")
    if not res:
        return ""
    n = 0
    for r in reversed(res):
        if r != res[-1]:
            break
        n += 1
    return f"{res[-1]}{n}"


def division_table(T, reg, info, div):
    order = T.rank([t for t in info if info[t]["div"] == div], True)
    lead = order[0]
    rows = []
    for i, t in enumerate(order):
        w, l, ti = wl(T, t); dw, dl = int(T.dw[t]), T.dg[t] - int(T.dw[t])
        g = gb(T, lead, t)
        rows.append({"abbr": t, "nick": info[t]["nick"], "rec": rec(T, t), "gb": "—" if i == 0 else (f"{g:g}" if g else "0"),
                     "div": f"{dw}-{dl}", "strk": streak(reg, t), "pf": T.pf[t], "pa": T.pa[t]})
    return {"name": div, "rows": rows}


def place_text(T, info, t):
    """'1st in the AFC East, 2 games ahead' style line."""
    div = info[t]["div"]; order = T.rank([x for x in info if info[x]["div"] == div], True)
    i = order.index(t); ordn = ["1st", "2nd", "3rd", "4th"][i]
    if i == 0:
        g = gb(T, t, order[1])
        tail = f", {g:g} game{'s' if g != 1 else ''} ahead" if g > 0 else ", tied at the top (wins the tiebreaker)" if g == 0 else ""
    else:
        g = gb(T, order[0], t)
        tail = f", {g:g} game{'s' if g != 1 else ''} back" if g > 0 else ", tied for 1st (loses the tiebreaker)"
    return f"{ordn} in the {div}{tail}"


# ---------- lines ----------
def espn_odds(game, kick_date):
    """Spread / total / moneylines from ESPN's free scoreboard (DraftKings via ESPN). None if unavailable."""
    eid = game.get("espn", "")
    if not eid:
        return None
    sb = fetch_json("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=" + kick_date.replace("-", ""))
    ev = next((e for e in sb.get("events", []) if e.get("id") == eid), None)
    if not ev:
        return None
    comp = ev["competitions"][0]
    tv = ", ".join(n for b in comp.get("broadcasts", []) for n in b.get("names", []))
    odds = (comp.get("odds") or [None])[0]
    if not odds:
        return {"tv": tv}
    bills_home = game["home_team"] == BILLS
    side = "home" if bills_home else "away"; other = "away" if bills_home else "home"
    def f(x):
        try:
            return float(str(x).replace("+", "")) if x not in (None, "", "EVEN") else (100.0 if x == "EVEN" else None)
        except ValueError:
            return None
    ps, ml, tot = odds.get("pointSpread", {}), odds.get("moneyline", {}), odds.get("total", {})
    def g(d, *ks):
        for k in ks:
            d = (d or {}).get(k)
        return d
    out = {"book": (odds.get("provider") or {}).get("name", ""), "tv": tv,
           "cur": {"spread": f(g(ps, side, "close", "line")), "total": f(g(tot, "over", "close", "line")) or f(odds.get("overUnder")),
                   "ml": f(g(ml, side, "close", "odds")), "oppMl": f(g(ml, other, "close", "odds"))},
           "open": {"spread": f(g(ps, side, "open", "line")), "total": f(g(tot, "over", "open", "line")),
                    "ml": f(g(ml, side, "open", "odds")), "oppMl": f(g(ml, other, "open", "odds"))}}
    if out["cur"]["spread"] is None and odds.get("spread") is not None:  # older shape: spread from the home side
        s = float(odds["spread"]); out["cur"]["spread"] = s if bills_home else -s
    for k in ("total", "spread"):  # total line from the over side may be written "o44.5"
        for when in ("cur", "open"):
            v = g(tot if k == "total" else ps, "over" if k == "total" else side, "close" if when == "cur" else "open", "line")
            if isinstance(v, str) and v[:1] in "ou":
                out[when][k] = f(v[1:])
    return out


def nflverse_odds(game):
    """Fallback: the lines nflverse keeps on the schedule (from the home team's point of view)."""
    try:
        sp = float(game["spread_line"])
    except (ValueError, KeyError):
        return None
    bills_home = game["home_team"] == BILLS
    num = lambda k: float(game[k]) if game.get(k) not in ("", None) else None
    return {"book": "consensus (nflverse)", "tv": "",
            "cur": {"spread": -sp if bills_home else sp, "total": num("total_line"),
                    "ml": num("home_moneyline" if bills_home else "away_moneyline"),
                    "oppMl": num("away_moneyline" if bills_home else "home_moneyline")}, "open": {}}


def build_lines(game, old_lines):
    """Current and opening line, plus every change this job has seen since the line opened."""
    src = None
    try:
        src = espn_odds(game, game["gameday"])
    except Exception as e:
        print("ESPN odds unavailable:", e)
    tv = (src or {}).get("tv", "")
    if not src or (src.get("cur") or {}).get("spread") is None:
        fb = nflverse_odds(game)
        if fb:
            src = dict(fb, tv=tv)
    if not src or src.get("cur", {}).get("spread") is None:
        return None, tv
    hist = list((old_lines or {}).get("history", [])) if (old_lines or {}).get("gameId") == game["game_id"] else []
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    cur = src["cur"]; op = src.get("open") or {}
    if not hist and op.get("spread") is not None:  # first look at this game: start the history at the opening line
        hist.append({"t": None, "spread": op["spread"], "total": op.get("total"), "ml": op.get("ml"), "open": True})
    last = hist[-1] if hist else {}
    if not hist or any(last.get(k) != cur.get(k) for k in ("spread", "total", "ml")):
        hist.append({"t": now, "spread": cur["spread"], "total": cur.get("total"), "ml": cur.get("ml")})
    return {"gameId": game["game_id"], "book": src.get("book", ""), "cur": cur,
            "open": op if op.get("spread") is not None else {k: hist[0].get(k) for k in ("spread", "total", "ml")},
            "history": hist[-200:]}, tv


# ---------- primetime ----------
def primetime(game, tv):
    day, t = game["weekday"], game["gametime"]
    h = int(t.split(":")[0]) if t else 0
    md = game["gameday"][5:]
    if md == "12-25":
        return {"kind": "Christmas", "title": "Christmas Day", "sub": tv}
    if day == "Thursday" and md[:2] == "11" and 22 <= int(md[3:]) <= 28 and h < 19:
        return {"kind": "Thanksgiving", "title": "Thanksgiving Day", "sub": tv}
    if h >= 19 or day in ("Monday", "Thursday", "Saturday", "Friday"):
        name = {"Monday": "Monday Night Football", "Thursday": "Thursday Night Football", "Sunday": "Sunday Night Football",
                "Saturday": "Saturday Night Football" if h >= 19 else "Saturday Showcase", "Friday": "Friday Night Football"}.get(day)
        if name and (h >= 19 or day == "Saturday"):
            return {"kind": "Primetime", "title": name, "sub": tv}
    return None


# ---------- injury report freshness ----------
def injury_stamp(inj, old):
    """When the report (both teams) last changed. The job checks hourly, so this is accurate to the hour."""
    key = hashlib.md5(json.dumps([inj.get("bills"), inj.get("opp")], sort_keys=True).encode()).hexdigest()[:12]
    prev = (old or {}).get("injuries", {}) if old else {}
    if prev.get("hash") == key and prev.get("changed"):
        return key, prev["changed"], prev.get("changedIso")
    now = et_now()
    return key, stamp(now), now.isoformat(timespec="minutes")


# ---------- playoff simulation ----------
def ratings(reg, info, prior_games=4):
    """Points-per-game rating for every team: margin of victory adjusted for opponents (a simple SRS),
    pulled toward average as if each team had also played `prior_games` average games."""
    played = [g for g in reg if g["home_score"] != ""]
    r = dict.fromkeys(info, 0.0)
    for _ in range(60):
        tot = dict.fromkeys(info, 0.0); n = dict.fromkeys(info, 0)
        for g in played:
            h, a = g["home_team"], g["away_team"]; m = int(g["home_score"]) - int(g["away_score"])
            m = max(-24, min(24, m)); hfa = 0 if g["location"] == "Neutral" else 1.5
            tot[h] += m - hfa + r[a]; n[h] += 1; tot[a] += -m + hfa + r[h]; n[a] += 1
        r = {t: tot[t] / (n[t] + prior_games) for t in info}
        mean = sum(r.values()) / len(r); r = {t: v - mean for t, v in r.items()}
    return r


def win_prob(game, R):
    """Home team's chance to win. Uses the betting line when nflverse has one, else the ratings."""
    try:
        sp = float(game["spread_line"])  # expected home margin
    except (ValueError, KeyError):
        sp = R[game["home_team"]] - R[game["away_team"]] + (0 if game["location"] == "Neutral" else 1.5)
    return 0.5 * (1 + math.erf(sp / (13.5 * math.sqrt(2))))


def ml_prob(ml, opp_ml):
    def p(x): return 100 / (x + 100) if x > 0 else -x / (-x + 100)
    if ml is None or opp_ml is None:
        return None
    a, b = p(ml), p(opp_ml)
    return a / (a + b)


def simulate(reg, info, the_game, bills_win_p, n=10000, seed=17):
    """Plays out every remaining game n times. Returns the Bills' chances overall, with a win and with a loss
    in the_game, for: playoffs, AFC East, No. 1 seed (the only first-round bye), AFC title, Super Bowl."""
    rng = random.Random(seed)
    R = ratings(reg, info)
    base = real_table(reg, info)
    left = [g for g in reg if g["home_score"] == "" and g["game_id"] != the_game["game_id"]]
    probs = [win_prob(g, R) for g in left]
    conf = info[BILLS]["conf"]; bdiv = info[BILLS]["div"]
    keys = ("playoffs", "division", "seed1", "conf", "sb")
    cnt = {"win": dict.fromkeys(keys, 0), "loss": dict.fromkeys(keys, 0)}; nres = {"win": 0, "loss": 0}
    def ko(h, a):  # playoff game, h at home (neutral for the Super Bowl handled by caller)
        return h if rng.random() < 0.5 * (1 + math.erf((R[h] - R[a] + 1.5) / (13.5 * math.sqrt(2)))) else a
    for i in range(n):
        T = copy_table(base)
        bills_won = rng.random() < bills_win_p
        h, a = the_game["home_team"], the_game["away_team"]
        T.add(h, a, 1 if (bills_won == (h == BILLS)) else 0)
        for g, p in zip(left, probs):
            T.add(g["home_team"], g["away_team"], 1 if rng.random() < p else 0)
        res = "win" if bills_won else "loss"; nres[res] += 1; c = cnt[res]
        champs = {}
        for cf in ("AFC", "NFC"):
            seeds, winners = T.seeds(cf, rng)
            if cf == conf:
                if BILLS in seeds:
                    c["playoffs"] += 1
                if BILLS in winners:
                    c["division"] += 1
                if seeds[0] == BILLS:
                    c["seed1"] += 1
            # bracket: 1 has a bye; 2v7, 3v6, 4v5; reseed each round
            alive = [seeds[0]] + [ko(seeds[i], seeds[7 - i]) for i in (1, 2, 3)]
            alive.sort(key=seeds.index)
            alive = [ko(alive[0], alive[3]), ko(alive[1], alive[2])]
            alive.sort(key=seeds.index)
            champs[cf] = ko(alive[0], alive[1])
        if champs[conf] == BILLS:
            c["conf"] += 1
            o = champs["NFC" if conf == "AFC" else "AFC"]
            if rng.random() < 0.5 * (1 + math.erf((R[BILLS] - R[o]) / (13.5 * math.sqrt(2)))):
                c["sb"] += 1
    pct = lambda x, d: round(100 * x / d, 1) if d else None
    out = {k: {"now": pct(cnt["win"][k] + cnt["loss"][k], n), "win": pct(cnt["win"][k], nres["win"]),
               "loss": pct(cnt["loss"][k], nres["loss"])} for k in keys}
    return out, R


# ---------- significance ----------
def significance(reg, info, game, odds):
    """What a Bills win (and a loss) would mean, from the standings as they are now."""
    T = real_table(reg, info)
    opp = game["away_team"] if game["home_team"] == BILLS else game["home_team"]
    conf, div = info[BILLS]["conf"], info[BILLS]["div"]
    others_played = all(g["home_score"] != "" for g in reg if g["week"] == game["week"] and g["game_id"] != game["game_id"])

    def after(win):
        X = copy_table(T)
        X.add(game["home_team"], game["away_team"], 1 if (win == (game["home_team"] == BILLS)) else 0)
        return X

    def facts(X, win):
        f = []
        w, l, _ = wl(X, BILLS); r = rec(X, BILLS)
        best = max(X.pct(t) for t in info if t != BILLS)
        bp = X.pct(BILLS)
        seeds, winners = X.seeds(conf)
        seed = seeds.index(BILLS) + 1 if BILLS in seeds else None
        dorder = X.rank([t for t in info if info[t]["div"] == div], True)
        second = dorder[1] if dorder[0] == BILLS else dorder[0]
        lead = gb(X, BILLS, second) if dorder[0] == BILLS else -gb(X, dorder[0], BILLS)
        return {"rec": r, "bestNFL": bp > best + 1e-9, "tiedBestNFL": abs(bp - best) < 1e-9, "seed": seed,
                "divFirst": dorder[0] == BILLS, "divLead": lead, "divRival": info[second]["nick"] if dorder[0] == BILLS else info[dorder[0]]["nick"]}
    now = facts(T, None); W = facts(after(True), True); L = facts(after(False), False)
    on = info[opp]["nick"]; ow, ol, _ = wl(T, opp)

    def seed_txt(s): return f"the AFC's No. {s} seed" if s else "outside the AFC playoff field"
    def win_line():
        bits = [f"A win would make the Bills {W['rec']}"]
        if W["bestNFL"]:
            bits.append("alone with the best record in the NFL")
        elif W["tiedBestNFL"]:
            bits.append("tied for the best record in the NFL")
        if W["seed"] == 1 and now["seed"] != 1:
            bits.append("and move them into the AFC's No. 1 seed")
        elif W["seed"] == 1:
            bits.append("and keep them the AFC's No. 1 seed")
        elif W["seed"] and now["seed"] and W["seed"] < now["seed"]:
            bits.append(f"and move them up to {seed_txt(W['seed'])}")
        s = bits[0] + (", " + ", ".join(bits[1:]) if len(bits) > 1 else "") + "."
        if W["divFirst"]:
            g = W["divLead"]
            if not now["divFirst"]:
                s += f" It would put them in 1st place in the {div}" + (f", {g:g} game{'s' if g != 1 else ''} ahead of the {W['divRival']}." if g > 0 else ", holding the tiebreaker.")
            elif g > now["divLead"]:
                s += f" Their {div} lead would grow to {g:g} game{'s' if g != 1 else ''} over the {W['divRival']}."
        if ol <= 1 and ow >= 4:
            s += f" It would also hand the {ow}-{ol} {on} " + ("their first loss." if ol == 0 else "just their second loss.")
        return s

    def loss_line():
        s = f"A loss would drop them to {L['rec']}"
        if now["seed"] == 1 and L["seed"] != 1:
            s += f" and out of the No. 1 seed (to No. {L['seed']})" if L["seed"] else " and out of the playoff field for now"
        elif L["seed"] and now["seed"] and L["seed"] > now["seed"]:
            s += f" and down to {seed_txt(L['seed'])}"
        s += "."
        if now["divFirst"] and not L["divFirst"]:
            s += f" They would fall out of 1st place in the {div}."
        elif L["divFirst"]:
            g = L["divLead"]
            s += f" They would still lead the {div}" + (f" by {g:g} game{'s' if g != 1 else ''}." if g > 0 else " on a tiebreaker.")
        return s
    note = ("Based on every other result this week." if others_played else
            "Based on the standings right now; other games this week can still change it.")
    return {"win": win_line(), "loss": loss_line(), "note": note,
            "now": {"rec": now["rec"], "seed": now["seed"]}, "seedWin": W["seed"], "seedLoss": L["seed"]}


def copy_table(T):
    X = Table([], T.info)
    X.w, X.g, X.dw, X.dg, X.cw, X.cg = dict(T.w), dict(T.g), dict(T.dw), dict(T.dg), dict(T.cw), dict(T.cg)
    X.h2h, X.h2hg = defaultdict(float, T.h2h), defaultdict(int, T.h2hg)
    X.beat = defaultdict(list, {k: list(v) for k, v in T.beat.items()})
    X.pf, X.pa = dict(T.pf), dict(T.pa)
    return X


def last_played(reg):
    d = max(g["gameday"] for g in reg if g["home_score"] != "")
    y, mo, dd = map(int, d.split("-"))
    m = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."][mo - 1]
    return f"{m} {dd}, {y}"


# ---------- everything for matchup.json ----------
def build_extras(m, sched, teams_rows, season, old, sims=10000):
    reg = season_games(sched, season)
    game = next(g for g in sched if g["game_id"] == m["gameId"])
    info = team_info(teams_rows, reg)
    T = real_table(reg, info)
    opp = m["opp"]["abbr"]
    out = {}
    out["teamColors"] = {"bills": [info[BILLS]["c1"], info[BILLS]["c2"]], "opp": [info[opp]["c1"], info[opp]["c2"]]}
    out["standings"] = {"bills": division_table(T, reg, info, info[BILLS]["div"]), "opp": division_table(T, reg, info, info[opp]["div"]),
                        "billsPlace": place_text(T, info, BILLS), "oppPlace": place_text(T, info, opp)}
    lines, tv = None, ""
    try:
        lines, tv = build_lines(game, (old or {}).get("lines"))
    except Exception as e:
        print("lines skipped:", e)
    if lines:
        out["lines"] = lines
    if tv and not m.get("tv"):
        m["tv"] = tv
    pt = primetime(game, m.get("tv", ""))
    if pt:
        out["primetime"] = pt
    if game["game_type"] == "REG":
        try:
            p = ml_prob((lines or {}).get("cur", {}).get("ml"), (lines or {}).get("cur", {}).get("oppMl"))
            if p is None:
                p = win_prob(game, ratings(reg, info))
                p = p if game["home_team"] == BILLS else 1 - p
            odds, _ = simulate(reg, info, game, p, n=sims)
            out["playoffs"] = {"odds": odds, "winProb": round(100 * p, 1), "sims": sims,
                               "asOf": "through the games of " + last_played(reg)}
        except Exception as e:
            print("playoff odds skipped:", e)
        try:
            sig = significance(reg, info, game, out.get("playoffs"))
            po = (out.get("playoffs") or {}).get("odds")
            if po:
                a, b = po["seed1"]["win"], po["seed1"]["loss"]
                sig["odds"] = (f"In {sims:,} simulations of the rest of the season, the Bills earn the No. 1 seed "
                               f"{a:.0f}% of the time with a win and {b:.0f}% with a loss.")
            out["significance"] = sig
        except Exception as e:
            print("significance skipped:", e)
    return out
