set -o pipefail
mkdir -p out
pip install -q pandas beautifulsoup4 lxml
python scripts/build_history.py out 2>&1 | tail -c 20000 > out/log.txt
