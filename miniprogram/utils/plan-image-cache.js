// utils/plan-image-cache.js
//
// 云端 designs doc 里刻意不存 previewImage / wireframeImage / photoPath（三个本地路径字段，
// app.js 的 LOCAL_ONLY 白名单会剥掉）。云端只留 previewFileID / wireframeFileID / photoFileID。
//
// 于是"清缓存后拉回方案，直接打开 materials/cost"会出问题：wxml 硬绑本地路径字段，全空。
// 打开方案 / 导出前用本模块把三个 fileID 走 imgCache（命中即本地路径；未命中会下载落盘）
// 补回本地路径字段，UI/导出零改动。

const imgCache = require('./img-cache.js');

/**
 * fileID → 本地路径的四级回退：
 *   1) 字段为空 → 返回空串
 *   2) plan 里已有 wxfile:// 本地路径（同会话产物）→ 直接用
 *   3) imgCache 命中 → 用缓存路径
 *   4) 都没命中 → getTempFileURL + downloadFile + saveFile（imgCache.resolve 内部完成）
 */
function _resolveOne(fileID, existingLocal) {
  if (!fileID) return Promise.resolve(existingLocal || '');
  if (existingLocal && /^wxfile:\/\//.test(existingLocal)) {
    return Promise.resolve(existingLocal);
  }
  return imgCache.resolve(fileID).catch((err) => {
    console.warn('[plan-image-cache] resolve fileID 失败:', fileID, err && err.errMsg);
    return '';
  });
}

/**
 * 就地把 plans 里三张图的本地路径字段（previewImage / wireframeImage / photoPath）补齐。
 * 失败字段置空串（wxml 的 wx:if / pdf-exporter 会兜底占位），永不抛错。
 * @param {Array<object>} plans
 * @returns {Promise<void>}
 */
async function resolvePlanImages(plans) {
  await Promise.all((plans || []).map(async (plan) => {
    const [preview, wire, photo] = await Promise.all([
      _resolveOne(plan.previewFileID,   plan.previewImage),
      _resolveOne(plan.wireframeFileID, plan.wireframeImage),
      _resolveOne(plan.photoFileID,     plan.photoPath),
    ]);
    plan.previewImage = preview || '';
    plan.wireframeImage = wire || '';
    plan.photoPath = photo || '';
  }));
}

/**
 * 同步判断"resolvePlanImages 会不会真的触发下载"。
 * 用于 onTap 前决定是否 showLoading —— 命中缓存时可以静默补字段直接 navigate。
 *
 *   fileID 空                        → 视为不需要（该图本来就没有）
 *   plan 已有 wxfile:// 本地路径     → 视为 ready（同会话产物 / 未被 refresh 冲掉）
 *   imgCache.hasReady 命中           → 视为 ready
 *   其余                             → not ready（真要下载）
 *
 * @param {Array<object>} plans
 * @returns {boolean}
 */
function arePlanImagesReady(plans) {
  const report = diagnosePlanImages(plans);
  return report.ready;
}

/**
 * arePlanImagesReady 的详细版本：返回每张图的判定依据，方便真机排查为什么会走 loading 分支。
 * 不做任何异步 IO，与 arePlanImagesReady 走同一套判定，只多产出一份诊断信息。
 *
 * 返回：{ ready: boolean, details: [{ plan, field, fileID, existingLocal, reason }] }
 *   reason ∈ 'no-fileid' | 'wxfile-exists' | 'cache-hit' | 'cache-miss'
 *   ready = 所有 details 里 reason !== 'cache-miss'
 *
 * @param {Array<object>} plans
 */
function diagnosePlanImages(plans) {
  const list = plans || [];
  const details = [];
  let ready = true;
  for (let i = 0; i < list.length; i++) {
    const plan = list[i] || {};
    const triples = [
      ['previewImage',   plan.previewFileID,   plan.previewImage],
      ['wireframeImage', plan.wireframeFileID, plan.wireframeImage],
      ['photoPath',      plan.photoFileID,     plan.photoPath],
    ];
    for (let j = 0; j < triples.length; j++) {
      const field = triples[j][0];
      const fileID = triples[j][1];
      const existingLocal = triples[j][2];
      let reason;
      if (!fileID) reason = 'no-fileid';
      else if (existingLocal && /^wxfile:\/\//.test(existingLocal)) reason = 'wxfile-exists';
      else if (imgCache.hasReady(fileID)) reason = 'cache-hit';
      else { reason = 'cache-miss'; ready = false; }
      details.push({
        planId: plan.id || plan._id,
        field: field,
        fileID: fileID || '',
        existingLocal: existingLocal || '',
        reason: reason,
      });
    }
  }
  return { ready: ready, details: details };
}

module.exports = {
  resolvePlanImages: resolvePlanImages,
  arePlanImagesReady: arePlanImagesReady,
  diagnosePlanImages: diagnosePlanImages,
};
