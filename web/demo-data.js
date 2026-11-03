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
        vung, mien: !vung ? "" : vung === "Vùng 3" ? "Miền Y" : "Miền X", quan: !vung ? "" : g1 < 0 ? "Quận Nam" : g2 < 0 ? "Quận Tây" : "Quận Đông",
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
