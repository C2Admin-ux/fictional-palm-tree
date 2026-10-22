"""Weekly 'Vacancy & Leasing Update' PDF, one page per property (Pikes Place, Pebble Creek, De Cortez).
Usage: python3 -I vreport.py config.json [--facts]
config.json keys:
  today            "YYYY-MM-DD" run date (Signals export date)
  signals_csv      AppFolio Leasing Signals suggested/advertised rents CSV ("C2- pricing" email)
  rent_roll_csv    AppFolio rent_roll-YYYYMMDD.csv ("C2 weekly report" email)
  weekly_json      output of weekly_parse.py for this week's Weekly Property Report PDF
  prior_weekly_json  (optional) weekly_parse.py output for the prior week's PDF, for prior-week funnel
  last_report_pdf  (optional) last week's Vacancy_Update PDF, for the "Since m/d" change column
  last_report_date "YYYY-MM-DD" date of that PDF
  narrative_json   per-property headline / actions / pipeline / extra_notes / overrides written for this week
  out              output PDF path
Prints a JSON summary per property plus any layout warnings; exit code 2 on layout overflow.
With --facts, prints a JSON dump of everything the narrative is written from and exits."""
import sys, csv, re, json, statistics, subprocess
from datetime import date, datetime
from reportlab.lib.pagesizes import letter, landscape
from reportlab.pdfgen import canvas
from reportlab.platypus import Table, TableStyle, Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase.pdfmetrics import stringWidth

CFG = json.load(open(sys.argv[1]))
TODAY = date.fromisoformat(CFG["today"])
NARR = json.load(open(CFG["narrative_json"]))
WK = json.load(open(CFG["weekly_json"]))
PWK = json.load(open(CFG["prior_weekly_json"])) if CFG.get("prior_weekly_json") else None
WEEKLY_ASOF = datetime.strptime(WK["meta"]["asof"], "%m/%d/%Y").date()
LAST_DATE = date.fromisoformat(CFG["last_report_date"]) if CFG.get("last_report_date") else None
TAKEOVER = date(2026, 8, 14)  # Places took over; "new leases" = move-ins since then
PROPS = ["Pikes Place", "Pebble Creek", "De Cortez"]
ADDR = {"Pikes Place": "3717 E San Miguel St", "Pebble Creek": "2005 S. El Paso Ave", "De Cortez": "3006 De Cortez St"}

W, H = landscape(letter)
LM, RM = 28, 28
CW = W - LM - RM
INK = colors.black
GRAY = colors.Color(0.38, 0.38, 0.38)
HAIR = colors.Color(0.80, 0.80, 0.80)
warn = []


# ------------------------------------------------------------------ helpers
def num(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    s = str(s).replace(",", "").replace("$", "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


def dts(s):
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def prop_of(unit):
    return {"3006": "De Cortez", "2005": "Pebble Creek"}.get(unit.split("-")[0], "Pikes Place")


def usd(x, d=0):
    return "-" if x is None else f"${x:,.{d}f}"


def rng(lo, hi):
    if lo is None or hi is None:
        return "-"
    return f"${lo:,.0f}" if lo == hi else f"${lo:,.0f}-{hi:,.0f}"


def mdy(d):
    return "-" if d is None else d.strftime("%m/%d/%y")


def md(d):
    return "-" if d is None else d.strftime("%m/%d")


def fd(d):
    return d.strftime("%-m/%-d") if d.year == TODAY.year else d.strftime("%-m/%-d/%y")


def fits(s, w, font="Helvetica", size=6.5, tag=""):
    if stringWidth(s, font, size) > w - 3:
        warn.append(f"overflow {tag}: '{s}' ({stringWidth(s, font, size):.0f} > {w-3:.0f})")
    return s


def mid(lo, hi):
    return None if lo is None or hi is None else (lo + hi) / 2


# ------------------------------------------------------------------ inputs
rr = {}
with open(CFG["rent_roll_csv"], newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        u = (row.get("Unit") or "").strip()
        if u.count("-") == 1 and not u.startswith("->") and row.get("Status"):
            rr[u] = row

sig = {}
with open(CFG["signals_csv"], newline="", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        u = (row.get("Unit") or "").strip()
        if u.count("-") == 1 and not u.startswith("->"):
            sig[u] = row

DEM = WK["props"]
units_all = []
for u, r in rr.items():
    st_rr = r["Status"]
    if not (st_rr.startswith("Vacant") or st_rr.startswith("Notice")):
        continue
    l = sig.get(u, {})
    st = l.get("Unit Status") or st_rr
    avail = dts(l.get("Available On")) if l else None
    if avail is None:
        avail = dts(r.get("Available On"))
    moveout = dts(r.get("Move-out"))
    if moveout is None and st.startswith("Notice") and avail:
        moveout = avail
    d = (TODAY - avail).days if (avail and avail <= TODAY and st.startswith("Vacant")) else None
    mkt = num(l.get("Computed Market Rent")) or num(r.get("Market Rent"))
    x = dict(unit=u, prop=prop_of(u), status=st, status_rr=st_rr,
             utype=(l.get("Unit Type") or r["Tags"]), tag=r["Tags"], bd=r["BD/BA"], sqft=r["Sqft"],
             avail=avail, moveout=moveout, days=d,
             ready=(r.get("Rent Ready") == "Yes"),
             posted=(l.get("Posted To Internet") == "Yes") if l else False,
             last_rent=num(l.get("Last Tenant Rent")) or num(r.get("Previous Rent")), mkt=mkt,
             cur_lo=num(l.get("Current Advertised Rent (Low)")), cur_hi=num(l.get("Current Advertised Rent (High)")),
             sug_lo=num(l.get("Suggested Advertised Rent (Low)")), sug_hi=num(l.get("Suggested Advertised Rent (High)")),
             last_chg=dts(l.get("Last Advertised Rent Change Date")) if l else None)
    x["cur_mid"], x["sug_mid"] = mid(x["cur_lo"], x["cur_hi"]), mid(x["sug_lo"], x["sug_hi"])
    x["delta"] = (x["sug_mid"] - x["cur_mid"]) if (x["sug_mid"] is not None and x["cur_mid"] is not None) else None
    x["far"] = bool(avail and avail.year > TODAY.year and st.startswith("Vacant"))

    def lost_at(asof, x=x, avail=avail, st=st, mkt=mkt):
        if avail and avail <= asof and st.startswith("Vacant") and mkt and not x["far"]:
            return mkt / 30.0 * (asof - avail).days
        return 0.0
    x["lost"] = lost_at(TODAY)
    x["lost_asof"] = lost_at(WEEKLY_ASOF) if st_rr.startswith("Vacant") else 0.0
    units_all.append(x)


def type_summary(prop):
    out = {}
    for u, r in rr.items():
        if prop_of(u) != prop:
            continue
        st = (sig.get(u) or {}).get("Unit Status") or r["Status"]
        o = out.setdefault(r["Tags"], dict(units=0, occ=0, vu=0, vr=0, nu=0, mkts=[], rents=[], moveins=[]))
        o["units"] += 1
        o["mkts"].append(num(r["Market Rent"]) or 0)
        if st.startswith("Vacant"):
            o["vu" if st == "Vacant-Unrented" else "vr"] += 1
        else:
            o["occ"] += 1
            if st.startswith("Notice"):
                o["nu"] += 1
        rent = num(r["Rent"])
        if not st.startswith("Vacant") and rent and rent > 0:
            o["rents"].append(rent)
            mi, lf = dts(r.get("Move-in")), dts(r.get("Lease From"))
            if mi and mi >= TAKEOVER and lf and abs((lf - mi).days) <= 7:
                o["moveins"].append(rent)
    return out


# ------------------------------------------------------------------ last week's report (for the change column)
LAST = {}
if CFG.get("last_report_pdf"):
    _txt = subprocess.run(["pdftotext", "-layout", CFG["last_report_pdf"], "-"], capture_output=True, text=True).stdout
    _rx = re.compile(r"^\s*(\d{4}-\d+)\s+(.+?)\s+(Vacant|Rented|Notice-R|Notice)\s+(\d\d/\d\d/\d\d|-)\s+(in \d+d|MO \d\d/\d\d|\d+d|-)\s+(Yes|NO|-)\s+(Yes|NO)\s")
    for line in _txt.splitlines():
        m = _rx.match(line)
        if m:
            u, ty, st, av, dc, rd, po = m.groups()
            LAST[u] = dict(cls={"Vacant": "Unrented", "Rented": "Rented", "Notice": "Notice", "Notice-R": "Notice"}[st],
                           avail=None if av == "-" else datetime.strptime(av, "%m/%d/%y").date(),
                           ready=(rd == "Yes") if rd != "-" else None, posted=(po == "Yes"))
    if len(LAST) < 10:
        warn.append(f"last report parsed only {len(LAST)} units; change column may be wrong")
HAVE_LAST = bool(LAST)
SINCE = f"Since {fd(LAST_DATE)}" if (HAVE_LAST and LAST_DATE) else "Since last run"


def cur_cls(u):
    return {"Vacant-Unrented": "Unrented", "Vacant-Rented": "Rented"}.get(u["status"], "Notice")


def change_text(u):
    if not HAVE_LAST:
        return "-", False
    L = LAST.get(u["unit"])
    if L is None:
        return "New on list (was occupied)", True
    parts, sg = [], False
    nc = cur_cls(u)
    if L["cls"] != nc:
        sg = True
        parts.append({("Notice", "Unrented"): "Moved out (now Vacant)", ("Unrented", "Rented"): "Rented",
                      ("Rented", "Unrented"): "Fell through", ("Notice", "Rented"): "Moved out, rented"}.get((L["cls"], nc), f"{L['cls']} to {nc}"))
    if nc != "Notice" and L["ready"] is not None and L["ready"] != u["ready"]:
        sg = True
        parts.append("Rdy " + ("Y>N" if L["ready"] else "N>Y"))
    if L["posted"] != u["posted"]:
        sg = True
        parts.append("Post " + ("Y>N" if L["posted"] else "N>Y"))
    la, ca = L["avail"], u["avail"]
    if la and ca and abs((ca - la).days) >= 2:
        parts.append(f"avail {fd(la)}>{fd(ca)}")
    elif ca and not la:
        parts.append(f"avail set {fd(ca)}")
    return ("; ".join(parts) if parts else "No change"), sg


# ------------------------------------------------------------------ next step
def next_step(u, overrides):
    uid, st = u["unit"], u["status"]
    if uid in overrides:
        t, flag = overrides[uid]
        return t, bool(flag)
    d = u["days"]
    if st.startswith("Notice"):
        mo = md(u["moveout"])
        if st == "Notice-Rented":
            return f"MO {mo}, rented: book turn", False
        return (f"MO {mo}: pre-lease (ad live)" if u["posted"] else f"MO {mo}: post and pre-lease now"), False
    if st == "Vacant-Rented":
        if not u["avail"]:
            return "Rented, no move-in date: set date", True
        left = (u["avail"] - TODAY).days
        return (f"Rented, move-in {md(u['avail'])}: ready" if u["ready"] else f"Rented, move-in {md(u['avail'])} (in {left}d): finish turn"), not u["ready"]
    if u["far"]:
        return f"Avail {mdy(u['avail'])}: confirm reno date" + (", unpost" if u["posted"] else ""), False
    if not u["avail"]:
        return "No avail date: set date" + ("" if u["posted"] else ", post"), True
    if d is None:
        left = (u["avail"] - TODAY).days
        if u["ready"]:
            return f"Ready, avail in {left}d: pre-lease now" + ("" if u["posted"] else ", post today"), False
        return f"Not ready, due {md(u['avail'])} (in {left}d): finish turn", left <= 7
    if not u["ready"]:
        return f"Not ready {d}d: escalate make-ready", True
    if not u["posted"]:
        return "Ready but not posted: post today", True
    return f"Ready & posted ({d}d): push showings", False


# ------------------------------------------------------------------ drawing
def kpi_box(c, x, y, w, h, label, value, sub):
    c.setStrokeColor(HAIR); c.setLineWidth(0.6)
    c.rect(x, y - h, w, h, stroke=1, fill=0)
    c.setFillColor(GRAY); c.setFont("Helvetica", 6)
    c.drawString(x + 5, y - 9, label.upper())
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 13.5)
    c.drawString(x + 5, y - 24, value)
    c.setFillColor(GRAY); c.setFont("Helvetica", 6)
    fits(sub, w - 4, "Helvetica", 6, "kpi " + label)
    c.drawString(x + 5, y - 33.5, sub)
    c.setFillColor(INK)


def draw_paras(c, items, x, y_top, width, bottom, style, label):
    y = y_top
    for i, t in enumerate(items, 1):
        p = Paragraph(t, style, bulletText=f"{i}.")
        w, h = p.wrap(width, 400)
        if y - h < bottom:
            warn.append(f"{label}: action {i} overflows bottom ({y-h:.0f} < {bottom})")
        p.drawOn(c, x, y - h)
        y -= h + 3.2
    return y


def lead_mix_line():
    leads = WK["meta"].get("leads") or []
    if not leads:
        return "<b>Lead mix:</b> not available this week."
    top = sorted(leads, key=lambda l: -l["inq"])[:2]
    s = ", ".join(f"{l['source']} {l['share']}% of guest cards ({l['show_rate']} reach a showing)" for l in top)
    best = [l for l in leads if l["inq"] >= 3 and l not in top]
    best = sorted(best, key=lambda l: -(l["show"] / max(l["inq"], 1)))[:1]
    if best and best[0]["show"] > 0:
        b = best[0]
        s += f"; {b['source']} is {b['share']}% but {b['show']} of {b['inq']} toured"
    return f"<b>Lead mix (all 3 properties):</b> {s}. Not split by property."


def make_page(c, prop, pageno, total):
    N = NARR[prop]
    overrides = {k: tuple(v) for k, v in (N.get("overrides") or {}).items()}
    pu = [u for u in units_all if u["prop"] == prop]
    n_units = len([u for u in rr if prop_of(u) == prop])
    vu = [u for u in pu if u["status"] == "Vacant-Unrented"]
    vr = [u for u in pu if u["status"] == "Vacant-Rented"]
    nu = [u for u in pu if u["status"].startswith("Notice")]
    occ = n_units - len(vu) - len(vr)
    dem = DEM[prop]
    wk_lbl = f"{datetime.strptime(WK['meta']['week_start'], '%m/%d/%Y').strftime('%-m/%-d')}-{datetime.strptime(WK['meta']['week_end'], '%m/%d/%Y').strftime('%-m/%-d')}"

    ready_vu = [u for u in vu if u["ready"]]
    not_ready = len(vu) - len(ready_vu)
    q_n = len([u for u in vu if u["far"]])
    avail_vu = [u for u in vu if u["days"] is not None and not u["far"]]
    avg_days = statistics.mean([u["days"] for u in avail_vu]) if avail_vu else 0
    oldest = max([u["days"] for u in avail_vu]) if avail_vu else 0
    lost = sum(u["lost"] for u in pu)
    lost_asof = sum(u["lost_asof"] for u in pu)
    if dem.get("lost_rent") is not None and abs(round(lost_asof) - dem["lost_rent"]) > 2:
        warn.append(f"{prop}: lost rent as of {WEEKLY_ASOF} = {lost_asof:.0f} vs weekly report {dem['lost_rent']} (tie-out failed)")
    stake = sum(u["mkt"] for u in vu if u["mkt"])

    top = H - 26
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 15)
    c.drawString(LM, top - 12, f"{prop}: Vacancy & Leasing Update")
    c.setFont("Helvetica", 7.5); c.setFillColor(GRAY)
    c.drawRightString(W - RM, top - 10, f"As of {TODAY.strftime('%b %-d, %Y')}  |  {ADDR[prop]}, Colorado Springs, CO  |  {n_units} units")
    c.setStrokeColor(INK); c.setLineWidth(0.8)
    c.line(LM, top - 18, W - RM, top - 18)

    hs = ParagraphStyle("hd", fontName="Helvetica-Bold", fontSize=8.6, leading=10.6, textColor=INK)
    p = Paragraph(N["headline"], hs)
    pw, ph = p.wrap(CW, 60)
    p.drawOn(c, LM, top - 24 - ph)
    y = top - 24 - ph - 7

    gap, nb, bh = 5, 7, 40
    bw = (CW - gap * (nb - 1)) / nb
    ready_sub = f"{not_ready} not ready" + (f" ({q_n} dated {TODAY.year + 1})" if q_n else "")
    kp = [
        ("Occupancy", f"{occ/n_units*100:.1f}%", f"{occ}/{n_units}; {dem['occ_chg']}"),
        ("Vacant, unrented", f"{len(vu)}", f"+{len(vr)} rented, +{len(nu)} on notice"),
        ("Rent-ready (unrented)", f"{len(ready_vu)} of {len(vu)}", ready_sub),
        ("Avg days vacant", f"{avg_days:.0f}", f"{len(avail_vu)} past avail. date; oldest {oldest}d"),
        ("Est. lost rent to date", usd(lost), "vacant + rented, at market"),
        ("Unrented rent at stake", usd(stake) + "/mo", "vacant unrented at market"),
        (f"Demand, wk {wk_lbl}", f"{dem['inq']}/{dem['show']}/{dem['app']}", "inquiries / showings / apps"),
    ]
    for i, (a, b, s) in enumerate(kp):
        kpi_box(c, LM + i * (bw + gap), y, bw, bh, a, b, s)
    y -= bh + 9

    c.setFont("Helvetica-Bold", 8); c.setFillColor(INK)
    c.drawString(LM, y - 7, "Units to move: vacant, rented-not-yet-moved-in, and on notice")
    y -= 11

    hdr = ["Unit", "Type", "Status", "Avail on", "Days", "Ready", "Posted", "Last rent", "Market", "Current ad", "Suggested", "Chg", "Lost rent", SINCE, "Next step"]
    cw = [38, 40, 32, 38, 32, 26, 29, 32, 32, 50, 54, 24, 34, 136]
    cw.append(CW - sum(cw))
    rows = [hdr]
    far_date = date(2100, 1, 1)
    ordered = (sorted(vu, key=lambda u: (u["days"] is None, -(u["days"] or 0), u["avail"] or far_date))
               + sorted(vr, key=lambda u: (u["days"] is None, -(u["days"] or 0), u["avail"] or far_date))
               + sorted(nu, key=lambda u: u["moveout"] or far_date))
    bold_cells = []
    for ri, u in enumerate(ordered, 1):
        step, urgent = next_step(u, overrides)
        ctext, csig = change_text(u)
        isnotice = u["status"].startswith("Notice")
        st = {"Vacant-Unrented": "Vacant", "Vacant-Rented": "Rented", "Notice-Unrented": "Notice", "Notice-Rented": "Notice-R"}.get(u["status"], u["status"][:8])
        if isnotice:
            dcol = "MO " + md(u["moveout"])
        elif u["days"] is not None:
            dcol = f"{u['days']}d"
        else:
            dcol = f"in {(u['avail'] - TODAY).days}d" if u["avail"] else "-"
        chg = "-" if u["delta"] is None else ("0" if abs(u["delta"]) <= 0.5 else f"{u['delta']:+.0f}")
        rows.append([u["unit"], u["utype"].replace(" Renovated", " Reno").replace(" Classic", " Cl"), st, mdy(u["avail"]), dcol,
                     "-" if isnotice else ("Yes" if u["ready"] else "NO"), "Yes" if u["posted"] else "NO",
                     usd(u["last_rent"]), usd(u["mkt"]), rng(u["cur_lo"], u["cur_hi"]), rng(u["sug_lo"], u["sug_hi"]),
                     chg, usd(u["lost"]) if u["lost"] else "-", ctext, step])
        if not isnotice and not u["ready"]:
            bold_cells.append((5, ri))
        if not u["posted"] and u["status"] == "Vacant-Unrented":
            bold_cells.append((6, ri))
        if urgent:
            bold_cells.append((14, ri))
        if csig:
            bold_cells.append((13, ri))
        if u["days"] is not None and u["days"] >= 45 and not isnotice:
            bold_cells.append((4, ri))
        if u["delta"] is not None and abs(u["delta"]) >= 50:
            bold_cells.append((11, ri))
        for ci, w in enumerate(cw):
            fits(str(rows[-1][ci]), w, "Helvetica-Bold" if (ci, ri) in bold_cells else "Helvetica", 6.0 if ci == 13 else 6.4, f"{prop} {u['unit']} col{ci}")
    rh = 10.2
    t = Table(rows, colWidths=cw, rowHeights=[12] + [rh] * (len(rows) - 1))
    ts = [("FONT", (0, 0), (-1, -1), "Helvetica", 6.4), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 6.4),
          ("TEXTCOLOR", (0, 0), (-1, -1), INK), ("LINEBELOW", (0, 0), (-1, 0), 0.7, INK), ("LINEBELOW", (0, 1), (-1, -1), 0.25, HAIR),
          ("LEFTPADDING", (0, 0), (-1, -1), 1.5), ("RIGHTPADDING", (0, 0), (-1, -1), 1.5),
          ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("ALIGN", (3, 0), (4, -1), "CENTER"), ("ALIGN", (5, 0), (6, -1), "CENTER"), ("ALIGN", (7, 0), (8, -1), "RIGHT"),
          ("ALIGN", (9, 0), (10, -1), "CENTER"), ("ALIGN", (11, 0), (12, -1), "RIGHT")]
    prev = None
    for ri, u in enumerate(ordered, 1):
        g = u["status"].split("-")[0] + ("R" if u["status"] == "Vacant-Rented" else "")
        if prev and prev != g:
            ts.append(("LINEABOVE", (0, ri), (-1, ri), 0.6, GRAY))
        prev = g
    ts.append(("FONT", (13, 1), (13, -1), "Helvetica", 6.0))
    for (ci, ri) in bold_cells:
        ts.append(("FONT", (ci, ri), (ci, ri), "Helvetica-Bold", 6.0 if ci == 13 else 6.4))
    t.setStyle(TableStyle(ts))
    tw, th = t.wrap(CW, 400)
    t.drawOn(c, LM, y - th)
    y -= th + 4
    c.setFont("Helvetica", 5.6); c.setFillColor(GRAY)
    c.drawString(LM, y - 5, f"Days = Available On through {fd(TODAY)}; lost rent = market / 30 x days (weekly-report method; as of {fd(WEEKLY_ASOF)} it ties to the weekly report at {usd(lost_asof)}). Bold = needs attention. MO = move-out date. "
                 "Chg = suggested minus current ad (midpoints).")
    c.drawString(LM, y - 11.5, f"Ready flag from the {fd(WEEKLY_ASOF)} rent roll; status, Available On, posting and pricing from the {fd(TODAY)} Leasing Signals export. " + (N.get("extra_notes") or ""))
    ids_now = {u["unit"] for u in pu}
    left = [k for k in LAST if prop_of(k) == prop and k not in ids_now]
    ctexts = [change_text(u)[0] for u in ordered]
    new_n = sum(1 for t_ in ctexts if t_.startswith("New"))
    chg_n = sum(1 for t_ in ctexts if t_ not in ("No change", "-") and not t_.startswith("New"))
    ltxt = []
    for k in left:
        r = rr.get(k)
        if not r:
            ltxt.append(f"{k} (not in rent roll)")
            continue
        mi, rent = dts(r.get("Move-in")), num(r.get("Rent"))
        ltxt.append(f"{k} (now {r['Status']}, move-in {md(mi) if mi else '-'}, {usd(rent) if rent else '$0 rent'})")
    if HAVE_LAST:
        summ = (f"{SINCE} report: {chg_n} of {len(ordered)} units changed, {new_n} new on the list, {len(left)} left the list" + (": " + "; ".join(ltxt) if ltxt else "") + ".")
        leg = f"'{SINCE}' column: Rdy = rent-ready, Post = posted online, Y/N = Yes/No, avail = available-on date (shown only if it moved 2+ days). Bold = status, ready or posted changed."
    else:
        summ = "No prior report was available for comparison, so the change column is blank this week."
        leg = ""
    c.drawString(LM, y - 18, summ)
    c.drawString(LM, y - 24.5, leg)
    fits(summ, CW + 3, "Helvetica", 5.6, f"{prop} summary")
    fits(leg, CW + 3, "Helvetica", 5.6, f"{prop} legend")
    y -= 34

    LW = 352
    RX = LM + LW + 16
    RW = W - RM - RX
    ts_ = type_summary(prop)
    order = sorted(ts_.keys(), key=lambda k: (-ts_[k]["units"], k))
    c.setFont("Helvetica-Bold", 8); c.setFillColor(INK)
    c.drawString(LM, y - 7, "By unit type")
    c.drawString(RX, y - 7, "What needs to happen (in priority order)")
    ybase = y - 11
    trows = [["Type", "Units", "Occ %", "Vacant", "Rented", "Notice", "Market", "In-place", "New leases*"]]
    allmi, allrent = [], []
    for k in order:
        o = ts_[k]
        mkt = statistics.mean(o["mkts"])
        inpl = statistics.mean(o["rents"]) if o["rents"] else None
        mi = f"{usd(statistics.median(o['moveins']))} ({len(o['moveins'])})" if o["moveins"] else "-"
        allmi += o["moveins"]; allrent += o["rents"]
        trows.append([k, o["units"], f"{o['occ']/o['units']*100:.0f}%", o["vu"], o["vr"], o["nu"], usd(mkt), usd(inpl), mi])
    tot_units = sum(ts_[k]["units"] for k in order)
    tot_occ = sum(ts_[k]["occ"] for k in order)
    trows.append(["Total", tot_units, f"{tot_occ/tot_units*100:.1f}%", sum(ts_[k]["vu"] for k in order), sum(ts_[k]["vr"] for k in order), sum(ts_[k]["nu"] for k in order),
                  "", usd(statistics.mean(allrent)) if allrent else "-", f"{usd(statistics.median(allmi))} ({len(allmi)})" if allmi else "-"])
    tcw = [38, 28, 32, 33, 33, 33, 40, 42, LW - (38 + 28 + 32 + 33 * 3 + 40 + 42)]
    tt = Table(trows, colWidths=tcw, rowHeights=[11] + [10.2] * (len(trows) - 1))
    tt.setStyle(TableStyle([("FONT", (0, 0), (-1, -1), "Helvetica", 6.4), ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 6.4),
                            ("FONT", (0, -1), (-1, -1), "Helvetica-Bold", 6.4), ("LINEBELOW", (0, 0), (-1, 0), 0.7, INK),
                            ("LINEBELOW", (0, 1), (-1, -2), 0.25, HAIR), ("LINEABOVE", (0, -1), (-1, -1), 0.6, INK),
                            ("LEFTPADDING", (0, 0), (-1, -1), 1.5), ("RIGHTPADDING", (0, 0), (-1, -1), 1.5),
                            ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (-1, -1), "RIGHT")]))
    tw2, th2 = tt.wrap(LW, 200)
    tt.drawOn(c, LM, ybase - th2)
    yl = ybase - th2 - 3
    c.setFont("Helvetica", 5.6); c.setFillColor(GRAY)
    c.drawString(LM, yl - 5, "Vacant = unrented. In-place = avg rent of occupied units (excl. $0 rents).")
    c.drawString(LM, yl - 11.5, f"*New leases = median rent (count) of move-ins since {fd(TAKEOVER)}/{str(TAKEOVER.year)[2:]} with a new lease.")
    yl -= 21

    c.setFont("Helvetica-Bold", 8); c.setFillColor(INK)
    c.drawString(LM, yl - 7, "Demand and pipeline")
    yl -= 11
    inq, sh, ap, apd = dem["inq"], dem["show"], dem["app"], dem["appr"]
    avail_now = len(vu) + len([u for u in nu if u["status"] == "Notice-Unrented"])
    ds = ParagraphStyle("ds", fontName="Helvetica", fontSize=6.9, leading=8.3, textColor=INK, leftIndent=7, bulletIndent=0)
    funnel = (f"<b>Funnel, wk {wk_lbl}:</b> {inq} inquiries, {sh} showings ({(sh/inq*100) if inq else 0:.0f}%), {ap} application{'s' if ap != 1 else ''}, "
              f"{apd} approved, {dem.get('den', 0)} denied, {dem.get('can', 0)} canceled. ")
    if PWK and prop in PWK["props"] and "inq" in PWK["props"][prop]:
        pd = PWK["props"][prop]
        funnel += f"Prior week: {pd['inq']} / {pd['show']} ({(pd['show']/pd['inq']*100) if pd['inq'] else 0:.0f}%) / {pd['app']} / {pd['appr']} approved. "
    elif WK["meta"].get("totals", {}).get("inq"):
        T = WK["meta"]["totals"]
        funnel += f"All 3 properties, prior week: {T['inq']['last_week']} inquiries / {T['show']['last_week']} showings / {T['app']['last_week']} apps / {T['appr']['last_week']} approved. "
    funnel += f"{avail_now} units available to lease."
    dl = [funnel, lead_mix_line(), N["pipeline"]]
    for s in dl:
        p = Paragraph(s, ds, bulletText="-")
        w_, h_ = p.wrap(LW, 100)
        p.drawOn(c, LM, yl - h_)
        yl -= h_ + 2.2
    if yl < 24:
        warn.append(f"{prop}: left column overflows ({yl:.0f})")

    st_ = ParagraphStyle("ac", fontName="Helvetica", fontSize=7, leading=8.5, textColor=INK, leftIndent=10, bulletIndent=0, bulletFontName="Helvetica-Bold", bulletFontSize=7)
    yr = draw_paras(c, N["actions"], RX, ybase - 1, RW, 24, st_, prop)

    c.setStrokeColor(HAIR); c.setLineWidth(0.5)
    c.line(LM, 20, W - RM, 20)
    c.setFont("Helvetica", 5.6); c.setFillColor(GRAY)
    c.drawString(LM, 12, f"Sources: AppFolio Leasing Signals ({fd(TODAY)}), AppFolio rent roll ({fd(WEEKLY_ASOF)}), Weekly Property Report wk of {wk_lbl}. Unit-level demand is not tracked; funnel is property-level.")
    c.drawRightString(W - RM, 12, f"{pageno} of {total}")
    return dict(prop=prop, units=n_units, occ_pct=round(occ / n_units * 100, 1), vu=len(vu), vr=len(vr), nu=len(nu), ready=len(ready_vu),
                lost=round(lost), lost_asof=round(lost_asof), stake=round(stake), avg_days=round(avg_days), rows=len(rows) - 1,
                changed=chg_n, new=new_n, left=left, y_left=round(yl), y_right=round(yr))


# ------------------------------------------------------------------ facts dump (for writing the narrative) when run with --facts
if "--facts" in sys.argv:
    facts = {}
    for prop in PROPS:
        pu = [u for u in units_all if u["prop"] == prop]
        facts[prop] = dict(weekly=DEM[prop], units=[{k: (v.isoformat() if isinstance(v, date) else v) for k, v in u.items()} for u in pu],
                           change={u["unit"]: change_text(u) for u in pu},
                           left_list=[k for k in LAST if prop_of(k) == prop and k not in {u["unit"] for u in pu}],
                           default_next_step={u["unit"]: next_step(u, {}) for u in pu},
                           by_type={k: {kk: (round(statistics.mean(vv)) if kk in ("mkts", "rents") and vv else (sorted(vv) if kk == "moveins" else vv)) for kk, vv in o.items()} for k, o in type_summary(prop).items()})
    facts["meta"] = WK["meta"]
    facts["prior_week"] = PWK["props"] if PWK else None
    print(json.dumps(facts, indent=1, default=str))
    sys.exit(0)

c = canvas.Canvas(CFG["out"], pagesize=landscape(letter))
c.setTitle(f"Vacancy & Leasing Update by Property - {TODAY.strftime('%b %-d, %Y')}")
c.setAuthor("C2 Capital Partners")
res = []
for i, prop in enumerate(PROPS, 1):
    res.append(make_page(c, prop, i, len(PROPS)))
    c.showPage()
c.save()
print(json.dumps(res, indent=1))
print("\n".join(warn) if warn else "no layout warnings")
if any("overflow" in w for w in warn):
    sys.exit(2)
