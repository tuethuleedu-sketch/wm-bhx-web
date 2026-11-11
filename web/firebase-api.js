// Chạy trên Firebase gói miễn phí: đăng nhập bằng Firebase Auth, giá đối thủ lưu ở Firestore, trình duyệt Admin tự lấy giá từ BHX.
// Các phần còn lại (WM+, danh sách cửa hàng, tuyến đường, bot) vẫn gọi Apps Script, kèm token Firebase để Apps Script xác minh.
// Đang chạy song song với bản cũ: chỉ bật khi mở web với ?fb=1, tắt bằng ?fb=0.
(function () {
  const CFG = window.APP_CONFIG;
  if (CFG.mode !== "gas" || !window.GasAPI) return;
  const FLAG = "wmbhx_fb", q = new URLSearchParams(location.search).get("fb");
  try { if (q === "1") localStorage.setItem(FLAG, "1"); if (q === "0") localStorage.removeItem(FLAG); } catch (_) {}
  let on = false;
  try { on = localStorage.getItem(FLAG) === "1"; } catch (_) {}
  if (!on) return;

  // Cấu hình web của Firebase là mã định danh công khai; dữ liệu được bảo vệ bằng đăng nhập và quy tắc Firestore.
  const FB = { apiKey: "AIzaSyBXVRExNrdhPRpgQxCjYFcmhCbryMvZ9yw", authDomain: "bhx-map.firebaseapp.com", projectId: "bhx-map", storageBucket: "bhx-map.firebasestorage.app", messagingSenderId: "572165460587", appId: "1:572165460587:web:35760ee5273541eb05172e" };
  const SDK = "https://www.gstatic.com/firebasejs/11.10.0/", SESSION_DAYS = 7, DOC_MAX = 1000000, SHARDS = 8;
  const BHX_URL = "https://api.bachhoaxanh.com/gw/Category/AjaxProduct", PAGE = 50, DELAY = 300, RETRY = 3, STEP_MS = 6000, JOB = "wmbhx_price_job";
  const DEFAULT = [{ tinh: "Hồ Chí Minh", provinceId: "1027", wardId: "100675", storeId: "6834" }, { tinh: "Hà Nội", provinceId: "1000", wardId: "103282", storeId: "30964" }, { tinh: "Cần Thơ", provinceId: "1032", wardId: "100166", storeId: "14387" }];
  const CATS = [10338, 10340, 11238, 2282, 2286, 2289, 2382, 2385, 2386, 2387, 2388, 2403, 2443, 2444, 2446, 2463, 2464, 2465, 2483, 2484, 2485, 2486, 2490, 2491, 2493, 2504, 2507, 2510, 2511, 2513, 2516, 2517, 2519, 2524, 2526, 2530, 2563, 2564, 2565, 2566, 2567, 2683, 2687, 2787, 2803, 2804, 2806, 2809, 2883, 2903, 2943, 2944, 2947, 2965, 3003, 3004, 3023, 3027, 3028, 3063, 3104, 3124, 3187, 3188, 3226, 3233, 3234, 3235, 3237, 3238, 3265, 3345, 3357, 3358, 3359, 3360, 3361, 3362, 3364, 3365, 3368, 3465, 3485, 3487, 3507, 3525, 3708, 3727, 3728, 3732, 3740, 4326, 4352, 4585, 4888, 4929, 5226, 5436, 56, 5872, 6553, 6562, 6597, 6653, 6658, 7068, 7082, 7083, 7086, 7143, 7162, 7170, 7171, 7199, 7259, 7459, 7462, 7478, 7480, 7558, 7579, 7618, 7622, 7694, 7779, 8139, 8158, 8159, 8160, 8163, 8271, 8275, 8285, 8286, 8318, 8320, 8338, 8400, 8638, 8678, 8779, 8781, 8782, 8783, 8785, 8788, 8790, 8820, 8938, 8966, 9027, 9081, 9498];

  const G = window.GasAPI, gas = { ...G };
  let auth = null, db = null, booted = null;
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const addScript = (src) => new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => fail(new Error("Không tải được thư viện Firebase. Kiểm tra mạng rồi thử lại.")); document.head.appendChild(s); });
  function ready() {
    if (booted) return booted;
    booted = (async () => {
      if (!window.firebase) { await addScript(SDK + "firebase-app-compat.js"); await addScript(SDK + "firebase-auth-compat.js"); await addScript(SDK + "firebase-firestore-compat.js"); }
      firebase.initializeApp(FB);
      auth = firebase.auth(); db = firebase.firestore();
      await new Promise((ok) => { const off = auth.onAuthStateChanged(() => { off(); ok(); }); });
      G._setTokenFn(() => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve("")));
    })();
    return booted;
  }
  const authMsg = (e) => ({ "auth/invalid-credential": "Email hoặc mật khẩu không đúng.", "auth/wrong-password": "Email hoặc mật khẩu không đúng.", "auth/user-not-found": "Email hoặc mật khẩu không đúng.", "auth/invalid-email": "Email không hợp lệ.", "auth/too-many-requests": "Thử sai quá nhiều lần. Đợi một lúc rồi thử lại.", "auth/email-already-in-use": "Email này đã tạo mật khẩu rồi. Hãy đăng nhập, hoặc bấm Quên mật khẩu.", "auth/weak-password": "Mật khẩu quá yếu, cần ít nhất 8 ký tự.", "auth/requires-recent-login": "Hãy đăng nhập lại rồi đổi mật khẩu.", "auth/network-request-failed": "Không kết nối được máy chủ đăng nhập. Kiểm tra mạng rồi thử lại." }[e.code] || e.message);
  const wrap = async (fn) => { try { return await fn(); } catch (e) { throw e.code && /^auth\//.test(e.code) ? new Error(authMsg(e)) : e; } };
  async function sessionOk(u) {
    if (!u.emailVerified) { G.sessionNote = "Email chưa được xác nhận. Hãy mở thư xác nhận rồi đăng nhập lại."; await auth.signOut(); return false; }
    const t = await u.getIdTokenResult();
    if (Date.now() - new Date(t.authTime).getTime() > SESSION_DAYS * 864e5) { G.sessionNote = "Phiên đăng nhập đã hết 7 ngày, hãy đăng nhập lại."; await auth.signOut(); return false; }
    return true;
  }
  // Quyền đọc từ Firestore cho nhanh; Apps Script vẫn kiểm tra lại ở nền (ghi nhật ký, thu hồi quyền có hiệu lực).
  // Chưa có trong Firestore thì hỏi Apps Script. null = không có quyền.
  let ME = null;
  async function whoAmI() {
    const email = auth.currentUser.email.toLowerCase();
    let role = null;
    try { const d = await db.collection("users").doc(email).get(); if (d.exists) role = d.data().role; } catch (_) {}
    if (role) {
      G.me().catch(async (e) => { if (e.code === "AUTH") { await auth.signOut(); location.reload(); } });
      return (ME = { email, role });
    }
    try { ME = await G.me(); }
    catch (e) { if (e.code !== "AUTH") throw e; G.sessionNote = e.message; await auth.signOut(); return (ME = null); }
    if (ME.role === "admin") db.collection("users").doc(email).set({ role: "admin" }).catch(() => {});
    return ME;
  }

  Object.assign(G, {
    fb: true,
    hasSession() { try { return !!localStorage.getItem(`firebase:authUser:${FB.apiKey}:[DEFAULT]`); } catch (_) { return false; } },
    async currentUser() {
      await ready();
      if (!auth.currentUser || !(await sessionOk(auth.currentUser))) return null;
      return whoAmI();
    },
    signIn: (email, password) => wrap(async () => {
      await ready();
      const { user } = await auth.signInWithEmailAndPassword(email, password);
      if (!user.emailVerified) { await user.sendEmailVerification(); await auth.signOut(); throw new Error("Email chưa được xác nhận. Đã gửi lại thư xác nhận, hãy mở thư rồi đăng nhập lại."); }
      const me = await whoAmI();
      if (!me) throw new Error(G.sessionNote || "Email này chưa được cấp quyền.");
      return me;
    }),
    fbRegister: (email, password) => wrap(async () => {
      await ready();
      const { user } = await auth.createUserWithEmailAndPassword(email, password);
      await user.sendEmailVerification();
      await auth.signOut();
    }),
    fbForgot: (email) => wrap(async () => { await ready(); await auth.sendPasswordResetEmail(email); }),
    changePassword: (email, password, newPassword) => wrap(async () => {
      await ready();
      const u = auth.currentUser;
      await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, password));
      await u.updatePassword(newPassword);
      return whoAmI();
    }),
    async signOut() { await ready(); await auth.signOut(); },
    resetPassword: (email) => wrap(async () => { await ready(); await auth.sendPasswordResetEmail(email); return { sent: true }; }),
    // Danh sách quyền gốc ở Apps Script; chép sang Firestore để quy tắc Firestore dùng được.
    async listUsers() {
      const list = await gas.listUsers();
      await ready();
      const keep = new Set(list.map((u) => u.email.toLowerCase()));
      const old = await db.collection("users").get();
      const batch = db.batch();
      list.forEach((u) => batch.set(db.collection("users").doc(u.email.toLowerCase()), { role: u.role }));
      old.docs.forEach((d) => { if (!keep.has(d.id)) batch.delete(db.collection("users").doc(d.id)); });   // quyền bị gỡ ở bản cũ cũng gỡ ở đây
      await batch.commit();
      return list;
    },
    async addUser(email, role) {
      const r = await gas.addUser(email, role);
      await ready();
      await db.collection("users").doc(String(email).trim().toLowerCase()).set({ role });
      return r;
    },
    async removeUser(email) {
      const r = await gas.removeUser(email);
      await ready();
      await db.collection("users").doc(String(email).trim().toLowerCase()).delete();
      return r;
    },
  });

  // ---------- Bản đồ: WM+, cửa hàng đối thủ, biến động ----------
  // Apps Script vẫn giữ bản gốc (tự lấy cửa hàng BHX và đối thủ mỗi sáng, vì BHX chỉ cho máy chủ Google lấy).
  // Firestore giữ bản sao để mở web đọc nhanh. Chỉ Admin ghi bản sao; Viewer chỉ đọc.
  // WM+ để riêng ở cache_wm, kèm hạn 48 giờ: quá hạn thì quy tắc Firestore chặn đọc, Admin xoá khi mở web, Firestore TTL xoá dự phòng.
  const CACHE_MAX = 700000, FRESH_MS = 30 * 36e5, REFRESH_MS = 36e5;
  const cacheMeta = () => db.collection("cache").doc("meta");
  const enc = new TextEncoder();
  function chunks(arr) {
    const out = []; let cur = [], size = 2;
    for (const x of arr) {
      const n = enc.encode(JSON.stringify(x)).length + 1;
      if (cur.length && size + n > CACHE_MAX) { out.push(cur); cur = []; size = 2; }
      cur.push(x); size += n;
    }
    if (cur.length || !out.length) out.push(cur);
    return out.map((c) => JSON.stringify(c));
  }
  const partIds = (gen, name, n) => Array.from({ length: n }, (_, i) => `${gen}_${name}_${i}`);
  async function readParts(col, ids) {
    const docs = await Promise.all(ids.map((id) => db.collection(col).doc(id).get()));
    if (docs.some((d) => !d.exists)) throw new Error("Bản sao đang được cập nhật");
    return docs.flatMap((d) => JSON.parse(d.data().d));
  }
  const delDocs = (col, ids) => Promise.all(ids.map((id) => db.collection(col).doc(id).delete().catch(() => {})));
  const wmLive = (m) => m.wmParts > 0 && m.wmExpires > Date.now();
  let metaErr = "";
  async function readMetaCache() {
    try { const d = await cacheMeta().get(); metaErr = d.exists ? "" : "chưa có bản sao"; return d.exists ? d.data() : null; }
    catch (e) { metaErr = e.code === "permission-denied" ? "Firestore từ chối đọc, kiểm tra Quy tắc" : "không đọc được Firestore"; return null; }
  }
  async function readCache(m) {
    const P = m.parts || {};
    const [bhx, comp, changes, wm] = await Promise.all([
      readParts("cache", partIds(m.gen, "bhx", P.bhx || 0)), readParts("cache", partIds(m.gen, "comp", P.comp || 0)),
      readParts("cache", partIds(m.gen, "changes", P.changes || 0)),
      wmLive(m) ? readParts("cache_wm", partIds(m.wmGen, "wm", m.wmParts)) : [],
    ]);
    const live = wmLive(m);
    return {
      me: ME, settings: m.settings ? JSON.parse(m.settings) : { viewer_can_export: true }, changes,
      snapshot: { wm: live ? wm : [], bhx, comp, compUpdated: m.compUpdated || "", compStatus: m.compStatus || "",
        wmVersion: live ? m.wmVersion : "chưa có", wmExpires: live ? new Date(m.wmExpires) : null, bhxUpdated: m.bhxUpdated || "chưa chạy" },
    };
  }
  async function writeWm(rows, expires, version) {
    const wmGen = String(Date.now()), parts = chunks(rows), expireAt = firebase.firestore.Timestamp.fromMillis(expires);
    await Promise.all(parts.map((d, i) => db.collection("cache_wm").doc(`${wmGen}_wm_${i}`).set({ d, expireAt })));
    return { wmGen, wmParts: parts.length, wmExpires: expires, wmVersion: version };
  }
  // Lấy bản gốc từ Apps Script rồi ghi bản sao. Ghi phần mới trước, đổi meta sau, xoá phần cũ cuối cùng.
  async function refreshCache(pre) {
    const b = pre || await gas.getBoot.call(G), s = b.snapshot, old = (await readMetaCache()) || {};
    const gen = String(Date.now()), parts = {}, writes = [];
    for (const [name, arr] of [["bhx", s.bhx || []], ["comp", s.comp || []], ["changes", b.changes || []]]) {
      const c = chunks(arr); parts[name] = c.length;
      c.forEach((d, i) => writes.push(db.collection("cache").doc(`${gen}_${name}_${i}`).set({ d })));
    }
    await Promise.all(writes);
    const exp = s.wmExpires ? s.wmExpires.getTime() : 0;
    let wm = { wmGen: "", wmParts: 0, wmExpires: 0, wmVersion: "" };
    if (s.wm && s.wm.length && exp > Date.now()) {
      wm = old.wmVersion === s.wmVersion && wmLive(old) ? { wmGen: old.wmGen, wmParts: old.wmParts, wmExpires: Math.min(old.wmExpires, exp), wmVersion: old.wmVersion }
        : await writeWm(s.wm, exp, s.wmVersion);
    }
    await cacheMeta().set({ gen, parts, ...wm, syncedAt: Date.now(), settings: JSON.stringify(b.settings || {}),
      compUpdated: s.compUpdated || "", compStatus: s.compStatus || "", bhxUpdated: s.bhxUpdated || "" });
    if (old.gen) for (const [name, n] of Object.entries(old.parts || {})) await delDocs("cache", partIds(old.gen, name, n));
    if (old.wmGen && old.wmGen !== wm.wmGen) await delDocs("cache_wm", partIds(old.wmGen, "wm", old.wmParts || 0));
    G.listUsers().catch(() => {});
    return { ...b, me: ME };
  }
  // Admin mở web sau khi WM+ hết 48 giờ: xoá hẳn phần WM+ trong bản sao.
  async function purgeWm(m) {
    if (!m || !m.wmParts || m.wmExpires > Date.now()) return;
    await cacheMeta().set({ wmGen: "", wmParts: 0, wmExpires: 0, wmVersion: "" }, { merge: true });
    await delDocs("cache_wm", partIds(m.wmGen, "wm", m.wmParts));
  }
  // Ghi lại nguồn và thời gian tải để hiện dưới bản đồ, biết ngay đang nhanh hay đang phải quay về Apps Script.
  async function cachedOrGas() {
    await ready();
    const t0 = Date.now(), sec = () => ((Date.now() - t0) / 1000).toFixed(1).replace(".", ",") + " giây";
    const m = await readMetaCache(), admin = ME && ME.role === "admin";
    let why = m ? "bản sao quá 30 giờ" : metaErr;
    if (m && Date.now() - m.syncedAt < FRESH_MS) {
      try {
        const b = await readCache(m);
        if (admin) { purgeWm(m).catch(() => {}); if (Date.now() - m.syncedAt > REFRESH_MS) refreshCache().catch(() => {}); }
        G.loadInfo = "Firebase, " + sec();
        return b;
      } catch (e) { why = e.code === "permission-denied" ? "Firestore từ chối đọc, kiểm tra Quy tắc" : "bản sao đang cập nhật"; }
    }
    const b = await gas.getBoot.call(G);
    if (admin) {
      try { await refreshCache(b); why += "; đã chép sang Firebase cho lần sau"; }
      catch (e) { why += "; chép sang Firebase lỗi: " + (e.code === "permission-denied" ? "Firestore từ chối ghi, kiểm tra Quy tắc" : e.message); }
    }
    G.loadInfo = `Apps Script, ${sec()} (${why})`;
    return { ...b, me: ME };
  }
  Object.assign(G, {
    getBoot: cachedOrGas,
    getSnapshot: async () => (await cachedOrGas()).snapshot,
    getChanges: async () => (await cachedOrGas()).changes,
    getSettings: async () => (await cachedOrGas()).settings,
    async setSetting(key, value) {
      const r = await gas.setSetting(key, value);
      const m = await readMetaCache();
      if (m) await cacheMeta().set({ settings: JSON.stringify({ ...(m.settings ? JSON.parse(m.settings) : {}), [key]: value }) }, { merge: true });
      return r;
    },
    // Lưu vào Apps Script như cũ, rồi chép ngay WM+ mới sang bản sao. Hạn tính từ trước lúc lưu nên không dài hơn bản gốc.
    async publishWm(rows) {
      const t0 = Date.now(), r = await gas.publishWm(rows);
      await ready();
      const old = (await readMetaCache()) || {};
      if (!old.gen) { await refreshCache(); return r; }
      rows = rows.map((w) => ({ ...w, ma: String(w.ma).trim(), ten: w.ten || String(w.ma).trim(), lat: Number(w.lat), lng: Number(w.lng), chuoi: w.chuoi || "WM+" }));   // giống cách Apps Script lưu
      const wm = await writeWm(rows, t0 + 48 * 36e5, r.version + " — " + new Date(t0 + 7 * 36e5).toISOString().slice(0, 10).split("-").reverse().join("/"));
      await cacheMeta().set(wm, { merge: true });
      if (old.wmGen) await delDocs("cache_wm", partIds(old.wmGen, "wm", old.wmParts || 0));
      return r;
    },
  });

  // ---------- Dữ liệu giá ----------
  // Mỗi tỉnh một tài liệu, lưu dạng chuỗi JSON để nằm gọn trong 1 lượt ghi và không tốn chỉ mục.
  const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const shardOf = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return "s" + (h % SHARDS); };
  const pack = (v) => { const s = JSON.stringify(v); if (new Blob([s]).size > DOC_MAX) throw new Error("Dữ liệu vượt giới hạn 1 MB của một tài liệu Firestore."); return s; };
  const today = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
  const metaRef = () => db.collection("price").doc("meta");
  async function readMeta() { const d = await metaRef().get(); return d.exists ? d.data() : {}; }
  const metaRuns = (m) => (m.runs ? JSON.parse(m.runs) : []);
  // Mỗi tỉnh tối đa 2 cửa hàng: Thành thị và Nông thôn. Giá lưu theo "nơi lấy giá": Thành thị giữ tên tỉnh (khớp dữ liệu cũ), Nông thôn thêm " · Nông thôn".
  const URBAN = "Thành thị", RURAL = "Nông thôn";
  // Chuỗi khác BHX: tên nơi lấy giá có mã chuỗi ở đầu, ví dụ "LOTTE: Hồ Chí Minh".
  const chainOf = (p) => (p.chain === "LOTTE" || p.chain === "KFM" ? p.chain : "BHX");
  const locName = (p) => (chainOf(p) === "BHX" ? "" : chainOf(p) + ": ") + (p.khu === RURAL ? `${p.tinh} · ${RURAL}` : p.tinh);
  const metaProvinces = (m) => (m.provinces ? JSON.parse(m.provinces) : DEFAULT).map((p) => ({ ...p, khu: p.khu === RURAL ? RURAL : URBAN }));
  async function readCur(tinh) { const d = await db.collection("price_cur").doc(slug(tinh)).get(); return d.exists ? d.data() : null; }
  async function readShards() {
    const docs = await Promise.all(Array.from({ length: SHARDS }, (_, k) => db.collection("price_skus").doc("s" + k).get()));
    const out = {}; docs.forEach((d, k) => (out["s" + k] = d.exists ? JSON.parse(d.data().json) : {}));
    return out;
  }
  const toItem = (a) => ({ id: a[0], final: a[1], base: a[2], off: a[3], promo: !!a[4], title: a[5], can: !!a[6], first_seen: a[7], last_seen: a[8] });
  const fromRow = (r, first, date) => [r.id, r.final, r.base, Math.round(r.off * 10000) / 10000, r.promo ? 1 : 0, r.title, r.can === false ? 0 : 1, first, date];

  // Cùng quy tắc với Apps Script: chỉ thêm lịch sử khi SKU mới hoặc đổi giá; tải lại trong ngày thì gộp vào ngày đó.
  async function saveProvince(tinh, store, rows, date, file, force, skus, addr) {
    const key = slug(tinh), cur = await readCur(tinh), old = cur ? JSON.parse(cur.items) : [];
    const last = old.reduce((m, a) => (a[8] > m ? a[8] : m), "");
    if (last > date) throw new Error(`${tinh} đã có giá ngày ${last}, mới hơn ngày ${date}.`);
    const active = old.filter((a) => a[8] === last).length;
    if (!force && active && rows.length < active * 0.7) throw Object.assign(new Error(`${tinh}: chỉ lấy được ${rows.length} SKU, ít hơn nhiều so với ${active} SKU lần trước.`), { code: "PRICE_SHRINK" });
    const prev = new Map(old.map((a) => [a[0], a])), seen = new Set(rows.map((r) => r.id));
    const dates = cur && cur.dates ? JSON.parse(cur.dates).filter((d) => d < date) : [], earlier = dates.length ? dates[dates.length - 1] : "";
    const s = { tinh, rows: rows.length, added: 0, gone: 0, up: 0, down: 0 }, hist = [], items = [];
    old.forEach((a) => {
      if (seen.has(a[0])) return;
      if (a[8] === last) s.gone++;
      if (a[8] !== date) items.push(a); else if (a[7] !== date && earlier) { a[8] = earlier; items.push(a); }
    });
    rows.forEach((r) => {
      const o = prev.get(r.id);
      if (!o) s.added++; else if (o[1] && r.final > o[1]) s.up++; else if (o[1] && r.final < o[1]) s.down++;
      if (!o || o[1] !== r.final || o[2] !== r.base) hist.push([r.id, r.final, r.base]);
      items.push(fromRow(r, o ? o[7] : date, date));
      const shard = skus[shardOf(r.id)];
      shard[r.id] = [r.code, r.name, r.cat, r.brand, r.unit, r.url, r.grp || ""];
    });
    const histRef = db.collection("price_hist").doc(`${key}_${date}`), histOld = await histRef.get();
    if (histOld.exists) { const add = new Set(hist.map((h) => h[0])); JSON.parse(histOld.data().rows).forEach((h) => { if (!add.has(h[0])) hist.push(h); }); }
    const m = await readMeta(), runs = metaRuns(m).concat([{ date, at: new Date().toISOString(), tinh, store, ...(addr ? { addr: String(addr).slice(0, 200) } : {}), file, by: auth.currentUser.email, n: rows.length, oos: rows.filter((r) => r.can === false).length, added: s.added, gone: s.gone, up: s.up, down: s.down }]).slice(-1500);
    const batch = db.batch();
    batch.set(db.collection("price_cur").doc(key), { tinh, store, latest: date, items: pack(items), dates: JSON.stringify(dates.concat(date).slice(-60)) });
    batch.set(histRef, { tinh, date, rows: pack(hist) });
    batch.set(metaRef(), { runs: pack(runs) }, { merge: true });
    Object.keys(skus).forEach((k) => batch.set(db.collection("price_skus").doc(k), { json: pack(skus[k]) }));
    await batch.commit();
    return s;
  }
  function rowOf(raw, prov) {
    const d = raw && raw.data ? raw.data : raw, num = (v) => { const x = Number(v); return isFinite(x) ? x : 0; };
    const list = d.lstCampaingInfo, pr = (Array.isArray(d.productPrices) && d.productPrices[0]) || {}, camp = d.campaignInfo || d.promotionInfo || (Array.isArray(list) && list[0]) || null;
    const price = num(pr.price !== undefined ? pr.price : d.price), sys = num(pr.sysPrice !== undefined ? pr.sysPrice : d.sysPrice || d.originalPrice), flash = camp ? num(camp.price) : 0;
    const final = flash > 0 && flash < price ? flash : price, base = sys > final ? sys : price;
    let off = base > 0 && final > 0 ? 1 - final / base : 0;
    if (off < 0.005) off = num((camp && camp.discountPercent) || (pr.discountPercent !== undefined ? pr.discountPercent : d.discountPercent)) / 100;
    if (!(off > 0 && off < 1)) off = 0;
    const title = String((camp && (camp.title || camp.name)) || d.promotionText || "").trim().slice(0, 200), url = d.url ? "https://www.bachhoaxanh.com" + d.url : "";
    return { id: String(d.id ?? ""), code: String(d.productCode || d.barcode || ""), name: String(d.name || d.productName || "").slice(0, 300), cat: String((d.category && d.category.name) || d.categoryName || ""), brand: String(d.brandName || ""), unit: String(d.unit || d.unitName || d.quantityUnit || ""), url, final, base, off, promo: off > 0 || title !== "" || !!camp, can: pr.isCanBuy !== false && d.isCanBuy !== false, title };
  }
  async function bhxPage(prov, cat, page) {
    let last = "";
    for (let a = 0; a < RETRY; a++) {
      if (a) await sleep(2000 * a);
      let r;
      try {
        r = await fetch(BHX_URL, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", Accept: "application/json, text/plain, */*", platform: "webnew", reversehost: "http://bhxapi.live", xapikey: "bhx-api-core-2022" },
          body: JSON.stringify({ provinceId: Number(prov.provinceId), wardId: Number(prov.wardId), districtId: 0, storeId: Number(prov.storeId), CategoryId: cat, SelectedBrandId: "", PropertyIdList: "", SortStr: "", PropertySelected: [], PageIndex: page, PageSize: PAGE, PriorityProductIds: "", LastShowProductId: 0 }) });
      } catch (_) { last = "không kết nối được BHX"; continue; }
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`BHX từ chối (${r.status}).`), { stop: true });
      if (r.status === 429) throw Object.assign(new Error("BHX báo gọi quá nhiều (429). Đợi một lúc rồi bấm Tiếp tục."), { stop: true });
      if (r.status !== 200) { last = "HTTP " + r.status; continue; }
      try { const d = await r.json(); return (d.data && d.data.products) || []; } catch (_) { last = "phản hồi không đọc được"; }
    }
    throw new Error(`Ngành ${cat} của ${prov.tinh} lỗi: ${last}`);
  }

  // Tiến độ theo tỉnh lưu ở trình duyệt: đóng tab thì chạy tiếp từ tỉnh đang dở.
  // ---------- Nguồn giá theo chuỗi ----------
  // LOTTE: trình duyệt gọi thẳng web LOTTE (web cho phép). Mỗi ngành lớn 1 lần gọi, tối đa 1.000 SKU một trang. Giá theo từng siêu thị.
  const LOTTE_API = "https://www.lottemart.vn/v1/p/mart/es/vi_", LOTTE_SIZE = 1000;
  // Ngành lớn của LOTTE có bán ở BHX/WM (bỏ điện gia dụng, thú cưng, thời trang, thể thao).
  const LOTTE_CATS = [3, 266, 495, 285, 303, 167, 506, 200, 186, 161, 143, 231, 111, 140, 226, 122, 261, 314, 516, 325, 351, 369];
  const CHAIN_NAME = { BHX: "BHX", LOTTE: "LOTTE", KFM: "Kingfoodmart" };
  async function lottePage(store, cat, page) {
    let last = "";
    for (let a = 0; a < RETRY; a++) {
      if (a) await sleep(2000 * a);
      let r;
      try { r = await fetch(`${LOTTE_API}${store}/categories/${cat}/products`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page_number: page, page_size: LOTTE_SIZE }) }); }
      catch (_) { last = "không kết nối được LOTTE"; continue; }
      if (r.status === 403 || r.status === 429) throw new Error(`LOTTE từ chối (${r.status}). Đợi một lúc rồi bấm Tiếp tục.`);
      if (r.status !== 200) { last = "HTTP " + r.status; continue; }
      try { const d = await r.json(); return (d.data && d.data.items) || []; } catch (_) { last = "phản hồi không đọc được"; }
    }
    throw new Error(`Ngành ${cat} của LOTTE ${store} lỗi: ${last}`);
  }
  function lotteRow(it) {
    const num = (v) => { const x = Number(v); return isFinite(x) ? x : 0; }, V = (it.price && it.price.VND) || {};
    const regular = num(V.default), price = num(V.price) || regular, special = num(V.special_price), orig = num(V.default_original);
    const final = special > 0 && special < price ? special : price, base = Math.max(orig, regular, final);
    const path = (it.category_full_path || []).filter((s) => !/^virtual/i.test(s)).sort((a, b) => b.split(" / ").length - a.split(" / ").length)[0] || "";
    const parts = path.split(" / "), grp = parts[1] || parts[0] || "", title = String(V.default_discount_label || "").trim().slice(0, 200);
    const off = base > 0 && final > 0 && base > final ? 1 - final / base : 0;
    return { id: "LOTTE:" + it.id, code: String(it.sku || ""), name: String(it.name || "").slice(0, 300), grp, cat: parts[2] || grp, brand: "", unit: "", url: /^https:\/\/www\.lottemart\.vn\//.test(it.url || "") ? it.url : "",
      final, base, off, promo: off > 0 || title !== "", title, can: String(it.in_stock) === "1" && num(it.stock_qty) > 0 };
  }
  // LOTTE trả tối đa 1.000 SKU cho mỗi ngành và không cho chọn trang tiếp theo, nên lấy theo ngành sâu nhất của các ngành lớn trên.
  const lotteTree = new Map(), lotteKids = new Map();
  async function lotteLeaves(store) {
    if (lotteTree.has(store)) return lotteTree.get(store);
    let d = null;
    try { const r = await fetch(`${LOTTE_API}${store}/categories/tree/filter?level=3`, { credentials: "omit" }); if (r.ok) d = await r.json(); } catch (_) {}
    if (!d || !Array.isArray(d.data)) throw new Error(`Không đọc được danh mục của LOTTE ${store}.`);
    const want = new Set(LOTTE_CATS.map(String)), out = [];
    // Lấy theo ngành con (cấp 4); ngành con nào chạm 1.000 SKU thì mới đi sâu thêm (xem SRC.LOTTE), để đỡ số lần gọi.
    const kids = lotteKids.get(store) || new Map(); lotteKids.set(store, kids);
    const note = (c) => { const ch = Array.isArray(c.child) ? c.child : []; kids.set(Number(c.id), ch.map((k) => Number(k.id)).filter(Boolean)); ch.forEach(note); };
    d.data.forEach((c) => { if (!want.has(String(c.id))) return; note(c); const ch = kids.get(Number(c.id)); out.push(...(ch.length ? ch : [Number(c.id)])); });
    if (!out.length) throw new Error(`Danh mục LOTTE ${store} không có ngành nào cần lấy.`);
    lotteTree.set(store, out);
    return out;
  }
  // Kingfoodmart: web không cho trình duyệt ở trang khác gọi thẳng, nên Apps Script lấy hộ từng trang (không ghi gì vào Sheet).
  let kfmCats = null;
  async function catsFor(p) {
    const c = chainOf(p);
    if (c === "LOTTE") return lotteLeaves(p.storeId);
    if (c === "KFM") { if (!kfmCats) kfmCats = (await gas.kfmPricePage("", 1)).cats.map((x) => x.slug); return kfmCats; }
    return CATS;
  }
  const catsLen = (p) => (chainOf(p) === "LOTTE" ? (lotteTree.get(p.storeId) || { length: 90 }).length : chainOf(p) === "KFM" ? (kfmCats ? kfmCats.length : 15) : CATS.length);
  const SRC = {
    BHX: { page: async (p, cat, page) => { const l = await bhxPage(p, cat, page); return { rows: l.map((x) => rowOf(x, p)), more: l.length === PAGE }; } },
    LOTTE: { page: async (p, cat, page) => {
      const l = await lottePage(p.storeId, cat, page), deeper = l.length >= LOTTE_SIZE ? ((lotteKids.get(p.storeId) || new Map()).get(Number(cat)) || []) : [];
      return { rows: l.map(lotteRow), more: false, expand: deeper };   // chạm 1.000 SKU: lấy thêm các ngành con của ngành này
    } },
    KFM: { page: async (p, slug, page) => { const d = await gas.kfmPricePage(slug, page + 1); return { rows: d.items, more: d.page < d.last }; } },
  };

  let job = null, buf = null, shards = null;
  const saveJob = () => { try { const { summary, ...j } = job; localStorage.setItem(JOB, JSON.stringify({ ...j, summary })); } catch (_) {} };
  const loadJob = () => { try { return JSON.parse(localStorage.getItem(JOB) || "null"); } catch (_) { return null; } };
  const out = (j) => (j ? { id: j.id, status: j.status, date: j.date, msg: j.msg || "", tinh: j.provinces[j.pi] ? locName(j.provinces[j.pi]) : "", count: j.provinces.length, done: j.provinces.slice(0, j.pi).reduce((a, p) => a + catsLen(p), 0) + j.ci, total: j.provinces.reduce((a, p) => a + catsLen(p), 0), rows: j.rows, summary: j.summary || null } : null);
  async function saveCurrent(force) {
    const p = job.provinces[job.pi];
    try {
      if (!shards) shards = await readShards();
      const s = await saveProvince(locName(p), p.storeId, buf.rows, job.date, "Cập nhật trực tiếp", force, shards, p.addr);
      job.summary.provinces.push(s); job.rows += s.rows; job.pi++; job.ci = 0; job.page = 0; buf = null; job.msg = "";
      job.status = job.pi >= job.provinces.length ? "done" : "running";
    } catch (e) {
      if (e.code === "PRICE_SHRINK") { job.status = "confirm"; job.msg = e.message + " Dữ liệu cũ của tỉnh này giữ nguyên."; }
      else { job.status = "paused"; job.msg = e.message + " Các tỉnh đã lưu vẫn giữ nguyên."; }
    }
    saveJob();
  }
  Object.assign(G, {
    fbPrice: true,
    async getPrices() {
      await ready();
      const [m, curSnap, skus] = await Promise.all([readMeta(), db.collection("price_cur").get(), readShards()]);
      const skuList = [], items = [];
      Object.values(skus).forEach((sh) => Object.entries(sh).forEach(([id, a]) => skuList.push({ id, code: a[0], name: a[1], cat: a[2], brand: a[3], unit: a[4], url: a[5], grp: a[6] || "" })));
      curSnap.docs.forEach((d) => { const c = d.data(); JSON.parse(c.items).forEach((a) => items.push({ ...toItem(a), tinh: c.tinh, store: c.store })); });
      return { skus: skuList, items, runs: metaRuns(m), hist: [], regions: m.regions ? JSON.parse(m.regions) : null };
    },
    // Chép lịch sử giá đã lưu ở bản Apps Script (Google Sheet) sang Firestore. Chạy lại nhiều lần cũng không nhân đôi:
    // ngày nào Firestore đã có thì giữ bản Firestore, SKU đã có thì chỉ lùi ngày xuất hiện đầu tiên, lần tải trùng thì bỏ.
    async importGasPrices() {
      await ready();
      const g = await gas.getPrices();
      if (!g.items.length && !g.hist.length) return { provinces: [], dates: 0 };
      const skus = await readShards(), m = await readMeta(), out = [];
      g.skus.forEach((s) => { const sh = skus[shardOf(s.id)]; if (!sh[s.id]) sh[s.id] = [s.code, s.name, s.cat, s.brand, s.unit, s.url]; });
      const tinhs = [...new Set(g.items.map((x) => x.tinh).concat(g.hist.map((h) => h[1])))].filter(Boolean);
      for (const tinh of tinhs) {
        const key = slug(tinh), cur = await readCur(tinh);
        const fsDates = cur && cur.dates ? JSON.parse(cur.dates) : [], byId = new Map((cur ? JSON.parse(cur.items) : []).map((a) => [a[0], a]));
        const gi = g.items.filter((x) => x.tinh === tinh);
        gi.forEach((x) => { const a = byId.get(x.id); if (!a) byId.set(x.id, fromRow(x, x.first_seen, x.last_seen)); else if (x.first_seen && x.first_seen < a[7]) a[7] = x.first_seen; });
        const byDate = new Map();
        g.hist.filter((h) => h[1] === tinh).forEach((h) => { if (!byDate.has(h[0])) byDate.set(h[0], []); byDate.get(h[0]).push([h[2], h[3], h[4]]); });
        let added = 0;
        for (const [d, rows] of byDate) {
          if (fsDates.includes(d)) continue;                                   // ngày Firestore đã có thì giữ nguyên
          await db.collection("price_hist").doc(`${key}_${d}`).set({ tinh, date: d, rows: pack(rows) });
          added++;
        }
        const runDates = g.runs.filter((r) => r.tinh === tinh).map((r) => r.date);
        const dates = [...new Set(fsDates.concat([...byDate.keys()], runDates))].sort().slice(-60);
        const latest = cur ? cur.latest : dates[dates.length - 1];
        const store = cur ? cur.store : (gi[gi.length - 1] || {}).store || "";
        await db.collection("price_cur").doc(key).set({ tinh, store, latest, items: pack([...byId.values()]), dates: JSON.stringify(dates) });
        out.push({ tinh, dates: added, skus: gi.length });
      }
      const seen = new Set(metaRuns(m).map((r) => r.date + "|" + r.tinh + "|" + r.at));
      const runs = g.runs.filter((r) => !seen.has(r.date + "|" + r.tinh + "|" + r.at)).concat(metaRuns(m)).sort((a, b) => (a.date + a.at < b.date + b.at ? -1 : 1)).slice(-1500);
      const batch = db.batch();
      Object.keys(skus).forEach((k) => batch.set(db.collection("price_skus").doc(k), { json: pack(skus[k]) }));
      batch.set(metaRef(), { runs: pack(runs), imported: new Date().toISOString() }, { merge: true });
      await batch.commit();
      return { provinces: out, dates: out.reduce((a, p) => a + p.dates, 0) };
    },
    // Bảng tỉnh → miền/vùng lấy từ file WM+ (không chứa dữ liệu WM nào khác).
    async savePriceRegions(reg) {
      await ready();
      const clean = {};
      Object.entries(reg || {}).slice(0, 200).forEach(([k, v]) => { if (/^[a-z0-9]{1,60}$/.test(k)) clean[k] = { mien: String(v.mien || "").slice(0, 60), vung: String(v.vung || "").slice(0, 60) }; });
      await metaRef().set({ regions: JSON.stringify(clean) }, { merge: true });
    },
    // Lịch sử chỉ tải cho tỉnh đang xem để trang nhẹ và ít lượt đọc.
    async getPriceHist(tinh) {
      await ready();
      const cur = await readCur(tinh), key = slug(tinh), dates = cur && cur.dates ? JSON.parse(cur.dates).slice(-26) : [];
      const docs = await Promise.all(dates.map((d) => db.collection("price_hist").doc(`${key}_${d}`).get()));
      const rows = [];
      docs.forEach((d, k) => { if (d.exists) JSON.parse(d.data().rows).forEach((h) => rows.push([dates[k], tinh, h[0], h[1], h[2]])); });
      return rows;
    },
    async publishPrices(rows, meta, force) {
      await ready();
      const byT = new Map(), skus = await readShards(), provinces = [];
      rows.forEach((r) => { if (!byT.has(r.tinh)) byT.set(r.tinh, []); byT.get(r.tinh).push(r); });
      for (const [t, list] of byT) provinces.push(await saveProvince(t, list[0].store, list, meta.date, meta.file, force, skus));
      return { date: meta.date, rows: rows.length, provinces };
    },
    async priceConfig() {
      await ready();
      if (!job) job = loadJob();
      if (job && job.status === "done") job = null;
      return { provinces: metaProvinces(await readMeta()), missing: new Array(7).fill(""), job: out(job) };
    },
    async savePriceConfig(list) {
      await ready();
      if (job && job.status !== "done") throw new Error("Đang có lần cập nhật dở dang. Huỷ lần đó trước khi đổi thiết lập.");
      const seen = new Set(), clean = list.map((p) => {
        const o = { chain: chainOf(p), tinh: String(p.tinh || "").trim().slice(0, 60), khu: p.khu === RURAL ? RURAL : URBAN, provinceId: String(p.provinceId || "").trim(), wardId: String(p.wardId || "").trim(), storeId: String(p.storeId || "").trim(), addr: String(p.addr || "").trim().slice(0, 200) };
        if (!o.tinh) throw new Error("Thiếu tên tỉnh"); if (seen.has(locName(o))) throw new Error("Trùng tỉnh và khu vực: " + locName(o)); seen.add(locName(o));
        if (o.chain === "BHX") ["provinceId", "wardId", "storeId"].forEach((k) => { if (!/^\d{1,12}$/.test(o[k])) throw new Error(`${locName(o)}: ${k} phải là số`); });
        else if (o.chain === "LOTTE" && !/^[a-z]{2,6}$/.test(o.storeId)) throw new Error(`${locName(o)}: mã siêu thị LOTTE là 2–6 chữ thường, ví dụ nsg`);
        else if (o.chain === "KFM") o.storeId = "online";
        return o;
      });
      await metaRef().set({ provinces: pack(clean) }, { merge: true });
      return G.priceConfig();
    },
    async priceTest() {
      await ready();
      const list = metaProvinces(await readMeta()), res = [];
      for (const p of list) {
        try {
          let rows = [];
          const cats = await catsFor(p);
          for (let c = 0; c < Math.min(5, cats.length) && !rows.length; c++) { rows = (await SRC[chainOf(p)].page(p, cats[c], 0)).rows; await sleep(DELAY); }
          res.push(rows.length ? { tinh: locName(p), ok: rows.some((r) => r.final > 0), sku: rows.length, withPrice: rows.filter((r) => r.final > 0).length, withCat: rows.filter((r) => r.cat).length, withBrand: rows.filter((r) => r.brand).length } : { tinh: locName(p), ok: false, msg: "Không có SKU nào ở 5 ngành đầu" });
        } catch (e) { res.push({ tinh: locName(p), ok: false, msg: e.message }); }
      }
      return res;
    },
    // scope: "all" (mặc định), "urban" chỉ Thành thị, "rural" chỉ Nông thôn.
    async priceStart(scope) {
      await ready();
      if (!job) job = loadJob();
      if (job && job.status !== "done" && job.date === today()) {
        if (job.status === "paused") job.status = "running";
        job.msg = ""; saveJob(); return out(job);
      }
      buf = null; shards = null;
      // urban/rural: chỉ cửa hàng BHX thành thị/nông thôn; BHX, LOTTE, KFM: chỉ chuỗi đó; all: tất cả.
      const all = metaProvinces(await readMeta()), list = all.filter((p) => scope === "urban" ? chainOf(p) === "BHX" && p.khu !== RURAL : scope === "rural" ? chainOf(p) === "BHX" && p.khu === RURAL : ["BHX", "LOTTE", "KFM"].includes(scope) ? chainOf(p) === scope : true);
      if (!list.length) throw new Error(scope === "rural" ? "Chưa có cửa hàng Nông thôn nào trong thiết lập. Bấm Lấy đủ các tỉnh có BHX rồi Lưu thiết lập." : ["LOTTE", "KFM"].includes(scope) ? "Chưa có cửa hàng của chuỗi này trong thiết lập. Bấm Thêm LOTTE và Kingfoodmart rồi Lưu thiết lập." : "Chưa có tỉnh nào trong thiết lập.");
      kfmCats = null;
      job = { id: String(Date.now()), status: "running", date: today(), scope: scope || "all", provinces: list, pi: 0, ci: 0, page: 0, rows: 0, msg: "", summary: { date: today(), provinces: [] } };
      saveJob();
      return out(job);
    },
    async priceStep(id) {
      if (!job || job.id !== id) throw new Error("Lần cập nhật này không còn. Bấm Cập nhật để bắt đầu lại.");
      if (job.status !== "running") return out(job);
      const t0 = Date.now(), p = job.provinces[job.pi], src = SRC[chainOf(p)];
      if (!buf) { buf = { rows: [], seen: new Set() }; job.ci = 0; job.page = 0; }           // tải lại trang thì lấy lại từ đầu tỉnh đang dở
      let cats;
      try {
        cats = await catsFor(p);
        while (Date.now() - t0 < STEP_MS && job.ci < cats.length) {
          const r = await src.page(p, cats[job.ci], job.page);
          const fresh = r.rows.filter((x) => x.id && x.name && !buf.seen.has(x.id) && buf.seen.add(x.id));
          buf.rows.push(...fresh);
          if (r.expand && r.expand.length) cats.splice(job.ci + 1, 0, ...r.expand.filter((c) => !cats.includes(c)));
          if (r.more && fresh.length) job.page++; else { job.page = 0; job.ci++; }
          await sleep(DELAY);
        }
      } catch (e) {
        job.status = "paused"; job.msg = e.message + " Các nơi đã lưu vẫn giữ nguyên."; saveJob(); return out(job);
      }
      if (job.ci >= cats.length) {
        if (!buf.rows.length) { job.status = "paused"; job.msg = `${CHAIN_NAME[chainOf(p)]} không trả SKU nào cho ${p.tinh}. Kiểm tra lại mã cửa hàng.`; saveJob(); return out(job); }
        await saveCurrent(false);
      }
      return out(job);
    },
    async priceFinish(id) {
      if (!job || job.id !== id || job.status !== "confirm") throw new Error("Không có lần cập nhật nào đang chờ xác nhận");
      await saveCurrent(true);
      return out(job);
    },
    // Tự lập danh sách ở Apps Script (BHX chỉ cho máy chủ Google lấy danh sách cửa hàng), giữ các cửa hàng đã thiết lập.
    async priceAutoStores() { await ready(); return gas.priceAutoStores(metaProvinces(await readMeta())); },
    async priceCancel() { job = null; buf = null; try { localStorage.removeItem(JOB); } catch (_) {} return G.priceConfig(); },
  });
})();
