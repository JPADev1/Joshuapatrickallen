set -o pipefail
mkdir -p out
pip install -q pandas beautifulsoup4 lxml
# touchdowns and games are already built and checked; this run dumps stat tables for the yardage/wins/AFC East mountains
python scripts/dump_tables.py out 2>&1 | tail -c 20000 > out/tables_run.txt
