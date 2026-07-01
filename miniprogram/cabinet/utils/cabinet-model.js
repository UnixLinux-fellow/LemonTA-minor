// 衣柜模型命名规范与本地清单管理。
// 命名：{宽}-{高}-{深}-{编码}.glb，编码字母 a..l/g/SK/y/yg/z/zg。

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

// 实际本地 glb 文件命名为 {宽}{编码大写}.glb（如 50A.glb / 100G1.glb），
// 而需求文档里的命名规则是 {宽}-{高}-{深}-{编码}.glb。
// 这里同时支持两种解析。

const LOCAL_MODEL_DIR = '/cabinet/utils/cabinet-model';

function parse(name) {
  const base = name.replace(/\.glb$/i, '');
  // 短命名：50A / 100G1 / 100A2
  const shortMatch = base.match(/^(\d+)([A-Za-z][A-Za-z0-9]*)$/);
  if (shortMatch) {
    const w = parseInt(shortMatch[1], 10);
    const codeRaw = shortMatch[2];
    return { w, h: defaultHeightForCode(codeRaw), d: 600, code: codeRaw.toLowerCase() };
  }
  // 完整命名：{w}-{h}-{d}-{code}
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

function defaultHeightForCode(code) {
  const lc = code.toLowerCase();
  if (lc.indexOf('g') === 0 || lc === 'yg' || lc === 'zg') return 300;
  if (lc === 'sk') return 230;
  return 230;
}

function format({ w, h, d, code }) {
  return `${w}-${h}-${d}-${code}`;
}

// 短命名（小程序本地真实文件名），如 50A.glb / 100G1.glb
function shortName({ w, code }) {
  return `${w}${code.toUpperCase()}.glb`;
}

function localPath({ w, code }) {
  return `${LOCAL_MODEL_DIR}/${shortName({ w, code })}`;
}

// 检查 glb 是否真实存在
// 小程序运行时：wx.getFileSystemManager().accessSync（包内文件）
// Node 测试环境：fs.existsSync 兜底，路径相对 cabinet-model.js 同级 cabinet-model/ 目录
function fileExists(pkgPath) {
  if (typeof wx !== 'undefined' && wx.getFileSystemManager) {
    const fs = wx.getFileSystemManager();
    try { fs.accessSync(pkgPath); return true; } catch (e) { /* fallthrough */ }
    // 部分基础库要求去掉前导 /
    try { fs.accessSync(pkgPath.replace(/^\//, '')); return true; } catch (e) { return false; }
  }
  try {
    const nodeFs = require('fs');
    const nodePath = require('path');
    // pkgPath 形如 "/cabinet/utils/cabinet-model/100K.glb"，cabinet-model.js 自身在 cabinet/utils/ 下
    // 取 file basename 拼到 cabinet-model.js 同级 cabinet-model/ 子目录
    const base = pkgPath.split('/').pop();
    return nodeFs.existsSync(nodePath.join(__dirname, 'cabinet-model', base));
  } catch (e) {
    return false;
  }
}

function makeModel(w, code) {
  const h = defaultHeightForCode(code), d = 600;
  return {
    w,
    h,
    d,
    code,
    name: format({ w, h, d, code }),
    file: shortName({ w, code }),
    path: localPath({ w, code }),
  };
}

// 自动扫描 utils/cabinet-model/ 下所有遵循 {50|100}{A-Z}.glb 命名的柜型 +
// {50|100}{g|g1|g2}.glb 加高模块。新增任何符合命名的 glb，无需改代码即可被识别。
// 注：转角柜 Y/Z/YG/ZG 命名为 Y-110-230.glb 形式，文件加载由 three-renderer
// 直接路由，不进入 picker，故不归本函数管理。
function localModels() {
  const found = [];
  // 标准柜：枚举 a..z 字母
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    for (const w of [50, 100]) {
      const m = makeModel(w, letter);
      if (fileExists(m.path)) found.push(m);
    }
  }
  // 加高模块：g / g1 / g2
  for (const code of ['g', 'g1', 'g2']) {
    for (const w of [50, 100]) {
      const m = makeModel(w, code);
      if (fileExists(m.path)) found.push(m);
    }
  }
  return found;
}

function categorize(models) {
  const out = { s50: [], s100: [], raise: [], corner: [], sk: [], other: [] };
  models.forEach((m) => {
    if (/^g/i.test(m.code) && m.code.indexOf('zg') !== 0 && m.code.indexOf('yg') !== 0) {
      out.raise.push(m);
    } else if (m.code === 'y' || m.code === 'z' || m.code === 'yg' || m.code === 'zg') {
      out.corner.push(m);
    } else if (m.code === 'SK') {
      out.sk.push(m);
    } else if (m.w === 50) {
      out.s50.push(m);
    } else if (m.w === 100) {
      out.s100.push(m);
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
  localModels,
  categorize,
};
