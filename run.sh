set -e
# Step 1 (exploration): grab the career-leader lists and a few sample player pages.
python scripts/fetch_wiki.py wiki @explore_titles.txt
