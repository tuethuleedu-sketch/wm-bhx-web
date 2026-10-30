# WM+ ↔ BHX — Radius Competitor Mapping

```
bhx_fetch.py      API BHX (JSON) ──► data/bhx_stores.csv  (+ bhx_new_stores_YYYYMMDD.csv)
wm_bhx_match.py   WM+ file + BHX snapshot ──BallTree──► output/wm_bhx_pairs.csv | wm_summary.csv | wm_bhx_wide.csv
web/ + gas/       Web app có đăng nhập OTP (thay Power BI): GitHub Pages + Apps Script + Google Sheet — hướng dẫn: SETUP_GOOGLE.md
run_daily.bat     chạy cả 2 bước (1 click / Task Scheduler)
tests/            mock API + benchmark + đối chiếu brute-force
```

## 1. Cài đặt
```
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
python bhx_fetch.py --probe          # kiểm tra schema thật (xem mục 2)
python bhx_fetch.py --rescan         # lần đầu: dò provinceId, cache 7 ngày
python wm_bhx_match.py --wm-file MASTER.xlsx --wm-sheet "MnM ĐBSH" --radius 1
```

## 2. Tìm endpoint API BHX (Chrome)
1. Mở `bachhoaxanh.com` → chọn Tỉnh/Phường nhận hàng hoặc vào trang **Hệ thống cửa hàng**.
2. `F12` → tab **Network** → lọc **Fetch/XHR** → tick *Preserve log* → ô filter gõ `Location` hoặc `Stores`.
3. Đổi Tỉnh/Thành trên giao diện → request mới xuất hiện. Link đã có của bạn là dạng này:
   `…/gw/Location/V2/GetStoresByLocation?provinceId=…&wardId=0&pageSize=10&pageIndex=0`
4. Click request → **Preview/Response**: xác nhận mảng có `storeId, lat, lng, storeAddress, provinceId…` (khớp các cột `Column1.*` trong sheet `BHX ĐBSH`).
5. **Headers** → xem *Request Headers*. Nếu thiếu header thì API trả 401/403: `Right-click request → Copy → Copy as cURL`, lấy các header lạ (`authorization`, `deviceid`, `x-…`) bỏ vào `headers.json` dạng `{"authorization": "…"}` — script tự nạp.
6. Thử sửa `pageSize` (50/100/500) ngay trên URL để biết trần của server; script tự dừng khi trang không còn `storeId` mới nên không phụ thuộc trần này.
7. Danh sách tỉnh: mở dropdown Tỉnh/Thành → tìm request trả danh sách tỉnh (khoá `province`). Chưa có thì script tự dò `provinceId` trong dải `--scan-range 1000 1100` (chỉnh theo thực tế).

## 3. Tham số bán kính `xx`
| Mục đích | Lệnh |
|---|---|
| 1,5 km | `--radius 1.5` |
| 500 m | `--radius 500 --unit m` |
| Chỉ vài tỉnh (lọc phía WM+, BHX vẫn toàn quốc) | `--province "Hải Phòng,Bắc Ninh"` |
| Thêm file dạng MASTER (BHX_1..5) | `--wide` |
| Chọn engine | `--engine balltree` (mặc định) / `ckdtree` |

Output luôn tính bằng **km**. Đầu ra `wm_bhx_pairs.csv`: `Mã WM+ · Tên WM+ · Tỉnh · Mã BHX lân cận · Địa chỉ BHX · Khoảng cách (km) · Lat BHX · Lng BHX`. `wm_summary.csv` có đủ mọi WM+ (kể cả 0 BHX) + BHX gần nhất + toạ độ `Lat WM+ · Lng WM+` (2 cột cuối, cho visual Map).

## 4. Đưa vào Power BI / tự động hằng ngày
| | A. Batch → CSV → Power BI (khuyến nghị) | B. Python script trong Power BI | C. Excel + nút VBA |
|---|---|---|---|
| Ưu | Refresh Power BI chỉ đọc CSV (giây); chạy được trên Service; lỗi API không làm hỏng report | Bấm Refresh trong Desktop là chạy hết | Quen thuộc, 1 nút |
| Nhược | Cần 1 máy bật theo lịch | Service cần Personal Gateway + Python; refresh chậm; khó debug | Khó chia sẻ, phụ thuộc macro |

**A — các bước**
1. Sửa 3 biến đầu `run_daily.bat`. Đặt lịch: `schtasks /create /tn "BHX_Daily" /tr "D:\WM_BHX\run_daily.bat" /sc daily /st 06:00`
2. Power BI → *Get Data → Text/CSV* trỏ `output\wm_bhx_pairs.csv` (đặt thư mục trên OneDrive/SharePoint để khỏi cần gateway). Trong Power Query ép kiểu số **theo culture en-US** (máy locale Việt dùng dấu phẩy thập phân, `0.055` sẽ thành `55`):
   `Table.TransformColumnTypes(Src, {{"Khoảng cách (km)", type number}}, "en-US")`
3. Radius động không cần tính lại: chạy batch với `RADIUS_MAX_KM` đủ lớn → *Modeling → New parameter (Numeric range 0.1–5, step 0.1)* tạo `Radius`, rồi:
   ```
   BHX trong bán kính = CALCULATE ( DISTINCTCOUNT ( Pairs[Mã BHX lân cận] ),
                                    Pairs[Khoảng cách (km)] <= [Radius Value] )
   ```
   Slicer Tỉnh/Khu vực lọc trên bảng WM+ (join `wm_summary` theo `Mã WM+`).

**B — Python script (Get Data → Python script)**
```python
import subprocess, sys, pandas as pd
subprocess.run([sys.executable, r"D:\WM_BHX\bhx_fetch.py"])
subprocess.run([sys.executable, r"D:\WM_BHX\wm_bhx_match.py", "--wm-file", r"D:\WM_BHX\MASTER.xlsx", "--radius", "5"], check=True)
pairs = pd.read_csv(r"D:\WM_BHX\output\wm_bhx_pairs.csv", encoding="utf-8-sig")
```

## 5. Xử lý lỗi & bảo vệ dữ liệu
- Retry/backoff tự động cho mất mạng, 429, 5xx. Exit code: `0` OK · `2` schema/guard · `3` mạng/tỉnh thất bại · `1` khác.
- API đổi cấu trúc: parser tìm đệ quy mảng chứa `storeId/lat/lng` (chịu được đổi tên wrapper, `latitude/longitude`); đổi hẳn schema → raw JSON lưu `logs/raw_*.json`, **snapshot cũ giữ nguyên**.
- Guard: snapshot mới < 70% snapshot cũ, hoặc thiếu bất kỳ tỉnh nào → không ghi đè.
- Dòng bị loại (tọa độ thiếu/ngoài VN, cửa hàng ảo) và trùng mã **không xoá âm thầm**: ghi ra `output/qa_*.csv`, `data/qa_bhx_duplicates.csv`.
- Tần suất 1 lần/ngày, ~0,2 s/request: kiểm tra điều khoản sử dụng của BHX trước khi vận hành thường xuyên.
