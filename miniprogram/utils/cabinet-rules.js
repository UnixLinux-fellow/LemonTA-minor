// 衣柜空间设置与摆放校验规则。纯函数，便于单测。

const CORNER = {
  WZJ: 'WZJ', // 无
  ZZJ: 'ZZJ', // 左转角
  YZJ: 'YZJ', // 右转角
  ZYZJ: 'ZYZJ', // 双侧
};

const WALL_LIMIT = { wMin: 44, wMax: 1000, hMin: 232, hMax: 1000 };
const WALL_LIMIT_SHOE = { wMin: 80, wMax: 300, hMin: 220, hMax: 270 };
const MODE = { WARDROBE: 'wardrobe', SHOE: 'shoe' };

function isPositiveInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function validateName(name, existingNames) {
  if (!name) return { ok: false, message: '请填写空间名称' };
  if (name.length > 15) return { ok: false, message: '空间名称限制15个字符' };
  if (existingNames && existingNames.indexOf(name) >= 0) {
    return { ok: false, message: '空间名称不能重复，请重新填写空间名称' };
  }
  return { ok: true };
}

function validateWall(width, height, mode) {
  const limit = mode === MODE.SHOE ? WALL_LIMIT_SHOE : WALL_LIMIT;
  if (!isPositiveInt(width) || !isPositiveInt(height)) {
    return { ok: false, message: '墙体尺寸需为正整数' };
  }
  if (width < limit.wMin || width > limit.wMax) {
    return {
      ok: false,
      message: `墙体宽度需在 ${limit.wMin}cm ~ ${limit.wMax}cm 之间`,
    };
  }
  if (height < limit.hMin || height > limit.hMax) {
    return {
      ok: false,
      message: `墙体高度需在 ${limit.hMin}cm ~ ${limit.hMax}cm 之间`,
    };
  }
  return { ok: true };
}

// 转角柜校验：W<114 仅 WZJ；114<=W<224 仅 ZZJ/YZJ/WZJ（不可双侧）
function validateCorner(width, cornerType) {
  if (!CORNER[cornerType]) return { ok: false, message: '请选择转角柜类型' };
  if (cornerType === CORNER.WZJ) return { ok: true };
  if (width < 114) {
    return {
      ok: false,
      message: '不符合转角衣柜添加条件，宽度<114cm 时仅可选择"无"',
    };
  }
  if (width < 224 && cornerType === CORNER.ZYZJ) {
    return {
      ok: false,
      message:
        '不符合转角衣柜添加条件，114cm≤宽度<224cm 时仅可选择左侧或右侧转角柜',
    };
  }
  return { ok: true };
}

function validateRaise(height, hasRaise) {
  if (!hasRaise) return { ok: true };
  if (height <= 250) {
    return {
      ok: false,
      message: '墙面高度不符合勾选加高模块的条件，高度需大于250cm',
    };
  }
  return { ok: true };
}

// 单侧转角柜数量
function cornerCount(cornerType) {
  if (cornerType === CORNER.WZJ) return 0;
  if (cornerType === CORNER.ZYZJ) return 2;
  return 1;
}

// 标准模块可摆放总宽 x：在区间 [W-124-z*110, W-44-z*110] 中找能被 50 整除的最大值
function computeStandardRange(width, cornerType) {
  const z = cornerCount(cornerType);
  const lo = width - 124 - z * 110;
  const hi = width - 44 - z * 110;
  if (hi < 0) return { x: 0, lo, hi, valid: false };
  // 找区间内最大的 50 倍数；标准段必须能容纳至少一个 50cm 柜
  const top = Math.floor(hi / 50) * 50;
  if (top < lo || top < 50) return { x: 0, lo, hi, valid: false };
  return { x: top, lo, hi, valid: true };
}

// 给定标准段已用宽度 used，返回非标模块宽度 e（cm）
function computeNonStandardWidth(width, cornerType, standardUsed) {
  const z = cornerCount(cornerType);
  const reserved = 4 /* 两侧收口 SK*2 */ + z * 110; // 转角柜按 110cm 占位
  const remaining = width - reserved - standardUsed;
  return remaining;
}

module.exports = {
  CORNER,
  WALL_LIMIT,
  WALL_LIMIT_SHOE,
  MODE,
  validateName,
  validateWall,
  validateCorner,
  validateRaise,
  cornerCount,
  computeStandardRange,
  computeNonStandardWidth,
};
