"""Refresh data/allen-2026.json from nflverse weekly player stats.

Runs on GitHub Actions (no API key needed). It only writes the file when the new numbers look sane:
if nflverse cannot be read, the player is missing, or totals went DOWN, the job fails and the old file stays.
Standard library only.
"""
import csv, io, json, sys, urllib.request
from datetime import date

SEASON = 2026
PLAYER_ID = "00-0034857"          # Josh Allen (QB, BUF) in nflverse
OUT = "data/allen-2026.json"
URLS = [
    f"https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{SEASON}.csv",
    f"https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_{SEASON}.csv",
]


def fetch():
    last = None
    for u in URLS:
        try:
            with urllib.request.urlopen(u, timeout=60) as r:
                return u, r.read().decode("utf-8")
        except Exception as e:  # try the next known file name
            last = e
    sys.exit(f"Could not download nflverse stats: {last}")


def pick(row, *names):
    for n in names:
        if n in row and row[n] not in ("", "NA"):
            return float(row[n])
    return 0.0


def rating(c, a, y, t, i):
    k = lambda x: max(0.0, min(2.375, x))
    return (k((c / a - .3) * 5) + k((y / a - 3) * .25) + k(t / a * 20) + k(2.375 - i / a * 25)) / 6 * 100


def main():
    url, text = fetch()
    rows = [r for r in csv.DictReader(io.StringIO(text))
            if r.get("player_id") == PLAYER_ID and r.get("season_type", "REG") == "REG" and int(float(r["season"])) == SEASON]
    if not rows:
        sys.exit("No regular-season rows for Josh Allen in the nflverse file.")
    rows.sort(key=lambda r: int(float(r["week"])))
    games = []
    for r in rows:
        games.append({
            "week": int(float(r["week"])), "opp": r.get("opponent_team", ""),
            "cmp": int(pick(r, "completions")), "att": int(pick(r, "attempts")),
            "yds": int(pick(r, "passing_yards")), "td": int(pick(r, "passing_tds")),
            "int": int(pick(r, "passing_interceptions", "interceptions")),
            "rushAtt": int(pick(r, "carries")), "rushYds": int(pick(r, "rushing_yards")),
            "rushTD": int(pick(r, "rushing_tds")),
        })
    n = {k: sum(g[k] for g in games) for k in ("cmp", "att", "yds", "td", "int", "rushAtt", "rushYds", "rushTD")}
    now = {"label": f"{SEASON}*", "g": len(games), "gs": len(games), **n,
           "rate": round(rating(n["cmp"], n["att"], n["yds"], n["td"], n["int"]), 1)}

    try:
        old = json.load(open(OUT))
    except FileNotFoundError:
        old = None
    if old:
        o = old["now"]
        if now["g"] < o["g"] or now["yds"] < o["yds"] or now["td"] < o["td"] or now["rushTD"] < o["rushTD"]:
            sys.exit(f"New totals are lower than the saved ones ({now} vs {o}); refusing to overwrite.")
        # keep game details (opponent, date, result) already saved
        saved = {g["week"]: g for g in old.get("games", [])}
        for g in games:
            if g["week"] in saved:
                for k in ("date", "opp", "home", "result"):
                    if k in saved[g["week"]]:
                        g[k] = saved[g["week"]][k]
    out = {"updated": date.today().isoformat(), "source": f"nflverse ({url.split('/')[-1]})",
           "thru": f"Week {games[-1]['week']}", "now": now, "games": games}
    new_text = json.dumps(out, indent=2) + "\n"
    if old and json.dumps({k: v for k, v in old.items() if k != "updated"}, sort_keys=True) == \
            json.dumps({k: v for k, v in out.items() if k != "updated"}, sort_keys=True):
        print("No change.")
        return
    open(OUT, "w").write(new_text)
    print("Updated:", now)


if __name__ == "__main__":
    main()
