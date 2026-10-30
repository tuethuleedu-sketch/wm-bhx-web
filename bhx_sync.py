#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bhx_sync.py — Kéo BHX (bhx_fetch.py) rồi gửi lên Google Apps Script (Google Sheet) cho web app.

Apps Script (gas/Code.gs → syncBhx_) so với Sheet: mở mới / đóng cửa / dời > 50 m, ghi tab
bhx_stores + bhx_changes. Lần đầu = baseline. Guard > 30% cửa hàng bị coi là đóng → từ chối.

Cấu hình (biến môi trường, hoặc file .env cạnh script — đã nằm trong .gitignore):
    GAS_URL=https://script.google.com/macros/s/…/exec
    SYNC_SECRET=...                 # in ra khi chạy setup() trong Apps Script — KHÔNG commit

Cách dùng:
    python bhx_sync.py               # fetch + sync
    python bhx_sync.py --skip-fetch  # chỉ sync từ data/bhx_stores.csv có sẵn
    python bhx_sync.py --dry-run     # tính thay đổi, không ghi

Exit code: 0 OK | 1 lỗi khác | 2 guard/schema/cấu hình | 3 mạng (giống bhx_fetch.py)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

import pandas as pd
import requests

import bhx_fetch as bf

BASE_DIR = Path(__file__).resolve().parent
log = logging.getLogger("bhx_sync")


def load_env(path: Path = BASE_DIR / ".env") -> None:
    """Đọc KEY=VALUE từ .env vào os.environ (không ghi đè biến đã có)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def province_names() -> dict[int, str]:
    try:
        r = bf.build_session().get(bf.PROVINCES_URL, timeout=(5, 60)); r.raise_for_status()
        return {int(p["id"]): p.get("name") for p in r.json()["data"]["provinces"]}
    except (requests.RequestException, ValueError, KeyError, TypeError) as e:
        log.warning("Không lấy được tên tỉnh (%s) — cột tinh để trống", e)
        return {}


def load_snapshot(path: Path, names: dict[int, str]) -> list[dict]:
    """data/bhx_stores.csv → bản ghi gửi Apps Script. Bỏ cửa hàng ảo (giống wm_bhx_match mặc định)."""
    df = pd.read_csv(path)
    if "isStoreVirtual" in df.columns:
        df = df[~df["isStoreVirtual"].fillna(False).astype(str).str.lower().isin(["true", "1"])]
    df = df.dropna(subset=["storeId", "lat", "lng"])
    return [{
        "store_id": int(r.storeId),
        "dia_chi": None if pd.isna(r.storeAddress) else str(r.storeAddress),
        "province_id": None if pd.isna(r.provinceId) else int(r.provinceId),
        "tinh": None if pd.isna(r.provinceId) else names.get(int(r.provinceId)),
        "lat": round(float(r.lat), 6), "lng": round(float(r.lng), 6),
    } for r in df.itertuples()]


def post(url: str, payload: dict) -> dict:
    """POST tới Web app. Apps Script trả 302 sang googleusercontent; requests tự theo (đổi sang GET) để lấy JSON."""
    r = requests.post(url, json=payload, timeout=(10, 300))
    if r.status_code >= 400:
        raise RuntimeError(f"Apps Script → HTTP {r.status_code}")
    try:
        j = r.json()
    except ValueError:
        raise RuntimeError("Apps Script không trả JSON — kiểm tra GAS_URL (phải là link …/exec của bản Deploy)")
    if j.get("error"):
        raise RuntimeError(f"Apps Script: {j['error']}")
    return j["data"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-fetch", action="store_true", help="Không gọi bhx_fetch, dùng data/bhx_stores.csv có sẵn")
    ap.add_argument("--dry-run", action="store_true", help="Chỉ tính thay đổi, không ghi")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    load_env()
    url, secret = os.environ.get("GAS_URL", ""), os.environ.get("SYNC_SECRET", "")
    if not (url and secret):
        log.error("Thiếu GAS_URL / SYNC_SECRET (biến môi trường hoặc .env)"); return 2

    if not a.skip_fetch:
        rc = bf.main([])
        if rc != 0:
            log.error("bhx_fetch thất bại (exit=%s) — không đồng bộ để tránh ghi dữ liệu thiếu", rc)
            return rc
    if not bf.SNAPSHOT.exists():
        log.error("Chưa có %s", bf.SNAPSHOT); return 2

    stores = load_snapshot(bf.SNAPSHOT, province_names())
    log.info("Gửi %d cửa hàng BHX lên Google Sheet%s", len(stores), " (dry-run)" if a.dry_run else "")
    try:
        res = post(url, {"action": "syncBhx", "secret": secret, "stores": stores, "dryRun": a.dry_run})
    except requests.RequestException as e:
        log.error("Lỗi mạng khi gọi Apps Script: %s", e); return 3
    except RuntimeError as e:
        log.error("%s", e); return 2
    log.info("Kết quả: %d cửa hàng · mở %s · đóng %s · dời %s%s%s", res["stores"], res["open"], res["close"], res["move"],
             " · lần đầu: ghi baseline, không tính thay đổi" if res.get("baseline") else "", " · DRY-RUN, chưa ghi" if res.get("dry_run") else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
