// Lớp dữ liệu DEMO — toàn bộ là dữ liệu giả, sinh ngẫu nhiên có seed (không chứa WM+/BHX thật).
// Bước 2 sẽ thay bằng SupabaseAPI cùng interface: getSnapshot, getChanges, getVersions, listUsers, addUser, removeUser.
(function () {
  function rng(seed) {                       // mulberry32: cùng seed → cùng dữ liệu mỗi lần mở
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = rng(20261030);
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

  // Tâm giả lập theo tỉnh (toạ độ trung tâm hành chính, chỉ để rải điểm)
  const PROV = [
    ["TP. Hải Phòng", 20.86, 106.68, 0.10, 140], ["T. Hải Dương", 20.94, 106.33, 0.09, 80],
    ["T. Bắc Ninh", 21.18, 106.07, 0.07, 80], ["T. Thái Bình", 20.45, 106.34, 0.08, 70],
    ["T. Vĩnh Phúc", 21.31, 105.60, 0.08, 70], ["T. Hưng Yên", 20.65, 106.05, 0.07, 50],
    ["T. Nam Định", 20.43, 106.17, 0.07, 45], ["T. Ninh Bình", 20.25, 105.97, 0.07, 40],
    ["T. Hà Nam", 20.54, 105.92, 0.06, 25],
  ];
  const STREETS = ["Lê Lợi", "Trần Hưng Đạo", "Nguyễn Trãi", "Lý Thường Kiệt", "Hai Bà Trưng", "Quang Trung", "Lê Duẩn", "Điện Biên"];

  const wm = [], bhx = [];
  PROV.forEach(([tinh, lat, lng, sd, n], p) => {
    for (let i = 0; i < n; i++) {
      const ma = "D" + String(p + 1) + String(i + 1).padStart(3, "0"), g1 = gauss(), g2 = gauss();
      const chuoi = rand() < 0.2 ? "WMT" : "WM+";
      // Vùng/Miền giả: Thái Bình chia 2 vùng, Hà Nam để trống — để xem đủ các trường hợp
      const vung = p === 8 ? "" : p < 2 ? "Vùng 1" : p < 3 || p === 4 ? "Vùng 2" : p === 3 ? (g2 < 0 ? "Vùng 1" : "Vùng 3") : "Vùng 3";
      wm.push({ ma, ten: chuoi + " demo " + ma, tinh, lat: +(lat + g1 * sd).toFixed(6), lng: +(lng + g2 * sd).toFixed(6),
        khu_vuc: Math.hypot(g1, g2) < 1 ? "Urban" : "Rural", chuoi,
        vung, mien: !vung ? "" : vung === "Vùng 3" ? "Miền Y" : "Miền X", quan: !vung ? "" : g1 < 0 ? "Quận Nam" : g2 < 0 ? "Quận Tây" : "Quận Đông", phuong: !vung ? "" : "Phường " + (1 + Math.floor(Math.abs(g1 * 2 + g2) * 2) % 5),
        dia_chi: `${Math.floor(rand() * 300) + 1} ${STREETS[Math.floor(rand() * STREETS.length)]}, ${tinh}` });
    }
    for (let i = 0; i < Math.round(n * 2.3); i++) {
      bhx.push({
        ma: 90000 + bhx.length, tinh,
        dia_chi: `BHX demo ${Math.floor(rand() * 300) + 1} ${STREETS[Math.floor(rand() * STREETS.length)]}, ${tinh}`,
        lat: +(lat + gauss() * sd * 1.3).toFixed(6), lng: +(lng + gauss() * sd * 1.3).toFixed(6),
      });
    }
  });
  for (let i = 0; i < 160; i++) {                    // tỉnh chỉ có BHX, không có WM+
    bhx.push({ ma: 90000 + bhx.length, tinh: "TP. Hà Nội",
      dia_chi: `BHX demo ${Math.floor(rand() * 300) + 1} ${STREETS[Math.floor(rand() * STREETS.length)]}, Hà Nội`,
      lat: +(21.03 + gauss() * 0.08).toFixed(6), lng: +(105.83 + gauss() * 0.08).toFixed(6) });
  }

  // Các chuỗi đối thủ khác (giả). Emart để trống vì chưa có nguồn dữ liệu.
  const comp = [];
  [["COOP", "Co.op demo", 40], ["GO", "GO! demo", 20], ["KFM", "Kingfood demo", 25], ["LOTTE", "LOTTE demo", 8]].forEach(([chain, ten, n]) => {
    for (let i = 0; i < n; i++) {
      const [tinh, lat, lng, sd] = PROV[Math.floor(rand() * PROV.length)];
      comp.push({ chain, ma: chain.toLowerCase() + "-" + (i + 1), ten: `${ten} ${i + 1}`, tinh,
        dia_chi: `${Math.floor(rand() * 300) + 1} ${STREETS[Math.floor(rand() * STREETS.length)]}, ${tinh}`,
        lat: +(lat + gauss() * sd).toFixed(6), lng: +(lng + gauss() * sd).toFixed(6) });
    }
  });

  // Lịch sử thay đổi 30 ngày gần nhất
  const today = new Date("2026-10-30T07:00:00+07:00");
  const changes = [];
  for (let k = 0; k < 42; k++) {
    const b = bhx[Math.floor(rand() * bhx.length)];
    const r = rand(), d = new Date(today - Math.floor(rand() * 30) * 864e5);
    const type = r < 0.55 ? "open" : r < 0.85 ? "close" : "move";
    const ev = { date: d.toISOString().slice(0, 10), type, ma: b.ma, dia_chi: b.dia_chi, tinh: b.tinh, lat: b.lat, lng: b.lng };
    if (type === "move") { ev.old_lat = +(b.lat - 0.002).toFixed(6); ev.old_lng = +(b.lng + 0.0015).toFixed(6); }
    changes.push(ev);
  }
  changes.sort((a, b) => b.date.localeCompare(a.date));

  const settings = { viewer_can_export: true };
  let wmExpires = new Date(Date.now() + 41 * 3600e3);
  const versions = [
    { version: "v2", uploaded: "08:12:00 30/10/2026", by: "admin.demo@example.com", rows: wm.length, added: 12, removed: 3, moved: 1, status: "Còn hạn đến 08:12:00 1/11/2026" },
    { version: "v1", uploaded: "09:40:00 27/10/2026", by: "admin.demo@example.com", rows: wm.length - 9, added: 0, removed: 0, moved: 0, status: "Đã xoá 10:05:00 29/10/2026" },
  ];
  let users = [
    { email: "admin.demo@example.com", role: "admin", added: "2026-10-30" },
    { email: "dongnghiep1.demo@example.com", role: "viewer", added: "2026-10-30" },
  ];

  let botHasKey = !/[?&]nokey=1/.test(location.search), botProv = "gemini", botModel = {}, botUsed = 0, priceStore = null, priceJob = null, priceCfg = [{ tinh: "Hồ Chí Minh", khu: "Thành thị", provinceId: "1", wardId: "1", storeId: "1", addr: "Địa chỉ giả 1" }, { tinh: "Hồ Chí Minh", khu: "Nông thôn", provinceId: "1", wardId: "4", storeId: "4", addr: "Địa chỉ giả 4" }, { tinh: "Hà Nội", khu: "Thành thị", provinceId: "2", wardId: "2", storeId: "2", addr: "" }, { tinh: "Cần Thơ", khu: "Thành thị", provinceId: "3", wardId: "3", storeId: "3", addr: "" }];
  function priceDemo() {
    if (priceStore) return priceStore;
    let seed = 20261104;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const CATS = ["Sữa tươi", "Sữa chua uống liền", "Mì ăn liền", "Phở, bún ăn liền", "Dầu ăn", "Nước mắm", "Nước ngọt", "Cà phê hoà tan", "Bánh quy", "Kẹo cứng", "Rau lá", "Trái cây", "Thịt heo", "Nước giặt", "Nước rửa chén", "Sữa tắm", "Kem đánh răng", "Hàng đông chế biến"];   // tên ngành thật của BHX để thử cây ngành
    const PROV = [{ tinh: "Hồ Chí Minh", store: "demo-11", rate: 0.36, level: {} }, { tinh: "Hà Nội", store: "demo-22", rate: 0.3, level: {} }, { tinh: "Cần Thơ", store: "demo-33", rate: 0.26, level: {} },
      { tinh: "Hồ Chí Minh · Nông thôn", store: "demo-12", rate: 0.3, level: {} }, { tinh: "Cần Thơ · Nông thôn", store: "demo-34", rate: 0.22, level: {} }];   // 2 tỉnh có thêm cửa hàng nông thôn
    PROV.forEach((p) => CATS.forEach((c) => (p.level[c] = 0.97 + rnd() * 0.06)));
    const dates = Array.from({ length: 8 }, (_, w) => new Date(Date.now() - (7 - w) * 7 * 864e5).toISOString().slice(0, 10));
    const round = (x) => Math.round(x / 100) * 100, skus = [], items = [], hist = [], runs = [];
    PROV.forEach((p) => dates.forEach((date) => runs.push({ date, tinh: p.tinh, store: p.store, file: "gia_demo.xlsx", by: "demo@example.com", n: 0, oos: 0, added: 0, gone: 0, up: 0, down: 0 })));
    for (let k = 0; k < 900; k++) {
      const cat = CATS[Math.floor(rnd() * CATS.length)], id = String(900000 + k), list = (8 + rnd() * rnd() * 240) * 1000;
      skus.push({ id, code: String(100000 + k), name: `SKU demo ${String(k + 1).padStart(4, "0")}`, cat, brand: `Thương hiệu ${"ABCDEFGHIJKLMN"[k % 14]}`, unit: "Gói", url: "" });
      PROV.forEach((p, pi) => {
        if (rnd() < 0.03) return;                                                  // một số SKU không bán ở tỉnh này
        const from = k < 860 ? 0 : 1 + Math.floor(rnd() * 7), to = k % 45 === 7 ? 3 + Math.floor(rnd() * 4) : 7;
        let base = round(list * p.level[cat]), keep = "", row = null;
        for (let w = from; w <= to; w++) {
          if (rnd() < 0.05) base = round(base * (1 + 0.03 + rnd() * 0.05));
          const on = rnd() < p.rate, off = on ? 0.05 + rnd() * rnd() * 0.5 : 0, final = round(base * (1 - off)), sig = final + "|" + base;
          if (sig !== keep) { hist.push([dates[w], p.tinh, id, final, base]); keep = sig; }
          row = { tinh: p.tinh, store: p.store, id, final, base, off: base > final ? 1 - final / base : 0, promo: on, title: on && rnd() < 0.2 ? "Mua 2 giảm thêm" : "", can: rnd() > 0.04, first_seen: dates[from], last_seen: dates[to] };
          runs[pi * dates.length + w].n++; if (!row.can) runs[pi * dates.length + w].oos++;
        }
        if (row) items.push(row);
      });
    }
    hist.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return (priceStore = { skus, items, hist, runs });
  }
  window.DemoAPI = {
    mode: "demo",
    async currentUser() { return null; },
    // Demo: mật khẩu bất kỳ; nhập "tam" để xem bước đặt mật khẩu mới.
    async signIn(email, password) { return password === "tam" ? { mustChange: true, email } : { email, role: "admin" }; },
    async changePassword(email) { return { email, role: "admin" }; },
    async resetPassword() { return { tempPassword: "demo12345678" }; },
    async signOut() {},
    async getSettings() { return { ...settings }; },
    async setSetting(key, value) { settings[key] = value; },
    async getSnapshot() {
      return { wm, bhx, comp, compUpdated: "2026-10-30 07:00", compStatus: "", bhxUpdated: "2026-10-30 06:00", wmVersion: versions[0].version + " — " + versions[0].uploaded.split(" ").pop(), wmExpires };
    },
    async getAccessLog() {
      const t = Date.now(), at = (h) => new Date(t - h * 3600e3).toISOString();
      return [
        { at: at(0.1), email: "admin.demo@example.com", event: "login" },
        { at: at(2), email: "dongnghiep1.demo@example.com", event: "resume" },
        { at: at(3), email: "nguoila.demo@example.com", event: "denied" },
        { at: at(4), email: "dongnghiep1.demo@example.com", event: "login_fail" },
        { at: at(5), email: "dongnghiep1.demo@example.com", event: "login" },
        { at: at(6), email: "admin.demo@example.com", event: "logout" },
      ];
    },
    // Giá đối thủ giả cho bản xem trước: 8 tuần, tên ngành, thương hiệu, SKU và giá đều do máy sinh ra.
    async getPrices() { return priceDemo(); },
    async publishPrices(rows, meta, force) {
      const d = priceDemo(), date = meta.date, byT = new Map(), provinces = [];
      rows.forEach((r) => { if (!byT.has(r.tinh)) byT.set(r.tinh, []); byT.get(r.tinh).push(r); });
      byT.forEach((list, t) => {
        const last = d.items.filter((x) => x.tinh === t).reduce((m, x) => (x.last_seen > m ? x.last_seen : m), ""), active = d.items.filter((x) => x.tinh === t && x.last_seen === last).length;
        if (!force && list.length < active * 0.7) throw Object.assign(new Error(`${t}: file chỉ có ${list.length} SKU, ít hơn nhiều so với ${active} SKU lần trước.`), { code: "PRICE_SHRINK" });
      });
      byT.forEach((list, t) => {
        const old = d.items.filter((x) => x.tinh === t), prev = new Map(old.map((x) => [x.id, x])), seen = new Set(list.map((r) => r.id)), last = old.reduce((m, x) => (x.last_seen > m ? x.last_seen : m), "");
        const s = { tinh: t, rows: list.length, added: 0, gone: old.filter((x) => x.last_seen === last && !seen.has(x.id)).length, up: 0, down: 0 };
        d.items = d.items.filter((x) => !(x.tinh === t && seen.has(x.id)));
        list.forEach((r) => {
          const o = prev.get(r.id);
          if (!o) s.added++; else if (o.final && r.final > o.final) s.up++; else if (o.final && r.final < o.final) s.down++;
          if (!o || o.final !== r.final || o.base !== r.base) d.hist.push([date, t, r.id, r.final, r.base]);
          d.items.push({ tinh: t, store: r.store, id: r.id, final: r.final, base: r.base, off: r.off, promo: r.promo, title: r.title, can: r.can, first_seen: o ? o.first_seen : date, last_seen: date });
          if (!d.skus.some((x) => x.id === r.id)) d.skus.push({ id: r.id, code: r.code, name: r.name, cat: r.cat, brand: r.brand, unit: r.unit, url: r.url });
        });
        d.runs.push({ date, tinh: t, store: list[0].store, file: meta.file, by: "demo@example.com", n: list.length, added: s.added, gone: s.gone, up: s.up, down: s.down });
        provinces.push(s);
      });
      return { date, rows: rows.length, provinces };
    },
    // Nút Cập nhật giá ở bản xem trước: chạy giả, không gọi BHX và không cần token.
    async priceConfig() { return { provinces: priceCfg, missing: [], job: priceJob }; },
    async savePriceConfig(list) { priceCfg = list; return { provinces: priceCfg, missing: [], job: priceJob }; },
    async priceTest() { await new Promise((r) => setTimeout(r, 300)); return priceCfg.map((p) => ({ tinh: p.tinh, ok: true, sku: 10, withPrice: 10, withCat: 10, withBrand: 10 })); },
    async priceStart() {
      if (!priceJob || priceJob.status === "done") priceJob = { id: "demo", status: "running", date: new Date().toISOString().slice(0, 10), msg: "", tinh: priceCfg[0].tinh, done: 0, total: 459, rows: 0, summary: null };
      if (priceJob.status === "paused") priceJob.status = "running";
      return { ...priceJob };
    },
    async priceStep() {
      await new Promise((r) => setTimeout(r, 250));
      const j = priceJob;
      if (j.status === "running") {
        j.done = Math.min(j.total, j.done + 153); j.rows += 850; j.tinh = priceCfg[Math.min(priceCfg.length - 1, Math.floor(j.done / 153))].tinh;
        if (j.done >= j.total) j.status = "saving";
      } else if (j.status === "saving") {
        const d = priceDemo(), rows = [];
        d.items.forEach((x) => { const s = d.skus.find((k) => k.id === x.id); if (x.last_seen === new Date().toISOString().slice(0, 10) || x.last_seen >= d.runs[d.runs.length - 1].date) rows.push({ ...s, tinh: x.tinh, store: x.store, final: x.final, base: x.base, off: x.off, promo: x.promo, title: x.title, can: x.can }); });
        j.summary = await this.publishPrices(rows, { file: "Cập nhật trực tiếp", date: j.date }, true);
        j.status = "done";
      }
      return { ...j };
    },
    async priceFinish() { return { ...priceJob }; },
    async priceCancel() { priceJob = null; return { provinces: priceCfg, missing: [], job: null }; },
    // Bot ở bản xem trước: trả lời mẫu dựng từ số liệu, không gọi Gemini và không gửi gì ra ngoài.
    async botStatus() { return { hasKey: botHasKey, provider: botHasKey ? botProv : "", model: botHasKey ? (botModel[botProv] || (botProv === "claude" ? "claude-opus-5-5" : "gemini-3.5-flash-lite")) : "", used: botUsed, limit: 30 }; },
    async saveBotModel(m) { await new Promise((r) => setTimeout(r, 200)); m = String(m).trim().toLowerCase(); if (!(botProv === "claude" ? /^claude-/ : /^gemini/).test(m)) throw new Error("Tên model không khớp với key đang dùng."); botModel[botProv] = m; return this.botStatus(); },
    async saveBotKey(k) { await new Promise((r) => setTimeout(r, 200)); if (!/^[\x21-\x7e]{20,200}$/.test(k.trim())) throw new Error("Key không đúng dạng. Hãy chép lại đủ key, không có dấu cách."); botHasKey = true; botProv = /^sk-ant-/.test(k.trim()) ? "claude" : "gemini"; return { hasKey: true, provider: botProv, used: botUsed, limit: 30 }; },
    async askBot(q, ctx) {
      await new Promise((r) => setTimeout(r, 500));
      botUsed++;
      const s = ctx.chi_so, top = (ctx.theo_nganh || [])[0];
      return { used: botUsed, limit: 30, text: `[Bản xem trước: trả lời mẫu trên dữ liệu giả, chưa gọi Gemini]\nCâu hỏi: ${q}\n\n${ctx.pham_vi.tinh}: ${s.ty_le_khuyen_mai}% SKU có khuyến mãi, mức giảm trung vị ${s.giam_trung_vi}%.` + (top ? `\nNgành khuyến mãi nhiều nhất: ${top.nganh} (${top.ty_le_khuyen_mai}%).` : "") };
    },
    // Bản xem trước không gọi Google: đường giả gấp khúc qua các điểm, chỉ để xem giao diện.
    async getRoute(points) {
      await new Promise((r) => setTimeout(r, 300));
      const path = [], legs = [];
      points.forEach((p, k) => {
        if (!k) { path.push([p.lat, p.lng]); return; }
        const q = points[k - 1], km = 111 * Math.hypot(p.lat - q.lat, (p.lng - q.lng) * 0.93) * 1.3;
        path.push([q.lat, p.lng], [p.lat, p.lng]);
        legs.push({ km, min: km * 2.4 });
      });
      return { order: points.slice(1).map((_, k) => k), legs, path };
    },
    async getChanges() { return changes; },
    async getBoot() { return { settings: await this.getSettings(), snapshot: await this.getSnapshot(), changes: await this.getChanges() }; },
    async getVersions() { return versions.slice(); },
    async publishWm(rows) {                    // giống publish_wm_version: thay toàn bộ WM+, trả thống kê
      const d = window.WMUpload.diff(wm, rows), now = new Date();
      wm.splice(0, wm.length, ...rows.map(({ ma, ten, tinh, lat, lng, khu_vuc, chuoi, dia_chi }) => ({ ma, ten, tinh, lat, lng, khu_vuc, chuoi, dia_chi })));
      const v = { version: "v" + (versions.length + 1), uploaded: now.toLocaleString("vi-VN"), by: "admin.demo@example.com",
        rows: rows.length, added: d.added.length, removed: d.removed.length, moved: d.moved.length,
        status: "Còn hạn đến " + new Date(+now + 48 * 3600e3).toLocaleString("vi-VN") };
      versions.unshift(v); wmExpires = new Date(+now + 48 * 3600e3);
      return v;
    },
    async listUsers() { return users.slice(); },
    async addUser(email, role) {
      if (users.some(u => u.email === email)) throw new Error("Email đã có trong danh sách");
      users.push({ email, role, added: new Date().toISOString().slice(0, 10) });
      return { tempPassword: "demo12345678" };
    },
    async removeUser(email) { users = users.filter(u => u.email !== email); },
  };
})();
