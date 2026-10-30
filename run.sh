set -o pipefail
mkdir -p out
pip install -q pandas beautifulsoup4 lxml
# touchdowns (history_pre1999.json) are already built and checked; this run only adds games played
python scripts/build_games.py out 2>&1 | tail -c 20000 > out/games_log.txt
