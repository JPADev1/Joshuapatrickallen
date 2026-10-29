"""Download Wikipedia pages (rendered HTML) into a folder, politely.

    python scripts/fetch_wiki.py OUTDIR "Page title" ["Page title" ...]
    python scripts/fetch_wiki.py OUTDIR @titles.txt
"""
import json, os, re, sys, time, urllib.parse, urllib.request

API = "https://en.wikipedia.org/w/api.php"
UA = "joshuapatrickallen.com stats builder (https://joshuapatrickallen.com; github.com/JPADev1/Joshuapatrickallen)"


def fetch(title):
    q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "text|displaytitle", "redirects": 1,
                                "format": "json", "formatversion": 2})
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.load(r)
            if "error" in d:
                return None, d["error"].get("info")
            return d["parse"], None
        except Exception as e:
            err = e
            time.sleep(3 * (attempt + 1))
    return None, str(err)


def search(q, n=4):
    """Titles of the top Wikipedia search hits for q."""
    qs = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": q, "srlimit": n, "format": "json"})
    try:
        req = urllib.request.Request(f"{API}?{qs}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            return [h["title"] for h in json.load(r)["query"]["search"]]
    except Exception:
        return []


def slug(t):
    return re.sub(r"[^A-Za-z0-9]+", "_", t).strip("_")


def main():
    out = sys.argv[1]
    titles = []
    for a in sys.argv[2:]:
        titles += [l.strip() for l in open(a[1:]) if l.strip()] if a.startswith("@") else [a]
    os.makedirs(out, exist_ok=True)
    bad = []
    for t in titles:
        p = os.path.join(out, slug(t) + ".html")
        if os.path.exists(p):
            continue
        d, err = fetch(t)
        if not d:
            bad.append(f"{t}\t{err}")
            continue
        with open(p, "w") as f:
            f.write(f"<!-- title: {d['title']} -->\n" + d["text"])
        time.sleep(0.5)
    print(f"{len(titles) - len(bad)} fetched, {len(bad)} failed")
    if bad:
        open(os.path.join(out, "_failed.txt"), "w").write("\n".join(bad) + "\n")


if __name__ == "__main__":
    main()
