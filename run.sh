set -e
pip install -q pandas beautifulsoup4 lxml
python scripts/build_history.py out
