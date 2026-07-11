// 计算线框图上每个柜体编号的百分比坐标（左/上）。
// 必须与 three-renderer.captureWireframeImage 的投影参数完全一致，否则 DOM 覆盖的编号
// 与图片里烧进去的编号会错位 → 视觉上出现"重影"。
// 当前实现（与 three-renderer 同步）：
//   fov=45° 垂直
//   相机距离 dist = max(distW, distH) * 1.1，distW/distH 各按 aspect 换算的半 fov 求
//   CAPTURE_ZOOM=1（截图不放大，保证宽高完整入镜）
//   缩放走 fov 而不是相机 z：camZ 恒为 dist
//   柜体平面 z = -120cm
//   canvas 长宽比 = 92vw / 420rpx ≈ 690/420
// 任何一处改动都必须同步改这里，并且 cost/index.js 会强制重新烘焙（wireframeHasLabels
// 被作废，见 cost/index.js 的对应逻辑）。
function computeLabelPositions(plan) {
  if (!plan || !plan.wall || !plan.layout || !plan.layout.items) return [];
  const wall = plan.wall;
  const items = plan.layout.items;
  const hasRaise = !!plan.hasRaise;
  const STD_HEIGHT = 230;
  const raiseH = hasRaise ? Math.max(0, wall.h - STD_HEIGHT - 2) : 0;
  const fov = 45;
  const fovRad = (fov * Math.PI) / 180;
  const aspect = 690 / 420;
  const halfFovV = fovRad / 2;
  const halfFovH = Math.atan(Math.tan(halfFovV) * aspect);
  const distW = (wall.w / 2) / Math.tan(halfFovH);
  const distH = (wall.h / 2) / Math.tan(halfFovV);
  const cameraDist = Math.max(distW, distH) * 1.1;
  const CAPTURE_ZOOM = 1;
  // 缩放走 fov：camZ 恒为 cameraDist，fov 缩小到 baseFov
  const camZ = cameraDist;
  const effectiveHalfFovV = Math.atan(Math.tan(halfFovV) / CAPTURE_ZOOM);
  const effectiveHalfFovH = Math.atan(Math.tan(effectiveHalfFovV) * aspect);
  const CAB_Z = -120;
  const distToCab = camZ - CAB_Z;
  const visVertical = 2 * distToCab * Math.tan(effectiveHalfFovV);
  const visHorizontal = 2 * distToCab * Math.tan(effectiveHalfFovH);
  let cursor = -wall.w / 2;
  const xCenters = [];
  items.forEach((it) => {
    if (it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard') {
      xCenters.push(cursor + it.w / 2);
    }
    cursor += it.w;
  });
  const projX = (x) => 50 + (x / (visHorizontal / 2)) * 50;
  const projY = (y) => 50 - ((y - wall.h / 2) / (visVertical / 2)) * 50;
  const bottomCenterY = STD_HEIGHT / 2;
  const raiseCenterY = STD_HEIGHT + raiseH / 2;
  const labels = [];
  xCenters.forEach((x, i) => {
    labels.push({ key: 'b-' + (i + 1), idx: i + 1, left: projX(x), top: projY(bottomCenterY) });
  });
  if (hasRaise) {
    xCenters.forEach((x, i) => {
      labels.push({ key: 'r-' + (i + 1), idx: i + 1, left: projX(x), top: projY(raiseCenterY) });
    });
  }
  return labels;
}

// 投影参数版本号：截图相机公式或 CAPTURE_ZOOM 变更时必须递增。
// cost/index.js 用它决定"存量已烘图"是否作废重烧。
// v1（初版）：dist = (W/2)/tan(fov/2) + H*0.5、CAPTURE_ZOOM=1.5、camZ = dist/1.5
// v2（本次）：dist = max(distW, distH)*1.1（宽高各按 aspect 换算取距离）、CAPTURE_ZOOM=1、
//              缩放走 fov（camZ 恒为 dist），使窄墙/高墙都能完整入镜
const WIREFRAME_LABELS_VERSION = 2;

module.exports = { computeLabelPositions, WIREFRAME_LABELS_VERSION };
