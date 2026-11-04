// Đọc file WM+ trên trình duyệt (SheetJS), kiểm tra, so với bản hiện hành. Không gửi gì đi cho tới khi Admin bấm Áp dụng.
// Quy tắc khớp với wm_bhx_match.py: alias cột WM_COLS, dò dòng tiêu đề trong 8 dòng đầu, bbox VN.
window.WMUpload = (function () {
  const COLS = {
    ma: ["Mã WM+", "Mã CH", "Mã SAP", "Code"],
    ten: ["Tên WM+", "Tên CH", "Tên cửa hàng", "Store Name"],
    tinh: ["Tỉnh mới", "Tỉnh/Thành", "Tỉnh/TP", "Tỉnh/TP cũ trước 1/7", "Tỉnh"],
    lat: ["Latitude", "Vĩ độ", "Lat"],
    lng: ["Longitude", "Kinh độ", "Lng", "Long"],
    // Tuỳ chọn
    khu_vuc: ["Khu vực", "Khu vuc", "Urban/Rural", "Phân loại khu vực", "Loại khu vực", "Thành thị/Nông thôn", "Area"],
    chuoi: ["Chuỗi", "Chuoi", "Chain", "Brand", "Mô hình"],
    dia_chi: ["Địa chỉ", "Địa chỉ CH", "Dia chi", "Address"],
    vung: ["Vùng", "Vung", "Region", "Zone"],
    mien: ["Miền", "Mien", "Vùng miền"],
    quan: ["Quận/Huyện", "Quận", "Huyện", "Quận huyện", "Quận/Huyện cũ", "District"],
    phuong: ["Phường/Xã", "Phường", "Xã", "Phường xã", "Xã/Phường", "Phường/Xã mới", "Ward"],
  };
  const OPTIONAL = new Set(["ten", "khu_vuc", "chuoi", "dia_chi", "vung", "mien", "quan", "phuong"]);
  const plain = (s) => norm(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
  // "Thành thị"/"urban"/"nội thành"/U/TT → Urban; "Nông thôn"/"rural"/"ngoại thành"/R/NT → Rural; khác giữ nguyên
  function khuVuc(v) {
    const s = plain(v);
    if (!s) return "";
    if (/rural|nong thon|ngoai thanh|^(r|nt)$/.test(s)) return "Rural";
    if (/urban|thanh thi|noi thanh|do thi|^(u|tt)$/.test(s)) return "Urban";
    return norm(v).slice(0, 30);
  }
  // WinMart+ / WM+ / WMP → WM+; WinMart / WMT → WMT; trống → mặc định của lần upload
  function chuoi(v, dflt) {
    const s = plain(v).replace(/\s/g, "");
    if (!s) return dflt;
    if (/^(wm\+|wmp|winmart\+|winmartplus|wmplus)$/.test(s)) return "WM+";
    if (/^(wmt|winmart|wm)$/.test(s)) return "WMT";
    return null;
  }
  const BBOX = [8.0, 24.5, 102.0, 110.0];
  const MOVE_KM = 0.05;
  const norm = (v) => String(v ?? "").trim();
  // So tên cột bỏ qua hoa thường, dấu, khoảng trắng: "PHƯỜNG / XÃ" khớp "Phường/Xã".
  const headKey = (v) => plain(v).replace(/[^a-z0-9]/g, "");
  const ALL = new Set(Object.values(COLS).flat().map(headKey));

  // Thư viện Excel nặng nên chỉ tải khi Admin vào tab upload hoặc chọn file.
  let lib = null;
  const ensureLib = () => lib || (lib = new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    s.onload = ok;
    s.onerror = () => { lib = null; fail(new Error("không tải được thư viện đọc Excel, kiểm tra mạng rồi thử lại")); };
    document.head.appendChild(s);
  }));

  function readWorkbook(buf) {
    return XLSX.read(buf, { type: "array", cellDates: false });
  }

  // Trả { rows, header, headerRow, mapping, missing }
  function parseSheet(ws) {
    // Ô lỗi Excel (#REF!, #N/A…) coi như trống — giống pandas (cột "Tỉnh mới" của MASTER toàn #REF!)
    const ERR = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|SPILL!|CALC!)$/;
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
      .map((r) => (r || []).map((v) => (typeof v === "string" && ERR.test(v.trim()) ? null : v)));    let best = -1, bestScore = 0;
    grid.slice(0, 8).forEach((r, i) => {
      const s = (r || []).filter((v) => ALL.has(headKey(v))).length;
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (bestScore < 2) return { error: "Không dò được dòng tiêu đề (8 dòng đầu không có đủ tên cột)." };
    const header = grid[best].map(norm);
    const body = grid.slice(best + 1).filter((r) => r && r.some((v) => v !== null && norm(v) !== ""));
    // Cột đầu tiên tồn tại VÀ có dữ liệu (giống _pick trong Python)
    const mapping = {}, missing = [];
    for (const [k, cands] of Object.entries(COLS)) {
      const c = cands.map((n) => header.map(headKey).indexOf(headKey(n))).find((ix) => ix >= 0 && body.some((r) => r[ix] !== null && norm(r[ix]) !== ""));
      if (c === undefined) { if (!OPTIONAL.has(k)) missing.push(k); } else mapping[k] = c;
    }
    return { header, headerRow: best + 1, body, mapping, missing };
  }

  const num = (v) => (typeof v === "number" ? v : parseFloat(norm(v).replace(",", ".")));

  // Kiểm tra từng dòng. Không tự xoá: dòng lỗi được liệt kê; dòng trùng mã chặn việc áp dụng.
  function validate(p, dfltChuoi = "WM+") {
    const ok = [], bad = [], seen = new Map();
    const col = (r, k) => (p.mapping[k] !== undefined ? norm(r[p.mapping[k]]) : "");
    p.body.forEach((r, i) => {
      const line = p.headerRow + 1 + i;                       // số dòng trong Excel
      const ma = norm(r[p.mapping.ma]);
      const rec = { line, ma, ten: col(r, "ten") || ma,
        tinh: norm(r[p.mapping.tinh]), lat: num(r[p.mapping.lat]), lng: num(r[p.mapping.lng]),
        khu_vuc: khuVuc(col(r, "khu_vuc")), chuoi: chuoi(col(r, "chuoi"), dfltChuoi), dia_chi: col(r, "dia_chi").slice(0, 300), vung: col(r, "vung").slice(0, 50), mien: col(r, "mien").slice(0, 50), quan: col(r, "quan").slice(0, 50), phuong: col(r, "phuong").slice(0, 50) };
      let why = "";
      if (!ma) why = "thiếu mã";
      else if (!rec.chuoi) why = `chuỗi "${col(r, "chuoi")}" không phải WM+/WMT`;
      else if (!isFinite(rec.lat) || !isFinite(rec.lng)) why = "thiếu/sai toạ độ";
      else if (rec.lat < BBOX[0] || rec.lat > BBOX[1] || rec.lng < BBOX[2] || rec.lng > BBOX[3]) why = "toạ độ ngoài lãnh thổ VN";
      if (why) { bad.push({ ...rec, why }); return; }
      rec.lat = +rec.lat.toFixed(6); rec.lng = +rec.lng.toFixed(6);
      (seen.get(ma) || seen.set(ma, []).get(ma)).push(rec);
      ok.push(rec);
    });
    const dups = [...seen.values()].filter((g) => g.length > 1).flat();
    return { ok, bad, dups };
  }

  function haversineKm(a, b) {
    const R = 6371.0088, rad = Math.PI / 180;
    const x = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function diff(cur, next) {
    const old = new Map(cur.map((w) => [String(w.ma), w])), nw = new Map(next.map((w) => [w.ma, w]));
    const added = next.filter((w) => !old.has(w.ma));
    const removed = cur.filter((w) => !nw.has(String(w.ma)));
    const moved = next.filter((w) => old.has(w.ma)).map((w) => ({ ...w, km: haversineKm(old.get(w.ma), w) })).filter((w) => w.km > MOVE_KM);
    return { added, removed, moved };
  }

  return { ensureLib, readWorkbook, parseSheet, validate, diff, COLS };
})();
