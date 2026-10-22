"""Parse the Places 'Weekly Property Report' PDF (Pikes Place / De Cortez / Pebble Creek).
Usage: python3 -I weekly_parse.py <weekly.pdf> [out.json]
Writes JSON with per-property demand/box-score figures, occupancy, lost rent, lead mix, delinquency."""
import sys, re, json, subprocess

PROPS = ["Pikes Place", "De Cortez", "Pebble Creek"]


def to_int(s):
    s = s.replace(",", "").replace("$", "").strip()
    if s in ("—", "-", ""):
        return 0
    return int(float(s))


def parse(pdf):
    txt = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    lines = txt.splitlines()
    out = {p: {} for p in PROPS}
    meta = {}

    m = re.search(r"Week of (\w+ \d+) - (\w+ \d+), (\d{4})", txt)
    if m:
        meta["week"] = f"{m.group(1)} - {m.group(2)}, {m.group(3)}"
    m = re.search(r"Activity: (\d\d/\d\d/\d{4}) - (\d\d/\d\d/\d{4})\. Availability.*?as of (\d\d/\d\d/\d{4})", txt)
    if m:
        meta["week_start"], meta["week_end"], meta["asof"] = m.group(1), m.group(2), m.group(3)
    m = re.search(r"Week-over-week changes compare with the (\d\d/\d\d) - (\d\d/\d\d/\d{4})", txt)
    if m:
        meta["prior_week"] = f"{m.group(1)}-{m.group(2)}"

    # --- Summary block: occupancy %, change text, occupied/units, vacant, notice, avg rent (column order = PROPS order as printed)
    hdr_i = next(i for i, l in enumerate(lines) if l.strip() == "Summary" and any("Activity for" in x for x in lines[i + 1:i + 3]))
    blk = lines[hdr_i:hdr_i + 25]
    order = None
    for l in blk:
        names = [p for p in PROPS if p in l]
        if len(names) == 3:
            order = sorted(names, key=lambda p: l.index(p))
            break
    pct_line = next(l for l in blk if re.search(r"\d+\.\d%", l))
    pcts = re.findall(r"(\d+\.\d)%", pct_line)
    chg_line = next(l for l in blk if "last week" in l.lower())
    chgs = re.findall(r"(Even with last week|[+-]\d+\.\d pts vs\. last week)", chg_line)
    occ_line = next(l for l in blk if re.search(r"\d+ / \d+", l))
    occs = re.findall(r"(\d+) / (\d+)\s+(\d+) \((\d+) rented\)", occ_line)
    not_line = next(l for l in blk if re.search(r"^\s*\d+\s+\$\d", l))
    nots = re.findall(r"(\d+)\s+\$([\d,]+)", not_line)
    for k, p in enumerate(order):
        d = out[p]
        d["occ"] = pcts[k] + "%"
        c = chgs[k]
        d["occ_chg"] = "even w/ last wk" if c.startswith("Even") else c.replace(" vs. last week", " vs last wk")
        d["occupied"], d["units"], d["vacant"], d["vacant_rented"] = map(int, occs[k])
        d["on_notice"], d["avg_rent"] = int(nots[k][0]), to_int(nots[k][1])

    # --- This Week at a Glance (columns: Pikes, DC, PC, Total, Last week, Change)
    gl = next(i for i, l in enumerate(lines) if "This Week at a Glance" in l)
    glance_cols = None
    for l in lines[gl:gl + 4]:
        if all(p in l for p in PROPS):
            glance_cols = sorted(PROPS, key=lambda p: l.index(p))
    keys = {"Move-ins": "mi", "Move-outs": "mo", "Renewals": "renew", "Month-to-month residents": "mtm", "Evictions": "evict",
            "Inquiries": "inq", "Showings": "show", "Applications": "app", "Approved": "appr", "Denied": "den", "Canceled": "can"}
    totals = {}
    for l in lines[gl:gl + 40]:
        for label, key in keys.items():
            m = re.match(rf"^\s*{re.escape(label)}\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([+-]?\d+|—)", l)
            if m:
                for k, p in enumerate(glance_cols):
                    out[p][key] = int(m.group(k + 1))
                totals[key] = dict(total=int(m.group(4)), last_week=int(m.group(5)))
    meta["totals"] = totals

    # --- Unit Availability: per-property lost rent total and unit rows
    for p in PROPS:
        m = re.search(rf"{re.escape(p)} \((\d+) units?\)(.*?)\n\s*Total\s+\d+ units\s+\$?([\d,]+|—)", txt, re.S)
        if m:
            out[p]["avail_units"] = int(m.group(1))
            out[p]["lost_rent"] = to_int(m.group(3))
            rows = []
            for r in re.finditer(r"^\s*(\d{4}-\d+)\s+(.+?)\s+(\d/\d\.\d\d)\s+(\d+)\s+(Vacant|Notice) - (Unrented|Rented)\s+(\d\d/\d\d/\d{4}|—)\s+(\d+|—)\s+(Yes|No)\s+(Yes|No)\s+\$([\d,]+)\s+(\$[\d,]+|—)",
                                 m.group(2), re.M):
                rows.append(dict(unit=r.group(1), type=r.group(2).strip(), status=f"{r.group(5)}-{r.group(6)}", avail=None if r.group(7) == "—" else r.group(7),
                                 days=None if r.group(8) == "—" else int(r.group(8)), ready=r.group(9) == "Yes", posted=r.group(10) == "Yes",
                                 market=to_int(r.group(11)), lost=to_int(r.group(12))))
            out[p]["avail_rows"] = rows

    # --- Lead sources (portfolio-wide)
    leads = []
    ls = next((i for i, l in enumerate(lines) if l.strip().startswith("Lead Sources") and any("Prospect Source" in x for x in lines[i + 1:i + 3])), None)
    if ls is not None:
        for l in lines[ls:ls + 45]:
            m = re.match(r"^\s*([A-Za-z][A-Za-z0-9 \-]+?)\s{2,}(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\d+%|—)", l)
            if m and m.group(1).strip() != "Total":
                leads.append(dict(source=m.group(1).strip(), inq=int(m.group(2)), show=int(m.group(3)), app=int(m.group(4)),
                                  appr=int(m.group(5)), share=int(m.group(7)), show_rate=m.group(8)))
    meta["leads"] = leads

    # --- Box score per property (vacant + notice unrented)
    for p in PROPS:
        m = re.search(rf"^\s*{re.escape(p)}\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$", txt, re.M)
        if m:
            out[p]["box_unrented"] = int(m.group(5))

    # --- Rollover windows and delinquency
    m = re.search(r"Next 90 days \(.*?\)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", txt)
    if m:
        for k, p in enumerate(PROPS):  # rollover table columns are Pikes, DC, PC
            out[p]["exp90"] = int(m.group(k + 1))
    for p in PROPS:
        m = re.search(rf"^\s*{re.escape(p)}\s+\$([\d,]+)\s+\$([\d,]+)\s+\$([\d,]+)\s+\$([\d,]+)\s+\$([\d,]+)", txt, re.M)
        if m:
            out[p]["delinq_total"], out[p]["delinq_90"] = to_int(m.group(1)), to_int(m.group(5))
        m = re.search(rf"^\s*{re.escape(p)}\s+(\d+)\s+(\d+)\s+\$([\d,]+)\s+(\d+)%", txt, re.M)
        if m:
            out[p]["accts_owing"], out[p]["evict_accts"], out[p]["evict_bal"] = int(m.group(1)), int(m.group(2)), to_int(m.group(3))
    notes = []
    for l in lines:
        m = re.match(r"^\s*(\d{4}-\d+)\s+(Pikes Place|De Cortez|Pebble Creek)\s+(Evict|Current|Notice)\s+\$([\d,]+)\s+(\$[\d,]+|—)\s+(.*\S)", l)
        if m:
            notes.append(dict(unit=m.group(1), prop=m.group(2), status=m.group(3), balance=to_int(m.group(4)), note=m.group(6)))
    meta["largest_balances"] = notes
    # key takeaways text
    kt = re.search(r"Key Takeaways\n(.*?)\n\n\n", txt, re.S)
    meta["takeaways"] = re.sub(r"\s+", " ", kt.group(1)) if kt else ""
    return dict(meta=meta, props=out)


if __name__ == "__main__":
    res = parse(sys.argv[1])
    js = json.dumps(res, indent=1)
    if len(sys.argv) > 2:
        open(sys.argv[2], "w").write(js)
    print(js)
