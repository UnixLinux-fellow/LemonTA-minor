// 成本数据启动编排: 并行触发 price/panel/model_meta 三张字典的 preloadAll。
// 由 app.onLaunch 调 ensureCostDataReady(不 await, fire-and-forget), 每次成本页也会再校验。
// 目标是"启动写 storage → 成本页同步命中", 不阻塞其他业务。
//
// 另外提供 ensureUiDescReady 拉 text_desc 供 option-scroll-card 组件的图文说明区使用,
// 与成本无关, 独立编排, 命名分离。

const priceDict = require('./price-dict.js');
const panelDict = require('./panel-dict.js');
const modelMetaCache = require('./model-meta-cache.js');
const textDescDict = require('./text-desc-dict.js');

async function ensureCostDataReady(opts) {
  const force = !!(opts && opts.force);
  await Promise.all([
    priceDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] price fail', e)),
    panelDict.preloadAll({ force }).catch((e) => console.warn('[bootstrap] panel fail', e)),
    modelMetaCache.preloadAll().catch((e) => console.warn('[bootstrap] meta fail', e)),
  ]);
}

async function ensureUiDescReady(opts) {
  const force = !!(opts && opts.force);
  await textDescDict.preloadAll({ force })
    .catch((e) => console.warn('[bootstrap] text_desc fail', e));
}

function isAllReady() {
  return priceDict.isReady() && panelDict.isReady();
  // model-meta-cache 无 isReady: 成本页会按具体 fileName 判 peekMeta,
  // 缺哪个柜的元数据只影响那一柜, 不阻塞其他柜。
  // text-desc-dict 也不算入: UI 说明区可缺, 页面仍能正常用。
}

module.exports = { ensureCostDataReady, ensureUiDescReady, isAllReady };
