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
