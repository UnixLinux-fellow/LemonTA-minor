// 柜体参数化生成的共享工具：门数、门宽、门分组。
// 单位 mm。鞋柜（含 150A/B/C/D 变体）与书柜共享。
// 抽出自 shoe-cabinet-parts.js，保持算法一致，便于变体与新品类复用。

const SIDE_PANEL_THICK = 18;
const GAP = 2;
const WIDTH_MIN = 800;
const WIDTH_MAX = 3000;

function _clampW(w) {
  if (typeof w !== 'number' || !isFinite(w)) return WIDTH_MIN;
  return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, w));
}

// 硬编码区间匹配。临界值严格：1100=2, 1101=3
function getDoorCount(totalWidth) {
  const w = _clampW(totalWidth);
  if (w <= 1100) return 2;
  if (w <= 1600) return 3;
  if (w <= 2100) return 4;
  if (w <= 2600) return 5;
  return 6;
}

// 输入 totalWidth (mm), doorCount, 输出 doorWidths[] 与 xOffsets[]
// 内宽 = totalWidth - SIDE_PANEL_THICK*2
// 总缝 = GAP * (doorCount + 1)
// baseW = floor((内宽 - 总缝) / doorCount)
// 余量 = 内宽 - 总缝 - baseW*doorCount, 全部加到最后一扇
// xOffsets[0] = SIDE_PANEL_THICK + GAP
// xOffsets[i] = xOffsets[i-1] + doorWidths[i-1] + GAP
function calcDoorSizeAndX(totalWidth, doorCount) {
  const innerW = totalWidth - SIDE_PANEL_THICK * 2;
  const totalGap = GAP * (doorCount + 1);
  const usable = innerW - totalGap;
  const baseW = Math.floor(usable / doorCount);
  const remainder = usable - baseW * doorCount;
  const doorWidths = new Array(doorCount).fill(baseW);
  doorWidths[doorCount - 1] += remainder;
  const xOffsets = [];
  let cursor = SIDE_PANEL_THICK + GAP;
  for (let i = 0; i < doorCount; i++) {
    xOffsets.push(cursor);
    cursor += doorWidths[i] + GAP;
  }
  return { doorWidths, xOffsets };
}

// 门的分组：N 奇 → [1, 2, 2, ...]（单开门在最左，其余对开）
//          N 偶 → [2, 2, ...]（全部对开）
// 中侧板只放在分组边界，数量 = groups.length - 1
function getDoorGroups(doorCount) {
  const n = Math.max(0, Math.floor(doorCount));
  if (n === 0) return [];
  const groups = [];
  if (n % 2 === 1) groups.push(1);
  const pairs = Math.floor((n - (n % 2)) / 2);
  for (let i = 0; i < pairs; i++) groups.push(2);
  return groups;
}

module.exports = {
  SIDE_PANEL_THICK,
  GAP,
  WIDTH_MIN,
  WIDTH_MAX,
  _clampW,
  getDoorCount,
  calcDoorSizeAndX,
  getDoorGroups,
};
