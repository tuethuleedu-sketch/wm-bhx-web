/**
 * WM+ ↔ BHX — backend Google Apps Script (Web App, gắn với 1 Google Sheet làm database).
 *
 * Triển khai: Deploy → Web app · Execute as: Me · Who has access: Anyone.
 * "Anyone" chỉ là ai cũng GỌI được URL; mọi dữ liệu đều cần phiên đăng nhập OTP (xem route_).
 * KHÔNG chia sẻ Google Sheet cho ai — người dùng chỉ vào qua web.
 *
 * Các tab: users · settings · wm_versions · bhx_stores · bhx_changes · access_log
 * WM+ mỗi lần upload nằm trong 1 file Sheet riêng (thư mục UPLOAD_FOLDER), hết 48 giờ bị XOÁ VĨNH VIỄN
 * (xoá cả file → không còn lịch sử phiên bản để khôi phục).
 *
 * Chạy 1 lần trong editor: setup()  — tạo tab, Admin đầu tiên (chủ Sheet), SYNC_SECRET, lịch chạy hằng giờ.
 */

// ID của Google Sheet làm database (đoạn giữa /d/ và /edit trong link Sheet).
// Để trống nếu script được tạo từ trong Sheet (Tiện ích → Apps Script).
const SHEET_ID = '';

const CFG = {
  TZ: 'Asia/Ho_Chi_Minh',
  OTP_TTL_S: 600,            // mã OTP sống 10 phút
  OTP_MAX_TRY: 5,            // nhập sai 5 lần → huỷ mã
  OTP_MIN_GAP_S: 60,         // 1 email chỉ xin mã 1 lần/phút
  OTP_MAX_PER_DAY: 80,       // trần toàn hệ thống/ngày (Gmail cá nhân gửi ~100 mail/ngày qua Apps Script)
  SESSION_TTL_S: 21600,      // phiên đăng nhập 6 giờ (trần của CacheService)
  WM_TTL_H: 48,              // WM+ tự xoá sau 48 giờ
  MOVE_KM: 0.05,             // dời > 50 m mới tính là dời vị trí
  MAX_CLOSE_RATIO: 0.30,     // guard đồng bộ BHX
  BBOX: [8.0, 24.5, 102.0, 110.0],
  UPLOAD_FOLDER: 'WM_BHX_uploads (tu xoa sau 48h)',
};

const TABS = {
  users:       ['email', 'role', 'added_at', 'added_by'],
  settings:    ['key', 'value'],
  wm_versions: ['id', 'version', 'uploaded_at', 'uploaded_by', 'file_id', 'n_rows', 'n_added', 'n_removed', 'n_moved', 'is_current', 'purged_at', 'purge_note'],
  bhx_stores:  ['store_id', 'dia_chi', 'province_id', 'tinh', 'lat', 'lng', 'first_seen', 'last_seen', 'is_active'],
  bhx_changes: ['detected_on', 'type', 'store_id', 'dia_chi', 'tinh', 'lat', 'lng', 'old_lat', 'old_lng'],
  access_log:  ['at', 'email', 'event'],
};
const WM_COLS = ['ma', 'ten', 'tinh', 'lat', 'lng'];

// ───────────────────────── HTTP ─────────────────────────
function doGet() {
  return out_({ ok: true, service: 'wm-bhx' });      // không trả dữ liệu
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (_) { return out_({ error: 'Yêu cầu không hợp lệ' }); }
  try {
    return out_({ ok: true, data: route_(req) });
  } catch (err) {
    return out_({ error: String(err && err.message || err), code: err && err.code });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  const a = String(req.action || '');
  // Không cần đăng nhập
  if (a === 'requestOtp') return requestOtp_(req.email);
  if (a === 'verifyOtp') return verifyOtp_(req.email, req.code);
  if (a === 'syncBhx') return syncBhx_(req.secret, req.stores, !!req.dryRun);
  // Cần đăng nhập
  const u = session_(req.token);
  if (a === 'me') { log_(u.email, 'resume', true); return u; }
  if (a === 'logout') { CacheService.getScriptCache().remove('sess:' + sha_(String(req.token))); log_(u.email, 'logout'); return true; }
  if (a === 'snapshot') return snapshot_();
  if (a === 'changes') return changes_();
  if (a === 'settings') return settings_();
  // Chỉ Admin
  if (['versions', 'publishWm', 'listUsers', 'addUser', 'removeUser', 'setSetting', 'accessLog'].indexOf(a) >= 0) {
    if (u.role !== 'admin') throw new Error('Chỉ Admin được làm thao tác này');
    if (a === 'versions') return versions_();
    if (a === 'publishWm') return publishWm_(u, req.rows);
    if (a === 'listUsers') return listUsers_();
    if (a === 'addUser') return addUser_(u, req.email, req.role);
    if (a === 'removeUser') return removeUser_(u, req.email);
    if (a === 'setSetting') return setSetting_(req.key, req.value);
    if (a === 'accessLog') return accessLog_();
  }
  throw new Error('Thao tác không tồn tại');
}

// ───────────────────────── Sheet helpers ─────────────────────────
function db_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}
function sh_(name) {
  const s = db_().getSheetByName(name);
  if (!s) throw new Error('Thiếu tab "' + name + '" — chạy setup() trong Apps Script');
  return s;
}
function readRows_(name) {
  const v = sh_(name).getDataRange().getValues();
  const head = TABS[name];
  return v.slice(1).filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); })
    .map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
}
function toGrid_(name, rows) {
  const head = TABS[name];
  return rows.map(function (o) { return head.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; }); });
}
function writeAll_(name, rows) {
  const s = sh_(name), head = TABS[name];
  s.clearContents();
  s.getRange(1, 1, 1, head.length).setValues([head]);
  if (rows.length) s.getRange(2, 1, rows.length, head.length).setValues(toGrid_(name, rows));
}
function append_(name, rows) {
  if (!rows.length) return;
  const s = sh_(name), head = TABS[name];
  s.getRange(s.getLastRow() + 1, 1, rows.length, head.length).setValues(toGrid_(name, rows));
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}
const isTrue_ = function (v) { return v === true || String(v).toUpperCase() === 'TRUE'; };
function nowIso_() { return new Date().toISOString(); }
function todayVN_() { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd'); }
function fmtVN_(iso) { return iso ? Utilities.formatDate(new Date(iso), CFG.TZ, 'HH:mm dd/MM/yyyy') : ''; }
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}
function km_(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.pow(Math.sin((lat2 - lat1) * r / 2), 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.pow(Math.sin((lng2 - lng1) * r / 2), 2);
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}
function normEmail_(e) {
  const s = String(e || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 200) throw new Error('Email không hợp lệ');
  return s;
}
function err_(msg, code) { const e = new Error(msg); e.code = code; return e; }

// ───────────────────────── Đăng nhập OTP ─────────────────────────
function roleOf_(email) {
  const u = readRows_('users').filter(function (r) { return String(r.email).toLowerCase() === email; })[0];
  return u ? String(u.role) : null;
}

// Luôn trả cùng 1 câu → không dò được email nào có trong danh sách. Chỉ email được cấp quyền mới nhận mail.
function requestOtp_(emailRaw) {
  const email = normEmail_(emailRaw), cache = CacheService.getScriptCache();
  if (cache.get('otpgap:' + email)) throw new Error('Vừa gửi mã — đợi 1 phút rồi thử lại');
  cache.put('otpgap:' + email, '1', CFG.OTP_MIN_GAP_S);
  if (!roleOf_(email)) { log_(email, 'denied', true); return { sent: true }; }

  const props = PropertiesService.getScriptProperties(), dayKey = 'otpcount:' + todayVN_();
  const n = Number(props.getProperty(dayKey) || 0);
  if (n >= CFG.OTP_MAX_PER_DAY) throw new Error('Hệ thống đã gửi quá nhiều mã hôm nay — thử lại ngày mai');
  props.setProperty(dayKey, String(n + 1));

  const code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 12), 16) % 1000000).padStart(6, '0');
  cache.put('otp:' + email, JSON.stringify({ h: sha_(email + ':' + code), n: 0 }), CFG.OTP_TTL_S);
  MailApp.sendEmail({
    to: email,
    subject: 'Mã đăng nhập WM+ ↔ BHX: ' + code,
    body: 'Mã đăng nhập của bạn: ' + code + '\nMã hết hạn sau 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.',
    htmlBody: '<p>Mã đăng nhập của bạn: <b style="font-size:20px">' + code + '</b></p><p>Mã hết hạn sau 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>',
  });
  return { sent: true };
}

function verifyOtp_(emailRaw, codeRaw) {
  const email = normEmail_(emailRaw), code = String(codeRaw || '').trim(), cache = CacheService.getScriptCache();
  const raw = cache.get('otp:' + email);
  if (!raw) throw new Error('Mã không đúng hoặc đã hết hạn. Bấm gửi lại mã.');
  const st = JSON.parse(raw);
  if (st.h !== sha_(email + ':' + code)) {
    st.n += 1;
    if (st.n >= CFG.OTP_MAX_TRY) cache.remove('otp:' + email); else cache.put('otp:' + email, JSON.stringify(st), CFG.OTP_TTL_S);
    throw new Error('Mã không đúng hoặc đã hết hạn. Bấm gửi lại mã.');
  }
  cache.remove('otp:' + email);
  const role = roleOf_(email);
  if (!role) { log_(email, 'denied'); throw new Error('Email này chưa được Admin cấp quyền truy cập.'); }
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess:' + sha_(token), email, CFG.SESSION_TTL_S);     // chỉ lưu hash của token
  log_(email, 'login');
  return { token: token, email: email, role: role };
}

// Kiểm tra quyền MỖI lần gọi → thu hồi quyền có hiệu lực ngay.
function session_(token) {
  if (!token) throw err_('Chưa đăng nhập', 'AUTH');
  const email = CacheService.getScriptCache().get('sess:' + sha_(String(token)));
  if (!email) throw err_('Phiên đăng nhập đã hết hạn — đăng nhập lại', 'AUTH');
  const role = roleOf_(email);
  if (!role) throw err_('Quyền truy cập đã bị thu hồi', 'AUTH');
  return { email: email, role: role };
}

function log_(email, event, throttle) {
  if (throttle) {                                   // chống spam: 1 dòng/email/sự kiện/phút
    const c = CacheService.getScriptCache(), k = 'log:' + event + ':' + email;
    if (c.get(k)) return;
    c.put(k, '1', 60);
  }
  append_('access_log', [{ at: nowIso_(), email: email, event: event }]);
}

// ───────────────────────── Đọc dữ liệu ─────────────────────────
function liveVersion_() {
  const ttl = CFG.WM_TTL_H * 3600e3;
  return readRows_('wm_versions').filter(function (v) {
    return isTrue_(v.is_current) && !v.purged_at && Date.now() - new Date(v.uploaded_at).getTime() < ttl;
  })[0] || null;
}
function readWmFile_(fileId) {
  const v = SpreadsheetApp.openById(fileId).getSheets()[0].getDataRange().getValues();
  return v.slice(1).map(function (r) { return { ma: String(r[0]), ten: String(r[1] || r[0]), tinh: String(r[2]), lat: Number(r[3]), lng: Number(r[4]) }; });
}

function snapshot_() {
  const v = liveVersion_();
  const bhx = readRows_('bhx_stores').filter(function (r) { return isTrue_(r.is_active); }).map(function (r) {
    return { ma: Number(r.store_id), dia_chi: String(r.dia_chi), tinh: String(r.tinh), lat: Number(r.lat), lng: Number(r.lng) };
  });
  const st = settings_();
  return {
    wm: v ? readWmFile_(String(v.file_id)) : [],
    bhx: bhx,
    wmVersion: v ? v.version + ' — ' + Utilities.formatDate(new Date(v.uploaded_at), CFG.TZ, 'dd/MM/yyyy') : 'chưa có',
    wmExpires: v ? new Date(new Date(v.uploaded_at).getTime() + CFG.WM_TTL_H * 3600e3).toISOString() : null,
    bhxUpdated: st.bhx_last_run || 'chưa chạy',
  };
}

function changes_() {
  return readRows_('bhx_changes').map(function (r) {
    return { date: String(r.detected_on), type: String(r.type), ma: Number(r.store_id), dia_chi: String(r.dia_chi), tinh: String(r.tinh),
      lat: Number(r.lat), lng: Number(r.lng), old_lat: r.old_lat === '' ? null : Number(r.old_lat), old_lng: r.old_lng === '' ? null : Number(r.old_lng) };
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).slice(0, 5000);
}

function settings_() {
  const o = { viewer_can_export: true };
  readRows_('settings').forEach(function (r) {
    const v = String(r.value);
    o[r.key] = v === 'true' ? true : v === 'false' ? false : v;
  });
  return o;
}

function setSetting_(key, value) {
  if (key !== 'viewer_can_export') throw new Error('Cài đặt không hợp lệ');
  return withLock_(function () { putSetting_(key, value ? 'true' : 'false'); return true; });
}
function putSetting_(key, value) {
  const rows = readRows_('settings').filter(function (r) { return r.key !== key; });
  rows.push({ key: key, value: String(value) });
  writeAll_('settings', rows);
}

function versions_() {
  const ttl = CFG.WM_TTL_H * 3600e3;
  return readRows_('wm_versions').reverse().map(function (v) {
    const exp = new Date(new Date(v.uploaded_at).getTime() + ttl);
    return { version: v.version, uploaded: fmtVN_(v.uploaded_at), by: v.uploaded_by, rows: v.n_rows, added: v.n_added, removed: v.n_removed, moved: v.n_moved,
      status: v.purged_at ? 'Đã xoá ' + fmtVN_(v.purged_at) + (v.purge_note ? ' (' + v.purge_note + ')' : '')
        : exp > new Date() ? 'Còn hạn đến ' + fmtVN_(exp.toISOString()) : 'Hết hạn, chờ xoá (≤ 1 giờ)' };
  });
}

// ───────────────────────── Upload WM+ ─────────────────────────
function validateWm_(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Không có dòng hợp lệ để lưu');
  if (rows.length > 20000) throw new Error('File quá lớn (> 20.000 dòng)');
  const seen = {}, b = CFG.BBOX;
  return rows.map(function (r, i) {
    const ma = String(r.ma || '').trim(), lat = Number(r.lat), lng = Number(r.lng);
    if (!ma) throw new Error('Dòng ' + (i + 1) + ': thiếu mã');
    if (seen[ma]) throw new Error('Trùng mã ' + ma);
    seen[ma] = 1;
    if (!(lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3])) throw new Error('Mã ' + ma + ': toạ độ ngoài lãnh thổ VN');
    return { ma: ma, ten: String(r.ten || ma).slice(0, 200), tinh: String(r.tinh || '').slice(0, 100), lat: lat, lng: lng };
  });
}

function publishWm_(u, rowsRaw) {
  const rows = validateWm_(rowsRaw);
  return withLock_(function () {
    const prevV = liveVersion_(), prev = prevV ? readWmFile_(String(prevV.file_id)) : [];
    const all = readRows_('wm_versions');
    const version = 'v' + (all.length + 1);
    const ss = SpreadsheetApp.create('WM_upload_' + version + '_' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd_HHmm'));
    const sh = ss.getSheets()[0];
    sh.getRange('A:E').setNumberFormat('@');
    sh.getRange(1, 1, rows.length + 1, 5).setValues([WM_COLS].concat(rows.map(function (r) { return WM_COLS.map(function (k) { return r[k]; }); })));
    DriveApp.getFileById(ss.getId()).moveTo(uploadFolder_());

    const old = {}; prev.forEach(function (w) { old[w.ma] = w; });
    const now = {}; rows.forEach(function (w) { now[w.ma] = 1; });
    const added = rows.filter(function (w) { return !old[w.ma]; }).length;
    const removed = prev.filter(function (w) { return !now[w.ma]; }).length;
    const moved = rows.filter(function (w) { return old[w.ma] && km_(old[w.ma].lat, old[w.ma].lng, w.lat, w.lng) > CFG.MOVE_KM; }).length;

    all.forEach(function (v) { v.is_current = false; });
    all.push({ id: all.length + 1, version: version, uploaded_at: nowIso_(), uploaded_by: u.email, file_id: ss.getId(),
      n_rows: rows.length, n_added: added, n_removed: removed, n_moved: moved, is_current: true, purged_at: '', purge_note: '' });
    writeAll_('wm_versions', all);
    return { version: version, rows: rows.length, added: added, removed: removed, moved: moved };
  });
}

function uploadFolder_() {
  const it = DriveApp.getFoldersByName(CFG.UPLOAD_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CFG.UPLOAD_FOLDER);
}

// Lịch chạy hằng giờ (setup tạo). Xoá VĨNH VIỄN file WM+ quá 48 giờ — không qua thùng rác.
function purgeExpiredWm() {
  withLock_(function () {
    const ttl = CFG.WM_TTL_H * 3600e3, all = readRows_('wm_versions');
    let changed = false;
    all.forEach(function (v) {
      if (v.purged_at || Date.now() - new Date(v.uploaded_at).getTime() < ttl) return;
      let note = '';
      try {
        Drive.Files.remove(String(v.file_id));               // Advanced Drive service: xoá vĩnh viễn
      } catch (e) {
        try { DriveApp.getFileById(String(v.file_id)).setTrashed(true); note = 'chỉ chuyển vào thùng rác — bật Drive API service'; }
        catch (e2) { note = 'không tìm thấy file'; }
      }
      v.purged_at = nowIso_(); v.purge_note = note; v.is_current = false; changed = true;
    });
    if (changed) writeAll_('wm_versions', all);
  });
}

// ───────────────────────── Đồng bộ BHX ─────────────────────────
function safeEq_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Đẩy snapshot từ ngoài vào (bhx_sync.py — dự phòng khi không chạy được syncBhxDaily).
function syncBhx_(secret, storesRaw, dryRun) {
  if (!safeEq_(secret, PropertiesService.getScriptProperties().getProperty('SYNC_SECRET'))) throw new Error('Sai SYNC_SECRET');
  return syncBhxCore_(storesRaw, dryRun);
}

function syncBhxCore_(storesRaw, dryRun) {
  if (!Array.isArray(storesRaw) || !storesRaw.length) throw new Error('Snapshot BHX rỗng');
  const stores = storesRaw.map(function (s) {
    const id = Number(s.store_id), lat = Number(s.lat), lng = Number(s.lng);
    if (!isFinite(id) || !isFinite(lat) || !isFinite(lng)) throw new Error('Snapshot BHX sai định dạng');
    return { store_id: id, dia_chi: String(s.dia_chi || ''), province_id: s.province_id == null ? '' : Number(s.province_id), tinh: String(s.tinh || ''), lat: lat, lng: lng };
  });
  return withLock_(function () {
    const old = readRows_('bhx_stores'), today = todayVN_(), base = old.length === 0;
    const o = {}; old.forEach(function (r) { o[String(r.store_id)] = r; });
    const seen = {}, open = [], move = [];
    stores.forEach(function (n) {
      const p = o[String(n.store_id)]; seen[String(n.store_id)] = 1;
      if (!p || !isTrue_(p.is_active)) open.push(n);
      else if (km_(Number(p.lat), Number(p.lng), n.lat, n.lng) > CFG.MOVE_KM) move.push({ n: n, p: p });
    });
    const active = old.filter(function (r) { return isTrue_(r.is_active); });
    const close = active.filter(function (r) { return !seen[String(r.store_id)]; });
    if (active.length && close.length / active.length > CFG.MAX_CLOSE_RATIO) {
      throw new Error('Guard: ' + close.length + ' / ' + active.length + ' cửa hàng đang mở bị coi là đóng (> 30%) — nghi API trả thiếu, không ghi');
    }
    const res = { baseline: base, stores: stores.length, open: base ? 0 : open.length, close: base ? 0 : close.length, move: base ? 0 : move.length };
    if (dryRun) { res.dry_run = true; return res; }

    if (!base) {
      const ev = function (s, type, extra) {
        return Object.assign({ detected_on: today, type: type, store_id: s.store_id, dia_chi: s.dia_chi, tinh: s.tinh, lat: s.lat, lng: s.lng, old_lat: '', old_lng: '' }, extra || {});
      };
      append_('bhx_changes', open.map(function (n) { return ev(n, 'open'); })
        .concat(move.map(function (m) { return ev(m.n, 'move', { old_lat: m.p.lat, old_lng: m.p.lng }); }))
        .concat(close.map(function (p) { return ev(p, 'close'); })));
    }
    const rows = stores.map(function (n) {
      const p = o[String(n.store_id)];
      return Object.assign({}, n, { tinh: n.tinh || (p ? p.tinh : ''), first_seen: p ? p.first_seen : today, last_seen: today, is_active: true });
    }).concat(old.filter(function (r) { return !seen[String(r.store_id)]; }).map(function (r) { return Object.assign({}, r, { is_active: false }); }));
    writeAll_('bhx_stores', rows);
    putSetting_('bhx_last_run', Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'));
    return res;
  });
}

// ───────────────────────── Tự lấy BHX trên máy chủ Google (lịch 06:00) ─────────────────────────
// Cùng quy tắc với bhx_fetch.py: 27 tỉnh từ GetFull, phân trang 50/trang, alias storeId/lat/lng,
// bỏ cửa hàng ảo, khử trùng theo storeId. Thiếu > 2% so với tổng API báo → dừng, không ghi.
const BHX = {
  PROVINCES: 'https://api.bachhoaxanh.com/gw/LocationV3/GetFull',
  STORES: 'https://api.bachhoaxanh.com/gw/Location/V2/GetStoresByLocation',
  PAGE: 50,             // trần thật của server
  BATCH: 25,            // số request song song mỗi lô
  MIN_COMPLETE: 0.98,
  HEADERS: { Accept: 'application/json, text/plain, */*', Origin: 'https://www.bachhoaxanh.com', Referer: 'https://www.bachhoaxanh.com/' },
  KEYS: { store_id: ['storeId', 'storeID', 'id'], lat: ['lat', 'latitude'], lng: ['lng', 'lon', 'long', 'longitude'] },
};

// fetchAll theo lô; request lỗi (mạng, HTTP ≠ 200, không phải JSON) được thử lại tối đa 2 lần.
function bhxFetchJson_(urls) {
  const out = new Array(urls.length);
  let todo = urls.map(function (_, i) { return i; });
  for (let attempt = 0; attempt < 3 && todo.length; attempt++) {
    if (attempt) Utilities.sleep(2000 * attempt);
    const failed = [];
    for (let s = 0; s < todo.length; s += BHX.BATCH) {
      const idx = todo.slice(s, s + BHX.BATCH);
      let res;
      try {
        res = UrlFetchApp.fetchAll(idx.map(function (i) { return { url: urls[i], muteHttpExceptions: true, headers: BHX.HEADERS }; }));
      } catch (e) { Array.prototype.push.apply(failed, idx); continue; }
      res.forEach(function (r, k) {
        if (r.getResponseCode() === 200) {
          try { out[idx[k]] = JSON.parse(r.getContentText()); return; } catch (_) { /* rơi xuống failed */ }
        }
        failed.push(idx[k]);
      });
    }
    todo = failed;
  }
  if (todo.length) throw new Error('API BHX lỗi ' + todo.length + '/' + urls.length + ' request, vd: ' + urls[todo[0]]);
  return out;
}

const pick_ = function (rec, keys) {
  for (let i = 0; i < keys.length; i++) if (rec[keys[i]] !== undefined && rec[keys[i]] !== null) return rec[keys[i]];
  return undefined;
};

// Tìm đệ quy mảng cửa hàng (có storeId/lat/lng) — không phụ thuộc tên wrapper data/stores.
function findStores_(node) {
  if (Array.isArray(node)) {
    if (node.length && node[0] && typeof node[0] === 'object' &&
        Object.keys(BHX.KEYS).every(function (k) { return pick_(node[0], BHX.KEYS[k]) !== undefined; })) return node;
    for (let i = 0; i < node.length; i++) { const f = findStores_(node[i]); if (f) return f; }
  } else if (node && typeof node === 'object') {
    const ks = Object.keys(node);
    for (let i = 0; i < ks.length; i++) { const f = findStores_(node[ks[i]]); if (f) return f; }
  }
  return null;
}

function fetchBhxStores_() {
  const pl = bhxFetchJson_([BHX.PROVINCES])[0];
  const provinces = (((pl || {}).data || {}).provinces || []).map(function (p) { return { id: Number(p.id), name: String(p.name || ''), total: 0 }; });
  if (!provinces.length) throw new Error('Không lấy được danh sách tỉnh BHX (GetFull)');
  const url = function (pid, page) { return BHX.STORES + '?provinceId=' + pid + '&wardId=0&pageSize=' + BHX.PAGE + '&pageIndex=' + page; };

  const first = bhxFetchJson_(provinces.map(function (p) { return url(p.id, 0); }));
  const more = [], owner = [];
  provinces.forEach(function (p, i) {
    p.total = Number(((first[i] || {}).data || {}).total) || 0;
    for (let pg = 1; pg < Math.ceil(p.total / BHX.PAGE); pg++) { more.push(url(p.id, pg)); owner.push(i); }
  });
  const rest = bhxFetchJson_(more);

  const all = {}, keep = {};
  const add = function (payload, p) {
    (findStores_(payload) || []).forEach(function (rec) {
      const id = Number(pick_(rec, BHX.KEYS.store_id)), lat = Number(pick_(rec, BHX.KEYS.lat)), lng = Number(pick_(rec, BHX.KEYS.lng));
      if (!isFinite(id) || !isFinite(lat) || !isFinite(lng)) return;
      all[id] = 1;
      if (isTrue_(rec.isStoreVirtual) || String(rec.isStoreVirtual) === '1') return;    // bỏ cửa hàng ảo
      keep[id] = { store_id: id, dia_chi: String(rec.storeAddress || ''), province_id: p.id, tinh: p.name,
        lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    });
  };
  provinces.forEach(function (p, i) { add(first[i], p); });
  rest.forEach(function (payload, k) { add(payload, provinces[owner[k]]); });

  const totalApi = provinces.reduce(function (a, p) { return a + p.total; }, 0), got = Object.keys(all).length;
  if (!totalApi || got < totalApi * BHX.MIN_COMPLETE) {
    throw new Error('Lấy thiếu: ' + got + '/' + totalApi + ' cửa hàng — không ghi để tránh báo đóng cửa sai');
  }
  return { stores: Object.keys(keep).map(function (k) { return keep[k]; }), got: got, totalApi: totalApi,
    provinces: provinces.length, requests: 1 + provinces.length + more.length };
}

// Lịch chạy hằng ngày (setup tạo, 06:00 theo múi giờ của project). Chạy tay được để thử.
function syncBhxDaily() {
  const t0 = Date.now();
  try {
    const f = fetchBhxStores_();
    const t1 = Date.now();
    const res = syncBhxCore_(f.stores, false);
    const msg = 'OK ' + f.stores.length + ' cửa hàng (API ' + f.got + '/' + f.totalApi + ', ' + f.provinces + ' tỉnh, ' + f.requests + ' request) · mở ' +
      res.open + ' · đóng ' + res.close + ' · dời ' + res.move + (res.baseline ? ' · baseline' : '') +
      ' · lấy ' + Math.round((t1 - t0) / 1000) + 's, ghi ' + Math.round((Date.now() - t1) / 1000) + 's';
    withLock_(function () { putSetting_('bhx_last_status', msg); });
    Logger.log(msg);
    return res;
  } catch (e) {
    const msg = 'LỖI ' + Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm') + ': ' + e.message;
    try { withLock_(function () { putSetting_('bhx_last_status', msg); }); } catch (_) { /* không che lỗi gốc */ }
    Logger.log(msg);
    throw e;            // để Apps Script gửi mail báo lỗi trigger cho chủ project
  }
}

// ───────────────────────── Phân quyền / nhật ký ─────────────────────────
function listUsers_() {
  return readRows_('users').map(function (r) { return { email: String(r.email), role: String(r.role), added: String(r.added_at).slice(0, 10) }; });
}
function addUser_(u, emailRaw, role) {
  const email = normEmail_(emailRaw);
  if (role !== 'admin' && role !== 'viewer') throw new Error('Quyền không hợp lệ');
  return withLock_(function () {
    if (roleOf_(email)) throw new Error('Email đã có trong danh sách');
    append_('users', [{ email: email, role: role, added_at: nowIso_(), added_by: u.email }]);
    return true;
  });
}
function removeUser_(u, emailRaw) {
  const email = normEmail_(emailRaw);
  if (email === u.email) throw new Error('Không thể tự thu hồi quyền chính mình');
  return withLock_(function () {
    const rows = readRows_('users'), left = rows.filter(function (r) { return String(r.email).toLowerCase() !== email; });
    if (!left.some(function (r) { return r.role === 'admin'; })) throw new Error('Phải còn ít nhất 1 Admin');
    writeAll_('users', left);
    return true;
  });
}
function accessLog_() {
  return readRows_('access_log').reverse().slice(0, 500).map(function (r) { return { at: String(r.at), email: String(r.email), event: String(r.event) }; });
}

// ───────────────────────── Cài đặt lần đầu ─────────────────────────
function setup() {
  const ss = db_();
  if (!ss) throw new Error('Không tìm thấy Sheet — điền SHEET_ID ở đầu file');
  Object.keys(TABS).forEach(function (name) {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    s.getRange('A:Z').setNumberFormat('@');          // giữ nguyên chuỗi ngày/email, không để Sheets tự đổi kiểu
    s.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]);
    s.setFrozenRows(1);
  });
  const owner = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!readRows_('users').length) append_('users', [{ email: owner, role: 'admin', added_at: nowIso_(), added_by: 'setup' }]);
  if (!readRows_('settings').some(function (r) { return r.key === 'viewer_can_export'; })) putSetting_('viewer_can_export', 'true');

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SYNC_SECRET')) props.setProperty('SYNC_SECRET', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['purgeExpiredWm', 'syncBhxDaily'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purgeExpiredWm').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncBhxDaily').timeBased().atHour(6).everyDays(1).create();
  uploadFolder_();
  Logger.log('Xong. Admin đầu tiên: %s', owner);
  Logger.log('SYNC_SECRET (dán vào GitHub Secret, KHÔNG chia sẻ): %s', props.getProperty('SYNC_SECRET'));
}
