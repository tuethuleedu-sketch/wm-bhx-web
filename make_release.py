# -*- coding: utf-8 -*-
"""
Đóng gói bản sạch để đưa lên GitHub → thư mục release/.

Kéo-thả lên web GitHub KHÔNG tôn trọng .gitignore, nên script chỉ copy file trong danh sách
cho phép (ALLOW) rồi quét lại: chặn file dữ liệu (.xlsx/.csv/.env/.log…) và khoá bí mật
(sb_secret_…, JWT có role service_role). Có lỗi → xoá release/ và exit 1.

Chạy:  python make_release.py
"""
import base64, json, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "release"
MARK = OUT / ".release_marker"          # chỉ xoá release/ nếu do script này tạo

# Không có HANDOFF.md, powerbi/ (chứa số liệu thật), data/, output/, logs/, archive_supabase/, file Excel.
ALLOW = [
    ".gitignore", ".github/workflows/bhx_daily.yml", ".github/workflows/pages.yml",
    "README.md", "SETUP_GOOGLE.md", "requirements.txt", "run_daily.bat",
    "bhx_fetch.py", "bhx_sync.py", "wm_bhx_match.py", "make_release.py",
    "tests/test_pipeline.py",
    "gas/Code.gs", "gas/appsscript.json", "gas/test/mock_gas.js", "gas/test/run_tests.html", "gas/test/e2e.html",
    "web/index.html", "web/app.js", "web/style.css", "web/config.js", "web/demo-data.js",
    "web/gas-api.js", "web/upload.js", "web/robots.txt",
]
BLOCK_EXT = {".xlsx", ".xls", ".xlsm", ".csv", ".env", ".log", ".pbix", ".parquet", ".zip"}
SECRET = re.compile(r"sb_secret_[A-Za-z0-9_-]{12,}|(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])")   # khoá Supabase / SYNC_SECRET (64 hex)
JWT = re.compile(r"eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+")


def jwt_role(payload_b64: str) -> str | None:
    try:
        pad = "=" * (-len(payload_b64) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64 + pad)).get("role")
    except Exception:
        return None


def main() -> int:
    if OUT.exists():
        if not MARK.exists():
            print(f"[DỪNG] {OUT} đã tồn tại nhưng không do script tạo — tự xoá/đổi tên rồi chạy lại."); return 1
        shutil.rmtree(OUT)
    errors, warns = [], []
    for rel in ALLOW:
        src = ROOT / rel
        if not src.exists():
            errors.append(f"thiếu file {rel}"); continue
        dst = OUT / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    MARK.write_text("tạo bởi make_release.py\n", encoding="utf-8")

    for f in OUT.rglob("*"):
        if not f.is_file() or f == MARK:
            continue
        rel = f.relative_to(OUT).as_posix()
        if f.suffix.lower() in BLOCK_EXT:
            errors.append(f"file dữ liệu bị chặn: {rel}")
        text = f.read_text(encoding="utf-8", errors="ignore")
        if SECRET.search(text):
            errors.append(f"có khoá bí mật (SYNC_SECRET / sb_secret_…) trong {rel}")
        for m in JWT.finditer(text):
            if jwt_role(m.group(1)) == "service_role":
                errors.append(f"có khoá service_role trong {rel}")

    cfg = (OUT / "web/config.js").read_text(encoding="utf-8") if (OUT / "web/config.js").exists() else ""
    if 'mode: "demo"' in cfg:
        warns.append('web/config.js đang mode "demo" — web sẽ chỉ hiện dữ liệu giả. Sửa theo SETUP_GOOGLE.md bước 3 nếu muốn chạy thật.')
    elif not re.search(r'gasUrl:\s*"https://script\.google\.com/macros/s/[^"]+/exec"', cfg):
        errors.append('web/config.js mode "gas" nhưng gasUrl chưa đúng dạng https://script.google.com/macros/s/…/exec')

    if errors:
        shutil.rmtree(OUT)
        print("[LỖI] Không tạo bản phát hành:"); [print("  -", e) for e in errors]; return 1
    files = sorted(p.relative_to(OUT).as_posix() for p in OUT.rglob("*") if p.is_file() and p != MARK)
    print(f"[OK] {len(files)} file trong {OUT}:"); [print("  ", p) for p in files]
    for w in warns:
        print("[CẢNH BÁO]", w)
    print("\nKéo TOÀN BỘ nội dung bên trong release/ (gồm cả .github và .gitignore) vào trang Upload files của repo GitHub.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
