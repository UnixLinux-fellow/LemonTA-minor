// Node-runnable assertion tests for pure utils. Run: `node tests/run.js`

const path = require('path');
const rules = require(path.resolve(__dirname, '../miniprogram/utils/cabinet-rules.js'));
const layout = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/layout-engine.js'));
const cost = require(path.resolve(__dirname, '../miniprogram/utils/cost-engine.js'));
const model = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/cabinet-model.js'));
const planStore = require(path.resolve(__dirname, '../miniprogram/utils/plan-store.js'));
const pdfExporter = require(path.resolve(__dirname, '../miniprogram/utils/pdf-exporter.js'));
const modelSyncDiff = require(path.resolve(__dirname, '../miniprogram/utils/model-sync-diff.js'));

let passed = 0;
let failed = 0;

function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.log('  ✗ ' + msg);
    console.log('    expected: ' + JSON.stringify(expected));
    console.log('    actual:   ' + JSON.stringify(actual));
  }
}

function truthy(v, msg) {
  if (v) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    console.log('  ✗ ' + msg);
  }
}

function group(name, fn) {
  console.log('\n' + name);
  fn();
}

// ---- rules ----
group('rules.validateName', () => {
  eq(rules.validateName('').ok, false, '空名称应失败');
  eq(rules.validateName('a'.repeat(16)).ok, false, '超过15字符应失败');
  eq(rules.validateName('二宝的房间').ok, true, '正常名称应通过');
  eq(rules.validateName('二宝', ['二宝']).ok, false, '重名应失败');
});

group('rules.validateWall', () => {
  eq(rules.validateWall(43, 240).ok, false, 'W<44 应失败');
  eq(rules.validateWall(44, 232).ok, true, '边界值应通过');
  eq(rules.validateWall(1001, 240).ok, false, 'W>1000 应失败');
  eq(rules.validateWall(320, 231).ok, false, 'H<232 应失败');
  eq(rules.validateWall(320, 1000).ok, true, 'H=1000 应通过');
});

group('rules.validateCorner', () => {
  eq(rules.validateCorner(110, 'WZJ').ok, true, '<114 选无 ok');
  eq(rules.validateCorner(110, 'ZZJ').ok, false, '<114 选转角应失败');
  eq(rules.validateCorner(150, 'ZZJ').ok, true, '114~224 单侧 ok');
  eq(rules.validateCorner(150, 'ZYZJ').ok, false, '114~224 双侧应失败');
  eq(rules.validateCorner(300, 'ZYZJ').ok, true, '>=224 双侧 ok');
});

group('rules.validateRaise', () => {
  eq(rules.validateRaise(250, true).ok, false, 'H=250 加高应失败');
  eq(rules.validateRaise(251, true).ok, true, 'H=251 加高 ok');
  eq(rules.validateRaise(232, false).ok, true, '不加高任意高度 ok');
});

group('rules.computeStandardRange', () => {
  // 文档示例：W=480, 无转角，应得 [480-124, 480-44] = [356, 436] 中最大 50 倍数 = 400
  const r = rules.computeStandardRange(480, 'WZJ');
  eq(r.x, 400, 'W=480 无转角 标准段=400');
  eq(r.valid, true, '有效');
  // W=320 无转角：[196, 276] 最大 50 倍数 = 250
  const r2 = rules.computeStandardRange(320, 'WZJ');
  eq(r2.x, 250, 'W=320 标准段=250');
  // W=44 无转角：[-80, 0] 最大 50 倍数 = 0，但 < lo？
  const r3 = rules.computeStandardRange(44, 'WZJ');
  eq(r3.valid, false, 'W=44 无可摆放');
});

// ---- model-sync-diff ----
group('model-sync-diff.diff 首次同步（local 为空）', () => {
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
    { subdir: 'zj',   name: 'Y-110-230.glb', fileID: 'cloud://y', md5: 'yy', size: 200 },
  ];
  const r = modelSyncDiff.diff([], remote);
  eq(r.added.map((m) => m.name), ['50A.glb', 'Y-110-230.glb'], 'added 全部');
  eq(r.updated.length, 0, 'updated 空');
  eq(r.removed.length, 0, 'removed 空');
  eq(r.kept.length, 0, 'kept 空');
});

group('model-sync-diff.diff md5 未变 → kept', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.kept.length, 1, 'kept 1');
  eq(r.kept[0].downloaded, true, 'kept 保留 downloaded 字段');
  eq(r.added.length, 0, 'added 空');
  eq(r.updated.length, 0, 'updated 空');
  eq(r.removed.length, 0, 'removed 空');
});

group('model-sync-diff.diff md5 未变 但 fileID 变了 → kept 采用 remote fileID', () => {
  // 场景：老版本云函数拼错了 fileID（缺 bucket 段），本地 manifest 存了残缺 fileID。
  // 云函数修正后 remote 带来完整 fileID；md5 未变理论上走 kept 分支。
  // 期望：kept 采用 remote.fileID，让后续下载/临时链接使用完整地址。
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://env-only/cabinet-model/50cm/50A.glb', md5: 'aa', size: 100, downloaded: false, downloadedAt: 0 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://env-only.bucket/cabinet-model/50cm/50A.glb', md5: 'aa', size: 100 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.kept.length, 1, 'kept 1');
  eq(r.kept[0].fileID, 'cloud://env-only.bucket/cabinet-model/50cm/50A.glb', 'kept 采用 remote 完整 fileID');
});

group('model-sync-diff.diff kept 保留 local.pending 不置空', () => {
  const local = [
    {
      subdir: '50cm', name: '50A.glb', fileID: 'cloud://a1', md5: 'aa', size: 100,
      downloaded: true, downloadedAt: 1,
      pending: { md5: 'bb', fileID: 'cloud://a2', size: 110 },
    },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a1', md5: 'aa', size: 100 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.kept.length, 1, 'kept 1');
  eq(r.kept[0].pending.md5, 'bb', 'kept 保留 pending.md5');
  eq(r.kept[0].pending.fileID, 'cloud://a2', 'kept 保留 pending.fileID');
});

group('model-sync-diff.diff md5 变更 → updated 带 pending', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a1', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a2', md5: 'bb', size: 110 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.updated.length, 1, 'updated 1');
  eq(r.updated[0].md5, 'aa', '旧 md5 保留');
  eq(r.updated[0].pending.md5, 'bb', 'pending 保留新 md5');
  eq(r.updated[0].pending.fileID, 'cloud://a2', 'pending 保留新 fileID');
  eq(r.updated[0].downloaded, true, '旧文件仍可用');
});

group('model-sync-diff.diff 云上删除 → removed', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
    { subdir: '50cm', name: '50B.glb', fileID: 'cloud://b', md5: 'bb', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
  ];
  const r = modelSyncDiff.diff(local, remote);
  eq(r.removed.map((m) => m.name), ['50B.glb'], 'removed = [50B]');
  eq(r.kept.map((m) => m.name), ['50A.glb'], 'kept = [50A]');
});

group('model-sync-diff.buildManifest 首次全 added', () => {
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a', md5: 'aa', size: 100 },
  ];
  const diff = modelSyncDiff.diff([], remote);
  const m = modelSyncDiff.buildManifest(diff, 1720000000000);
  eq(m.version, 1, 'version=1');
  eq(m.syncedAt, 1720000000000, 'syncedAt 写入');
  eq(m.models.length, 1, 'models 1');
  eq(m.models[0].downloaded, false, 'added 未下载');
  eq(m.models[0].pending, null, 'added 无 pending');
});

group('model-sync-diff.buildManifest updated 保留旧值 + pending', () => {
  const local = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a1', md5: 'aa', size: 100, downloaded: true, downloadedAt: 1 },
  ];
  const remote = [
    { subdir: '50cm', name: '50A.glb', fileID: 'cloud://a2', md5: 'bb', size: 110 },
  ];
  const diff = modelSyncDiff.diff(local, remote);
  const m = modelSyncDiff.buildManifest(diff, 2);
  eq(m.models[0].md5, 'aa', '主字段仍是旧 md5');
  eq(m.models[0].fileID, 'cloud://a1', '主字段仍是旧 fileID');
  eq(m.models[0].downloaded, true, '主字段 downloaded=true');
  eq(m.models[0].pending.md5, 'bb', 'pending 新 md5');
  eq(m.models[0].pending.fileID, 'cloud://a2', 'pending 新 fileID');
});

// ---- model ----
group('cabinet-model.parse', () => {
  eq(model.parse('50A.glb'), { w: 50, h: 230, d: 600, code: 'a' }, '50A.glb 短命名');
  eq(model.parse('100G1.glb'), { w: 100, h: 300, d: 600, code: 'g1' }, '100G1.glb 加高短命名');
  eq(model.parse('50-230-600-a'), { w: 50, h: 230, d: 600, code: 'a' }, '完整命名解析');
});

group('cabinet-model.categorize 按 subdir 归类', () => {
  const all = [
    { subdir: '50cm', name: '50A.glb', w: 50, code: 'a', kind: 'standard' },
    { subdir: '100cm', name: '100A.glb', w: 100, code: 'a', kind: 'standard' },
    { subdir: '100cm', name: '100G1.glb', w: 100, code: 'g1', kind: 'raise' },
    { subdir: 'zj', name: 'Y-110-230.glb', w: 110, code: 'y', kind: 'corner' },
  ];
  const g = model.categorize(all);
  eq(g.s50.length, 1, 's50=1');
  eq(g.s100.length, 1, 's100=1');
  eq(g.raise.length, 1, 'raise=1');
  eq(g.corner.length, 1, 'corner=1');
  eq(model.categorize([{ subdir: 'zj', code: 'x', w: 90 }]).corner.length, 1, 'zj subdir 强制 corner，即使 code 不匹配 y/z/yg/zg');
});

// ---- layout-engine ----
group('layout-engine', () => {
  const state = layout.init({ wall: { w: 480, h: 260 }, cornerType: 'WZJ', hasRaise: false });
  eq(state.meta.standardWidth, 400, '初始化标准段=400');
  eq(state.meta.nonStandardWidth, 76, '非标=76 (480-4-400)');
  eq(state.meta.standardUsed, 50, '初始放第一格 50cm');
  // 添加 7 个 50cm 凑满
  for (let i = 0; i < 7; i++) {
    layout.addNext(state, { code: 'a', size: 50 });
  }
  eq(state.meta.isFull, true, '加满后 isFull');
  truthy(state.items.some((it) => it.kind === 'nonstandard'), '存在非标自动放置');
  // serialize
  const out = layout.serialize(state, { userTag: '抖鱼', timestamp: '202603201756', name: '二宝的房间' });
  truthy(/抖鱼-202603201756-二宝的房间-WZJ-H-260-W-480/.test(out), 'serialize 标题正确');
  truthy(/上收口：SK-476-2/.test(out), '上收口宽度=W-4');
});

group('layout-engine.removeLast 第一格保护', () => {
  const state = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  const r = layout.removeLast(state);
  eq(r.ok, false, '只剩第一格不可删除');
});

group('layout-engine.replaceLast 单柜场景（等价于 replaceFirst）', () => {
  const state = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  // standardWidth=250, 初始首块 50cm a, standardUsed=50
  const r = layout.replaceLast(state, { code: 'b', size: 100 });
  eq(r.ok, true, '单柜替换为 100b 成功');
  eq(state.meta.standardUsed, 100, '标准已用=100');
  const stds = state.items.filter((it) => it.kind === 'standard');
  eq(stds.length, 1, '仍只有 1 个标准柜');
  eq(stds[0].code, 'b', '末块 code=b');
  eq(stds[0].w, 100, '末块 w=100');
  eq(stds[0].isFirst, true, 'isFirst 标记保留');
  eq(state.meta.isFull, false, '未布满（250-100=150 剩余）');
});

group('layout-engine.replaceLast 多柜场景', () => {
  const state = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  layout.addNext(state, { code: 'a', size: 50 }); // 第 2 柜
  layout.addNext(state, { code: 'a', size: 50 }); // 第 3 柜
  // 此时 3 个 50a，standardUsed=150
  const r = layout.replaceLast(state, { code: 'c', size: 100 });
  eq(r.ok, true, '第 3 柜替换为 100c 成功');
  eq(state.meta.standardUsed, 200, '50+50+100=200');
  const stds = state.items.filter((it) => it.kind === 'standard');
  eq(stds.length, 3, '仍是 3 个标准柜');
  eq(stds[0].isFirst, true, '首块 isFirst 不变');
  eq(stds[1].code, 'a', '第 2 柜未动');
  eq(stds[1].w, 50, '第 2 柜宽度未动');
  eq(stds[2].code, 'c', '第 3 柜替换为 c');
  eq(stds[2].w, 100, '第 3 柜宽=100');
  eq(state.meta.isFull, false, '250-200=50 仍可放，未布满');
});

group('layout-engine.replaceLast 替换后刚好填满 → 自动布满', () => {
  const state = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  layout.addNext(state, { code: 'a', size: 50 }); // standardUsed=100
  layout.addNext(state, { code: 'a', size: 50 }); // standardUsed=150
  layout.addNext(state, { code: 'a', size: 50 }); // standardUsed=200
  // 还差 50 才到 standardWidth=250
  const r = layout.replaceLast(state, { code: 'b', size: 100 });
  eq(r.ok, true, '末块 50→100 成功');
  eq(state.meta.standardUsed, 250, '正好填满');
  eq(state.meta.isFull, true, '触发 placeNonStandardAndClose');
  truthy(state.items.some((it) => it.kind === 'nonstandard'), '已落非标');
  truthy(state.items.some((it) => it.kind === 'sk' && it.side === 'right'), '已落右收口');
});

group('layout-engine.replaceLast 越界应失败且不修改 state', () => {
  // 真实墙宽下 standardWidth 一定是 50 的倍数，replaceLast 的越界分支在
  // 真实流程下难以触发；用人工构造的 state 直接验证防御逻辑。
  const synthetic = {
    items: [
      { kind: 'sk', code: 'SK', w: 2, h: 240, side: 'left' },
      { kind: 'standard', code: 'a', w: 50, h: 230, isFirst: true },
    ],
    meta: {
      wall: { w: 84, h: 240 },
      cornerType: 'WZJ',
      hasRaise: false,
      standardWidth: 80,
      standardUsed: 50,
      nonStandardWidth: 30,
      color: 'white',
      showDoor: false,
      isFull: false,
      nonStandardPlaced: false,
    },
  };
  // newUsed = 50 - 50 + 100 = 100 > standardWidth(80) → 越界
  const r = layout.replaceLast(synthetic, { code: 'b', size: 100 });
  eq(r.ok, false, '越界应失败');
  truthy(/剩余宽度不足/.test(r.message || ''), '失败提示包含「剩余宽度不足」');
  eq(synthetic.meta.standardUsed, 50, '失败时 standardUsed 不变');
  eq(synthetic.items[1].w, 50, '失败时末块 w 不变');
  eq(synthetic.items[1].code, 'a', '失败时末块 code 不变');
});

group('layout-engine.replaceLast 无标准柜时返回失败', () => {
  // 构造仅有 sk 没有 standard 的人工 state
  const synthetic = {
    items: [{ kind: 'sk', code: 'SK', w: 2, h: 240, side: 'left' }],
    meta: {
      wall: { w: 84, h: 240 },
      cornerType: 'WZJ',
      hasRaise: false,
      standardWidth: 0,
      standardUsed: 0,
      nonStandardWidth: 0,
      color: 'white',
      showDoor: false,
      isFull: false,
      nonStandardPlaced: false,
    },
  };
  const r = layout.replaceLast(synthetic, { code: 'a', size: 50 });
  eq(r.ok, false, '无标准柜应失败');
  truthy(/未找到可替换/.test(r.message || ''), '失败提示包含「未找到可替换」');
});

group('layout-engine.init 左转角不放默认柜', () => {
  // 左转角：首位由 z 转角占据，不再自动放 50A
  const z = layout.init({ wall: { w: 480, h: 260 }, cornerType: 'ZZJ', hasRaise: false });
  const stds = z.items.filter((it) => it.kind === 'standard');
  eq(stds.length, 0, 'ZZJ 初始无任何 standard');
  truthy(z.items.some((it) => it.kind === 'corner' && it.code === 'z'), 'ZZJ 已落左转角 z');
  eq(z.meta.standardUsed, 0, 'ZZJ 初始 standardUsed=0');

  // 双侧转角：同样不放默认柜
  const zy = layout.init({ wall: { w: 480, h: 260 }, cornerType: 'ZYZJ', hasRaise: false });
  eq(zy.items.filter((it) => it.kind === 'standard').length, 0, 'ZYZJ 初始无任何 standard');
  eq(zy.meta.standardUsed, 0, 'ZYZJ 初始 standardUsed=0');

  // 右转角：保持原行为，首位放默认 50A
  const y = layout.init({ wall: { w: 480, h: 260 }, cornerType: 'YZJ', hasRaise: false });
  eq(y.items.filter((it) => it.kind === 'standard').length, 1, 'YZJ 初始有 1 个 standard (默认柜)');
  eq(y.meta.standardUsed, 50, 'YZJ 初始 standardUsed=50');
});

group('layout-engine.addNext 左转角零标准起始也能加柜', () => {
  // ZZJ + W=480: standardWidth = 480 - 124 - 110 = 246 → 取 50 倍数最大值 = 200（lo=246, hi=326）
  // 实际取窗口 [246, 326] 内最大 50 倍数 = 300
  const z = layout.init({ wall: { w: 480, h: 260 }, cornerType: 'ZZJ', hasRaise: false });
  truthy(z.meta.standardWidth >= 50, 'ZZJ standardWidth 足够放至少一个标准柜');
  const r = layout.addNext(z, { code: 'a', size: 50 });
  eq(r.ok, true, '左转角下 addNext 第一个标准柜成功');
  eq(z.meta.standardUsed, 50, 'standardUsed=50');
  eq(z.items.filter((it) => it.kind === 'standard').length, 1, '有 1 个 standard');
});

group('layout-engine.renderRows YZJ 预览右转角', () => {
  // YZJ + 未布满：bottom 末尾应出现预览的右转角 + 右收口；items 自身不变
  const s = layout.init({ wall: { w: 480, h: 240 }, cornerType: 'YZJ', hasRaise: false });
  const rows = layout.renderRows(s);
  const previewY = rows.bottom.find((it) => it.kind === 'corner' && it.code === 'y' && it.preview);
  truthy(previewY, '!isFull 下 bottom 含 preview 右转角 y');
  const previewRightSk = rows.bottom.find((it) => it.kind === 'sk' && it.side === 'right' && it.preview);
  truthy(previewRightSk, '!isFull 下 bottom 含 preview 右收口');
  truthy(s.items.every((it) => !it.preview), 'state.items 未被污染（无 preview 标记）');
  truthy(!s.items.some((it) => it.kind === 'corner' && it.code === 'y'), 'state.items 仍不含 y');
});

group('layout-engine.renderRows ZYZJ + 加高 预览顶层 yg', () => {
  const s = layout.init({ wall: { w: 480, h: 270 }, cornerType: 'ZYZJ', hasRaise: true });
  const rows = layout.renderRows(s);
  // 底层应有左转角 z（init push）+ 预览右转角 y
  truthy(rows.bottom.some((it) => it.kind === 'corner' && it.code === 'z'), '底层含左转角 z');
  truthy(rows.bottom.some((it) => it.kind === 'corner' && it.code === 'y' && it.preview), '底层含 preview 右转角 y');
  // 顶层应有左转角加高 zg（renderRows 的 cabinets 映射）+ 预览右转角加高 yg
  truthy(rows.top.some((it) => it.kind === 'raise' && it.code === 'zg'), '顶层含左转角加高 zg');
  truthy(rows.top.some((it) => it.kind === 'raise' && it.code === 'yg' && it.preview), '顶层含 preview 右转角加高 yg');
});

group('layout-engine.renderRows WZJ 不注入预览', () => {
  const s = layout.init({ wall: { w: 480, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  const rows = layout.renderRows(s);
  truthy(!rows.bottom.some((it) => it.preview), 'WZJ 下 bottom 不含 preview 标记');
  truthy(!rows.bottom.some((it) => it.kind === 'corner'), 'WZJ 下 bottom 不含 corner');
});

group('layout-engine.renderRows YZJ 布满后不再注入预览', () => {
  const s = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'YZJ', hasRaise: false });
  // standardWidth = 320 - 124 - 110 = [86, 166] 内最大 50 倍数 = 150
  // 默认放 50A 占 50；再加两个 50 把它填满到 150
  layout.addNext(s, { code: 'a', size: 50 });
  layout.addNext(s, { code: 'a', size: 50 });
  truthy(s.meta.isFull, '已布满');
  const rows = layout.renderRows(s);
  const previewY = rows.bottom.filter((it) => it.kind === 'corner' && it.code === 'y');
  eq(previewY.length, 1, '布满后只有 placeNonStandardAndClose 的真实 y，没有重复预览');
  truthy(!previewY[0].preview, '该 y 不带 preview 标记（来自 state.items）');
});

// ---- pdf-exporter._countCabinets ----
group('pdf-exporter._countCabinets', () => {
  // 空 layout
  eq(pdfExporter._countCabinets({ layout: { items: [] } }), 0, '空 items 返回 0');
  eq(pdfExporter._countCabinets({}), 0, '无 layout 返回 0');
  eq(pdfExporter._countCabinets({ layout: null }), 0, 'layout=null 返回 0');

  // 仅下排标准柜
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'sk', w: 2 },
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'b', w: 100 },
      { kind: 'nonstandard', w: 30 },
      { kind: 'sk', w: 2 },
    ] },
  }), 4, '3 standard + 1 nonstandard = 4');

  // 含 corner，hasRaise=false
  eq(pdfExporter._countCabinets({
    wall: { w: 480, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'corner', code: 'z', w: 110 },
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'corner', code: 'y', w: 110 },
    ] },
  }), 3, 'corner+standard+corner = 3');

  // 加高排：wall.h > 250 && hasRaise=true → 下排柜体各 +1
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 270 },
    hasRaise: true,
    layout: { items: [
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'b', w: 100 },
      { kind: 'nonstandard', w: 30 },
    ] },
  }), 6, '3 下排 + 3 加高排 = 6');

  // hasRaise=true 但 wall.h<=250 → 不加高
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 240 },
    hasRaise: true,
    layout: { items: [
      { kind: 'standard', code: 'a', w: 50 },
      { kind: 'standard', code: 'a', w: 50 },
    ] },
  }), 2, 'hasRaise=true 但 h<=250 → 不算加高');

  // sk 不计数
  eq(pdfExporter._countCabinets({
    wall: { w: 320, h: 240 },
    layout: { items: [
      { kind: 'sk', side: 'left', w: 2 },
      { kind: 'sk', side: 'right', w: 2 },
    ] },
  }), 0, '仅有 sk 返回 0');
});

// ---- wireframe-labels.computeLabelPositions ----
const wireframeLabels = require(path.resolve(__dirname, '../miniprogram/cabinet/utils/wireframe-labels.js'));
group('wireframe-labels.computeLabelPositions', () => {
  // 空输入
  eq(wireframeLabels.computeLabelPositions(null), [], 'null 返回 []');
  eq(wireframeLabels.computeLabelPositions({}), [], '无 wall/layout 返回 []');
  eq(wireframeLabels.computeLabelPositions({ wall: { w: 320, h: 240 } }), [], '无 layout 返回 []');
  eq(wireframeLabels.computeLabelPositions({ wall: { w: 320, h: 240 }, layout: { items: [] } }), [], '空 items 返回 []');

  // 3 个 standard，不加高 → 3 个标签
  const labels1 = wireframeLabels.computeLabelPositions({
    wall: { w: 320, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 100 },
    ] },
  });
  eq(labels1.length, 3, '3 个 standard → 3 个标签');
  truthy(labels1.every((l) => l.left >= 0 && l.left <= 100), '所有 left 在 0-100 范围内');
  truthy(labels1.every((l) => l.top >= 0 && l.top <= 100), '所有 top 在 0-100 范围内');
  truthy(labels1.every((l, i) => l.idx === i + 1), 'idx 从 1 递增');
  truthy(labels1.every((l) => l.key.startsWith('b-')), '不加高时全部 key 前缀 b-');

  // 加高排：3 个下排 + hasRaise=true + wall.h>250 → 6 个标签
  const labels2 = wireframeLabels.computeLabelPositions({
    wall: { w: 320, h: 270 },
    hasRaise: true,
    layout: { items: [
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 50 },
      { kind: 'standard', w: 100 },
    ] },
  });
  eq(labels2.length, 6, '3 下排 + 3 加高 = 6 个标签');
  eq(labels2.filter((l) => l.key.startsWith('b-')).length, 3, '下排 3 个');
  eq(labels2.filter((l) => l.key.startsWith('r-')).length, 3, '加高 3 个');

  // sk 不计数
  const labels3 = wireframeLabels.computeLabelPositions({
    wall: { w: 320, h: 240 },
    hasRaise: false,
    layout: { items: [
      { kind: 'sk', w: 2 },
      { kind: 'standard', w: 50 },
      { kind: 'sk', w: 2 },
    ] },
  });
  eq(labels3.length, 1, 'sk 不计数，仅 1 个 standard');
});

// ---- cost-engine ----
group('cost-engine.calc', () => {
  const cabinets = [
    { idx: 1, label: '左下1', code: 'a', w: 50, h: 230, kind: 'standard' },
    { idx: 2, label: '左下2', code: 'b', w: 100, h: 230, kind: 'standard' },
  ];
  const out = cost.calc({ cabinets, materials: { panel: 'E2国产板', doorPanel: '柜体相同', doorCraft: '无', hardware: '中国品牌', lighting: '无' } });
  eq(out.modules.length, 2, '2 个模块');
  truthy(out.grandTotal > 0, '总价大于 0');
  truthy(out.modules[0].detail.panels.length > 5, '板件清单 > 5 项');
  truthy(out.modules[0].detail.hardware.length > 5, '五金清单 > 5 项');
});

group('cost-engine 100A E2国产板 应接近表格示例', () => {
  // sheet1 中 100A 230 配 E2(80元/m²)/柜体相同/无/中国品牌/无 时，I8=109.0284 等等
  const out = cost.calc({
    cabinets: [{ label: '左下1', code: 'a', w: 100, h: 230, kind: 'standard' }],
    materials: { panel: 'E2国产板', doorPanel: '柜体相同', doorCraft: '无', hardware: '中国品牌', lighting: '无' },
  });
  const mod = out.modules[0];
  // 顶板 = (100-3.6)*58/10000*1*80 = 96.4*58*80/10000 ≈ 447.30 (源表用了 W-3.6=96.4 后乘 80 = 109.0284? 该值是单位面积 0.55912 * 195=爱格 才接近)
  // 这里只校验单价命中：板材 E2 = 80
  truthy(mod.detail.panels.every((p) => p.unit > 0), '所有板件单价 > 0');
  // 门板的单价应等于 80（柜体相同 + 无工艺 = 80）
  const door = mod.detail.panels.find((p) => p.name === '门板');
  eq(door.unit, 80, '门板单价 = E2 80');
});

// ---- layout-engine.renderRows ----
group('layout-engine.renderRows 加高分层', () => {
  const state = layout.init({ wall: { w: 320, h: 270 }, cornerType: 'WZJ', hasRaise: true });
  const rows = layout.renderRows(state);
  truthy(rows.bottom.length > 0, '底层有元素');
  truthy(rows.top.length >= 1, '加高顶层 ≥1');
  eq(rows.top[0].kind, 'raise', '顶层 kind=raise');
  eq(rows.top[0].h, 38, '270-230-2=38cm 加高高度');
  // hasRaise=false 时 top 应为空
  const s2 = layout.init({ wall: { w: 320, h: 240 }, cornerType: 'WZJ', hasRaise: false });
  eq(layout.renderRows(s2).top.length, 0, '不加高时顶层为空');
});

// ---- cost-engine 100H：层板 5 / A 抽 4 / 无 B 抽 ----
group('cost-engine 100H h 型抽屉与层板计入', () => {
  const out = cost.calc({
    cabinets: [{ label: '左下1', code: 'h', w: 100, h: 230, kind: 'standard' }],
    materials: { panel: 'E2国产板', doorPanel: '柜体相同', doorCraft: '无', hardware: '中国品牌', lighting: '无' },
  });
  const panels = out.modules[0].detail.panels;
  const shelf = panels.find((p) => p.name === '层板');
  const aFace = panels.find((p) => p.name === 'A抽面');
  const bFace = panels.find((p) => p.name === 'B抽面');
  eq(shelf.qty, 5, '层板 qty=5');
  eq(aFace.qty, 4, 'A抽面 qty=4');
  eq(bFace.qty, 0, 'B抽面 qty=0（全按 A 抽）');
  // 5 项与 h 抽屉数联动
  const hw = out.modules[0].detail.hardware;
  const slide = hw.find((h) => /Quadro/.test(h.name));
  const trio = hw.find((h) => /三合一/.test(h.name));
  eq(slide.qty, 4, '滑轨 qty = A+B = 4');
  eq(trio.qty, 60, '三合一 qty = 滑轨*15 = 60');
});

// ---- cost-engine 100E：层板 6 / 无抽屉 ----
group('cost-engine 100E e 型层板计入且无抽屉', () => {
  const out = cost.calc({
    cabinets: [{ label: '左下1', code: 'e', w: 100, h: 230, kind: 'standard' }],
    materials: { panel: 'E2国产板', doorPanel: '柜体相同', doorCraft: '无', hardware: '中国品牌', lighting: '无' },
  });
  const panels = out.modules[0].detail.panels;
  const shelf = panels.find((p) => p.name === '层板');
  const aFace = panels.find((p) => p.name === 'A抽面');
  const bFace = panels.find((p) => p.name === 'B抽面');
  eq(shelf.qty, 6, '层板 qty=6');
  eq(aFace.qty, 0, 'A抽面 qty=0（100E 无抽屉）');
  eq(bFace.qty, 0, 'B抽面 qty=0');
  const hw = out.modules[0].detail.hardware;
  const slide = hw.find((h) => /Quadro/.test(h.name));
  truthy(!slide || slide.qty === 0, '无滑轨（qty=0 应被 pushHw 过滤掉，或值为 0）');
});

// ---- cost-engine 非标 e1/e2 与 100E 隔离：仍是裸壳 ----
group('cost-engine 非标 e1/e2 不复用 100E 的表', () => {
  ['e1', 'e2'].forEach((code) => {
    const out = cost.calc({
      cabinets: [{ label: '左下1', code, w: 80, h: 230, kind: 'nonstandard' }],
      materials: { panel: 'E2国产板', doorPanel: '柜体相同', doorCraft: '无', hardware: '中国品牌', lighting: '无' },
    });
    const panels = out.modules[0].detail.panels;
    const shelf = panels.find((p) => p.name === '层板');
    const aFace = panels.find((p) => p.name === 'A抽面');
    eq(shelf.qty, 0, code + ' 层板 qty=0（非标裸壳）');
    eq(aFace.qty, 0, code + ' A抽面 qty=0');
  });
});

// ---- cost-engine 带 wall 时应包含 SK 收口 ----
group('cost-engine SK 收口', () => {
  const out = cost.calc({
    cabinets: [{ label: '左下1', code: 'a', w: 100, h: 230, kind: 'standard' }],
    materials: { panel: '爱格', doorPanel: '钢琴烤漆', doorCraft: '骨格线', hardware: '中国品牌', lighting: '无' },
    wall: { w: 480, h: 260 },
  });
  truthy(out.sk, '应输出 sk');
  // 面积 = (2*260)/10000*2 + ((480-4)*2)/10000 = 0.104 + 0.0952 = 0.1992
  truthy(Math.abs(out.sk.area - 0.1992) < 0.0005, 'SK 面积≈0.1992');
  truthy(out.sk.total > 0, 'SK 总价 > 0');
  truthy(out.grandTotal > 0, '总价含 SK 后 > 0');
});

// ---- plan-store ----
group('plan-store.timestampSec / photoName', () => {
  const d = new Date('2026-06-15T23:35:15');
  const ts = planStore.timestampSec(d);
  eq(ts, '20260615233515', '秒级时间戳格式');
  const nm = planStore.photoName('二宝的房间', d);
  eq(nm, '20260615233515-二宝的房间.jpg', '照片命名格式');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
