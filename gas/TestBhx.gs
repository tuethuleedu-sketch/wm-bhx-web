/**
 * Thử xem máy chủ Google (Apps Script) có gọi được API công khai của BHX không.
 * Chỉ đọc, không ghi gì vào Sheet. Chạy hàm testBhxFetch rồi xem Nhật ký thực thi.
 */
function testBhxFetch() {
  const opt = {
    muteHttpExceptions: true,
    headers: { Accept: 'application/json, text/plain, */*', Origin: 'https://www.bachhoaxanh.com', Referer: 'https://www.bachhoaxanh.com/' },
  };
  const urls = [
    'https://api.bachhoaxanh.com/gw/LocationV3/GetFull',
    'https://api.bachhoaxanh.com/gw/Location/V2/GetStoresByLocation?provinceId=1000&wardId=0&pageSize=50&pageIndex=0',
  ];
  urls.forEach(function (u) {
    const t = Date.now();
    try {
      const r = UrlFetchApp.fetch(u, opt);
      const body = r.getContentText();
      let info = '';
      try {
        const d = JSON.parse(body).data || {};
        info = d.provinces ? d.provinces.length + ' tỉnh' : (d.stores ? d.stores.length + ' cửa hàng (tổng ' + d.total + ')' : '');
      } catch (e) { info = 'không phải JSON: ' + body.slice(0, 120); }
      Logger.log('OK  HTTP %s · %s ms · %s · %s', r.getResponseCode(), Date.now() - t, info, u.split('/gw/')[1].slice(0, 40));
    } catch (e) {
      Logger.log('LỖI %s ms · %s · %s', Date.now() - t, e.message, u.split('/gw/')[1].slice(0, 40));
    }
  });
}
