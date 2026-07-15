// 衣柜摆放引擎：根据空间设置生成布局，支持加/删模块、颜色与门板切换。

const rules = require('../../utils/cabinet-rules.js');

const SK_WIDTH = 2;
const CORNER_WIDTH = 110;
const STD_HEIGHT = 230;

// 默认非标拉伸所用的占位模型 code
function chooseNonStandardCode(width) {
  return width <= 60 ? 'e1' : 'e2';
}

// 创建布局初始状态
function init({ wall, cornerType, hasRaise }) {
  const range = rules.computeStandardRange(wall.w, cornerType);
  const z = rules.cornerCount(cornerType);
  const standardWidth = range.x;
  const nonStandardWidth = wall.w - 4 - z * CORNER_WIDTH - standardWidth;

  const items = [];
  let cursor = 0; // 从左到右累计宽度

  // 左收口
  items.push({ kind: 'sk', code: 'SK', w: SK_WIDTH, h: wall.h, side: 'left' });
  cursor += SK_WIDTH;

  // 左转角
  if (cornerType === rules.CORNER.ZZJ || cornerType === rules.CORNER.ZYZJ) {
    items.push({
      kind: 'corner',
      code: 'z',
      w: CORNER_WIDTH,
      h: STD_HEIGHT,
    });
    cursor += CORNER_WIDTH;
  }

  // 第一个标准模块默认 100cm a 型（左转角/双侧转角场景下，首位由 z 转角占据，
  // 不再放默认柜；标准段从转角右侧 cursor 起算，由用户主动添加）。
  // 小墙 fallback：标准段 <100 但 ≥50 时退回放 50A；<50 不放默认柜。
  const hasLeftCorner = cornerType === rules.CORNER.ZZJ || cornerType === rules.CORNER.ZYZJ;
  let firstW = 0;
  if (!hasLeftCorner) {
    if (standardWidth >= 100) firstW = 100;
    else if (standardWidth >= 50) firstW = 50;
  }
  if (firstW > 0) {
    items.push({
      kind: 'standard',
      code: 'a',
      w: firstW,
      h: STD_HEIGHT,
      isFirst: true,
    });
  }

  // 右转角占位（实际放置等到布局结束时再插入到末尾，便于按 cursor 顺序展示）
  // 使用 placedRightCorner 标记
  const meta = {
    wall: Object.assign({}, wall),
    cornerType,
    hasRaise,
    standardWidth, // 总标准段宽度
    standardUsed: firstW, // 已占用标准段宽度
    nonStandardWidth: nonStandardWidth > 0 ? nonStandardWidth : 0,
    color: 'white',
    showDoor: false,
    isFull: false,
    nonStandardPlaced: false,
  };

  return { items, meta };
}

// 当前是否已进入最后一格（必须放非标）
function inLastSlot(state) {
  const remaining = state.meta.standardWidth - state.meta.standardUsed;
  return remaining < 50;
}

// 标准段还可继续放置的剩余宽度
function standardRemaining(state) {
  return state.meta.standardWidth - state.meta.standardUsed;
}

// 添加下一个模块
function addNext(state, { code, size }) {
  if (state.meta.isFull) {
    return { ok: false, message: '已布满，请点击确认布局' };
  }

  // 尾段合并规则：标准段剩余 <100 (已放不下整块 100A) 且 剩余+非标 落在单块非标覆盖范围
  // [40,120] 时, 直接把这两段合并成一块非标 e1/e2 收尾, 而不是 "50A + 更小的非标" 两块。
  // 对应文档: 剩余 41~61 用 50A (chooseNonStandardCode → e1), 61~120 用 100A 缩放 (→ e2)。
  // 忽略传入的 code/size —— 本次点击语义变成 "收尾", 单块非标由 chooseNonStandardCode 选型。
  const remaining = standardRemaining(state);
  if (remaining > 0 && remaining < 100) {
    const merged = remaining + state.meta.nonStandardWidth;
    if (merged >= 40 && merged <= 120) {
      state.meta.standardWidth = state.meta.standardUsed;
      state.meta.nonStandardWidth = merged;
      placeNonStandardAndClose(state);
      return { ok: true, merged: true };
    }
    // merged 超出单块非标范围 → 退回老路径 (下面分支照旧: 塞个 50 + 后续更小非标)
  }

  // 标准模块
  if (remaining >= size) {
    state.items.push({
      kind: 'standard',
      code,
      w: size,
      h: STD_HEIGHT,
    });
    state.meta.standardUsed += size;
  } else if (remaining === 50 && size === 50) {
    state.items.push({
      kind: 'standard',
      code,
      w: 50,
      h: STD_HEIGHT,
    });
    state.meta.standardUsed += 50;
  } else {
    return { ok: false, message: '剩余宽度不足，无法放置该尺寸柜体' };
  }

  // 是否进入最后一格触发非标自动放置
  if (state.meta.standardUsed >= state.meta.standardWidth) {
    placeNonStandardAndClose(state);
  }

  return { ok: true };
}

function placeNonStandardAndClose(state) {
  if (state.meta.nonStandardPlaced) return;
  if (state.meta.nonStandardWidth >= 40 && state.meta.nonStandardWidth <= 120) {
    const eCode = chooseNonStandardCode(state.meta.nonStandardWidth);
    state.items.push({
      kind: 'nonstandard',
      code: eCode,
      w: state.meta.nonStandardWidth,
      h: STD_HEIGHT,
    });
    state.meta.nonStandardPlaced = true;
  }
  // 右转角
  if (
    state.meta.cornerType === rules.CORNER.YZJ ||
    state.meta.cornerType === rules.CORNER.ZYZJ
  ) {
    state.items.push({
      kind: 'corner',
      code: 'y',
      w: CORNER_WIDTH,
      h: STD_HEIGHT,
    });
  }
  // 右收口
  state.items.push({
    kind: 'sk',
    code: 'SK',
    w: SK_WIDTH,
    h: state.meta.wall.h,
    side: 'right',
  });
  state.meta.isFull = true;
}

// 删除最后一个模块
function removeLast(state) {
  if (state.meta.isFull) {
    // 撤回非标 + 上一个标准
    // 先去掉收口与转角
    while (state.items.length) {
      const last = state.items[state.items.length - 1];
      if (last.kind === 'sk' && last.side === 'right') {
        state.items.pop();
        continue;
      }
      if (last.kind === 'corner' && last.code === 'y') {
        state.items.pop();
        continue;
      }
      if (last.kind === 'nonstandard') {
        state.items.pop();
        state.meta.nonStandardPlaced = false;
        break;
      }
      break;
    }
    // 同时撤回上一个标准模块
    const lastStd = state.items[state.items.length - 1];
    if (lastStd && lastStd.kind === 'standard' && !lastStd.isFirst) {
      state.meta.standardUsed -= lastStd.w;
      state.items.pop();
    }
    state.meta.isFull = false;
    return { ok: true };
  }

  // 找到最后一个标准模块
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.kind === 'standard') {
      if (it.isFirst) {
        return {
          ok: false,
          message: '第一个模块只能替换，不能删除',
        };
      }
      state.meta.standardUsed -= it.w;
      state.items.splice(i, 1);
      return { ok: true };
    }
  }
  return { ok: false, message: '无可删除模块' };
}

// 替换第一个模块（仅可在第一格替换）
// size 变化必须不超过整段标准宽度，否则布局会越界
function replaceFirst(state, { code, size }) {
  for (let i = 0; i < state.items.length; i++) {
    const it = state.items[i];
    if (it.kind === 'standard' && it.isFirst) {
      const newUsed = state.meta.standardUsed - it.w + size;
      if (newUsed > state.meta.standardWidth) {
        return { ok: false, message: '当前墙宽放不下该尺寸的首块' };
      }
      state.meta.standardUsed = newUsed;
      it.code = code;
      it.w = size;
      // 替换后正好填满整段标准宽度 → 自动落非标 + 右转角 + 右收口（与 addNext 一致）
      if (state.meta.standardUsed >= state.meta.standardWidth) {
        placeNonStandardAndClose(state);
      }
      return { ok: true };
    }
  }
  return { ok: false, message: '未找到首个模块' };
}

// 替换最后一个标准模块（含 isFirst 那一格在内）
// size 变化不可使 standardUsed 超过 standardWidth，否则越界返回失败、不修改 state
function replaceLast(state, { code, size }) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const it = state.items[i];
    if (it.kind !== 'standard') continue;
    const newUsed = state.meta.standardUsed - it.w + size;
    if (newUsed > state.meta.standardWidth) {
      return { ok: false, message: '剩余宽度不足，无法放置该尺寸柜体' };
    }
    state.meta.standardUsed = newUsed;
    it.code = code;
    it.w = size;
    // 与 replaceFirst 一致：刚好填满则自动落非标 + 右转角 + 右收口
    if (state.meta.standardUsed >= state.meta.standardWidth) {
      placeNonStandardAndClose(state);
    }
    return { ok: true };
  }
  return { ok: false, message: '未找到可替换的标准模块' };
}

// 当前布局是否处于"仅首块"状态：只有自动放置的首个标准模块、未布满
// （转角/收口不算 standard，所以左转角场景下也能正确识别）
function isOnlyFirstCabinet(state) {
  if (state.meta.isFull) return false;
  const stds = state.items.filter((it) => it.kind === 'standard');
  return stds.length === 1 && !!stds[0].isFirst;
}

function applyColor(state, color) {
  state.meta.color = color;
}

function toggleDoor(state) {
  state.meta.showDoor = !state.meta.showDoor;
}

// 序列化为存储格式（参考需求 3.3.3.2 节）
function serialize(state, planMeta) {
  const standards = state.items.filter(
    (it) => it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard'
  );
  const lines = [];
  // 标题行
  const cornerCodeMap = {
    WZJ: 'WZJ',
    ZZJ: 'ZZJ',
    YZJ: 'YZJ',
    ZYZJ: 'SZJ',
  };
  const titleParts = [
    planMeta.userTag || 'guest',
    planMeta.timestamp,
    planMeta.name,
    cornerCodeMap[state.meta.cornerType],
    'H-' + state.meta.wall.h,
    'W-' + state.meta.wall.w,
  ];
  lines.push(titleParts.join('-'));

  // 左下编号
  standards.forEach((it, idx) => {
    lines.push(`左下${idx + 1}：${it.code}-${it.w}-${it.h}`);
  });

  // 左上加高
  if (state.meta.hasRaise) {
    const raiseH = Math.max(0, state.meta.wall.h - 230 - 2);
    standards.forEach((it, idx) => {
      const code = it.code === 'y' ? 'yg' : it.code === 'z' ? 'zg' : 'g';
      lines.push(`左上${idx + 1}：${code}-${it.w}-${raiseH}`);
    });
  }

  // 收口条合并：上、左、右
  const skSide = state.meta.wall.h;
  const skTopWidth = state.meta.wall.w - 4;
  lines.push(`左收口：SK-2-${skSide}`);
  lines.push(`右收口：SK-2-${skSide}`);
  lines.push(`上收口：SK-${skTopWidth}-2`);
  return lines.join('\n');
}

// 计算柜门是否被遮挡的展示 + 总价相关需要的扁平柜体清单
function flattenCabinets(state) {
  const list = [];
  const standards = state.items.filter(
    (it) => it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard'
  );
  standards.forEach((it, idx) => {
    list.push({
      idx: idx + 1,
      label: `左下${idx + 1}`,
      code: it.code,
      w: it.w,
      h: it.h,
      kind: it.kind,
    });
  });
  if (state.meta.hasRaise) {
    standards.forEach((it, idx) => {
      const raiseH = Math.max(0, state.meta.wall.h - 230 - 2);
      const code = it.code === 'y' ? 'yg' : it.code === 'z' ? 'zg' : 'g';
      list.push({
        idx: idx + 1,
        label: `左上${idx + 1}`,
        code,
        w: it.w,
        h: raiseH,
        kind: 'raise',
      });
    });
  }
  return list;
}

// 根据当前 state 生成 3D 渲染分层结构 { bottom, top }
// 加高场景下，上排首尾补 2cm SK 与底排对齐；同时把底排 SK 高度截到 STD_HEIGHT，
// 避免 y=230~230+raiseH 区间与上排 SK 几何重叠。serialize / flattenCabinets 不受影响，
// BOM 仍按单根 wall.h 的 SK 计算。
// !isFull 时为 YZJ/ZYZJ 注入虚拟预览的右段（spacer 占非标占位 + 右转角 + 右收口），
// 让用户进 design 页就能在 3D 里看到右转角柜；state.items 不动，序列化/BOM/cost 不受影响。
function renderRows(state) {
  const hasRaiseRow = state.meta.hasRaise && state.meta.wall.h > 250;
  const hasRightCorner =
    state.meta.cornerType === rules.CORNER.YZJ ||
    state.meta.cornerType === rules.CORNER.ZYZJ;
  // 预览右段：仅在未布满且配置了右转角时注入
  const needPreviewRight = !state.meta.isFull && hasRightCorner;
  const previewBottom = [];
  if (needPreviewRight) {
    // 标准段已用之外、到右转角之前的剩余水平宽度，用 spacer 占位让 cursor 跨过去
    const standardRemainingW = state.meta.standardWidth - state.meta.standardUsed;
    const spacerW = standardRemainingW + state.meta.nonStandardWidth;
    if (spacerW > 0) {
      previewBottom.push({ kind: 'spacer', w: spacerW, h: STD_HEIGHT });
    }
    previewBottom.push({
      kind: 'corner',
      code: 'y',
      w: CORNER_WIDTH,
      h: STD_HEIGHT,
      preview: true,
    });
    previewBottom.push({
      kind: 'sk',
      code: 'SK',
      w: SK_WIDTH,
      h: state.meta.wall.h,
      side: 'right',
      preview: true,
    });
  }
  const baseBottom = hasRaiseRow
    ? state.items.map((it) =>
        it.kind === 'sk' ? Object.assign({}, it, { h: STD_HEIGHT }) : it
      )
    : state.items.slice();
  // 加高场景下预览右 SK 也截到 STD_HEIGHT
  const previewBottomAdj = hasRaiseRow
    ? previewBottom.map((it) =>
        it.kind === 'sk' ? Object.assign({}, it, { h: STD_HEIGHT }) : it
      )
    : previewBottom;
  const bottom = baseBottom.concat(previewBottomAdj);

  let top = [];
  if (hasRaiseRow) {
    const raiseH = Math.max(0, state.meta.wall.h - 230 - 2);
    const cabinets = state.items
      .filter((it) => it.kind === 'standard' || it.kind === 'corner' || it.kind === 'nonstandard')
      .map((it) => {
        let code = 'g';
        if (it.code === 'y') code = 'yg';
        else if (it.code === 'z') code = 'zg';
        return { kind: 'raise', code, w: it.w, h: raiseH };
      });
    // 加高排的收口跟随底柜：底柜有左 SK 才给上排加左 SK，右侧同理。
    // 底柜的右 SK 只在 placedRightCorner（isFull）时才落下，所以构图过程中
    // 上排不会单独悬一条右收口在末尾。
    const hasLeftSk = state.items.some((it) => it.kind === 'sk' && it.side === 'left');
    const hasRightSk = state.items.some((it) => it.kind === 'sk' && it.side === 'right');
    // 预览右段在 top 行的镜像：spacer 等宽透传，y → yg 加高，右 SK 加高
    const previewTop = needPreviewRight
      ? previewBottom.map((it) => {
          if (it.kind === 'spacer') return { kind: 'spacer', w: it.w, h: raiseH };
          if (it.kind === 'corner' && it.code === 'y') {
            return { kind: 'raise', code: 'yg', w: it.w, h: raiseH, preview: true };
          }
          if (it.kind === 'sk' && it.side === 'right') {
            return { kind: 'sk', code: 'SK', w: SK_WIDTH, h: raiseH, side: 'right', preview: true };
          }
          return it;
        })
      : [];
    top = [
      ...(hasLeftSk ? [{ kind: 'sk', code: 'SK', w: SK_WIDTH, h: raiseH, side: 'left' }] : []),
      ...cabinets,
      ...(hasRightSk ? [{ kind: 'sk', code: 'SK', w: SK_WIDTH, h: raiseH, side: 'right' }] : []),
      ...previewTop,
    ];
  }
  return { bottom, top };
}

module.exports = {
  init,
  addNext,
  removeLast,
  replaceFirst,
  replaceLast,
  isOnlyFirstCabinet,
  applyColor,
  toggleDoor,
  inLastSlot,
  standardRemaining,
  serialize,
  flattenCabinets,
  renderRows,
  SK_WIDTH,
  CORNER_WIDTH,
  STD_HEIGHT,
};
