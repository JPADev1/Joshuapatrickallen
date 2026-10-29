# joshuapatrickallen.com

Fan site tracking Josh Allen's stats and Bills franchise records.

## How the numbers stay current (free)
- `.github/workflows/update-data.yml` runs every hour on GitHub Actions and runs `scripts/update_data.py`.
- The script pulls free nflverse data (schedule, results, player and team stats, injury reports) and writes
  `allen-2026.json`, `matchup.json` and `nfl-ranks.json` to the **stats-data** branch.
- The pages read those files straight from GitHub, so data updates never trigger a Netlify deploy (no credits used).
  The copies in `data/` on main are only a fallback.
- After each Bills game, the Next game page switches to the following opponent on its own.

## Things to fill in by hand (no free feed)
`data/overrides.json`: TV network per game, and the all-time series record against an opponent
(through a given season; later games are added automatically). Without a series entry the page shows
the record since 1999.

## Touchdown Mountain (`touchdown-mountain.html`)
Opened from the "Career total touchdowns" tile. Allen vs the NFL's top 20 in total, passing, rushing or receiving
touchdowns, among all players, quarterbacks or running backs, career or through his first N seasons.
- `data/td-mountain.json`: everyone who reaches a top 30 in any view, season by season. Built by
  `python scripts/build_mountain.py` from nflverse (1999 on) and `scripts/history_pre1999.json` (before 1999).
- `scripts/history_pre1999.json` was built once from Wikipedia player pages by the job on the `history-build` branch;
  every player's seasons were checked against the career totals on his page.
- `td-mountain-2026.json` (stats-data branch): current-season touchdowns, refreshed hourly by update_data.py.
- Once a year after the Super Bowl: bump `SEASON` in update_data.py, then rerun build_mountain.py.
