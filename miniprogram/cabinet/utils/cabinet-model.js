// 衣柜模型命名解析与分类：{宽}{编码大写}.glb 短命名，或 {宽}-{高}-{深}-{编码}。
// 云存储上线后，模型清单来自 model-sync.listModels()（该模块懒 require 避免循环依赖）。
// 转角柜 Y/Z/YG/ZG 归入 zj 子目录，picker 侧按 subdir 分组。

const CODE_MAP = {
  a: '上下短衣区柜子',
  b: '上中长衣下开放格柜子',
  c: '上中长衣下抽屉柜子',
  d: '上短衣区中抽屉下抽拉层板柜子',
  e: '非标模块',
  f: '上短衣区下抽屉柜子',
  h: '上层板均分下抽屉柜子',
  i: '上中长衣左下抽屉右下层板柜子',
  j: '上短衣区下层板均分',
  k: '上层板均分下短衣区',
  l: '均为长衣区',
  g: '加高模块',
  SK: '收口条',
  y: '右侧转角柜',
  yg: '右侧转角柜加高模块',
  z: '左侧转角柜',
  zg: '左侧转角柜加高模块',
};

function defaultHeightForCode(code) {
  const lc = code.toLowerCase();
  if (lc.indexOf('g') === 0 || lc === 'yg' || lc === 'zg') return 300;
  if (lc === 'sk') return 230;
  return 230;
}

function parse(name) {
  const base = name.replace(/\.glb$/i, '');
  const shortMatch = base.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/);
  if (shortMatch) {
    const w = parseInt(shortMatch[1], 10);
    const codeRaw = shortMatch[2];
    return { w, h: defaultHeightForCode(codeRaw), d: 600, code: codeRaw.toLowerCase() };
  }
  const parts = base.split('-');
  if (parts.length >= 4) {
    return {
      w: parseInt(parts[0], 10),
      h: parseInt(parts[1], 10),
      d: parseInt(parts[2], 10),
      code: parts.slice(3).join('-'),
    };
  }
  return null;
}

function format({ w, h, d, code }) {
  return `${w}-${h}-${d}-${code}`;
}

function shortName({ w, code }) {
  return `${w}${code.toUpperCase()}.glb`;
}

// 已缓存到本地的柜型清单：委托给 model-sync。
// model-sync 在无 wx 环境（Node 测试）时返回空数组 → 测试直接构造数据传给 categorize。
function localModels() {
  const modelSync = require('./model-sync.js');
  return modelSync.listModels();
}

// 按 subdir 归类：50cm → s50，100cm → s100，zj → corner；code 以 g 开头的走 raise。
function categorize(models) {
  const out = { s50: [], s100: [], raise: [], corner: [], sk: [], other: [] };
  models.forEach((m) => {
    if (m.subdir === 'zj') {
      out.corner.push(m);
    } else if (m.subdir === '50cm') {
      if (/^g/.test(m.code || '')) out.raise.push(m);
      else out.s50.push(m);
    } else if (m.subdir === '100cm') {
      if (/^g/.test(m.code || '')) out.raise.push(m);
      else out.s100.push(m);
    } else if (m.code === 'SK' || m.code === 'sk') {
      out.sk.push(m);
    } else {
      out.other.push(m);
    }
  });
  return out;
}

module.exports = {
  CODE_MAP,
  parse,
  format,
  shortName,
  localModels,
  categorize,
};
