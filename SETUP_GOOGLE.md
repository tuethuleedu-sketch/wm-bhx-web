# Hướng dẫn triển khai: GitHub + Google Sheet + Google Apps Script

Tổng thời gian khoảng **30–40 phút**. Bạn tự tạo, tự đăng nhập và tự giữ mọi tài khoản và khoá.
**Không gửi `SYNC_SECRET`, mật khẩu hay mã OTP cho ai, kể cả Claude.** Tên menu của Google/GitHub có thể lệch chút theo thời điểm.

```
Trình duyệt ──► GitHub Pages (web/: giao diện, KHÔNG chứa dữ liệu)
     │
     └─ HTTPS ──► Apps Script Web app (chạy bằng tài khoản Google của bạn)
                     ├─ kiểm tra phiên đăng nhập OTP + quyền ở MỖI yêu cầu
                     ├─ Google Sheet "WM_BHX_DB": users · settings · wm_versions · bhx_stores · bhx_changes · access_log
                     └─ WM+ mỗi lần upload = 1 file Sheet riêng → XOÁ VĨNH VIỄN sau 48 giờ
Apps Script syncBhxDaily 06:00 ──► API BHX ──► tab bhx_stores / bhx_changes   (chạy trên máy chủ Google)
Dự phòng: bhx_sync.py (máy bạn / GitHub Action chạy tay) ──► Apps Script (kèm SYNC_SECRET)
Lưu ý: API BHX chặn máy chủ GitHub (đã thử 30/10/2026) nhưng cho máy chủ Google gọi.
```

---

## Bước 1 — Google Sheet + Apps Script (~15 phút)

1. Vào https://sheets.google.com bằng tài khoản Google của bạn → tạo **Bảng tính trống**, đặt tên `WM_BHX_DB`.
   **Không chia sẻ** file này cho ai. Đồng nghiệp chỉ vào qua web.
2. Menu **Tiện ích mở rộng (Extensions) → Apps Script**.
3. Trong editor:
   - Xoá hết nội dung file `Code.gs` có sẵn → dán toàn bộ nội dung file **`gas/Code.gs`** → bấm 💾 Lưu.
   - Biểu tượng ⚙️ **Project Settings** → tick **Show "appsscript.json" manifest file in editor** → quay lại Editor → mở `appsscript.json` → thay toàn bộ bằng nội dung **`gas/appsscript.json`** → Lưu.
     (Manifest này bật sẵn **Drive API** để xoá vĩnh viễn file WM+, đặt múi giờ Việt Nam và cấu hình Web app.)
4. Chạy cài đặt lần đầu: ở thanh trên chọn hàm **`setup`** → **Run**.
   - Google hỏi quyền → **Review permissions** → chọn tài khoản → nếu thấy "Google hasn't verified this app": **Advanced → Go to … (unsafe)**. Đây là script của chính bạn, không phải app bên ngoài.
     Các quyền cần: Sheets (database), Drive (tạo/xoá file WM+), Gmail gửi mail (mã OTP), chạy theo lịch, kết nối ngoài.
   - Xem **Execution log** ở dưới:
     - `Admin đầu tiên: <email của bạn>`
     - `SYNC_SECRET (...): <chuỗi 64 ký tự>` → **copy, cất vào trình quản lý mật khẩu**. Dùng ở bước 4.
   - Quay lại Google Sheet: phải có 6 tab `users, settings, wm_versions, bhx_stores, bhx_changes, access_log`. Tab `users` có email của bạn với quyền `admin`.
   - Chạy `setup` lại nhiều lần không sao: không tạo trùng Admin hay lịch chạy.
5. **Deploy → New deployment** → ⚙️ chọn **Web app**:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy** → copy **Web app URL** (dạng `https://script.google.com/macros/s/…/exec`).

   "Anyone" nghĩa là ai cũng *gọi* được URL. Mọi dữ liệu vẫn cần đăng nhập OTP, và email phải có trong tab `users`.

> **Sửa code Apps Script sau này:** dán code mới → Lưu → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
> Giữ nguyên URL. Không bấm "New deployment", vì như vậy sẽ ra URL mới.

## Bước 2 — Thử nhanh backend (tuỳ chọn, 1 phút)
Mở Web app URL trên trình duyệt → phải thấy `{"ok":true,"service":"wm-bhx"}`. Trang này không trả dữ liệu.

## Bước 3 — Cấu hình web + đóng gói (~3 phút)
1. Mở `web/config.js`, sửa:
   ```js
   mode: "gas",
   gasUrl: "https://script.google.com/macros/s/…/exec",   // URL ở bước 1.5
   ```
   URL này nằm công khai trong code web, không sao: không có mã OTP thì không lấy được dữ liệu.
2. Trong thư mục `wm_bhx_pipeline`:
   ```
   python make_release.py
   ```
   Script chỉ copy file trong danh sách cho phép vào `release\`, rồi quét: chặn file dữ liệu (.xlsx, .csv, .env, .log…) và khoá bí mật (kể cả `SYNC_SECRET`).
   **Không** đưa lên: `HANDOFF.md`, `powerbi\` (có số liệu thật), `data\`, `output\`, `logs\`, file Excel, `.env`, `archive_supabase\`.
   Phải thấy `[OK]` mới làm tiếp.

## Bước 4 — GitHub: lưu code + host web + chạy BHX hằng ngày (~10 phút)
1. https://github.com → đăng ký/đăng nhập → bật **2FA** (Settings → Password and authentication).
2. **New repository** → tên vd `wm-bhx-web`.
   - **Public**: GitHub Pages miễn phí. Code công khai nhưng không chứa dữ liệu hay khoá (`make_release.py` đã quét).
   - **Private**: GitHub Pages cần gói trả phí (GitHub Pro).
3. Trong repo trống: **uploading an existing file** → mở `release\` bằng File Explorer → chọn **tất cả** bên trong (kể cả `.github` và `.gitignore`; nếu không thấy thì vào View → Show → Hidden items) → kéo vào trang → **Commit changes**.
4. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   Tab **Actions → Deploy web to GitHub Pages → Run workflow** (lần đầu) → chờ xong → link web dạng `https://<tên-github>.github.io/wm-bhx-web/`.
5. **Settings → Secrets and variables → Actions → New repository secret**:
   - `GAS_URL` = Web app URL (bước 1.5)
   - `SYNC_SECRET` = chuỗi 64 ký tự (bước 1.4)
6. Tab **Actions → BHX daily sync → Run workflow** → chờ 2–5 phút → mở log, dòng cuối phải là `Kết quả: … cửa hàng · … lần đầu: ghi baseline`.
   Tab `bhx_stores` trong Sheet có khoảng 4.300 dòng.
   **Thực tế 30/10/2026: bước này lỗi vì API BHX chặn máy chủ GitHub.** Việc lấy BHX hằng ngày do hàm `syncBhxDaily`
   trong Apps Script đảm nhận (lịch 06:00 do `setup()` tạo). Workflow GitHub chỉ còn nút chạy tay để dự phòng.
   - Lỗi mạng/403 ở bước fetch → API BHX có thể chặn máy chủ GitHub (ở nước ngoài) → dùng **cách dự phòng** bên dưới.

> **Cập nhật code web sau này:** sửa → `python make_release.py` → upload lại nội dung `release\` (ghi đè) → Pages tự triển khai lại.
> Upload **không** xoá file cũ. File nào bỏ đi thì xoá tay trên GitHub.

**Cách dự phòng: đồng bộ BHX từ máy bạn.** Tạo file `.env` trong `wm_bhx_pipeline` (đã nằm trong `.gitignore`, không lên GitHub):
```
GAS_URL=https://script.google.com/macros/s/…/exec
SYNC_SECRET=chuỗi-64-ký-tự
```
`run_daily.bat` (đặt lịch bằng Task Scheduler) thấy `.env` sẽ tự gửi lên sau khi kéo BHX. Thử không ghi: `python bhx_sync.py --dry-run`.

## Bước 5 — Kiểm tra (~5 phút)
| # | Việc | Kết quả đúng |
|---|---|---|
| 1 | Mở link GitHub Pages ở cửa sổ ẩn danh | Chỉ thấy trang đăng nhập, **không** có banner "CHẾ ĐỘ DEMO" |
| 2 | Nhập email của bạn → Gửi mã → mở Gmail → nhập mã | Vào được, quyền Admin (mail có thể vào Spam lần đầu) |
| 3 | Nhập 1 email **chưa** cấp quyền | Vẫn báo "Đã gửi mã" nhưng **không có mail**; tab Phân quyền → Nhật ký có dòng "Bị từ chối" |
| 4 | Tổng quan | "… BHX, cập nhật <giờ Action chạy>" |
| 5 | Tab WM+ (upload) → chọn file MASTER → xem trước → Áp dụng | Bản đồ hiện WM+; dòng thông tin có "tự xoá … còn 48 giờ"; Drive có thư mục `WM_BHX_uploads (tu xoa sau 48h)` chứa 1 file |
| 6 | Tab Phân quyền → cấp 1 đồng nghiệp (Viewer) → họ đăng nhập | Thấy dữ liệu; không thấy tab Upload/Phân quyền |
| 7 | Thu hồi quyền người đó | Lần bấm tiếp theo của họ bị đăng xuất ngay |
| 8 | Sau 48 giờ (hoặc kiểm tra tab `wm_versions`) | Cột `purged_at` có giờ xoá; file trong thư mục Drive **biến mất** (không nằm trong Thùng rác) |

## Vận hành & giới hạn cần biết
- **WM+ tự xoá sau 48 giờ** tính từ lúc upload; muốn xem tiếp thì upload lại. BHX và lịch sử thay đổi BHX được giữ.
  Nếu `purge_note` ghi "chỉ chuyển vào thùng rác" → Drive API chưa bật: Apps Script → **Services (+) → Drive API → Add**, rồi tự xoá file trong Thùng rác Drive.
- **Phiên đăng nhập 6 giờ**; đóng tab là phải nhập mã lại. Thu hồi quyền có hiệu lực ngay.
- **Gmail cá nhân gửi khoảng 100 mail/ngày** qua Apps Script; web tự giới hạn 80 mã/ngày, mỗi email 1 mã/phút.
- **Sheet chính** (users, BHX, nhật ký) có lịch sử phiên bản của Google như mọi file Sheet. WM+ không nằm ở đây, nên không bị lưu lại trong lịch sử.
- **Bạn là chủ Sheet** nên mở và sửa trực tiếp được mọi tab, kể cả nhật ký. "Không sửa được nhật ký" chỉ áp dụng với người dùng qua web.
- **Dữ liệu nằm trên máy chủ Google** (không chọn được nơi lưu với tài khoản cá nhân). Nếu bạn dùng các tính năng Gemini trong Drive/Sheets thì Gemini có thể đọc file khi bạn gọi nó. Muốn chắc chắn thì không dùng Gemini trên các file này.
- **Lộ SYNC_SECRET:** Apps Script → Project Settings → Script properties → sửa `SYNC_SECRET` thành chuỗi mới → cập nhật GitHub Secret (và `.env` nếu có).
- **Tốc độ:** mỗi lần tải khoảng 1–3 giây (Apps Script chậm hơn database thật). Đủ cho nhóm nhỏ.
- Bản đồ nền dùng tile OpenStreetMap (miễn phí, có chính sách sử dụng hợp lý); dùng nội bộ ít người thì ổn.

## Test có sẵn (cho người bảo trì)
- `gas/test/run_tests.html`: 66 test backend `Code.gs` trên môi trường Google giả lập (OTP, quyền, upload, hết hạn 48h, đồng bộ BHX, thu hồi, nhật ký).
- `gas/test/e2e.html`: web thật + `Code.gs` giả lập, đăng nhập → upload → xem.
- Chạy: `python -m http.server 8766 -d .` trong `wm_bhx_pipeline` → mở `http://localhost:8766/gas/test/run_tests.html`.
- Giả lập **không** kiểm được quota, độ trễ, hay việc gửi mail thật của Google.
