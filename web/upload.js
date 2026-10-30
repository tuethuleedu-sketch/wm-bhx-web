// Đọc file WM+ trên trình duyệt (SheetJS), kiểm tra, so với bản hiện hành. Không gửi gì đi cho tới khi Admin bấm Áp dụng.
// Quy tắc khớp với wm_bhx_match.py: alias cột WM_COLS, dò dòng tiêu đề trong 8 dòng đầu, bbox VN.
window.WMUpload = (function () {
  const COLS = {
    ma: ["Mã WM+", "Mã CH", "Mã SAP", "Code"],
    ten: ["Tên WM+", "Tên CH", "Tên cửa hàng", "Store Name"],
    tinh: ["Tỉnh mới", "Tỉnh/Thành", "Tỉnh/TP", "Tỉnh/TP cũ trước 1/7", "Tỉnh"],
    lat: ["Latitude", "Vĩ độ", "Lat"],
    lng: ["Longitude", "Kinh độ", "Lng", "Long"],
  };
  const BBOX = [8.0, 24.5, 102.0, 110.0];
  const MOVE_KM = 0.05;
  const ALL = new Set(Object.values(COLS).flat());
  const norm = (v) => String(v ?? "").trim();

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
      const s = (r || []).filter((v) => ALL.has(norm(v))).length;
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (bestScore < 2) return { error: "Không dò được dòng tiêu đề (8 dòng đầu không có đủ tên cột)." };
    const header = grid[best].map(norm);
    const body = grid.slice(best + 1).filter((r) => r && r.some((v) => v !== null && norm(v) !== ""));
    // Cột đầu tiên tồn tại VÀ có dữ liệu (giống _pick trong Python)
    const mapping = {}, missing = [];
    for (const [k, cands] of Object.entries(COLS)) {
      const c = cands.map((n) => header.indexOf(n)).find((ix) => ix >= 0 && body.some((r) => r[ix] !== null && norm(r[ix]) !== ""));
      if (c === undefined) { if (k !== "ten") missing.push(k); } else mapping[k] = c;
    }
    return { header, headerRow: best + 1, body, mapping, missing };
  }

  const num = (v) => (typeof v === "number" ? v : parseFloat(norm(v).replace(",", ".")));

  // Kiểm tra từng dòng. Không tự xoá: dòng lỗi được liệt kê; dòng trùng mã chặn việc áp dụng.
  function validate(p) {
    const ok = [], bad = [], seen = new Map();
    p.body.forEach((r, i) => {
      const line = p.headerRow + 1 + i;                       // số dòng trong Excel
      const ma = norm(r[p.mapping.ma]);
      const rec = { line, ma, ten: p.mapping.ten !== undefined ? norm(r[p.mapping.ten]) || ma : ma,
        tinh: norm(r[p.mapping.tinh]), lat: num(r[p.mapping.lat]), lng: num(r[p.mapping.lng]) };
      let why = "";
      if (!ma) why = "thiếu mã";
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

  return { readWorkbook, parseSheet, validate, diff, COLS };
})();
