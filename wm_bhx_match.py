#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
wm_bhx_match.py — BƯỚC 2 + 3: GEOSPATIAL PROCESSING & OUTPUT
Tìm mọi cửa hàng BHX nằm trong bán kính `xx` quanh từng cửa hàng WM+ bằng BallTree (haversine),
không dùng vòng lặp cross-join.

Ví dụ:
    python wm_bhx_match.py --wm-file MASTER.xlsx --wm-sheet "MnM ĐBSH" --radius 1.5
    python wm_bhx_match.py --wm-file MASTER.xlsx --radius 500 --unit m --province "Hải Phòng,Bắc Ninh"
    python wm_bhx_match.py --wm-file MASTER.xlsx --radius 5 --wide   # + file dạng MASTER (5 BHX gần nhất/hàng)

Khuyến nghị cho Power BI: chạy với bán kính LỚN NHẤT cần dùng (R_max, vd 5 km) rồi để slicer/What-if
lọc `Khoảng cách (km) <= xx` — không phải tính lại.
"""
from __future__ import annotations

import argparse
import logging
import re
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from sklearn.neighbors import BallTree
except ImportError:                                   # fallback không cần scikit-learn
    BallTree = None
from scipy.spatial import cKDTree

BASE_DIR = Path(__file__).resolve().parent
OUT_DIR = BASE_DIR / "output"
DATA_DIR = BASE_DIR / "data"
EARTH_R_KM = 6371.0088
VN_BBOX = (8.0, 24.5, 102.0, 110.0)                   # lat_min, lat_max, lng_min, lng_max

# Tên cột có thể gặp ở file WM+ — lấy cột đầu tiên tồn tại VÀ có dữ liệu
WM_COLS = {
    "ma":   ["Mã WM+", "Mã CH", "Mã SAP", "Code"],
    "ten":  ["Tên WM+", "Tên CH", "Tên cửa hàng", "Store Name"],
    "tinh": ["Tỉnh mới", "Tỉnh/Thành", "Tỉnh/TP", "Tỉnh/TP cũ trước 1/7", "Tỉnh"],
    "lat":  ["Latitude", "Vĩ độ", "Lat"],
    "lng":  ["Longitude", "Kinh độ", "Lng", "Long"],
}
OUT_LONG = ["Mã WM+", "Tên WM+", "Tỉnh", "Mã BHX lân cận", "Địa chỉ BHX", "Khoảng cách (km)",
            "Lat BHX", "Lng BHX"]                       # toạ độ thêm cuối → không xô cột cũ; cho visual Map

log = logging.getLogger("wm_bhx_match")


# ─────────────────────────── LOAD & CLEAN ───────────────────────────
def _pick(df: pd.DataFrame, cands: list[str], key: str, required: bool = True) -> str | None:
    for c in cands:
        if c in df.columns and df[c].notna().any():
            return c
    if required:
        raise KeyError(f"Không tìm thấy cột '{key}' trong file (đã thử: {cands}). Sửa WM_COLS đầu file.")
    return None


def _read_table(path: Path, sheet: str | None, key_cols: list[str]) -> pd.DataFrame:
    """Đọc csv/xlsx; với xlsx tự dò dòng tiêu đề (file MASTER có nhóm nhãn ở dòng 1, header thật ở dòng 2):
    chọn dòng trong 8 dòng đầu khớp NHIỀU tên cột nhất."""
    if path.suffix.lower() in (".csv", ".txt"):
        return pd.read_csv(path, encoding="utf-8-sig")
    head = pd.read_excel(path, sheet_name=sheet or 0, header=None, nrows=8)
    keys = set(key_cols)
    scores = head.apply(lambda r: sum(str(v) in keys for v in r), axis=1)
    if scores.max() < 2:
        raise ValueError(f"Không dò được dòng tiêu đề trong {path.name} (sheet={sheet})")
    return pd.read_excel(path, sheet_name=sheet or 0, header=int(scores.idxmax()))


def _clean_coords(df: pd.DataFrame, lat: str, lng: str, tag: str) -> pd.DataFrame:
    """Loại dòng thiếu/ngoài lãnh thổ VN — KHÔNG xoá âm thầm: ghi toàn bộ dòng bị loại ra file QA."""
    df[lat] = pd.to_numeric(df[lat], errors="coerce")
    df[lng] = pd.to_numeric(df[lng], errors="coerce")
    a, b, c, d = VN_BBOX
    ok = df[lat].between(a, b) & df[lng].between(c, d)
    if (~ok).any():
        OUT_DIR.mkdir(exist_ok=True)
        p = OUT_DIR / f"qa_{tag}_toa_do_loi.csv"
        df[~ok].to_csv(p, index=False, encoding="utf-8-sig")
        log.warning("[%s] %d dòng tọa độ thiếu/ngoài VN bị loại khỏi tính toán → %s", tag, (~ok).sum(), p.name)
    return df[ok].copy()


def load_wm(path: Path, sheet: str | None = None) -> pd.DataFrame:
    """Chuẩn hoá WM+ → cột: ma, ten, tinh, lat, lng."""
    raw = _read_table(path, sheet, [c for v in WM_COLS.values() for c in v])
    lat, lng = _pick(raw, WM_COLS["lat"], "lat"), _pick(raw, WM_COLS["lng"], "lng")
    ma, tinh = _pick(raw, WM_COLS["ma"], "ma"), _pick(raw, WM_COLS["tinh"], "tinh")
    ten = _pick(raw, WM_COLS["ten"], "ten", required=False)
    if ten is None:
        log.warning("File WM+ không có cột Tên cửa hàng → dùng Mã làm Tên")
    log.info("WM+: ma='%s' ten='%s' tinh='%s' lat='%s' lng='%s'", ma, ten, tinh, lat, lng)

    df = pd.DataFrame({"ma": raw[ma], "ten": raw[ten] if ten else raw[ma],
                       "tinh": raw[tinh], "lat": raw[lat], "lng": raw[lng]})
    dup = df[df.duplicated("ma", keep=False)]
    if not dup.empty:                                  # chỉ cảnh báo vị trí, không tự xoá
        OUT_DIR.mkdir(exist_ok=True)
        dup.to_csv(OUT_DIR / "qa_wm_trung_ma.csv", index=False, encoding="utf-8-sig")
        log.warning("WM+ có %d dòng trùng Mã (chưa xoá) → output/qa_wm_trung_ma.csv", len(dup))
    return _clean_coords(df.dropna(subset=["ma"]), "lat", "lng", "wm").reset_index(drop=True)


def load_bhx(path: Path, sheet: str | None = None, include_virtual: bool = False) -> pd.DataFrame:
    """Đọc snapshot BHX (csv từ bhx_fetch.py hoặc sheet có tiền tố 'Column1.' của Power Query)."""
    raw = _read_table(path, sheet, ["storeId", "lat", "lng", "Column1.storeId", "Column1.lat", "Column1.lng"])
    raw.columns = [str(c).replace("Column1.", "") for c in raw.columns]
    missing = {"storeId", "lat", "lng"} - set(raw.columns)
    if missing:
        raise KeyError(f"File BHX thiếu cột {missing}; cột hiện có: {list(raw.columns)}")
    if "isStoreVirtual" in raw.columns and not include_virtual:
        v = raw["isStoreVirtual"].astype(str).str.lower().eq("true")
        if v.any():
            log.warning("Loại %d cửa hàng ảo (isStoreVirtual=True) — dùng --include-virtual để giữ", v.sum())
        raw = raw[~v]
    addr = raw["storeAddress"] if "storeAddress" in raw.columns else raw.get("storeLocation", "")
    df = pd.DataFrame({"ma": raw["storeId"], "dia_chi": addr, "lat": raw["lat"], "lng": raw["lng"]})
    return _clean_coords(df.dropna(subset=["ma"]), "lat", "lng", "bhx").reset_index(drop=True)


# ─────────────────────────── SPATIAL INDEX ───────────────────────────
def _xyz(rad: np.ndarray) -> np.ndarray:
    """(lat, lng) radian → toạ độ 3D trên cầu đơn vị (cho cKDTree)."""
    la, lo = rad[:, 0], rad[:, 1]
    return np.column_stack((np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)))


class GeoIndex:
    """Chỉ mục không gian trên tập BHX. engine = 'balltree' (haversine) | 'ckdtree' (chord 3D)."""

    def __init__(self, bhx_rad: np.ndarray, engine: str = "balltree"):
        if engine == "balltree" and BallTree is None:
            log.warning("Không có scikit-learn → chuyển sang cKDTree")
            engine = "ckdtree"
        self.engine, self.bhx_rad = engine, bhx_rad
        if engine == "balltree":
            self.tree = BallTree(bhx_rad, metric="haversine", leaf_size=40)
        else:
            self.bhx_xyz = _xyz(bhx_rad)
            self.tree = cKDTree(self.bhx_xyz)

    def radius(self, wm_rad: np.ndarray, radius_km: float):
        """Trả (wm_idx, bhx_idx, dist_km) phẳng — vectorized, không loop theo cặp."""
        r = radius_km / EARTH_R_KM
        if self.engine == "balltree":
            ind, dist = self.tree.query_radius(wm_rad, r=r, return_distance=True)
            counts = np.fromiter((len(a) for a in ind), dtype=np.int64, count=len(ind))
            bhx_idx = np.concatenate(ind).astype(np.int64) if counts.sum() else np.empty(0, np.int64)
            d_km = (np.concatenate(dist) if counts.sum() else np.empty(0)) * EARTH_R_KM
        else:
            wm_xyz = _xyz(wm_rad)
            ind = self.tree.query_ball_point(wm_xyz, r=2 * np.sin(r / 2))     # r góc → độ dài dây cung
            counts = np.fromiter((len(a) for a in ind), dtype=np.int64, count=len(ind))
            bhx_idx = (np.fromiter((j for a in ind for j in a), dtype=np.int64, count=int(counts.sum()))
                       if counts.sum() else np.empty(0, np.int64))
            wm_idx_tmp = np.repeat(np.arange(len(ind)), counts)
            chord = np.linalg.norm(wm_xyz[wm_idx_tmp] - self.bhx_xyz[bhx_idx], axis=1)
            d_km = 2 * np.arcsin(np.clip(chord / 2, 0, 1)) * EARTH_R_KM
        wm_idx = np.repeat(np.arange(len(counts)), counts)
        order = np.lexsort((d_km, wm_idx))                                  # theo WM+, gần → xa
        return wm_idx[order], bhx_idx[order], d_km[order]

    def nearest(self, wm_rad: np.ndarray):
        """BHX gần nhất cho MỌI WM+ (kể cả khi ngoài bán kính) → (idx, km)."""
        if self.engine == "balltree":
            d, i = self.tree.query(wm_rad, k=1)
            return i[:, 0], d[:, 0] * EARTH_R_KM
        wm_xyz = _xyz(wm_rad)
        chord, i = self.tree.query(wm_xyz, k=1)
        return i, 2 * np.arcsin(np.clip(chord / 2, 0, 1)) * EARTH_R_KM


# ─────────────────────────── CORE API ───────────────────────────
def find_neighbors(wm: pd.DataFrame, bhx: pd.DataFrame, radius_km: float,
                   engine: str = "balltree") -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Trả (pairs, summary):
      pairs   — [Mã WM+, Tên WM+, Tỉnh, Mã BHX lân cận, Địa chỉ BHX, Khoảng cách (km)]
      summary — mỗi WM+ 1 dòng: số BHX trong bán kính + BHX gần nhất (kể cả WM+ không có BHX nào trong bán kính)
    """
    if radius_km <= 0:
        raise ValueError("radius phải > 0")
    if wm.empty or bhx.empty:
        raise ValueError(f"Thiếu dữ liệu: WM+={len(wm)} dòng, BHX={len(bhx)} dòng")

    wm_rad = np.radians(wm[["lat", "lng"]].to_numpy(dtype="float64"))
    bhx_rad = np.radians(bhx[["lat", "lng"]].to_numpy(dtype="float64"))
    idx = GeoIndex(bhx_rad, engine)
    wi, bi, d = idx.radius(wm_rad, radius_km)

    pairs = pd.DataFrame({
        "Mã WM+": wm["ma"].to_numpy()[wi],
        "Tên WM+": wm["ten"].to_numpy()[wi],
        "Tỉnh": wm["tinh"].to_numpy()[wi],
        "Mã BHX lân cận": bhx["ma"].to_numpy()[bi],
        "Địa chỉ BHX": bhx["dia_chi"].to_numpy()[bi],
        "Khoảng cách (km)": np.round(d, 3),
        "Lat BHX": bhx["lat"].round(6).to_numpy()[bi],
        "Lng BHX": bhx["lng"].round(6).to_numpy()[bi],
    }, columns=OUT_LONG)

    ni, nd = idx.nearest(wm_rad)
    summary = pd.DataFrame({
        "Mã WM+": wm["ma"], "Tên WM+": wm["ten"], "Tỉnh": wm["tinh"],
        "Bán kính (km)": radius_km,                                   # tên cột cố định → schema Power BI ổn định
        "Số BHX trong bán kính": np.bincount(wi, minlength=len(wm)),
        "Mã BHX gần nhất": bhx["ma"].to_numpy()[ni],
        "BHX gần nhất (km)": np.round(nd, 3),
        "Lat WM+": wm["lat"].round(6), "Lng WM+": wm["lng"].round(6),   # thêm cuối → không xô cột cũ; cho visual Map
    })
    return pairs, summary


def to_master_wide(pairs: pd.DataFrame, k: int = 5) -> pd.DataFrame:
    """Pivot về dạng MASTER: mỗi WM+ 1 dòng, khối BHX_1..BHX_k cho Code / Address / Distance."""
    p = pairs.copy()
    p["rank"] = p.groupby("Mã WM+", sort=False).cumcount() + 1
    p = p[p["rank"] <= k]
    blocks = {"Code": "Mã BHX lân cận", "Address": "Địa chỉ BHX", "Distance": "Khoảng cách (km)"}
    out = p[["Mã WM+", "Tên WM+", "Tỉnh"]].drop_duplicates("Mã WM+").set_index("Mã WM+")
    for block, col in blocks.items():
        w = p.pivot(index="Mã WM+", columns="rank", values=col)
        w.columns = [f"{block}_BHX_{i}" for i in w.columns]
        out = out.join(w.convert_dtypes())            # mã BHX giữ kiểu số nguyên, không thành 31151.0
    return out.reset_index()


# ─────────────────────────── FILTER TỈNH ───────────────────────────
def _norm_prov(s) -> str:
    s = unicodedata.normalize("NFC", str(s)).lower().strip()
    return re.sub(r"^(thành phố|tp\.?|tỉnh|t\.)\s*", "", s)


def filter_province(wm: pd.DataFrame, provinces: str | None) -> pd.DataFrame:
    """Lọc phía WM+ (BHX giữ nguyên toàn quốc để không sót cửa hàng sát ranh giới tỉnh)."""
    if not provinces:
        return wm
    want = {_norm_prov(p) for p in provinces.split(",") if p.strip()}
    sub = wm[wm["tinh"].map(_norm_prov).isin(want)]
    if sub.empty:
        raise ValueError(f"Không có WM+ nào thuộc {sorted(want)}; giá trị hiện có: {sorted(wm['tinh'].astype(str).unique())}")
    return sub.reset_index(drop=True)


# ─────────────────────────── CLI ───────────────────────────
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="WM+ ↔ BHX radius matching (BallTree/haversine)")
    ap.add_argument("--wm-file", required=True, type=Path)
    ap.add_argument("--wm-sheet", default=None)
    ap.add_argument("--bhx-file", type=Path, default=DATA_DIR / "bhx_stores.csv")
    ap.add_argument("--bhx-sheet", default=None)
    ap.add_argument("--radius", "-r", type=float, default=1.0, help="Bán kính xx (đơn vị theo --unit)")
    ap.add_argument("--unit", choices=["km", "m"], default="km")
    ap.add_argument("--province", default=None, help='Lọc WM+ theo tỉnh, vd "Hải Phòng,Bắc Ninh"')
    ap.add_argument("--engine", choices=["balltree", "ckdtree"], default="balltree")
    ap.add_argument("--include-virtual", action="store_true")
    ap.add_argument("--wide", action="store_true", help="Xuất thêm file dạng MASTER (5 BHX gần nhất)")
    ap.add_argument("--xlsx", action="store_true", help="Xuất thêm .xlsx")
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR)
    a = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    radius_km = a.radius / 1000 if a.unit == "m" else a.radius
    try:
        wm = filter_province(load_wm(a.wm_file, a.wm_sheet), a.province)
        bhx = load_bhx(a.bhx_file, a.bhx_sheet, a.include_virtual)
        t0 = time.perf_counter()
        pairs, summary = find_neighbors(wm, bhx, radius_km, a.engine)
        dt = time.perf_counter() - t0
    except (FileNotFoundError, KeyError, ValueError) as e:
        log.error("%s", e)
        return 2
    except Exception:                                   # noqa: BLE001
        log.exception("Lỗi không xác định")
        return 1

    log.info("WM+=%d | BHX=%d | R=%g km | %d cặp | %d/%d WM+ có ≥1 BHX | engine=%s | tính toán %.3fs",
             len(wm), len(bhx), radius_km, len(pairs), (summary["Số BHX trong bán kính"] > 0).sum(), len(wm), a.engine, dt)

    a.out_dir.mkdir(exist_ok=True, parents=True)
    # Tên file CỐ ĐỊNH để Power BI / Power Query trỏ một lần là đủ
    pairs.to_csv(a.out_dir / "wm_bhx_pairs.csv", index=False, encoding="utf-8-sig")
    summary.to_csv(a.out_dir / "wm_summary.csv", index=False, encoding="utf-8-sig")
    if a.wide:
        to_master_wide(pairs).to_csv(a.out_dir / "wm_bhx_wide.csv", index=False, encoding="utf-8-sig")
    if a.xlsx:
        with pd.ExcelWriter(a.out_dir / "wm_bhx_result.xlsx") as xw:
            pairs.to_excel(xw, "pairs", index=False)
            summary.to_excel(xw, "summary", index=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
