// 方案命名与 id 工具。设计数据本身由 app.saveDesign / app.refreshDesigns 直接写云端。

function makeId() {
  return 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

function timestamp(date) {
  const d = date || new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes())
  );
}

// 含秒的时间戳，用于照片命名（YYYYMMDDhhmmss）
function timestampSec(date) {
  const d = date || new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function photoName(name, date) {
  return timestampSec(date) + '-' + (name || 'photo') + '.jpg';
}

module.exports = {
  makeId,
  timestamp,
  timestampSec,
  photoName,
};
