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
      const ma = "D" + String(p + 1) + String(i + 1).padStart(3, "0");
      wm.push({ ma, ten: "WM+ demo " + ma, tinh, lat: +(lat + gauss() * sd).toFixed(6), lng: +(lng + gauss() * sd).toFixed(6) });
    }
    for (let i = 0; i < Math.round(n * 2.3); i++) {
      bhx.push({
        ma: 90000 + bhx.length, tinh,
        dia_chi: `BHX demo ${Math.floor(rand() * 300) + 1} ${STREETS[Math.floor(rand() * STREETS.length)]}, ${tinh}`,
        lat: +(lat + gauss() * sd * 1.3).toFixed(6), lng: +(lng + gauss() * sd * 1.3).toFixed(6),
      });
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
    async requestOtp() {},
    async signIn(email) { return { email, role: "admin" }; },
    async signOut() {},
    async getSettings() { return { ...settings }; },
    async setSetting(key, value) { settings[key] = value; },
    async getSnapshot() {
      return { wm, bhx, bhxUpdated: "2026-10-30 06:00", wmVersion: versions[0].version + " — " + versions[0].uploaded.split(" ").pop(), wmExpires };
    },
    async getAccessLog() {
      const t = Date.now(), at = (h) => new Date(t - h * 3600e3).toISOString();
      return [
        { at: at(0.1), email: "admin.demo@example.com", event: "login" },
        { at: at(2), email: "dongnghiep1.demo@example.com", event: "resume" },
        { at: at(3), email: "nguoila.demo@example.com", event: "denied" },
        { at: at(5), email: "dongnghiep1.demo@example.com", event: "login" },
        { at: at(6), email: "admin.demo@example.com", event: "logout" },
      ];
    },
    async getChanges() { return changes; },
    async getVersions() { return versions.slice(); },
    async publishWm(rows) {                    // giống publish_wm_version: thay toàn bộ WM+, trả thống kê
      const d = window.WMUpload.diff(wm, rows), now = new Date();
      wm.splice(0, wm.length, ...rows.map(({ ma, ten, tinh, lat, lng }) => ({ ma, ten, tinh, lat, lng })));
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
    },
    async removeUser(email) { users = users.filter(u => u.email !== email); },
  };
})();
