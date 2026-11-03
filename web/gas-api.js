// Lớp dữ liệu Google Apps Script — cùng interface với DemoAPI (demo-data.js).
// Mọi kiểm tra quyền nằm ở backend (gas/Code.gs); file này chỉ gửi yêu cầu kèm token phiên.
(function () {
  const CFG = window.APP_CONFIG;
  if (CFG.mode !== "gas") return;
  const KEY = "wmbhx_token";
  const store = {                                       // localStorage: nhớ đăng nhập trên máy này tới khi Đăng xuất / hết 30 ngày
    get() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY); } catch (_) { return null; } },
    set(v) {
      try { sessionStorage.removeItem(KEY); v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (_) {}
    },
  };
  let token = store.get(), boot = null;
  const snapOf = (d) => ({ ...d, wmExpires: d.wmExpires ? new Date(d.wmExpires) : null });

  async function call(action, payload = {}) {
    let r;
    try {
      // text/plain → không có preflight CORS; Apps Script chuyển hướng sang googleusercontent rồi trả JSON
      r = await fetch(CFG.gasUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action, token, ...payload }), redirect: "follow", credentials: "omit" });
    } catch (_) { throw new Error("Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại."); }
    if (!r.ok) throw new Error(`Máy chủ lỗi (${r.status})`);
    const j = await r.json();
    if (j.error) {
      if (j.code === "AUTH") { token = null; store.set(null); }
      throw new Error(j.error);
    }
    return j.data;
  }

  window.GasAPI = {
    mode: "gas",
    async currentUser() {
      if (!token) return null;
      // Mở lại bằng phiên đã lưu: lấy luôn dữ liệu ban đầu trong cùng 1 lần gọi, getBoot dùng lại kết quả này.
      try { boot = await call("boot", { resume: true }); return boot.me; } catch (_) { return null; }
    },
    async getBoot() {
      const b = boot || await call("boot");
      boot = null;
      return { ...b, snapshot: snapOf(b.snapshot) };
    },
    async signIn(email, password) {
      const d = await call("login", { email, password });
      if (d.mustChange) return d;
      token = d.token; store.set(token);
      return { email: d.email, role: d.role };
    },
    async changePassword(email, password, newPassword) {
      const d = await call("changePassword", { email, password, newPassword });
      token = d.token; store.set(token);
      return { email: d.email, role: d.role };
    },
    resetPassword: (email) => call("resetPassword", { email }),
    async signOut() { try { await call("logout"); } finally { token = null; store.set(null); } },
    getSnapshot: async () => snapOf(await call("snapshot")),
    getChanges: () => call("changes"),
    getVersions: () => call("versions"),
    getSettings: () => call("settings"),
    setSetting: (key, value) => call("setSetting", { key, value }),
    publishWm: (rows) => call("publishWm", { rows }),
    listUsers: () => call("listUsers"),
    addUser: (email, role) => call("addUser", { email, role }),
    removeUser: (email) => call("removeUser", { email }),
    getAccessLog: () => call("accessLog"),
  };
})();
