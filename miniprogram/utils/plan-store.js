// 本地方案存储：基于 wx.storage，最多 30 条。

const STORAGE_KEY = 'PLAN_LIST';
const MAX = 30;

function _getStorage() {
  if (typeof wx !== 'undefined' && wx.getStorageSync) {
    return {
      get: () => wx.getStorageSync(STORAGE_KEY) || [],
      set: (v) => wx.setStorageSync(STORAGE_KEY, v),
    };
  }
  // node 测试兜底
  let mem = [];
  return {
    get: () => mem,
    set: (v) => {
      mem = v;
    },
  };
}

const store = _getStorage();

function list() {
  // 最新在前
  return store.get().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function get(id) {
  return list().find((p) => p.id === id) || null;
}

function isFull() {
  return list().length >= MAX;
}

function names() {
  return list().map((p) => p.name);
}

function upsert(plan) {
  const all = list();
  const i = all.findIndex((p) => p.id === plan.id);
  if (i >= 0) {
    all[i] = plan;
  } else {
    if (all.length >= MAX) return { ok: false, message: '设计库已满30条，需删除部分设计后新建' };
    all.push(plan);
  }
  store.set(all);
  return { ok: true };
}

function remove(id) {
  const all = list().filter((p) => p.id !== id);
  store.set(all);
}

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
  STORAGE_KEY,
  MAX,
  list,
  get,
  isFull,
  names,
  upsert,
  remove,
  makeId,
  timestamp,
  timestampSec,
  photoName,
};
