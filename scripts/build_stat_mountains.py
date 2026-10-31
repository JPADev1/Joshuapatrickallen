"""Build the data for the stat mountains (mountain.html), season by season:
  data/mtn-yards.json  passing and rushing yards, everyone who reaches a top 30 in any view
  data/mtn-wins.json   quarterback wins as the starter, regular season and playoffs
  data/mtn-afce.json   AFC East titles, credited to the champion's main starting quarterback

Sources
  1999 to last season: nflverse season stats and schedules (starting quarterbacks)        -> complete
  before 1999:         scripts/history_mtn_pre1999.json, built once from Wikipedia player
                       pages and the career QB wins list, checked against career totals   -> leaders and notable players
  AFC East titles:     scripts/afc_east_titles.json (add each new champion after the season)
The current season is added by update_data.py every hour (mtn-live-<season>.json, mtn-week-<season>.json).

Run once a year after the Super Bowl (after bumping SEASON in update_data.py):
    python scripts/build_stat_mountains.py
"""
import json, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], os.path.join(os.path.dirname(HERE), "data")]
import update_data as U  # noqa: E402
from build_mountain import pos_code, norm, NOT_NFL  # noqa: E402

TOP = 30
MAX_N = 30


def total(p, col, n, key):
    """Sum of season column col through the player's first n seasons (None = career). A category known
    only as a career total (miss) counts only when the view covers his whole career; otherwise None.
    A career total in car (from the wins list, where it differs from the season sum) is used whenever
    the view covers his whole career."""
    last = None if n is None else p["first"] + n - 1
    whole = last is None or last >= p["last"]
    if whole and key in p.get("car", {}):
        return p["car"][key]  # official career total wins over the season sum when the view covers his whole career
    if key in p.get("miss", ()):
        return None
    return sum(s[col] or 0 for y, s in p["seasons"].items() if last is None or y <= last)


def keep_top(people, views):
    """ids of everyone in the top TOP of any view: views = [(filter, [(col, key), ...])]"""
    keep = {U.ALLEN}
    for flt, parts in views:
        group = [p for p in people.values() if flt(p)]
        for n in list(range(1, MAX_N + 1)) + [None]:
            score = []
            for p in group:
                vals = [total(p, c, n, k) for c, k in parts]
                if any(v is None for v in vals):
                    continue
                v = sum(vals)
                if v > 0:
                    score.append((v, p["id"]))
            score.sort(reverse=True)
            if len(score) >= TOP:
                cut = score[TOP - 1][0]
                keep.update(i for v, i in score if v >= cut)
            else:
                keep.update(i for v, i in score)
    return keep


def write(name, obj):
    path = os.path.join(U.OUT, name)
    with open(path, "w") as f:
        head = json.dumps({k: v for k, v in obj.items() if k != "players"}, ensure_ascii=False)[:-1]
        f.write(head + ',"players":[\n' + ",\n".join(json.dumps(p, separators=(",", ":"), ensure_ascii=False) for p in obj["players"]) + "\n]}\n")
    print(f"{name}: {len(obj['players'])} players, {os.path.getsize(path) // 1024} KB")


def main():
    hist = json.load(open(os.path.join(HERE, "history_mtn_pre1999.json")))["players"]
    roster = {r["gsis_id"]: r for r in U.get("players/players.csv")}
    sched = U.fix_starters([g for g in U.get("schedules/games.csv") if g["season"].isdigit() and 1999 <= int(g["season"]) < U.SEASON])
    people = {}

    def person(pid, name, pos, y):
        info = roster.get(pid, {})
        p = people.setdefault(pid, {"id": pid, "name": name or info.get("display_name", pid), "pos": info.get("position") or pos or "",
                                    "first": int(info.get("rookie_season") or y), "last": y, "seasons": {}})
        p["first"], p["last"] = min(p["first"], y), max(p["last"], y)
        return p

    # season row: [passYds, rushYds, games, regW, regL(+T), postW, postL]
    for y in range(1999, U.SEASON):
        for r in U.get(f"stats_player/stats_player_reg_{y}.csv"):
            py, ry, g = int(U.num(r, "passing_yards")), int(U.num(r, "rushing_yards")), int(U.num(r, "games"))
            if not (py or ry or g):
                continue
            p = person(r["player_id"], r.get("player_display_name"), r.get("position"), y)
            s = p["seasons"].setdefault(y, [0, 0, None, 0, 0, 0, 0])
            s[0] += py; s[1] += ry; s[2] = (s[2] or 0) + g
    # games: snap counts (2012 on) catch games without a stat
    pfr = {r["pfr_id"]: r["gsis_id"] for r in roster.values() if r.get("pfr_id")}
    for y in range(2012, U.SEASON):
        snaps = defaultdict(int)
        for r in U.get(f"snap_counts/snap_counts_{y}.csv"):
            if r["game_type"] == "REG" and r["pfr_player_id"] in pfr and \
                    any(U.num(r, k) > 0 for k in ("offense_snaps", "defense_snaps", "st_snaps")):
                snaps[pfr[r["pfr_player_id"]]] += 1
        for pid, g in snaps.items():
            p = people.get(pid)
            if p and y in p["seasons"] and g > (p["seasons"][y][2] or 0):
                p["seasons"][y][2] = g
    # wins as the starting quarterback, from the schedule's starting QB ids
    for g in sched:
        if g["home_score"] in ("", "NA"):
            continue
        hs, as_ = int(g["home_score"]), int(g["away_score"])
        for side, me, op in (("home", hs, as_), ("away", as_, hs)):
            q = g[side + "_qb_id"]
            if not q:
                continue
            y = int(g["season"])
            p = person(q, g[side + "_qb_name"], "QB", y)
            s = p["seasons"].setdefault(y, [0, 0, None, 0, 0, 0, 0])
            post = g["game_type"] != "REG"
            if me > op:
                s[5 if post else 3] += 1
            else:
                s[6 if post else 4] += 1

    # merge pre-1999 history onto players who continued past 1998
    by_name = defaultdict(list)
    for pid, p in people.items():
        if p["first"] < 1999:
            by_name[norm(p["name"])].append(pid)
    problems = []
    for h in hist:
        if h["name"] in NOT_NFL:
            continue
        seasons = {s[0]: [s[1], s[2], s[5], s[3], s[6], s[4], s[7]] for s in h["seasons"]}
        cands = by_name.get(norm(h["name"]), [])
        matches = cands if len(cands) == 1 else [pid for pid in cands if abs(people[pid]["first"] - h["first"]) <= 1]
        if h["last"] >= 1999 and matches:
            p = people[matches[0]]
            p["seasons"].update(seasons)
            p["first"] = min(p["first"], h["first"])
            if h.get("miss"):
                p["miss"], p["car"] = h["miss"], h["car"]
            # whole-career wins check against the wins list
            for key, col in (("w", 3), ("pw", 5)):
                want = (h.get("chk") or {}).get(key)
                if want is not None and key not in p.get("miss", []):
                    got = sum(s[col] for s in p["seasons"].values())
                    if got != want:
                        problems.append(f"{h['name']}: {key} {got} (Wikipedia pre-1999 + nflverse) != list {want}; career views use {want}")
                        p.setdefault("car", {})[key] = want
                        lk = "l" if key == "w" else "pl"
                        lw = (h.get("chk") or {}).get(lk)
                        p["car"][lk] = lw if lw is not None else sum(s[col + 1] for s in p["seasons"].values())
        elif h["last"] >= 1999 and not matches:
            problems.append(f"{h['name']}: played past 1998 but no nflverse match; left out")
        else:
            people["w:" + h["wiki"]] = {"id": "w:" + h["wiki"], "name": h["name"], "pos": h["pos"], "first": h["first"],
                                         "last": h["last"], "seasons": seasons, **({"miss": h["miss"], "car": h["car"]} if h.get("miss") else {})}
    # players who began before 1999 without any history are left out (their early seasons are unknown)
    for pid in [pid for pid, p in people.items() if not pid.startswith("w:") and p["first"] < 1999
                and not any(y < 1999 for y in p["seasons"])]:
        del people[pid]
    for p in people.values():
        p["pos"] = pos_code(p["pos"])

    # Allen's 2018 passing yards: nflverse play-by-play has 2,044; the official figure (used everywhere on the site) is 2,074
    if 2018 in people[U.ALLEN]["seasons"]:
        people[U.ALLEN]["seasons"][2018][0] = 2074
    # official career yards (retired players: Wikipedia leader lists; active passers: the site's rank list base through last season)
    off = json.load(open(os.path.join(HERE, "official_careers.json")))
    alias = {"mikevick": "michaelvick"}
    for key, col in (("pass", 0), ("rush", 1)):
        named = {norm(k): v for k, v in off[key].items()}
        for p in people.values():
            if p["last"] >= U.SEASON - 1 or key in p.get("miss", []):
                continue
            v = named.get(alias.get(norm(p["name"]), norm(p["name"])))
            got = sum(s[col] or 0 for s in p["seasons"].values())
            # only small differences are corrections; a big gap is a different player with the same name,
            # or a list total that includes AAFC play (not NFL statistics)
            if v is not None and v != got and abs(v - got) <= v * 0.03:
                p.setdefault("car", {})[key] = v
                if abs(v - got) > max(50, v * 0.01):
                    problems.append(f"{p['name']}: career {key} yards {got} from seasons vs official {v}")
    # official career records (wins list) for retired quarterbacks, where nflverse's starters differ
    for p in people.values():
        rec = off["qbw"].get(p["name"])
        if not rec or p["pos"] != "QB" or p["last"] >= U.SEASON - 1:
            continue
        got = [sum(s[c] for s in p["seasons"].values()) for c in (3, 4, 5, 6)]
        for i, key in enumerate(("w", "l", "pw", "pl")):
            if rec[i] is not None and rec[i] != got[i] and "w" not in p.get("miss", []) and abs(rec[i] - got[i]) <= max(3, rec[i] * 0.05):
                p.setdefault("car", {})[key] = rec[i]
    ranks = json.load(open(os.path.join(HERE, "nfl_ranks_base.json")))["lists"]["Career passing yards"]["active"]
    for a in ranks:
        p = people.get(a["id"])
        if p and a["id"] != U.ALLEN:
            got = sum(s[0] or 0 for y, s in p["seasons"].items() if y < U.SEASON)
            if got != a["base"]:
                p.setdefault("car", {})["pass"] = a["base"]  # through last season; the page adds this season on top

    def out_player(p, cols, keys):
        q = {"id": p["id"], "name": p["name"], "pos": p["pos"], "first": p["first"], "last": p["last"],
             "s": [[y] + [s[c] for c in cols] for y, s in sorted(p["seasons"].items())]}
        m = [k for k in p.get("miss", []) if k in keys]
        car = {k: v for k, v in p.get("car", {}).items() if k in keys or (k in ("l", "pl") and ("w" in keys))}
        if m:
            q["miss"] = m
        if car:
            q["car"] = car
        if p["last"] >= U.SEASON - 2 and roster.get(p["id"], {}).get("pfr_id"):
            q["pfr"] = roster[p["id"]]["pfr_id"]
        return q

    note = "Regular season unless marked. 1999 on: nflverse (CC BY 4.0). Before 1999: Wikipedia (CC BY-SA 4.0)."
    # ---- yards ----
    is_qb, is_rb = (lambda p: p["pos"] == "QB"), (lambda p: p["pos"] == "RB")
    keep = keep_top(people, [(lambda p: True, [(0, "pass")]), (lambda p: True, [(1, "rush")]),
                             (is_qb, [(1, "rush")]), (is_rb, [(1, "rush")])])
    pool = sorted([people[i] for i in keep if i in people], key=lambda p: p["name"])
    write("mtn-yards.json", {"through": U.SEASON - 1, "note": note, "cols": ["pass", "rush", "g"],
                             "players": [out_player(p, [0, 1, 2], ("pass", "rush")) for p in pool]})
    # ---- wins ----
    keep = keep_top(people, [(is_qb, [(3, "w")]), (is_qb, [(5, "pw")]), (is_qb, [(3, "w"), (5, "pw")])])
    pool = sorted([people[i] for i in keep if i in people and people[i]["pos"] == "QB"], key=lambda p: p["name"])
    write("mtn-wins.json", {"through": U.SEASON - 1, "note": note, "cols": ["w", "l", "pw", "pl"],
                            "players": [out_player(p, [3, 4, 5, 6], ("w", "pw")) for p in pool]})
    # ---- AFC East titles ----
    T = json.load(open(os.path.join(HERE, "afc_east_titles.json")))["titles"]
    hist_by = {h["name"]: h for h in hist}
    qbs = {}
    for y, team, name, gs, pid in T:
        key = pid or next((i for i, p in people.items() if p["name"] == name and p["pos"] == "QB"), None) or "w:" + name
        p = people.get(key)
        h = hist_by.get(name)
        q = qbs.setdefault(key, {"id": key, "name": name, "pos": "QB",
                                 "first": p["first"] if p else h["first"], "last": p["last"] if p else h["last"], "s": [], "teams": []})
        q["s"].append([y, 1, team, gs])
        if team not in q["teams"]:
            q["teams"].append(team)
    if U.ALLEN not in qbs:
        a = people[U.ALLEN]
        qbs[U.ALLEN] = {"id": U.ALLEN, "name": "Josh Allen", "pos": "QB", "first": a["first"], "last": a["last"], "s": [], "teams": ["BUF"]}
    write("mtn-afce.json", {"through": U.SEASON - 1, "note": "AFC East champions since 1970, credited to the quarterback who started the most "
                            "regular-season games for the champion. Row: [season, title, team, starts].",
                            "players": sorted(qbs.values(), key=lambda q: q["name"])})
    print("\nchecks:")
    for x in problems:
        print("  " + x)


if __name__ == "__main__":
    main()
