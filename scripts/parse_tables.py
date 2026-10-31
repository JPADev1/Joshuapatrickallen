"""One-time: turn the Wikipedia table dumps (history-build branch, out/tables) into
scripts/history_mtn_pre1999.json for the stat mountains (yards, QB wins, AFC East titles).

    python parse_hist.py TABLES_DIR HB_SCRIPTS_DIR OUT_JSON REPORT_TXT
"""
import json, os, re, sys, glob
from collections import defaultdict

TABLES, HBS, OUTF, REP = sys.argv[1:5]
sys.path.insert(0, HBS)
import build_history as H  # noqa: E402  (CFL / AAFC filters, number parsing)

EXCL = re.compile(r"college|pre-draft|high school|usfl|cfl|canadian|xfl|arena|wfl|ufl|aaf\b|super bowl|head coach|"
                  r"boxing|golf|track|film|television|electoral|martial|grey cup|draft|world league|nfl europe", re.I)
POST = re.compile(r"postseason|playoff", re.I)


def ival(s):
    s = str(s).replace(",", "").replace("−", "-").replace("–", "-").strip()
    s = re.sub(r"\[.*?\]", "", s)
    m = re.match(r"^-?\d+", s)
    return int(m.group()) if m else None


def record(s):
    """'8−3−1' -> (8, 3, 1); a dash (no starts) -> (0, 0, 0)"""
    s = str(s).strip()
    m = re.match(r"^(\d+)\s*[-−–]\s*(\d+)(?:\s*[-−–]\s*(\d+))?", s)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
    return (0, 0, 0) if s in ("—", "-", "–", "") else None


def wins(s):
    r = record(s)
    return r[0] if r else None


def classify(cols):
    """column index for passYds, rushYds, record, games"""
    out = {}
    parts = [c.split("|") for c in cols]
    names = {p[-1].lower() for p in parts}
    for i, p in enumerate(parts):
        grp = " ".join(p[:-1]).lower() if len(p) > 1 else ""
        last = re.sub(r"\.\d+$", "", p[-1]).strip().lower()
        if last in ("yds", "yards", "yd"):
            if "pass" in grp and "pass" not in out:
                out["pass"] = i
            elif "rush" in grp and "rush" not in out:
                out["rush"] = i
            elif not grp or grp == last:
                if names & {"cmp", "comp", "pct", "rtg", "rate", "cmp%"} and "pass" not in out:
                    out["pass"] = i
                elif not names & {"rec", "receptions", "tgt"} and names & {"att", "car", "carries"} and "rush" not in out:
                    out["rush"] = i
        elif last in ("record", "w–l", "w-l", "qb rec", "qbrec") and "rec" not in out:
            out["rec"] = i
        elif last in ("gp", "g") and "gp" not in out:
            out["gp"] = i
    return out


def section(tables, post, after=-1):
    """tables of the chosen NFL regular-season (or postseason) section; a postseason section must come
    after the chosen regular-season one (pages with USFL tables have a USFL postseason table first)"""
    cands = []
    for ti, t in enumerate(tables):
        if ti <= after:
            continue
        if not t["cols"] or not re.match(r"^(year|season)", t["cols"][0], re.I):
            continue
        hs = t["h"]
        if not hs or EXCL.search(hs[0]) or (len(hs) > 1 and EXCL.search(hs[1]) and re.match(r"^(regular season|postseason|playoffs?)$", hs[0].strip(), re.I)):
            continue
        if bool(POST.search(hs[0])) != post:
            continue
        if not post and len(hs) > 1 and POST.search(hs[0]):
            continue
        k = classify(t["cols"])
        if not (set(k) & {"pass", "rush", "rec"}):
            continue
        cands.append((tuple(hs), t, k, ti))
    if not cands:
        return []
    pro = [c for c in cands if re.search(r"regular|nfl|afl|professional|pro career|career stat|statistics", " ".join(c[0][:2]), re.I)
           and not re.search(r"college|university|academy|state\b", " ".join(c[0][:2]), re.I)
           and (c[1]["cols"][1:2] and re.search(r"team|tm", c[1]["cols"][1], re.I))]
    if pro:
        cands = pro
    elif not post:
        return []
    first = cands[0][0]
    return [(t, k, ti) for hs, t, k, ti in cands if hs == first]


def keep_row(year, team):
    if H.CFL.search(team) or team.strip().upper() in H.CFL_CODES:
        return False
    if 1946 <= year <= 1949 and (H.AAFC.search(team) or (team.strip().upper() in H.AAFC_CODES and year >= (1947 if team.strip().upper() == "BAL" else 1946))):
        return False
    return True


TOTROW = re.compile(r"^(total|tot|2tm|3tm|2 ?teams|3 ?teams|combined)$", re.I)


def read(tables, post, after=-1):
    seas = defaultdict(dict)  # year -> {pass, rush, w, gp}
    kinds, career = set(), {}
    raw = defaultdict(int)  # totals including AAFC rows (career rows and infoboxes include them)
    at = -1
    for t, k, ti in section(tables, post, after):
        at = max(at, ti)
        new = [x for x in ("pass", "rush", "rec", "gp") if x in k and x not in kinds]
        if not new:
            continue
        kinds.update(new)
        for r in t["rows"]:
            y, team = r[0], r[1] if len(r) > 1 else ""
            if re.search(r"career|total", y, re.I):
                for x in new:
                    v = wins(r[k[x]]) if x == "rec" else ival(r[k[x]])
                    if v is not None:
                        career[x] = v
                continue
            m = re.match(r"^(19|20)\d\d", y.strip())
            if not m:
                continue
            yr = int(m.group())
            if TOTROW.match(team.strip()) or (not team.strip() and sum(1 for q in t["rows"] if q[0][:4] == y[:4]) > 1):
                continue
            cfl = H.CFL.search(team) or team.strip().upper() in H.CFL_CODES
            if not cfl:
                for x in new:
                    v = wins(r[k[x]]) if x == "rec" else ival(r[k[x]])
                    raw[x] += v or 0
            if not keep_row(yr, team):
                continue
            for x in new:
                v = wins(r[k[x]]) if x == "rec" else ival(r[k[x]])
                s = seas[yr]
                s[x] = (s.get(x) or 0) + (v or 0) if v is not None or x not in s else s[x]
                if x == "rec":
                    rr = record(r[k[x]]) or (0, 0, 0)
                    s["l"] = s.get("l", 0) + rr[1] + rr[2]  # losses + ties (decisions that weren't wins)
    return seas, kinds, career, raw, at


def main():
    # career QB wins (regular season and playoffs), by name
    W = json.load(open(os.path.join(TABLES, "List_of_National_Football_League_career_quarterback_wins_leaders.json")))
    regw, postw, regl, postl = {}, {}, {}, {}
    for t in W["tables"]:
        post = bool(re.search(r"postseason", t["h"][0], re.I))
        ci = {c: i for i, c in enumerate(t["cols"])}
        if "Quarterback" not in ci or "Career wins" not in ci:
            continue
        for r in t["rows"]:
            nm = re.sub(r"^[^A-Za-z]+", "", r[ci["Quarterback"]]).strip()
            nm = re.sub(r"[‡†*^#¤]+", "", nm).strip()
            (postw if post else regw)[nm] = ival(r[ci["Career wins"]])
            (postl if post else regl)[nm] = (ival(r[ci["Career losses"]]) or 0) + (ival(r[ci["Career ties"]]) or 0 if "Career ties" in ci else 0)
    players, report = [], []
    for f in sorted(glob.glob(os.path.join(TABLES, "*.json"))):
        d = json.load(open(f))
        if d["title"].startswith(("List of", "AFC")):
            continue
        reg, kinds, career, raw, at = read(d["tables"], False)
        if not reg:
            continue
        pst, pkinds, pcar, praw, _ = read(d["tables"], True, at)
        first, last = min(reg), max(reg)
        if first >= 1999:
            continue
        ib = d["infobox"]
        pos = re.sub(r"\(.*?\)|\[.*?\]", "", ib.get("Position", "")).strip()
        name = re.sub(r"\s*\(.*?\)$", "", d["title"])
        ibv = {"pass": ival(ib.get("Passing yards", "")), "rush": ival(ib.get("Rushing yards", ""))}
        p = {"name": name, "wiki": d["title"], "pos": pos, "first": first, "last": last, "seasons": [], "miss": [], "car": {}}
        notes = []
        for x, lab in (("pass", "pass"), ("rush", "rush")):
            tot = sum(s.get(x) or 0 for s in reg.values())
            if x in kinds:
                refs = [v for v in (career.get(x), ibv[x]) if v is not None]
                if refs and not any(abs(tot - v) <= 2 or abs(raw[x] - v) <= 2 for v in refs) and last < 1999 \
                        and not (min(refs) > 1.5 * max(tot, 1)):  # a much bigger career number includes CFL/USFL play
                    notes.append(f"{x} yds: seasons {tot} (with AAFC {raw[x]}) vs career row {career.get(x)} / infobox {ibv[x]}")
                    p["miss"].append(x); p["car"][x] = career.get(x, ibv[x])
            elif ibv[x]:
                p["miss"].append(x); p["car"][x] = ibv[x]
        # wins: per season from the Record column, else career from the wins list
        lw = regw.get(name)
        if "rec" in kinds:
            tot = sum(s.get("rec") or 0 for s in reg.values())
            p.setdefault("chk", {})["w"] = lw
            p["chk"]["l"] = regl.get(name)
            if lw is not None and tot != lw and last < 1999:
                notes.append(f"reg wins: seasons {tot} vs list {lw}")
                p["miss"].append("w"); p["car"]["w"] = lw; p["car"]["l"] = regl.get(name, 0)
        elif lw:
            p["miss"].append("w"); p["car"]["w"] = lw; p["car"]["l"] = regl.get(name, 0)
        lp = postw.get(name)
        if "rec" in pkinds:
            tot = sum(s.get("rec") or 0 for s in pst.values())
            p.setdefault("chk", {})["pw"] = lp
            p["chk"]["pl"] = postl.get(name)
            if lp is not None and tot != lp and last < 1999:
                notes.append(f"post wins: seasons {tot} vs list {lp}")
                p["miss"].append("pw"); p["car"]["pw"] = lp; p["car"]["pl"] = postl.get(name, 0)
        elif lp:
            p["miss"].append("pw"); p["car"]["pw"] = lp; p["car"]["pl"] = postl.get(name, 0)
        for y in sorted(reg):
            if y >= 1999:
                continue
            s = reg[y]
            p["seasons"].append([y, s.get("pass", 0) or 0, s.get("rush", 0) or 0, s.get("rec", 0) or 0,
                                 (pst.get(y, {}).get("rec") or 0), s.get("gp"), s.get("l", 0), pst.get(y, {}).get("l", 0)])
        if not p["seasons"]:
            continue
        if not p["miss"]:
            del p["miss"], p["car"]
        players.append(p)
        if notes:
            report.append(f"{d['title']}: " + "; ".join(notes))
    json.dump({"source": "Wikipedia player pages and the NFL career quarterback wins leaders list (CC BY-SA 4.0); regular season NFL/AFL, seasons before 1999. "
                         "Season row: [year, passing yards, rushing yards, regular-season wins as starter, playoff wins as starter, games, regular-season losses+ties as starter, playoff losses as starter]. "
                         "miss/car: categories known only as a career total.",
               "players": players}, open(OUTF, "w"), indent=0)
    open(REP, "w").write(f"{len(players)} players\n" + "\n".join(report) + "\n")
    print(open(REP).read()[:6000])


if __name__ == "__main__":
    main()
