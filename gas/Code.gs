/**
 * WM+ ↔ BHX — backend Google Apps Script (Web App, gắn với 1 Google Sheet làm database).
 *
 * Triển khai: Deploy → Web app · Execute as: Me · Who has access: Anyone.
 * "Anyone" chỉ là ai cũng GỌI được URL; mọi dữ liệu đều cần phiên đăng nhập bằng mật khẩu (xem route_).
 * KHÔNG chia sẻ Google Sheet cho ai — người dùng chỉ vào qua web.
 *
 * Các tab: users · settings · wm_versions · bhx_stores · bhx_changes · access_log
 * WM+ mỗi lần upload nằm trong 1 file Sheet riêng (thư mục UPLOAD_FOLDER), hết 48 giờ bị XOÁ VĨNH VIỄN
 * (xoá cả file → không còn lịch sử phiên bản để khôi phục).
 *
 * Chạy 1 lần trong editor: setup()  — tạo tab, Admin đầu tiên (chủ Sheet), SYNC_SECRET, lịch chạy hằng giờ.
 * Admin chưa có / quên mật khẩu: chạy taoMatKhauAdmin() trong editor để lấy mật khẩu tạm.
 */

// ID của Google Sheet làm database (đoạn giữa /d/ và /edit trong link Sheet).
// Để trống nếu script được tạo từ trong Sheet (Tiện ích → Apps Script).
const SHEET_ID = '';

const CFG = {
  TZ: 'Asia/Ho_Chi_Minh',
  PW_MIN_LEN: 8,             // mật khẩu tối thiểu 8 ký tự
  PW_ITER: 2000,             // số vòng băm, làm chậm việc dò mật khẩu nếu lộ Script Properties
  PW_MAX_TRY: 5,             // nhập sai 5 lần → khoá email đó
  PW_LOCK_S: 900,            // khoá 15 phút
  PW_TEMP_DAYS: 7,           // mật khẩu tạm hết hạn sau 7 ngày
  SESSION_DAYS: 7,          // đăng nhập 1 lần dùng đúng 7 ngày, không tự gia hạn (lưu ở Script Properties nên thay code không mất phiên)
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
  comp_stores: ['chain', 'store_id', 'ten', 'dia_chi', 'tinh', 'lat', 'lng', 'first_seen', 'last_seen', 'is_active'],
  comp_changes: ['detected_on', 'chain', 'type', 'store_id', 'ten', 'dia_chi', 'tinh', 'lat', 'lng', 'old_lat', 'old_lng'],
  access_log:  ['at', 'email', 'event'],
};
const WM_COLS = ['ma', 'ten', 'tinh', 'lat', 'lng', 'khu_vuc', 'chuoi', 'dia_chi', 'vung', 'mien', 'quan', 'phuong'];

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
  if (a === 'login') return login_(req.email, req.password);
  if (a === 'changePassword') return changePassword_(req.email, req.password, req.newPassword);
  if (a === 'syncBhx') return syncBhx_(req.secret, req.stores, !!req.dryRun);
  // Cần đăng nhập
  const u = session_(req.token);
  if (a === 'me') { log_(u.email, 'resume', true); return u; }
  // Mở trang: 1 lần gọi trả đủ dữ liệu ban đầu. resume = mở lại bằng phiên đã lưu (không phải vừa đăng nhập).
  if (a === 'boot') {
    if (req.resume) log_(u.email, 'resume', true);
    return { me: u, settings: settings_(), snapshot: snapshot_(), changes: changes_() };
  }
  if (a === 'logout') { PropertiesService.getScriptProperties().deleteProperty('sess:' + sha_(String(req.token))); log_(u.email, 'logout'); return true; }
  if (a === 'snapshot') return snapshot_();
  if (a === 'changes') return changes_();
  if (a === 'settings') return settings_();
  if (a === 'route') return roadRoute_(req.points);
  // Chỉ Admin
  if (['versions', 'publishWm', 'listUsers', 'addUser', 'removeUser', 'resetPassword', 'setSetting', 'accessLog'].indexOf(a) >= 0) {
    if (u.role !== 'admin') throw new Error('Chỉ Admin được làm thao tác này');
    if (a === 'versions') return versions_();
    if (a === 'publishWm') return publishWm_(u, req.rows);
    if (a === 'listUsers') return listUsers_();
    if (a === 'addUser') return addUser_(u, req.email, req.role);
    if (a === 'removeUser') return removeUser_(u, req.email);
    if (a === 'resetPassword') return resetPassword_(u, req.email);
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

// ───────────────────────── Đăng nhập bằng mật khẩu ─────────────────────────
function roleOf_(email) {
  const u = readRows_('users').filter(function (r) { return String(r.email).toLowerCase() === email; })[0];
  return u ? String(u.role) : null;
}

function pwHash_(pw, salt) {
  let h = sha_(salt + ':' + pw);
  for (let i = 0; i < CFG.PW_ITER; i++) h = sha_(salt + h);
  return h;
}
// Lưu ở Script Properties, không để trong Sheet. Chỉ lưu muối + hash, t = hạn của mật khẩu tạm.
function setPassword_(email, pw, tempUntil) {
  const salt = Utilities.getUuid().replace(/-/g, '');
  const rec = { s: salt, h: pwHash_(pw, salt) };
  if (tempUntil) rec.t = tempUntil;
  PropertiesService.getScriptProperties().setProperty('pw:' + email, JSON.stringify(rec));
}
function tempPassword_(email) {
  const pw = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  setPassword_(email, pw, Date.now() + CFG.PW_TEMP_DAYS * 864e5);
  CacheService.getScriptCache().remove('pwfail:' + email);
  return pw;
}

// Luôn báo cùng 1 câu và băm cùng số vòng → không dò được email nào có trong danh sách.
function checkPassword_(emailRaw, pwRaw) {
  const email = normEmail_(emailRaw), pw = String(pwRaw || '').slice(0, 200), cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pwfail:' + email) || 0);
  if (fails >= CFG.PW_MAX_TRY) throw new Error('Sai quá nhiều lần — đợi 15 phút rồi thử lại');
  let rec = null;
  try { rec = JSON.parse(PropertiesService.getScriptProperties().getProperty('pw:' + email) || 'null'); } catch (_) {}
  const role = roleOf_(email), hash = pwHash_(pw, rec ? rec.s : email);
  if (!rec || !role || rec.h !== hash || (rec.t && rec.t < Date.now())) {
    cache.put('pwfail:' + email, String(fails + 1), CFG.PW_LOCK_S);
    log_(email, role ? 'login_fail' : 'denied', true);
    throw new Error('Email hoặc mật khẩu không đúng.');
  }
  cache.remove('pwfail:' + email);
  return { email: email, role: role, temp: !!rec.t };
}

function newSession_(email, role) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  putSession_(sha_(token), email);                                  // chỉ lưu hash của token
  return { token: token, email: email, role: role };
}

// Mật khẩu tạm chưa mở phiên: phải đặt mật khẩu mới rồi mới vào được.
function login_(emailRaw, pw) {
  const c = checkPassword_(emailRaw, pw);
  if (c.temp) return { mustChange: true, email: c.email };
  log_(c.email, 'login');
  return newSession_(c.email, c.role);
}

function changePassword_(emailRaw, pw, newPwRaw) {
  const c = checkPassword_(emailRaw, pw), newPw = String(newPwRaw || '');
  if (newPw.length < CFG.PW_MIN_LEN || newPw.length > 200) throw new Error('Mật khẩu mới cần từ ' + CFG.PW_MIN_LEN + ' đến 200 ký tự');
  if (newPw === String(pw)) throw new Error('Mật khẩu mới phải khác mật khẩu cũ');
  setPassword_(c.email, newPw);
  endSessions_(c.email);                                            // đăng xuất các máy khác
  log_(c.email, 'pw_change');
  return newSession_(c.email, c.role);
}

function resetPassword_(u, emailRaw) {
  const email = normEmail_(emailRaw);
  if (email === u.email) throw new Error('Mật khẩu của bạn đổi ở nút "Đổi mật khẩu" trên cùng');
  if (!roleOf_(email)) throw new Error('Email này chưa được cấp quyền');
  const pw = tempPassword_(email);
  endSessions_(email);
  log_(email, 'pw_reset');
  return { tempPassword: pw };
}

// Chạy trong editor khi Admin chưa có hoặc quên mật khẩu. Mật khẩu tạm chỉ dùng để đặt mật khẩu mới.
function taoMatKhauAdmin() {
  const owner = Session.getEffectiveUser().getEmail().toLowerCase();
  if (roleOf_(owner) !== 'admin') throw new Error(owner + ' không phải Admin');
  const pw = tempPassword_(owner);
  endSessions_(owner);
  log_(owner, 'pw_reset');
  Logger.log('Mật khẩu tạm của %s (hạn %s ngày, KHÔNG gửi cho ai): %s', owner, CFG.PW_TEMP_DAYS, pw);
}

function endSessions_(email) {
  const props = PropertiesService.getScriptProperties(), all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess:') !== 0) return;
    let s = null;
    try { s = JSON.parse(all[k]); } catch (_) {}
    if (s && s.e === email) props.deleteProperty(k);
  });
}

function putSession_(h, email) {
  PropertiesService.getScriptProperties().setProperty('sess:' + h,
    JSON.stringify({ e: email, x: Date.now() + CFG.SESSION_DAYS * 864e5 }));
}

// Kiểm tra quyền MỖI lần gọi → thu hồi quyền có hiệu lực ngay.
function session_(token) {
  if (!token) throw err_('Chưa đăng nhập', 'AUTH');
  const h = sha_(String(token)), props = PropertiesService.getScriptProperties();
  let s = null;
  try { s = JSON.parse(props.getProperty('sess:' + h) || 'null'); } catch (_) {}
  if (!s || s.x < Date.now()) {
    if (s) props.deleteProperty('sess:' + h);
    throw err_('Phiên đăng nhập đã hết hạn — đăng nhập lại', 'AUTH');
  }
  const role = roleOf_(s.e);
  if (!role) { props.deleteProperty('sess:' + h); throw err_('Quyền truy cập đã bị thu hồi', 'AUTH'); }
  if (s.x - Date.now() > CFG.SESSION_DAYS * 864e5) putSession_(h, s.e);   // phiên cũ hạn 30 ngày: rút về 7 ngày, không bắt đăng nhập lại
  return { email: s.e, role: role };
}

// Dọn phiên hết hạn (gọi từ lịch hằng giờ).
function purgeSessions_() {
  const props = PropertiesService.getScriptProperties(), all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess:') !== 0) return;
    let s = null;
    try { s = JSON.parse(all[k]); } catch (_) {}
    if (!s || s.x < now) props.deleteProperty(k);
  });
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
  // File cũ ít cột hơn → khu_vuc/dia_chi/vung/mien/quan/phuong rỗng, chuoi mặc định WM+
  return v.slice(1).map(function (r) {
    return { ma: String(r[0]), ten: String(r[1] || r[0]), tinh: String(r[2]), lat: Number(r[3]), lng: Number(r[4]),
      khu_vuc: String(r[5] || ''), chuoi: String(r[6] || 'WM+'), dia_chi: String(r[7] || ''), vung: String(r[8] || ''), mien: String(r[9] || ''), quan: String(r[10] || ''), phuong: String(r[11] || '') };
  });
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
    comp: compRows_('comp_stores').filter(function (r) { return isTrue_(r.is_active); }).map(function (r) {
      return { chain: String(r.chain), ma: String(r.store_id), ten: String(r.ten), dia_chi: String(r.dia_chi), tinh: String(r.tinh), lat: Number(r.lat), lng: Number(r.lng) };
    }),
    compUpdated: st.comp_last_run || '',
    compStatus: st.comp_last_status || '',
    wmVersion: v ? v.version + ' — ' + Utilities.formatDate(new Date(v.uploaded_at), CFG.TZ, 'dd/MM/yyyy') : 'chưa có',
    wmExpires: v ? new Date(new Date(v.uploaded_at).getTime() + CFG.WM_TTL_H * 3600e3).toISOString() : null,
    bhxUpdated: st.bhx_last_run || 'chưa chạy',
  };
}

function changes_() {
  return readRows_('bhx_changes').map(function (r) { return Object.assign({ chain: 'BHX' }, r); }).concat(compRows_('comp_changes')).map(function (r) {
    return { date: String(r.detected_on), chain: String(r.chain), type: String(r.type), ma: String(r.store_id), dia_chi: String(r.dia_chi), tinh: String(r.tinh),
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
    const chuoi = String(r.chuoi || 'WM+');
    if (chuoi !== 'WM+' && chuoi !== 'WMT') throw new Error('Mã ' + ma + ': chuỗi phải là WM+ hoặc WMT');
    return { ma: ma, ten: String(r.ten || ma).slice(0, 200), tinh: String(r.tinh || '').slice(0, 100), lat: lat, lng: lng,
      khu_vuc: String(r.khu_vuc || '').slice(0, 30), chuoi: chuoi, dia_chi: String(r.dia_chi || '').slice(0, 300), vung: String(r.vung || '').slice(0, 50), mien: String(r.mien || '').slice(0, 50), quan: String(r.quan || '').slice(0, 50), phuong: String(r.phuong || '').slice(0, 50) };
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
    sh.getRange('A:L').setNumberFormat('@');
    sh.getRange(1, 1, rows.length + 1, WM_COLS.length).setValues([WM_COLS].concat(rows.map(function (r) { return WM_COLS.map(function (k) { return r[k]; }); })));
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
  purgeSessions_();
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

// keepProvinces: tỉnh mà API trả ÍT hơn tổng số chính nó báo (trang cuối rỗng — gặp thật 30/10/2026).
// Cửa hàng thuộc các tỉnh này mà vắng mặt thì GIỮ NGUYÊN, không tính là đóng cửa.
function syncBhxCore_(storesRaw, dryRun, keepProvinces) {
  const keep = {}; (keepProvinces || []).forEach(function (p) { keep[String(p)] = 1; });
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
    const missing = active.filter(function (r) { return !seen[String(r.store_id)]; });
    const held = missing.filter(function (r) { return keep[String(r.province_id)]; });   // vắng do API trả thiếu
    const close = missing.filter(function (r) { return !keep[String(r.province_id)]; });
    if (active.length && close.length / active.length > CFG.MAX_CLOSE_RATIO) {
      throw new Error('Guard: ' + close.length + ' / ' + active.length + ' cửa hàng đang mở bị coi là đóng (> 30%) — nghi API trả thiếu, không ghi');
    }
    const heldIds = {}; held.forEach(function (r) { heldIds[String(r.store_id)] = 1; });
    const res = { baseline: base, stores: stores.length, open: base ? 0 : open.length, close: base ? 0 : close.length, move: base ? 0 : move.length, held: held.length };
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
    }).concat(old.filter(function (r) { return !seen[String(r.store_id)]; }).map(function (r) {
      return heldIds[String(r.store_id)] ? r : Object.assign({}, r, { is_active: false });   // giữ nguyên bản cũ
    }));
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

  const all = {}, keep = {}, perProv = {};
  const add = function (payload, p) {
    (findStores_(payload) || []).forEach(function (rec) {
      const id = Number(pick_(rec, BHX.KEYS.store_id)), lat = Number(pick_(rec, BHX.KEYS.lat)), lng = Number(pick_(rec, BHX.KEYS.lng));
      if (!isFinite(id) || !isFinite(lat) || !isFinite(lng)) return;
      if (!all[id]) perProv[p.id] = (perProv[p.id] || 0) + 1;
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
  const short = provinces.filter(function (p) { return (perProv[p.id] || 0) < p.total; })
    .map(function (p) { return { id: p.id, got: perProv[p.id] || 0, total: p.total }; });
  return { stores: Object.keys(keep).map(function (k) { return keep[k]; }), got: got, totalApi: totalApi, short: short,
    provinces: provinces.length, requests: 1 + provinces.length + more.length };
}

// Lịch chạy hằng ngày (setup tạo, 06:00 theo múi giờ của project). Chạy tay được để thử.
function syncBhxDaily() {
  const t0 = Date.now();
  try {
    const f = fetchBhxStores_();
    const t1 = Date.now();
    const res = syncBhxCore_(f.stores, false, f.short.map(function (s) { return s.id; }));
    const msg = 'OK ' + f.stores.length + ' cửa hàng (API ' + f.got + '/' + f.totalApi + ', ' + f.provinces + ' tỉnh, ' + f.requests + ' request) · mở ' +
      res.open + ' · đóng ' + res.close + ' · dời ' + res.move + (res.baseline ? ' · baseline' : '') +
      (f.short.length ? ' · API trả thiếu ở tỉnh ' + f.short.map(function (s) { return s.id + ' (' + s.got + '/' + s.total + ')'; }).join(', ') +
        ' → giữ nguyên ' + res.held + ' cửa hàng vắng mặt' : '') +
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

// ───────────────────────── Đường đi thực tế ─────────────────────────
// Dịch vụ Maps có sẵn của Apps Script (không cần khoá API, hạn mức theo tài khoản). points[0] là điểm xuất phát, sau đó là các điểm dừng theo thứ tự web đã xếp.
// Mỗi chặng tối đa 23 điểm giữa đường + 1 điểm cuối; Google xếp lại thứ tự trong chặng, điểm cuối của chặng giữ nguyên.
const ROUTE_CHUNK = 24, ROUTE_MAX = 50;
function roadRoute_(pointsRaw) {
  const b = CFG.BBOX, pts = (Array.isArray(pointsRaw) ? pointsRaw : []).map(function (p) { return { lat: Number(p && p.lat), lng: Number(p && p.lng) }; });
  if (pts.length < 2 || pts.length > ROUTE_MAX + 1) throw new Error('Số điểm của tuyến không hợp lệ');
  pts.forEach(function (p) { if (!(p.lat >= b[0] && p.lat <= b[1] && p.lng >= b[2] && p.lng <= b[3])) throw new Error('Có điểm nằm ngoài lãnh thổ VN'); });
  const order = [], legs = [], polys = [];
  for (let a = 1; a < pts.length; a += ROUTE_CHUNK) {
    const n = Math.min(ROUTE_CHUNK, pts.length - a), from = order.length ? pts[order[order.length - 1] + 1] : pts[0], last = pts[a + n - 1];
    const finder = Maps.newDirectionFinder().setOrigin(from.lat, from.lng).setDestination(last.lat, last.lng)
      .setMode(Maps.DirectionFinder.Mode.DRIVING).setOptimizeWaypoints(true).setRegion('vn').setLanguage('vi');
    for (let k = a; k < a + n - 1; k++) finder.addWaypoint(pts[k].lat, pts[k].lng);
    let res;
    try { res = finder.getDirections(); }
    catch (e) { throw new Error('Google chưa tính được đường đi: ' + String(e.message || e).slice(0, 200)); }
    const r = res && res.routes && res.routes[0];
    if (!r) throw new Error('Không tìm được đường đi (' + (res && res.status) + ')');
    (r.waypoint_order || []).forEach(function (w) { order.push(a - 1 + w); });
    order.push(a + n - 2);
    r.legs.forEach(function (l) { legs.push({ km: l.distance.value / 1000, min: l.duration.value / 60 }); });
    polys.push(r.overview_polyline.points);
  }
  return { order: order, legs: legs, polys: polys };
}

// ───────────────────────── Tự lấy các chuỗi khác (lịch 07:00) ─────────────────────────
// Chỉ đọc danh sách cửa hàng công khai trên web của từng chuỗi. Mỗi chuỗi độc lập: chuỗi lỗi thì giữ nguyên
// dữ liệu cũ của chuỗi đó, các chuỗi khác vẫn cập nhật. Emart chưa có nguồn công khai nên chưa có ở đây.
const COMP = {
  COOP_LIST: 'https://co-opmart.com.vn/he-thong-sieu-thi',
  GO: 'https://sieuthi-go.vn/api/store-get-list-store?lang=vi&platform=2',
  TOPS: 'https://topsmarket.vn/wp-admin/admin-ajax.php',
  LOTTE: 'https://www.lottemart.vn/v1/p/mart/bos/vi_nsg/V1/store/detail-list',
  KFM: 'https://onelife-api.kingfoodmart.com/v1/gateway/',
  KFM_QUERY: 'query PartnerStore($page: Int, $limit: Int, $lat: Float, $lng: Float) { partnerStore(page: $page, limit: $limit, lat: $lat, lng: $lng) { data { address storeCode openingDate lat lng } total } }',
  KFM_PAGE: 100,
  MAX_PAGES: 40,
  // Tên tỉnh sau sáp nhập 1/7/2025, và tên cũ / cách viết khác quy về tỉnh mới
  PROVINCES: ['Hà Nội', 'Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Huế', 'Cần Thơ', 'Tuyên Quang', 'Cao Bằng', 'Lai Châu', 'Lào Cai', 'Thái Nguyên', 'Điện Biên', 'Lạng Sơn', 'Sơn La', 'Phú Thọ', 'Bắc Ninh', 'Quảng Ninh', 'Hưng Yên', 'Ninh Bình', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Trị', 'Quảng Ngãi', 'Gia Lai', 'Khánh Hòa', 'Lâm Đồng', 'Đắk Lắk', 'Đồng Nai', 'Tây Ninh', 'Vĩnh Long', 'Đồng Tháp', 'Cà Mau', 'An Giang'],
  ALIASES: { 'Hà Nội': ['hanoi'], 'Hồ Chí Minh': ['hcm', 'binh duong', 'ba ria', 'vung tau', 'binh chanh', 'thu duc'], 'Lâm Đồng': ['binh thuan', 'dak nong', 'dac nong'], 'Gia Lai': ['binh dinh'], 'Đắk Lắk': ['dac lac', 'phu yen'], 'Khánh Hòa': ['ninh thuan'], 'Tây Ninh': ['long an'], 'Đồng Tháp': ['tien giang'], 'Vĩnh Long': ['ben tre', 'tra vinh'], 'Cà Mau': ['bac lieu'], 'An Giang': ['kien giang'], 'Cần Thơ': ['soc trang', 'hau giang'], 'Đồng Nai': ['binh phuoc'], 'Đà Nẵng': ['quang nam'], 'Quảng Trị': ['quang binh'], 'Quảng Ngãi': ['kon tum'], 'Hải Phòng': ['hai duong'], 'Hưng Yên': ['thai binh'], 'Ninh Bình': ['nam dinh', 'ha nam'], 'Bắc Ninh': ['bac giang'], 'Phú Thọ': ['vinh phuc', 'hoa binh'], 'Thái Nguyên': ['bac kan', 'bac can'], 'Tuyên Quang': ['ha giang'], 'Lào Cai': ['yen bai'] },
};
const plainVi_ = function (s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/tinh(?=[a-z])/g, 'tinh ');
};
// Tỉnh = tên tỉnh xuất hiện SAU CÙNG trong địa chỉ ("Phường Bình Dương, Thành phố Hồ Chí Minh" → Hồ Chí Minh).
function tinhOf_(addr) {
  const a = plainVi_(addr);
  let best = '', at = -1;
  const look = function (needle, name) {
    const re = new RegExp('(^|[^a-z0-9])' + needle + '(?![a-z0-9])', 'g');
    let m;
    while ((m = re.exec(a))) { if (m.index > at) { at = m.index; best = name; } }
  };
  COMP.PROVINCES.forEach(function (p) {
    look(plainVi_(p), p);
    (COMP.ALIASES[p] || []).forEach(function (x) { look(x, p); });
  });
  return best;
}
const htmlText_ = function (s) {
  return String(s).replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(Number(d)); })
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
};
// fetchAll theo lô, thử lại tối đa 2 lần. Trả nội dung dạng chữ; còn request lỗi thì báo lỗi cả chuỗi.
function compTexts_(reqs) {
  const out = new Array(reqs.length);
  let todo = reqs.map(function (_, i) { return i; });
  for (let attempt = 0; attempt < 3 && todo.length; attempt++) {
    if (attempt) Utilities.sleep(2000 * attempt);
    const failed = [];
    for (let s = 0; s < todo.length; s += BHX.BATCH) {
      const idx = todo.slice(s, s + BHX.BATCH);
      let res;
      try {
        res = UrlFetchApp.fetchAll(idx.map(function (i) { return Object.assign({ muteHttpExceptions: true }, reqs[i]); }));
      } catch (e) { Array.prototype.push.apply(failed, idx); continue; }
      res.forEach(function (r, k) { if (r.getResponseCode() === 200) out[idx[k]] = r.getContentText(); else failed.push(idx[k]); });
    }
    todo = failed;
  }
  if (todo.length) throw new Error('lỗi ' + todo.length + '/' + reqs.length + ' request, vd: ' + reqs[todo[0]].url);
  return out;
}
const compJson_ = function (req) { return JSON.parse(compTexts_([req])[0]); };

function parseCoopDetail_(slug, html) {
  const la = /!3d(-?\d+\.\d+)/.exec(html), lo = /!2d(-?\d+\.\d+)/.exec(html), ti = /<title>([\s\S]*?)<\/title>/.exec(html);
  const i = html.indexOf('class="last"');
  if (!la || !lo || i < 0) return null;
  const parts = html.slice(i, i + 3000).replace(/<[^>]+>/g, '|').split('|').map(function (x) { return htmlText_(x).trim(); }).filter(String);
  return { store_id: slug, ten: ti ? htmlText_(ti[1]).trim() : slug, dia_chi: parts[2] || '', lat: la[1], lng: lo[1] };
}
function fetchCoop_() {
  const slugs = {};
  for (let p = 1; p <= COMP.MAX_PAGES; p++) {
    const t = compTexts_([{ url: COMP.COOP_LIST + '?searchName=&searchOption=0&page=' + p }])[0], re = /\/he-thong-sieu-thi\/([a-z0-9-]+)/g;
    let m, fresh = 0;
    while ((m = re.exec(t))) { if (!slugs[m[1]]) { slugs[m[1]] = 1; fresh++; } }
    if (!fresh) break;
  }
  const list = Object.keys(slugs);
  const texts = compTexts_(list.map(function (s) { return { url: COMP.COOP_LIST + '/' + s }; }));
  const rows = list.map(function (s, i) { return parseCoopDetail_(s, texts[i]); }).filter(Boolean);
  if (rows.length < list.length * 0.9) throw new Error('đọc được toạ độ ' + rows.length + '/' + list.length + ' — web có thể đã đổi cấu trúc');
  return rows;
}
// GO!, Big C và Tops Market cùng 1 nút lọc; lấy thiếu 1 trong 2 nguồn thì coi cả nhóm là lỗi để không báo đóng cửa sai.
function fetchGo_() {
  const go = compJson_({ url: COMP.GO }).message;
  const tops = compJson_({ url: COMP.TOPS, method: 'post', payload: { action: 'dvls_load_localstores', cityid: '', districtid: '' } }).data;
  if (!Array.isArray(go) || !Array.isArray(tops)) throw new Error('dữ liệu GO!/Tops sai định dạng');
  return go.map(function (s) { return { store_id: s.storeID, ten: s.name, dia_chi: s.address, lat: s.latitude, lng: s.longtitude }; })
    .concat(tops.map(function (s) { return { store_id: 'tops-' + s.id, ten: s.title, dia_chi: s.address, lat: s.maps_lat, lng: s.maps_lng }; }));
}
function fetchLotte_() {
  const list = compJson_({ url: COMP.LOTTE });
  if (!Array.isArray(list)) throw new Error('dữ liệu LOTTE sai định dạng');
  return list.filter(function (s) { return String(s.status) === '1'; }).map(function (s) {
    return { store_id: s.store_code, ten: 'LOTTE Mart ' + String(s.name).trim(), dia_chi: s.store_address, lat: s.latitude, lng: s.longitude };
  });
}
// Bỏ cửa hàng chưa tới ngày khai trương và cửa hàng web chưa có toạ độ (lat/lng = 1).
function fetchKfm_() {
  const today = todayVN_(), all = [];
  for (let p = 1; p <= COMP.MAX_PAGES; p++) {
    const d = compJson_({ url: COMP.KFM, method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ operationName: 'PartnerStore', variables: { page: p, limit: COMP.KFM_PAGE, lat: 0, lng: 0 }, query: COMP.KFM_QUERY }) }).data.partnerStore;
    Array.prototype.push.apply(all, d.data || []);
    if (!(d.data || []).length || all.length >= d.total) {
      if (all.length < d.total) throw new Error('lấy thiếu ' + all.length + '/' + d.total);
      break;
    }
  }
  return all.filter(function (s) { return String(s.openingDate || '').slice(0, 10) <= today && Math.abs(Number(s.lat)) >= 2; }).map(function (s) {
    return { store_id: s.storeCode, ten: 'Kingfoodmart ' + s.storeCode, dia_chi: s.address, lat: s.lat, lng: s.lng };
  });
}
const COMP_FETCH = { COOP: fetchCoop_, GO: fetchGo_, KFM: fetchKfm_, LOTTE: fetchLotte_ };

// Tab chưa tạo (chưa chạy lại setup) → coi như chưa có dữ liệu, không làm hỏng trang.
function compRows_(tab) { return db_().getSheetByName(tab) ? readRows_(tab) : []; }

// So với lần trước, cùng quy tắc và cùng guard với BHX; chỉ đụng tới dòng của chuỗi này.
function syncCompCore_(chain, raw) {
  const b = CFG.BBOX, seenIds = {}, stores = [];
  raw.forEach(function (s) {
    const id = String(s.store_id), lat = Number(String(s.lat).trim()), lng = Number(String(s.lng).trim());
    if (!id || seenIds[id] || !(lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3])) return;
    seenIds[id] = 1;
    stores.push({ chain: chain, store_id: id, ten: String(s.ten || '').trim(), dia_chi: String(s.dia_chi || '').trim(), tinh: tinhOf_(s.dia_chi),
      lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  });
  if (!stores.length) throw new Error('không lấy được cửa hàng nào');
  return withLock_(function () {
    const all = readRows_('comp_stores'), today = todayVN_();
    const old = all.filter(function (r) { return String(r.chain) === chain; }), others = all.filter(function (r) { return String(r.chain) !== chain; });
    const base = old.length === 0, o = {};
    old.forEach(function (r) { o[String(r.store_id)] = r; });
    const open = [], move = [];
    stores.forEach(function (n) {
      const p = o[n.store_id];
      if (!p || !isTrue_(p.is_active)) open.push(n);
      else if (km_(Number(p.lat), Number(p.lng), n.lat, n.lng) > CFG.MOVE_KM) move.push({ n: n, p: p });
    });
    const active = old.filter(function (r) { return isTrue_(r.is_active); });
    const close = active.filter(function (r) { return !seenIds[String(r.store_id)]; });
    if (active.length && close.length / active.length > CFG.MAX_CLOSE_RATIO) {
      throw new Error('Guard: ' + close.length + '/' + active.length + ' cửa hàng bị coi là đóng (> 30%) — nghi nguồn trả thiếu, không ghi');
    }
    if (!base) {
      const ev = function (s, type, extra) {
        return Object.assign({ detected_on: today, chain: chain, type: type, store_id: s.store_id, ten: s.ten, dia_chi: s.dia_chi, tinh: s.tinh, lat: s.lat, lng: s.lng, old_lat: '', old_lng: '' }, extra || {});
      };
      append_('comp_changes', open.map(function (n) { return ev(n, 'open'); })
        .concat(move.map(function (m) { return ev(m.n, 'move', { old_lat: m.p.lat, old_lng: m.p.lng }); }))
        .concat(close.map(function (p) { return ev(p, 'close'); })));
    }
    const rows = stores.map(function (n) {
      const p = o[n.store_id];
      return Object.assign({}, n, { first_seen: p ? p.first_seen : today, last_seen: today, is_active: true });
    }).concat(old.filter(function (r) { return !seenIds[String(r.store_id)]; }).map(function (r) { return Object.assign({}, r, { is_active: false }); }));
    writeAll_('comp_stores', others.concat(rows));
    return { baseline: base, stores: stores.length, open: base ? 0 : open.length, close: base ? 0 : close.length, move: base ? 0 : move.length };
  });
}

// Lịch chạy hằng ngày (setup tạo, 07:00). Chạy tay được để thử. Kết quả từng chuỗi ghi vào settings.comp_last_status.
function syncCompDaily() {
  const status = {}, time = Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm');
  Object.keys(COMP_FETCH).forEach(function (chain) {
    try {
      const r = syncCompCore_(chain, COMP_FETCH[chain]());
      status[chain] = { ok: true, at: time, msg: r.stores + ' cửa hàng · mở ' + r.open + ' · đóng ' + r.close + ' · dời ' + r.move + (r.baseline ? ' · baseline' : '') };
    } catch (e) {
      status[chain] = { ok: false, at: time, msg: String(e.message || e).slice(0, 300) };
    }
    Logger.log(chain + ': ' + status[chain].msg);
  });
  withLock_(function () { putSetting_('comp_last_run', time); putSetting_('comp_last_status', JSON.stringify(status)); });
  return status;
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
    return { tempPassword: tempPassword_(email) };
  });
}
function removeUser_(u, emailRaw) {
  const email = normEmail_(emailRaw);
  if (email === u.email) throw new Error('Không thể tự thu hồi quyền chính mình');
  return withLock_(function () {
    const rows = readRows_('users'), left = rows.filter(function (r) { return String(r.email).toLowerCase() !== email; });
    if (!left.some(function (r) { return r.role === 'admin'; })) throw new Error('Phải còn ít nhất 1 Admin');
    writeAll_('users', left);
    PropertiesService.getScriptProperties().deleteProperty('pw:' + email);
    endSessions_(email);
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
    if (['purgeExpiredWm', 'syncBhxDaily', 'syncCompDaily'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purgeExpiredWm').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('syncBhxDaily').timeBased().atHour(6).everyDays(1).create();
  ScriptApp.newTrigger('syncCompDaily').timeBased().atHour(7).everyDays(1).create();
  uploadFolder_();
  Logger.log('Xong. Admin đầu tiên: %s', owner);
  // Không in khoá ra log (log có thể bị chụp màn hình). Xem trong Cài đặt dự án → Thuộc tính tập lệnh.
  Logger.log('SYNC_SECRET đã có (64 ký tự) — xem trong ⚙️ Cài đặt dự án → Thuộc tính tập lệnh, KHÔNG chia sẻ');
}

// Sửa tay (chỉ chạy khi cần): huỷ các bản ghi "đóng cửa" của 1 ngày đã xác nhận là báo sai —
// xoá các dòng type=close ngày đó trong bhx_changes và bật lại is_active cho cửa hàng tương ứng.
function undoBhxCloses(dateStr) {
  const day = dateStr || todayVN_();
  return withLock_(function () {
    const ch = readRows_('bhx_changes');
    const ids = {}; ch.forEach(function (r) { if (String(r.detected_on) === day && r.type === 'close') ids[String(r.store_id)] = 1; });
    const n = Object.keys(ids).length;
    if (!n) { Logger.log('Không có bản ghi đóng cửa ngày %s', day); return 0; }
    writeAll_('bhx_changes', ch.filter(function (r) { return !(String(r.detected_on) === day && r.type === 'close'); }));
    writeAll_('bhx_stores', readRows_('bhx_stores').map(function (r) { return ids[String(r.store_id)] ? Object.assign({}, r, { is_active: true }) : r; }));
    Logger.log('Đã huỷ %s bản ghi đóng cửa ngày %s: %s', n, day, Object.keys(ids).join(', '));
    return n;
  });
}
