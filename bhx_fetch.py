#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bhx_fetch.py — BƯỚC 1: DATA INGESTION
Kéo danh sách cửa hàng Bách Hóa Xanh (BHX) trực tiếp từ JSON API (API Reverse Engineering),
không cào HTML. Kết quả: data/bhx_stores.csv (snapshot nguyên tử) + log cửa hàng mới/đóng.

Cách dùng:
    python bhx_fetch.py                         # chạy hằng ngày (dùng cache danh sách tỉnh)
    python bhx_fetch.py --probe                 # in JSON thô của 1 request để kiểm tra schema
    python bhx_fetch.py --rescan                # quét lại danh sách provinceId
    python bhx_fetch.py --provinces 1009,1010   # chỉ lấy một số tỉnh (test)

Exit code: 0 OK | 1 lỗi không xác định | 2 schema/guard lỗi | 3 lỗi mạng / tỉnh thất bại
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ─────────────────────────── CẤU HÌNH ───────────────────────────
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
LOG_DIR = BASE_DIR / "logs"

BASE_URL = "https://api.bachhoaxanh.com/gw/Location/V2/GetStoresByLocation"
# Danh sách tỉnh mới (sau sáp nhập) mà web BHX dùng cho dropdown "Tìm kiếm cửa hàng".
# Chỉ lấy provinces[].id; storeInfos trong đó lẫn cửa hàng đã đóng → không dùng làm danh sách cửa hàng.
PROVINCES_URL = "https://api.bachhoaxanh.com/gw/LocationV3/GetFull"
PAGE_SIZE = 50             # trần thật của server (29/10/2026); pageIndex tính offset theo số dòng trả về
MAX_PAGES = 100            # chốt chặn chống vòng lặp vô hạn / province
REQUEST_DELAY_S = 0.2      # nghỉ giữa các request (lịch sự với server)
WORKERS = 4                # số tỉnh chạy song song
TIMEOUT = (5, 20)          # (connect, read) giây
DEFAULT_SCAN_RANGE = (1000, 1100)   # dự phòng khi PROVINCES_URL lỗi; ID thật 29/10/2026: 1000, 1007, 1009–1033
PROVINCE_CACHE = DATA_DIR / "province_ids.json"
PROVINCE_CACHE_MAX_AGE_DAYS = 7
MIN_KEEP_RATIO = 0.70      # guard: snapshot mới < 70% snapshot cũ → không ghi đè
HEADERS_FILE = BASE_DIR / "headers.json"   # (tuỳ chọn) header copy từ DevTools nếu API đòi token

SNAPSHOT = DATA_DIR / "bhx_stores.csv"
SNAPSHOT_PREV = DATA_DIR / "bhx_stores_prev.csv"

# Schema chuẩn đầu ra (khớp các cột Column1.* trong sheet 'BHX ĐBSH' của file MASTER)
OUT_COLS = ["storeId", "lat", "lng", "storeLocation", "provinceId", "districtId",
            "wardId", "isStoreVirtual", "openHour", "storeAddress"]
# Alias để chịu được việc BHX đổi tên key nhẹ
ALIASES = {
    "storeId": ("storeId", "storeID", "id"),
    "lat": ("lat", "latitude"),
    "lng": ("lng", "lon", "long", "longitude"),
}
REQUIRED = tuple(ALIASES)

log = logging.getLogger("bhx_fetch")


class ApiSchemaError(RuntimeError):
    """API trả về cấu trúc không còn khớp kỳ vọng."""


class SnapshotGuardError(RuntimeError):
    """Dữ liệu mới bất thường (quá ít) → giữ nguyên snapshot cũ."""


# ─────────────────────────── HTTP SESSION ───────────────────────────
def build_session() -> requests.Session:
    """Session có retry/backoff cho lỗi mạng, 429 và 5xx."""
    s = requests.Session()
    retry = Retry(total=4, connect=4, read=4, status=4, backoff_factor=1.0,
                  status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=("GET",), respect_retry_after_header=True)
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=16))
    s.headers.update({
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.bachhoaxanh.com",
        "Referer": "https://www.bachhoaxanh.com/",
    })
    if HEADERS_FILE.exists():  # header bổ sung (authorization, deviceid...) nếu DevTools cho thấy cần
        try:
            s.headers.update(json.loads(HEADERS_FILE.read_text(encoding="utf-8")))
            log.info("Đã nạp header bổ sung từ %s", HEADERS_FILE.name)
        except (OSError, ValueError) as e:
            log.warning("headers.json không đọc được (%s) — bỏ qua", e)
    return s


def fetch_page(session: requests.Session, province_id: int, page_index: int,
               page_size: int = PAGE_SIZE) -> Any:
    """Gọi 1 trang API → trả JSON đã parse."""
    params = {"provinceId": province_id, "wardId": 0,
              "pageSize": page_size, "pageIndex": page_index}
    r = session.get(BASE_URL, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    try:
        return r.json()
    except ValueError as e:
        raise ApiSchemaError(
            f"Response không phải JSON (status={r.status_code}, "
            f"content-type={r.headers.get('content-type')}): {r.text[:200]!r}") from e


# ─────────────────────────── PARSE JSON ───────────────────────────
def _has_store_keys(d: dict) -> bool:
    return all(any(a in d for a in ALIASES[k]) for k in REQUIRED)


def _find_store_list(node: Any) -> tuple[list[dict] | None, bool]:
    """
    Tìm đệ quy list[dict] chứa storeId/lat/lng — không phụ thuộc tên wrapper
    ('data', 'stores', 'result'...). Trả (records, thấy_list_rỗng).
    """
    saw_empty = False
    if isinstance(node, list):
        if not node:
            return None, True
        if all(isinstance(x, dict) for x in node) and _has_store_keys(node[0]):
            return node, False
        children: Iterable = node
    elif isinstance(node, dict):
        children = node.values()
    else:
        return None, False
    for ch in children:
        found, empty = _find_store_list(ch)
        if found is not None:
            return found, False
        saw_empty = saw_empty or empty
    return None, saw_empty


def extract_records(payload: Any, *, context: str = "") -> list[dict]:
    """Trả list cửa hàng của 1 trang; [] nếu trang rỗng; raise ApiSchemaError nếu lệch schema."""
    records, saw_empty = _find_store_list(payload)
    if records is not None:
        return records
    if saw_empty:
        return []
    _dump_raw(payload, context)
    raise ApiSchemaError(f"Không tìm thấy danh sách cửa hàng (storeId/lat/lng) trong JSON [{context}]. "
                         f"Raw đã lưu trong logs/ — chạy --probe để xem cấu trúc mới.")


def normalize(records: list[dict]) -> pd.DataFrame:
    """Chuẩn hoá key theo OUT_COLS, ép kiểu số."""
    rows = []
    for rec in records:
        row = {c: rec.get(c) for c in OUT_COLS}
        for std, alts in ALIASES.items():
            if row.get(std) is None:
                row[std] = next((rec[a] for a in alts if a in rec), None)
        rows.append(row)
    df = pd.DataFrame(rows, columns=OUT_COLS)
    for c in ("storeId", "provinceId", "districtId", "wardId"):
        df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")
    for c in ("lat", "lng"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def _dump_raw(payload: Any, context: str) -> None:
    try:
        LOG_DIR.mkdir(exist_ok=True)
        p = LOG_DIR / f"raw_{datetime.now():%Y%m%d_%H%M%S}.json"
        p.write_text(json.dumps(payload, ensure_ascii=False, indent=2)[:200_000], encoding="utf-8")
        log.error("Đã lưu raw JSON lỗi: %s", p)
    except OSError:
        pass


# ─────────────────────────── FETCH THEO TỈNH ───────────────────────────
def fetch_province(session: requests.Session, province_id: int,
                   page_size: int = PAGE_SIZE) -> pd.DataFrame:
    """
    Phân trang đến hết. Điều kiện dừng: trang rỗng HOẶC trang không có storeId mới
    (an toàn nếu server tự hạ pageSize hoặc lặp lại trang cuối).
    """
    seen: set = set()
    frames: list[pd.DataFrame] = []
    for page in range(MAX_PAGES):
        payload = fetch_page(session, province_id, page, page_size)
        recs = extract_records(payload, context=f"province={province_id} page={page}")
        if not recs:
            break
        df = normalize(recs)
        fresh = df[~df["storeId"].isin(seen)]
        if fresh.empty:
            break
        seen.update(fresh["storeId"].dropna().tolist())
        frames.append(fresh)
        time.sleep(REQUEST_DELAY_S)
    else:
        log.warning("province=%s chạm MAX_PAGES=%s — kiểm tra điều kiện dừng", province_id, MAX_PAGES)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=OUT_COLS)


def fetch_all(session: requests.Session, province_ids: list[int],
              workers: int = WORKERS) -> tuple[pd.DataFrame, list[int]]:
    """Chạy song song theo tỉnh. Trả (df, danh_sách_tỉnh_thất_bại)."""
    frames, failed = [], []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch_province, session, pid): pid for pid in province_ids}
        for fut in as_completed(futs):
            pid = futs[fut]
            try:
                df = fut.result()
                log.info("province=%s → %d cửa hàng", pid, len(df))
                frames.append(df)
            except ApiSchemaError:
                raise                                   # lỗi schema: dừng toàn bộ, không ghi đè dữ liệu
            except requests.RequestException as e:
                log.error("province=%s thất bại sau retry: %s", pid, e)
                failed.append(pid)
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=OUT_COLS)
    return df, failed


# ─────────────────────────── DANH SÁCH TỈNH ───────────────────────────
def scan_provinces(session: requests.Session, lo: int, hi: int) -> list[int]:
    """Dò provinceId nào có cửa hàng (probe pageSize=1). 4xx = id không tồn tại."""
    def probe(pid: int) -> int | None:
        try:
            recs = extract_records(fetch_page(session, pid, 0, 1), context=f"scan {pid}")
            time.sleep(REQUEST_DELAY_S / 2)
            return pid if recs else None
        except requests.HTTPError as e:
            if e.response is not None and 400 <= e.response.status_code < 500:
                return None
            raise
        except ApiSchemaError:
            return None                                # id không hợp lệ có thể trả JSON khác dạng

    with ThreadPoolExecutor(max_workers=8) as ex:
        found = sorted(p for p in ex.map(probe, range(lo, hi)) if p is not None)
    log.info("Quét provinceId %d–%d → %d tỉnh có cửa hàng", lo, hi - 1, len(found))
    return found


def fetch_province_list(session: requests.Session) -> list[int]:
    """Lấy provinceId từ endpoint danh sách tỉnh của BHX. Lỗi mạng/schema → [] để caller quét dự phòng."""
    try:
        r = session.get(PROVINCES_URL, timeout=(5, 60))
        r.raise_for_status()
        ids = sorted({int(p["id"]) for p in r.json()["data"]["provinces"]})
    except (requests.RequestException, ValueError, KeyError, TypeError) as e:
        log.warning("Không lấy được danh sách tỉnh từ %s (%s) — chuyển sang quét dải", PROVINCES_URL, e)
        return []
    log.info("Danh sách tỉnh từ API: %d tỉnh %s", len(ids), ids)
    return ids


def resolve_provinces(session: requests.Session, args: argparse.Namespace) -> list[int]:
    """Ưu tiên: --provinces > cache còn hạn > endpoint danh sách tỉnh > quét dải."""
    if args.provinces:
        return [int(x) for x in args.provinces.split(",") if x.strip()]
    if PROVINCE_CACHE.exists() and not args.rescan:
        age_days = (time.time() - PROVINCE_CACHE.stat().st_mtime) / 86400
        if age_days <= PROVINCE_CACHE_MAX_AGE_DAYS:
            ids = json.loads(PROVINCE_CACHE.read_text(encoding="utf-8"))
            if ids:
                return ids
    ids = fetch_province_list(session)
    if not ids:
        lo, hi = args.scan_range
        ids = scan_provinces(session, lo, hi)
    if not ids:
        raise ApiSchemaError("Quét provinceId không ra tỉnh nào — kiểm tra dải --scan-range / endpoint / header.")
    PROVINCE_CACHE.write_text(json.dumps(ids), encoding="utf-8")
    return ids


# ─────────────────────────── SNAPSHOT ───────────────────────────
def save_snapshot(df: pd.DataFrame, min_ratio: float = MIN_KEEP_RATIO) -> None:
    """Ghi nguyên tử + guard + báo cáo cửa hàng mới/đóng so với snapshot trước."""
    DATA_DIR.mkdir(exist_ok=True)

    dup = df[df.duplicated("storeId", keep=False)]
    if not dup.empty:   # chỉ gắn cờ + giữ bản đầu (trùng do phân trang); chi tiết ghi ra file QA
        dup.to_csv(DATA_DIR / "qa_bhx_duplicates.csv", index=False, encoding="utf-8-sig")
        log.warning("Có %d dòng trùng storeId → xem data/qa_bhx_duplicates.csv (giữ bản đầu)", len(dup))
        df = df.drop_duplicates("storeId", keep="first")

    if SNAPSHOT.exists():
        prev = pd.read_csv(SNAPSHOT, usecols=["storeId", "storeAddress"])
        if len(df) < len(prev) * min_ratio:
            raise SnapshotGuardError(
                f"Snapshot mới {len(df)} dòng < {min_ratio:.0%} snapshot cũ ({len(prev)}) — "
                f"không ghi đè. Kiểm tra API/mạng.")
        new_ids = set(df["storeId"]) - set(prev["storeId"])
        closed = set(prev["storeId"]) - set(df["storeId"])
        log.info("So với lần trước: +%d cửa hàng mới, -%d không còn trong API", len(new_ids), len(closed))
        if new_ids:
            df[df["storeId"].isin(new_ids)].to_csv(
                DATA_DIR / f"bhx_new_stores_{datetime.now():%Y%m%d}.csv", index=False, encoding="utf-8-sig")
        shutil.copy2(SNAPSHOT, SNAPSHOT_PREV)

    tmp = SNAPSHOT.with_suffix(".tmp")
    df.sort_values("storeId").to_csv(tmp, index=False, encoding="utf-8-sig")
    os.replace(tmp, SNAPSHOT)          # nguyên tử: Power BI/Excel không bao giờ đọc file nửa chừng
    log.info("Đã ghi %s (%d cửa hàng)", SNAPSHOT.name, len(df))


# ─────────────────────────── PROBE & CLI ───────────────────────────
def probe(session: requests.Session, province_id: int) -> int:
    """In JSON thô + cấu trúc phát hiện được — dùng khi API đổi."""
    payload = fetch_page(session, province_id, 0, 2)
    print(json.dumps(payload, ensure_ascii=False, indent=2)[:3000])
    recs, _ = _find_store_list(payload)
    print("\n→ Tìm thấy list cửa hàng:", bool(recs), "| keys:", sorted(recs[0]) if recs else "—")
    return 0


def setup_logging() -> None:
    LOG_DIR.mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(LOG_DIR / "bhx_fetch.log", encoding="utf-8")])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Kéo danh sách cửa hàng BHX từ API")
    ap.add_argument("--provinces", help="Danh sách provinceId, ví dụ 1009,1010 (bỏ trống = tự dò)")
    ap.add_argument("--rescan", action="store_true", help="Bỏ cache, lấy lại danh sách provinceId")
    ap.add_argument("--scan-range", nargs=2, type=int, default=DEFAULT_SCAN_RANGE, metavar=("LO", "HI"))
    ap.add_argument("--probe", action="store_true", help="In JSON thô của 1 request rồi thoát")
    ap.add_argument("--probe-province", type=int, default=1027)
    a = ap.parse_args(argv)

    setup_logging()
    session = build_session()
    try:
        if a.probe:
            return probe(session, a.probe_province)
        pids = resolve_provinces(session, a)
        df, failed = fetch_all(session, pids)
        if failed:   # thiếu tỉnh = mất cửa hàng âm thầm → KHÔNG ghi đè snapshot
            log.error("Thất bại %d tỉnh %s — giữ nguyên snapshot cũ", len(failed), failed)
            return 3
        if df.empty:
            raise ApiSchemaError("Không lấy được cửa hàng nào.")
        save_snapshot(df)
        return 0
    except (ApiSchemaError, SnapshotGuardError) as e:
        log.error("%s", e)
        return 2
    except requests.RequestException as e:
        log.error("Lỗi mạng/HTTP: %s", e)
        return 3
    except Exception:                                   # noqa: BLE001 — chốt chặn cuối cho batch
        log.exception("Lỗi không xác định")
        return 1


if __name__ == "__main__":
    sys.exit(main())
