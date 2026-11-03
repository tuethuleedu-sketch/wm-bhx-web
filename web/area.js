// Đặc điểm khu vực quanh 1 cửa hàng: dân số ước tính (WorldPop) và điểm công khai (OpenStreetMap).
// Dữ liệu nằm sẵn trong web (pop-grid.js, poi-data.js), chỉ tải khi cần và tính ngay trên trình duyệt — không gửi toạ độ cửa hàng đi đâu.
window.AreaInfo = (function () {
  const rad = Math.PI / 180;
  const km = (la1, lo1, la2, lo2) => {
    const a = Math.sin(((la2 - la1) * rad) / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(((lo2 - lo1) * rad) / 2) ** 2;
    return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
  };
  const addScript = (src) => new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Không tải được " + src));
    document.head.appendChild(s);
  });
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

  let ready = null, G = null;
  function load() {
    return ready || (ready = Promise.all([addScript("pop-grid.js"), addScript("poi-data.js")]).then(() => {
      const p = window.POP_GRID;
      G = { ...p, rc: new Uint16Array(bytes(p.rc)), v: new Uint16Array(bytes(p.v)) };
    }).catch((e) => { ready = null; throw e; }));
  }

  // Ô đầu tiên có hàng ≥ r (lưới đã sắp theo hàng rồi cột)
  function firstRow(r) {
    let lo = 0, hi = G.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (G.rc[m * 2] < r) lo = m + 1; else hi = m; }
    return lo;
  }
  // Mỗi ô ~1 km: lấy mẫu 5×5 điểm để biết bao nhiêu phần ô nằm trong vòng tròn, cộng dân số theo tỉ lệ đó.
  function population(lat, lng, R) {
    const out = { total: 0, male: 0, ages: [0, 0, 0, 0, 0] };
    const dLat = R / 111 + G.dy, dLng = R / (111 * Math.cos(lat * rad)) + G.dx;
    const r0 = Math.max(0, Math.floor((G.y0 - lat - dLat) / G.dy)), r1 = Math.ceil((G.y0 - lat + dLat) / G.dy);
    const c0 = Math.floor((lng - dLng - G.x0) / G.dx), c1 = Math.ceil((lng + dLng - G.x0) / G.dx);
    for (let i = firstRow(r0); i < G.n && G.rc[i * 2] <= r1; i++) {
      const r = G.rc[i * 2], c = G.rc[i * 2 + 1];
      if (c < c0 || c > c1) continue;
      let inside = 0;
      for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
        if (km(lat, lng, G.y0 - (r + (a + 0.5) / 5) * G.dy, G.x0 + (c + (b + 0.5) / 5) * G.dx) <= R) inside++;
      }
      if (!inside) continue;
      const f = inside / 25, at = i * 6;
      for (let g = 0; g < 5; g++) { out.ages[g] += G.v[at + g] * f; out.total += G.v[at + g] * f; }
      out.male += G.v[at + 5] * f;
    }
    return out;
  }
  // Điểm trong bán kính R theo từng nhóm, gần trước xa sau.
  function places(lat, lng, R) {
    const dLat = R / 111, dLng = R / (111 * Math.cos(lat * rad)), out = {};
    Object.entries(window.POI_DATA.cats).forEach(([cat, rows]) => {
      const list = [];
      rows.forEach((p) => {
        if (Math.abs(p[0] - lat) > dLat || Math.abs(p[1] - lng) > dLng) return;
        const d = km(lat, lng, p[0], p[1]);
        if (d <= R) list.push({ name: p[2] || "", d });
      });
      out[cat] = list.sort((a, b) => a.d - b.d);
    });
    return out;
  }
  const compute = (lat, lng, R) => ({ pop: population(lat, lng, R), places: places(lat, lng, R), year: G.year, poiDate: window.POI_DATA.date });
  return { load, compute };
})();
