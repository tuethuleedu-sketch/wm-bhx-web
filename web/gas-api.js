// Lớp dữ liệu Google Apps Script — cùng interface với DemoAPI (demo-data.js).
// Mọi kiểm tra quyền nằm ở backend (gas/Code.gs); file này chỉ gửi yêu cầu kèm token phiên.
(function () {
  const CFG = window.APP_CONFIG;
  if (CFG.mode !== "gas") return;
  const KEY = "wmbhx_token";
  const store = {                                       // sessionStorage: đóng tab là phải đăng nhập lại
    get() { try { return sessionStorage.getItem(KEY); } catch (_) { return null; } },
    set(v) { try { v ? sessionStorage.setItem(KEY, v) : sessionStorage.removeItem(KEY); } catch (_) {} },
  };
  let token = store.get();

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
      try { return await call("me"); } catch (_) { return null; }
    },
    requestOtp: (email) => call("requestOtp", { email }),
    async signIn(email, code) {
      const d = await call("verifyOtp", { email, code });
      token = d.token; store.set(token);
      return { email: d.email, role: d.role };
    },
    async signOut() { try { await call("logout"); } finally { token = null; store.set(null); } },
    async getSnapshot() {
      const d = await call("snapshot");
      return { ...d, wmExpires: d.wmExpires ? new Date(d.wmExpires) : null };
    },
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
