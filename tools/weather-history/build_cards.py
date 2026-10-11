"""
Builds the Kansas City weather-history database used by GET /api/weather/similar-days.

One "event card" per past day (2019-2024) with notable weather at the facility, i.e. any of:
  - a NOAA Storm Events report for Jackson County MO (winter or severe-storm types),
  - an NWS warning/advisory for Jackson County (county MOC095 for storms, forecast zone MOZ037 for winter),
  - a weather-related crash spike (an hour with recent precipitation and >= 4x the normal injury-crash count).

Each card stores:
  - text      the human-readable summary the AI agent reads (and that embed_cards.py embeds).
              Written in the same windows as /api/weather/forecast: overnight, morning commute,
              office hours, evening commute. No exact date in the text (it made embeddings match on the calendar).
  - features  the facts used to MATCH a forecast day to past days. The backend computes the same
              features from the forecast (Weather/SimilarDays.cs), so the definitions must stay in step:
                overnight_precip  any precipitation 6 PM (day before) - 6 AM
                morning_low_f     lowest temperature 6-9 AM
                refreeze          overnight_precip and morning_low_f <= 32
                ice               freezing rain, freezing drizzle or sleet in any window
                snow_in           new snow (KCI Airport daily total)
                low_f             lowest temperature 6 PM (day before) - 6 PM
                extreme_cold      low_f <= 0
                thunder_any       thunderstorms in any window
                thunder_commute   thunderstorms in the morning or evening commute
                severe_alert      Severe Thunderstorm or Tornado Watch/Warning that day
                tornado_alert     Tornado Watch/Warning that day
                flood_alert       Flash Flood Warning that day
                winter_warning    Winter Storm, Ice Storm or Blizzard Warning that day
                winter_advisory   Winter Weather or Freezing Rain Advisory that day
                cold_alert        Wind Chill Advisory/Warning or Extreme Cold Warning that day
                month             1-12
  - details   what happened afterwards (storm reports, injuries, crash counts), shown to the agent but not matched on.

Sources (all public): NOAA NCEI Storm Events; Iowa Environmental Mesonet (IEM) archives of NWS warnings and of
hourly observations at KC Downtown Airport (MKC); NOAA GHCN-Daily at KCI Airport (AWS Open Data);
Kansas City "Road Casualties" open data (Missouri Highway Patrol injury/fatal crash reports, 2019-2024).

Usage (from the repo root; downloads are cached in tools/weather-history/.cache, which git ignores):
    python -I tools/weather-history/build_cards.py
    python -I tools/weather-history/embed_cards.py      # optional: Titan embeddings via Bedrock
Re-running keeps existing embeddings for cards whose text didn't change.
"""
import csv, gzip, hashlib, io, json, re, sqlite3, statistics, urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

TOOL_DIR = Path(__file__).resolve().parent
CACHE = TOOL_DIR / ".cache"
REPO = TOOL_DIR.parent.parent
DB_PATH = REPO / "bbna-hackmw26.Server" / "WeatherHistory" / "kc-weather-history.db"

UA = {"User-Agent": "bbna-hackmw26/1.0"}
YEARS = range(2019, 2025)          # the years the crash data covers
COUNTY_UGC, ZONE_UGC = "MOC095", "MOZ037"
MKC, KCI = "MKC", "USW00003947"

WINTER_TYPES = {"Blizzard", "Winter Storm", "Ice Storm", "Heavy Snow", "Winter Weather", "Extreme Cold/Wind Chill", "Cold/Wind Chill", "Sleet"}
SEVERE_TYPES = {"Tornado", "Thunderstorm Wind", "Hail", "Flash Flood", "Heavy Rain", "Lightning", "Flood", "High Wind"}

# Office windows (local time; hours relative to midnight of the workday, [start, end)).
# Must match the defaults of the "Workday" section in appsettings.json.
WINDOWS = [("overnight", "Overnight (6 PM prior day - 6 AM)", -6, 6), ("morning_commute", "Morning commute (6-9 AM)", 6, 9),
           ("office_hours", "Office hours (9 AM - 4 PM)", 9, 16), ("evening_commute", "Evening commute (4-6 PM)", 16, 18)]

# NWS warning types we track, by VTEC phenomena + significance code.
WARN_NAMES = {("TO", "W"): "Tornado Warning", ("TO", "A"): "Tornado Watch", ("SV", "W"): "Severe Thunderstorm Warning",
              ("SV", "A"): "Severe Thunderstorm Watch", ("FF", "W"): "Flash Flood Warning",
              ("WS", "W"): "Winter Storm Warning", ("IS", "W"): "Ice Storm Warning", ("BZ", "W"): "Blizzard Warning",
              ("WS", "A"): "Winter Storm Watch", ("WW", "Y"): "Winter Weather Advisory", ("ZR", "Y"): "Freezing Rain Advisory",
              ("WC", "Y"): "Wind Chill Advisory", ("WC", "W"): "Wind Chill Warning", ("EC", "W"): "Extreme Cold Warning"}
SEVERE_ALERTS = {"Tornado Warning", "Tornado Watch", "Severe Thunderstorm Warning", "Severe Thunderstorm Watch"}
WINTER_WARNINGS = {"Winter Storm Warning", "Ice Storm Warning", "Blizzard Warning"}
WINTER_ADVISORIES = {"Winter Weather Advisory", "Freezing Rain Advisory"}
COLD_ALERTS = {"Wind Chill Advisory", "Wind Chill Warning", "Extreme Cold Warning"}

# Present-weather codes -> words used in the card text (checked in this order).
PHRASES = [("FZRA", "freezing rain"), ("FZDZ", "freezing drizzle"), ("PL", "sleet"), ("+SN", "heavy snow"), ("SN", "snow"),
           ("TS", "thunderstorms"), ("+RA", "heavy rain"), ("RA", "rain"), ("DZ", "drizzle"), ("GR", "hail"), ("UP", "unknown precipitation")]
ICE_WORDS = {"freezing rain", "freezing drizzle", "sleet"}
PRECIP_WORDS = {w for _, w in PHRASES}


# ------------------------------------------------------------------------------------------
# Downloads (cached)
# ------------------------------------------------------------------------------------------
def fetch(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        body = r.read()
    return body if binary else body.decode("utf-8")


def cached(name, producer):
    """Returns the cached file's text, downloading it first if it isn't cached yet."""
    path = CACHE / name
    if not path.exists():
        print(f"  downloading {name} ...")
        path.write_text(producer(), encoding="utf-8")
    return path.read_text(encoding="utf-8")


def download_storm_events():
    listing = fetch("https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/")
    rows = []
    for y in YEARS:
        name = sorted(set(re.findall(rf"StormEvents_details-ftp_v1\.0_d{y}_c\d+\.csv\.gz", listing)))[-1]
        text = gzip.decompress(fetch(f"https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/{name}", binary=True)).decode("latin-1")
        for r in csv.DictReader(io.StringIO(text)):
            if r["STATE"] == "MISSOURI" and r["CZ_NAME"].startswith("JACKSON") and r["EVENT_TYPE"] in WINTER_TYPES | SEVERE_TYPES:
                rows.append({k: r[k] for k in ("BEGIN_YEARMONTH", "BEGIN_DAY", "END_YEARMONTH", "END_DAY", "EVENT_TYPE", "EVENT_ID",
                                               "MAGNITUDE", "MAGNITUDE_TYPE", "TOR_F_SCALE", "INJURIES_DIRECT", "DEATHS_DIRECT",
                                               "BEGIN_LOCATION", "EVENT_NARRATIVE", "EPISODE_NARRATIVE")})
    return json.dumps(rows)


def download_warnings():
    events = []
    for ugc in (COUNTY_UGC, ZONE_UGC):
        for y in YEARS:
            url = f"https://mesonet.agron.iastate.edu/json/vtec_events_byugc.py?ugc={ugc}&sdate={y}-01-01&edate={y}-12-31"
            events += json.loads(fetch(url)).get("events", [])
    return json.dumps(events)


def download_hourly_obs():
    return fetch(f"https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station={MKC}&data=tmpf&data=wxcodes&data=p01i"
                 f"&year1={YEARS[0]}&month1=1&day1=1&year2={YEARS[-1] + 1}&month2=1&day2=1&tz=America%2FChicago&format=onlycomma"
                 "&latlon=no&missing=empty&trace=0.0001&report_type=3&report_type=4")


def download_crashes():
    return fetch("https://data.kcmo.org/resource/62pj-bjfw.json?$select=date_trunc_ymd(date_time)%20as%20d,"
                 "date_extract_hh(date_time)%20as%20h,count(*)%20as%20n&$group=d,h&$limit=100000")


def download_kci_daily():
    return fetch(f"https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_station/{KCI}.csv")


# ------------------------------------------------------------------------------------------
# Load sources
# ------------------------------------------------------------------------------------------
def to_local(utc_text):
    """IEM warning times are UTC; everything else is US Central time. Hour-level DST approximation."""
    t = datetime.fromisoformat(utc_text.replace("Z", "+00:00")); y = t.year
    dst_start = datetime(y, 3, 8 + (6 - datetime(y, 3, 8).weekday()) % 7, 8, tzinfo=t.tzinfo)
    dst_end = datetime(y, 11, 1 + (6 - datetime(y, 11, 1).weekday()) % 7, 7, tzinfo=t.tzinfo)
    return (t - timedelta(hours=5 if dst_start <= t < dst_end else 6)).replace(tzinfo=None)


def load_sources():
    CACHE.mkdir(exist_ok=True)

    events_on = defaultdict(list)                         # date -> Storm Events rows
    for r in json.loads(cached("storm_events_jackson.json", download_storm_events)):
        d = date(int(r["BEGIN_YEARMONTH"][:4]), int(r["BEGIN_YEARMONTH"][4:]), int(r["BEGIN_DAY"]))
        end = date(int(r["END_YEARMONTH"][:4]), int(r["END_YEARMONTH"][4:]), int(r["END_DAY"]))
        while d <= end:
            events_on[d].append(r); d += timedelta(days=1)

    warnings_on, seen = defaultdict(list), set()          # date -> [(name, start, end)]
    for e in json.loads(cached("jackson_warnings.json", download_warnings)):
        name = WARN_NAMES.get((e.get("phenomena"), e.get("significance")))
        key = (e.get("phenomena"), e.get("significance"), e.get("eventid"), e.get("issue"))
        if not name or not e.get("issue") or not e.get("expire") or key in seen:
            continue
        seen.add(key)
        start, end = to_local(e["issue"]), to_local(e["expire"])
        d = start.date()
        while d <= end.date():
            warnings_on[d].append((name, start, end)); d += timedelta(days=1)

    obs = defaultdict(lambda: {"temps": [], "codes": set(), "precip": 0.0})   # local hour -> observations
    for r in csv.DictReader(io.StringIO(cached("mkc_hourly.csv", download_hourly_obs))):
        h = datetime.strptime(r["valid"], "%Y-%m-%d %H:%M").replace(minute=0)
        if r["tmpf"]: obs[h]["temps"].append(float(r["tmpf"]))
        obs[h]["codes"].update(c for c in (r["wxcodes"] or "").split() if not c.startswith("VC"))   # VC = nearby, not at the station
        if r["p01i"]: obs[h]["precip"] = max(obs[h]["precip"], float(r["p01i"]))

    crashes = defaultdict(int)                             # local hour -> injury/fatal crashes
    for r in json.loads(cached("kc_crashes_by_hour.json", download_crashes)):
        crashes[datetime.fromisoformat(r["d"][:10]) + timedelta(hours=int(r["h"]))] += int(r["n"])

    kci = defaultdict(dict)                                # date -> measured daily values at KCI
    for row in csv.reader(io.StringIO(cached("kci_daily.csv", download_kci_daily))):
        if row[0] == "ID" or row[1] < "20181201" or row[5]:   # row[5] = quality flag (failed QC)
            continue
        d, v = datetime.strptime(row[1], "%Y%m%d").date(), int(row[3])
        if row[2] == "SNOW": kci[d]["snow_in"] = round(v / 25.4, 1)        # mm
        elif row[2] == "SNWD": kci[d]["depth_in"] = round(v / 25.4)        # mm
        elif row[2] == "PRCP": kci[d]["precip_in"] = round(v / 254, 2)     # tenths of mm
        elif row[2] == "WSF2": kci[d]["gust_mph"] = round(v / 10 * 2.23694)  # tenths of m/s
    return events_on, warnings_on, obs, crashes, kci


# ------------------------------------------------------------------------------------------
# Build
# ------------------------------------------------------------------------------------------
def main():
    events_on, warnings_on, obs, crashes, kci = load_sources()

    def wet(h, hours_back):
        """Any precipitation (or thunder) in this hour or the hours before it."""
        for k in range(hours_back + 1):
            o = obs.get(h - timedelta(hours=k))
            if o and (o["precip"] > 0 or any(p in c for c in o["codes"] for p in ("RA", "DZ", "SN", "PL", "UP", "TS"))):
                return True
        return False

    # Typical crashes per hour: average over "normal" hours (dry, no warnings) in the same year,
    # weekday-or-weekend and hour of day.
    stratum = lambda h: (h.year, h.weekday() >= 5, h.hour)
    hours_n, crash_n = defaultdict(int), defaultdict(int)
    t = datetime(YEARS[0], 1, 1)
    while t < datetime(YEARS[-1] + 1, 1, 1):
        if t in obs and not wet(t, 6) and t.date() not in warnings_on:
            hours_n[stratum(t)] += 1; crash_n[stratum(t)] += crashes.get(t, 0)
        t += timedelta(hours=1)
    typical = lambda h: crash_n[stratum(h)] / hours_n[stratum(h)] if hours_n[stratum(h)] else None

    def window(day, start, end):
        """Weather words, temperature range, precipitation and crash counts for one window of a day."""
        base = datetime(day.year, day.month, day.day)
        hours = [base + timedelta(hours=h) for h in range(start, end)]
        temps = [x for h in hours for x in obs.get(h, {}).get("temps", [])]
        codes = set().union(*(obs.get(h, {}).get("codes", set()) for h in hours))
        words = []
        for code, w in PHRASES:
            if any(code in c for c in codes) and w not in words:
                if w == "snow" and "heavy snow" in words: continue
                if w == "rain" and {"heavy rain", "freezing rain"} & set(words): continue
                words.append(w)
        crash_count = sum(crashes.get(h, 0) for h in hours)
        expected = sum(x for h in hours if (x := typical(h)) is not None)
        return {"words": words, "low_f": min(temps) if temps else None, "high_f": max(temps) if temps else None,
                "precip_in": round(sum(obs.get(h, {}).get("precip", 0) for h in hours), 2),
                "crashes": crash_count, "crashes_typical": round(expected, 1),
                "crash_ratio": round(crash_count / expected, 2) if expected else None}

    def crash_spike(day):
        base = datetime(day.year, day.month, day.day)
        for h in (base + timedelta(hours=k) for k in range(-6, 18)):
            e = typical(h)
            if e and crashes.get(h, 0) >= 4 and crashes[h] >= 4 * e and wet(h, 12):
                return True
        return False

    cards, day = [], date(YEARS[0], 1, 1)
    while day <= date(YEARS[-1], 12, 31):
        ev, warns = events_on.get(day, []), warnings_on.get(day, [])
        if not (ev or warns or crash_spike(day)):
            day += timedelta(days=1); continue

        win = {key: window(day, s, e) for key, _, s, e in WINDOWS}
        all_words = set().union(*(w["words"] for w in win.values()))
        lows = [w["low_f"] for w in win.values() if w["low_f"] is not None]
        warn_names = {w[0] for w in warns}
        types = {r["EVENT_TYPE"] for r in ev}
        k = kci.get(day, {})

        # --- Features (keep in step with Weather/SimilarDays.cs) ---
        overnight_precip = bool(set(win["overnight"]["words"]) & PRECIP_WORDS) or win["overnight"]["precip_in"] >= 0.01
        morning_low = win["morning_commute"]["low_f"]
        low_f = min(lows) if lows else None
        features = {
            "overnight_precip": overnight_precip,
            "morning_low_f": morning_low,
            "refreeze": overnight_precip and morning_low is not None and morning_low <= 32,
            "ice": bool(all_words & ICE_WORDS),
            "snow_in": k.get("snow_in", 0.0),
            "low_f": low_f,
            "extreme_cold": low_f is not None and low_f <= 0,
            "thunder_any": "thunderstorms" in all_words,
            "thunder_commute": any("thunderstorms" in win[w]["words"] for w in ("morning_commute", "evening_commute")),
            "severe_alert": bool(warn_names & SEVERE_ALERTS),
            "tornado_alert": any(n.startswith("Tornado") for n in warn_names),
            "flood_alert": "Flash Flood Warning" in warn_names,
            "winter_warning": bool(warn_names & WINTER_WARNINGS),
            "winter_advisory": bool(warn_names & WINTER_ADVISORIES),
            "cold_alert": bool(warn_names & COLD_ALERTS),
            "month": day.month,
        }
        winter = (features["snow_in"] >= 0.1 or features["ice"] or features["refreeze"] or features["extreme_cold"]
                  or features["winter_warning"] or features["winter_advisory"] or features["cold_alert"] or bool(types & WINTER_TYPES))
        storm = features["thunder_any"] or features["severe_alert"] or features["flood_alert"] or bool(types & SEVERE_TYPES)
        hazard = "winter" if winter else "severe_storm" if storm else None
        if hazard is None:                     # e.g. an ordinary rainy day: not useful for closure decisions
            day += timedelta(days=1); continue

        # --- Card text: what the agent reads ---
        kinds = [name for name, on in [
            ("refreeze", features["refreeze"]), ("ice", features["ice"]), ("snow", features["snow_in"] >= 0.1),
            ("extreme cold", features["extreme_cold"]), ("thunderstorms", features["thunder_any"]),
            ("tornado", "Tornado" in types or features["tornado_alert"]), ("hail", "Hail" in types),
            ("damaging wind", bool({"Thunderstorm Wind", "High Wind"} & types)),
            ("flooding", bool({"Flash Flood", "Flood", "Heavy Rain"} & types) or features["flood_alert"])] if on]
        lines = [f"Kansas City weather event in {day:%B} ({'workday' if day.weekday() < 5 else 'weekend'}).",
                 f"Hazard: {hazard.replace('_', ' ')}" + (f" ({', '.join(kinds)})" if kinds else "") + ".",
                 "Conditions by window (KC Downtown Airport):"]
        for key, label, _, _ in WINDOWS:
            w = win[key]
            temps = f"{w['low_f']:.0f}-{w['high_f']:.0f}°F" if w["low_f"] is not None else "temps n/a"
            precip = f", {w['precip_in']:.2f} in precip" if w["precip_in"] >= 0.01 else ""
            spike = f" ({w['crash_ratio']:.1f}x)" if w["crash_ratio"] and w["crash_ratio"] >= 1.5 and w["crashes"] >= 3 else ""
            crash = f"; injury crashes {w['crashes']} vs ~{w['crashes_typical']:.1f} typical{spike}" if w["crashes_typical"] else ""
            lines.append(f"- {label}: {', '.join(w['words']) or 'dry'}, {temps}{precip}{crash}")
        measured = ", ".join(x for x in [f"snow {k['snow_in']} in" if k.get("snow_in") else None,
                                         f"snow depth {k['depth_in']} in" if k.get("depth_in") else None,
                                         f"precip {k['precip_in']} in" if k.get("precip_in") else None,
                                         f"peak gust {k['gust_mph']} mph" if k.get("gust_mph") else None] if x)
        if measured: lines.append(f"Measured at KCI Airport: {measured}.")
        lines.append("NWS warnings/advisories for Jackson County: " +
                     ("; ".join(sorted({f"{n} {s:%a %I:%M %p} - {x:%a %I:%M %p}" for n, s, x in warns})) or "none") + ".")
        reports = []
        for r in ev:
            mag = f" {r['MAGNITUDE']} {'mph' if r['MAGNITUDE_TYPE'] in ('EG', 'MG', 'ES', 'MS') else 'in'}" if r["MAGNITUDE"] else ""
            ef = f" EF{r['TOR_F_SCALE'][-1]}" if r["TOR_F_SCALE"] else ""
            hurt = f", {r['INJURIES_DIRECT']} injured" if r["INJURIES_DIRECT"] not in ("", "0") else ""
            dead = f", {r['DEATHS_DIRECT']} killed" if r["DEATHS_DIRECT"] not in ("", "0") else ""
            reports.append(f"{r['EVENT_TYPE']}{mag}{ef}{hurt}{dead}" + (f" near {r['BEGIN_LOCATION'].title()}" if r["BEGIN_LOCATION"] else ""))
        if reports: lines.append(f"NOAA storm reports: {'; '.join(sorted(set(reports)))}.")
        # Narrative of the most serious event (a tornado's own report, not a month-long flood summary).
        priority = ["Tornado", "Ice Storm", "Blizzard", "Winter Storm", "Heavy Snow", "Thunderstorm Wind", "Hail", "Flash Flood",
                    "Extreme Cold/Wind Chill", "Winter Weather", "Heavy Rain", "High Wind", "Flood"]
        for r in sorted(ev, key=lambda r: (priority.index(r["EVENT_TYPE"]) if r["EVENT_TYPE"] in priority else 99, not r["EVENT_NARRATIVE"])):
            narrative = re.sub(r"\s+", " ", (r["EVENT_NARRATIVE"] or r["EPISODE_NARRATIVE"] or "").strip())
            if narrative:
                lines.append(f"NOAA narrative: {narrative[:700]}"); break
        text = "\n".join(lines)

        details = {
            "kinds": kinds, "warnings": sorted(warn_names), "storm_event_ids": sorted({r["EVENT_ID"] for r in ev}),
            "injured": sum(int(r["INJURIES_DIRECT"] or 0) for r in ev), "killed": sum(int(r["DEATHS_DIRECT"] or 0) for r in ev),
            "morning_commute_crash_ratio": win["morning_commute"]["crash_ratio"],
            "evening_commute_crash_ratio": win["evening_commute"]["crash_ratio"],
            "windows": win,
        }
        cards.append((f"kc-{day.isoformat()}", day.isoformat(), hazard, int(day.weekday() < 5), text,
                      json.dumps(features), json.dumps(details), hashlib.sha256(text.encode()).hexdigest()))
        day += timedelta(days=1)

    write_db(cards)
    print(f"{len(cards)} cards -> {DB_PATH.relative_to(REPO)}  |  {dict(Counter(c[2] for c in cards))}  |  "
          f"median {statistics.median(len(c[4].split()) for c in cards):.0f} words")


def write_db(cards):
    """Rewrites the cards, keeping each existing embedding whose card text is unchanged."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.executescript("""
        CREATE TABLE IF NOT EXISTS event_cards (
            id              TEXT PRIMARY KEY,   -- kc-2023-02-16
            date            TEXT NOT NULL,      -- 2023-02-16
            hazard          TEXT NOT NULL,      -- winter | severe_storm
            is_workday      INTEGER NOT NULL,
            text            TEXT NOT NULL,      -- what the agent reads and what is embedded
            features        TEXT NOT NULL,      -- JSON: the facts matched against a forecast (see top of file)
            details         TEXT NOT NULL,      -- JSON: what happened (reports, crashes, warnings); not matched on
            text_sha256     TEXT NOT NULL,
            embedding       BLOB,               -- Titan V2 vector (float32), filled in by embed_cards.py; NULL if not embedded
            embedding_model TEXT
        );
        CREATE TABLE IF NOT EXISTS build_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    kept = {r[0]: r[1:] for r in db.execute("SELECT text_sha256, embedding, embedding_model FROM event_cards WHERE embedding IS NOT NULL")}
    db.execute("DELETE FROM event_cards")
    db.executemany("INSERT INTO event_cards VALUES (?,?,?,?,?,?,?,?,?,?)",
                   [(*c, *(kept.get(c[7]) or (None, None))) for c in cards])
    db.executemany("INSERT OR REPLACE INTO build_info VALUES (?, ?)", [
        ("built_at", datetime.now().isoformat(timespec="seconds")), ("years", f"{YEARS[0]}-{YEARS[-1]}"),
        ("location", f"Kansas City, MO (county {COUNTY_UGC}, zone {ZONE_UGC}, stations {MKC} and KCI)")])
    db.commit()
    db.execute("VACUUM")
    db.close()


if __name__ == "__main__":
    main()
