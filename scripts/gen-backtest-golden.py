"""
Generate a COMPACT real-archive golden fixture (a few tens of KB) for the BT-04
engine golden run. Flat-array bar encoding: each bar = [tsDeltaMin, o,h,l,c,v]
where tsDeltaMin is minutes since the day's 09:15 base; the base epoch-ms is
stored per day. The TS loader (golden-loader.ts) expands this back to the
canonical FixtureSnapshot. Keeps real prices (2dp) but a tiny on-disk footprint.

Golden: NIFTY weekly expiry 2024-07-25, two trade days 2024-07-24 + 2024-07-25,
ATM straddle band (atm-1..atm+1) — proves a multi-day 9:20 ATM short straddle on
a known well-covered expiry against REAL data.
"""
import json, glob, os, sys
from datetime import datetime
import pyarrow.parquet as pq

ARCHIVE = "market-data/market_archive_1m"
OUT = sys.argv[1]
STEP = 50

def ems(ts): return int(datetime.fromisoformat(ts).timestamp() * 1000)
def r2(x): return round(float(x), 2)

def day_base_ms(day):  # 09:15 IST of the day
    return ems(f"{day}T09:15:00+05:30")

def load_index_day(day):
    y, m = day[:4], day[5:7]
    t = pq.read_table(f"{ARCHIVE}/index/NIFTY/{y}/{y}-{m}.parquet").to_pydict()
    base = day_base_ms(day)
    out = []
    for i in range(len(t["timestamp"])):
        ts = t["timestamp"][i]
        if not ts.startswith(day): continue
        dmin = (ems(ts) - base) // 60000
        out.append([int(dmin), r2(t["open"][i]), r2(t["high"][i]), r2(t["low"][i]),
                    r2(t["close"][i]), r2(t["volume"][i] or 0)])
    out.sort(key=lambda b: b[0])
    return out

def load_opt_day(expiry, day, strike, ot):
    f = glob.glob(f"{ARCHIVE}/options/NIFTY/{expiry}/*-{strike}-{ot}.parquet")
    if not f: return None
    t = pq.read_table(f[0]).to_pydict()
    base = day_base_ms(day)
    out = []
    for i in range(len(t["timestamp"])):
        ts = t["timestamp"][i]
        if not ts.startswith(day): continue
        dmin = (ems(ts) - base) // 60000
        out.append([int(dmin), r2(t["open"][i]), r2(t["high"][i]), r2(t["low"][i]),
                    r2(t["close"][i]), r2(t["volume"][i] or 0)])
    out.sort(key=lambda b: b[0])
    return out

def spot_920(idx):
    for b in idx:
        if b[0] >= 5:  # 09:20 = base+5min
            return b[1]
    return idx[0][1]

def main():
    expiry = "2024-07-25"
    days = ["2024-07-24", "2024-07-25"]
    out_days = []
    for day in days:
        idx = load_index_day(day)
        atm = round(spot_920(idx) / STEP) * STEP
        # Exactly the strikes the two golden strategies need:
        #  - ATM short straddle: ATM CE + ATM PE
        #  - OTM short strangle: ATM+1 CE + ATM-1 PE
        wanted = [(atm, "CE"), (atm, "PE"), (atm + STEP, "CE"), (atm - STEP, "PE")]
        contracts = []
        for strike, ot in wanted:
            bars = load_opt_day(expiry, day, strike, ot)
            if bars:
                contracts.append({"strike": strike, "ot": ot, "bars": bars})
        out_days.append({"day": day, "expiry": expiry, "base": day_base_ms(day),
                         "index": idx, "contracts": contracts})
        print(day, "atm", atm, "contracts", len(contracts), "idx", len(idx))
    snap = {"snapshotId": "local-NIFTY-2024-07-golden-v1", "symbol": "NIFTY",
            "format": "compact-v1", "days": out_days}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        json.dump(snap, fh, separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT), "bytes")

if __name__ == "__main__":
    main()
