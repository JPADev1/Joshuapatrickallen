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

## Stat mountains (`mountain.html`)
Every career tile on the home page opens a mountain. Passing and rushing touchdowns open Touchdown Mountain preset to that
type; the others open `mountain.html`:
- `#s=yards` Yardage Mountain: passing or rushing yards, all players / QBs / RBs.
- `#s=wins` Win Mountain: wins as the starting QB, regular season, playoffs or both.
- `#s=afce` AFC East Mountain: AFC East titles since 1970, credited to the champion's main starter.
Each has career vs through-N-seasons, a play button, full screen, and (yards, wins) a week-by-week "This season" view.
- `data/mtn-yards.json`, `data/mtn-wins.json`, `data/mtn-afce.json`: built by `python scripts/build_stat_mountains.py`
  from nflverse (1999 on), `scripts/history_mtn_pre1999.json` (before 1999, from Wikipedia tables dumped by the job on the
  `history-build` branch), `scripts/official_careers.json` (official career totals for retired players) and
  `scripts/afc_east_titles.json` (add each new champion after the regular season).
- `mtn-live-2026.json` and `mtn-week-2026.json` (stats-data branch): this season, refreshed hourly by update_data.py.
- `scripts/starter_fixes.json`: games where nflverse names a different starting QB than the official record
  (Allen's one-snap starts in 2019, 2024 and 2025). Used for career wins everywhere.
- Once a year after the Super Bowl: add the AFC East champion, then rerun build_stat_mountains.py (after build_mountain.py).

## 90%+ props (Next game page)
`update_data.py` adds `props` to matchup.json every hour: every Bills and opponent prop (common alternate lines) that hit in
90%+ of the player's games this season, with game-log bars, a 1-5 star confidence rating and pros and cons. Games come
from snap counts, so a game on the field without a stat counts as a miss. A gambling disclaimer sits under the section.
