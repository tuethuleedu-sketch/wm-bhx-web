# -*- coding: utf-8 -*-
"""
Self-test: dựng mock API local (dữ liệu lấy từ sheet 'BHX ĐBSH' của MASTER) để kiểm tra
phân trang, retry, đổi schema, guard snapshot, phát hiện cửa hàng mới + benchmark BallTree.

Chạy:  python tests/test_pipeline.py --master "đường dẫn MASTER.xlsx"
"""
import argparse, json, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import bhx_fetch as bf
import wm_bhx_match as gm

STATE = {"stores": {}, "cap": 10, "mode": "ok", "fail_once": set(), "calls": 0, "prov_list": False}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        STATE["calls"] += 1
        if urlparse(self.path).path.endswith("/GetFull"):   # endpoint danh sách tỉnh
            if not STATE["prov_list"]:
                self.send_response(404); self.end_headers(); return
            body = json.dumps({"code": 0, "data": {"provinces": [{"id": p, "wards": []} for p in STATE["stores"]]}}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(body); return
        q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
        pid, size, page = int(q["provinceId"]), int(q["pageSize"]), int(q["pageIndex"])
        if pid not in STATE["stores"]:                      # tỉnh không tồn tại
            self.send_response(400); self.end_headers(); return
        if (pid, page) in STATE["fail_once"]:               # lỗi 503 tạm thời → phải được retry
            STATE["fail_once"].discard((pid, page))
            self.send_response(503); self.end_headers(); return
        size = min(size, STATE["cap"])                      # server tự hạ pageSize
        rows = STATE["stores"][pid][page * size:(page + 1) * size]
        if STATE["mode"] == "alias":                        # đổi tên key lat/lng → alias phải hấp thụ
            rows = [{("latitude" if k == "lat" else "longitude" if k == "lng" else k): v for k, v in r.items()} for r in rows]
        if STATE["mode"] == "broken":                       # đổi hẳn schema → phải báo lỗi, không ghi đè
            rows = [{"id_x": r["storeId"], "pos": [r["lat"], r["lng"]]} for r in rows] or [{"id_x": 0, "pos": [0, 0]}]
        body = json.dumps({"code": 0, "data": {"total": len(STATE["stores"][pid]), "items": rows}}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(body)


def main(master: str):
    raw = pd.read_excel(master, sheet_name="BHX ĐBSH")
    raw.columns = [c.replace("Column1.", "") for c in raw.columns]
    for pid, g in raw.groupby("provinceId"):
        STATE["stores"][int(pid)] = g.to_dict("records")
    total = len(raw)

    srv = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tmp = Path(tempfile.mkdtemp())
    bf.BASE_URL = f"http://127.0.0.1:{srv.server_port}/gw/Location/V2/GetStoresByLocation"
    bf.PROVINCES_URL = f"http://127.0.0.1:{srv.server_port}/gw/LocationV3/GetFull"
    bf.DATA_DIR, bf.LOG_DIR = tmp / "data", tmp / "logs"
    bf.SNAPSHOT, bf.SNAPSHOT_PREV = bf.DATA_DIR / "s.csv", bf.DATA_DIR / "s_prev.csv"
    bf.PROVINCE_CACHE = bf.DATA_DIR / "p.json"
    bf.REQUEST_DELAY_S = 0
    bf.DATA_DIR.mkdir(); bf.LOG_DIR.mkdir()
    _orig = bf.build_session
    def sess():
        s = _orig(); s.mount("http://", s.get_adapter("https://")); s.trust_env = False; return s
    bf.build_session = sess

    # 1) Happy path: server cap 10/trang, 1 lỗi 503 tạm thời; endpoint danh sách tỉnh 404 → quét 1000-1030
    STATE["fail_once"].add((1010, 1))
    rc = bf.main(["--scan-range", "1000", "1030"])
    df = pd.read_csv(bf.SNAPSHOT)
    assert rc == 0 and len(df) == total and df.storeId.is_unique, (rc, len(df), total)
    assert json.loads(bf.PROVINCE_CACHE.read_text()) == sorted(STATE["stores"]), "cache tỉnh sai"
    print(f"[OK] phân trang cap=10 + retry 503 + quét dự phòng: {len(df)}/{total} cửa hàng")

    # 1b) Endpoint danh sách tỉnh hoạt động → không quét dải (dải sai cũng không ảnh hưởng)
    STATE["prov_list"] = True
    calls0 = STATE["calls"]
    assert bf.main(["--rescan", "--scan-range", "5000", "5001"]) == 0
    assert json.loads(bf.PROVINCE_CACHE.read_text()) == sorted(STATE["stores"]), "cache tỉnh sai"
    assert STATE["calls"] - calls0 == 1 + sum(-(-len(v) // STATE["cap"]) + 1 for v in STATE["stores"].values())
    print("[OK] danh sách tỉnh lấy từ GetFull, không quét dải")

    # 2) Đổi tên key lat/lng → alias hấp thụ
    STATE["mode"] = "alias"
    assert bf.main([]) == 0 and len(pd.read_csv(bf.SNAPSHOT)) == total
    print("[OK] alias latitude/longitude được chuẩn hoá")

    # 3) Đổi schema hoàn toàn → exit 2, snapshot cũ nguyên vẹn
    before = bf.SNAPSHOT.read_bytes()
    STATE["mode"] = "broken"
    assert bf.main([]) == 2 and bf.SNAPSHOT.read_bytes() == before
    assert list(bf.LOG_DIR.glob("raw_*.json")), "không dump raw"
    print("[OK] schema đổi → exit 2, snapshot không bị ghi đè, raw JSON được lưu")

    # 4) Guard: chỉ trả 1 tỉnh (mất >30%) → không ghi đè
    STATE["mode"] = "ok"
    saved = dict(STATE["stores"]); ranked = sorted(saved, key=lambda k: -len(saved[k])); big = ranked[0]
    STATE["stores"] = {k: v for k, v in saved.items() if k not in ranked[:2]}   # mất 2 tỉnh lớn nhất (~47%)
    (bf.DATA_DIR / "p.json").write_text(json.dumps(sorted(STATE["stores"])))
    assert bf.main([]) == 2 and bf.SNAPSHOT.read_bytes() == before
    print("[OK] guard 70% chặn snapshot thiếu dữ liệu")

    # 5) Phát hiện cửa hàng mới
    STATE["stores"] = {k: list(v) for k, v in saved.items()}
    new = dict(STATE["stores"][big][0]); new["storeId"] = 99999
    STATE["stores"][big].append(new)
    (bf.DATA_DIR / "p.json").write_text(json.dumps(sorted(STATE["stores"])))
    assert bf.main([]) == 0 and len(pd.read_csv(bf.SNAPSHOT)) == total + 1
    assert list(bf.DATA_DIR.glob("bhx_new_stores_*.csv")), "không ghi file cửa hàng mới"
    print("[OK] phát hiện +1 cửa hàng mới → bhx_new_stores_*.csv")

    # 6) Benchmark BallTree: 3.500 WM+ × 2.500 BHX, rải trong lãnh thổ VN
    rng = np.random.default_rng(7)
    mk = lambda n: pd.DataFrame({"ma": np.arange(n), "ten": "x", "tinh": "x", "dia_chi": "x",
                                 "lat": rng.uniform(9, 21.5, n), "lng": rng.uniform(103, 109.3, n)})
    wm, bhx = mk(3500), mk(2500)
    for eng in ("balltree", "ckdtree"):
        t = time.perf_counter(); p, s = gm.find_neighbors(wm, bhx, 20, eng); dt = time.perf_counter() - t
        print(f"[BENCH] {eng}: 3500×2500 (8,75M cặp), R=20km → {len(p):,} cặp trong {dt:.3f}s")
        assert dt < 2
    # đối chiếu brute-force haversine trên mẫu 200 WM+
    sub = wm.iloc[:200]
    p, _ = gm.find_neighbors(sub, bhx, 20, "balltree")
    la1, lo1 = np.radians(sub[["lat", "lng"]].to_numpy().T); la2, lo2 = np.radians(bhx[["lat", "lng"]].to_numpy().T)
    a = np.sin((la2 - la1[:, None]) / 2) ** 2 + np.cos(la1[:, None]) * np.cos(la2) * np.sin((lo2 - lo1[:, None]) / 2) ** 2
    D = 2 * gm.EARTH_R_KM * np.arcsin(np.sqrt(a))
    assert int((D <= 20).sum()) == len(p), "số cặp khác brute-force"
    print("[OK] số cặp BallTree == brute-force haversine (200 WM+ × 2500 BHX)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--master", required=True)
    main(ap.parse_args().master)
