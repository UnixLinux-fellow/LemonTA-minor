// 计算线框图上每个柜体编号的百分比坐标（左/上）。
// 与 three-renderer.captureWireframeImage 参数保持一致：fov=45°、CAPTURE_ZOOM=1.5、
// 柜体平面 z=-120cm、canvas 长宽比 690/420。改任一参数时这里要同步改。
function computeLabelPositions(plan) {
  if (!plan || !plan.wall || !plan.layout || !plan.layout.items) return [];
  const wall = plan.wall;
  const items = plan.layout.items;
  const hasRaise = !!plan.hasRaise;
  const STD_HEIGHT = 230;
  const raiseH = hasRaise ? Math.max(0, wall.h - STD_HEIGHT - 2) : 0;
  const fov = 45;
  const fovRad = (fov * Math.PI) / 180;
  const cameraDist = (wall.w / 2) / Math.tan(fovRad / 2) + wall.h * 0.5;
  const CAPTURE_ZOOM = 1.5;
  const camZ = cameraDist / CAPTURE_ZOOM;
  const CAB_Z = -120;
  const distToCab = camZ - CAB_Z;
  const aspect = 690 / 420;
  const visVertical = 2 * distToCab * Math.tan(fovRad / 2);
  const visHorizontal = visVertical * aspect;
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

module.exports = { computeLabelPositions };
