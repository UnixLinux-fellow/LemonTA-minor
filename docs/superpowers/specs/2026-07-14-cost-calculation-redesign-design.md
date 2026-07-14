# 成本透视模块改造 — 设计规格

**日期**: 2026-07-14
**范围**: `miniprogram/utils/cost-engine.js` 重写 + 3 张云表接入 + materials/cost 页联动
**不改**: glb 上传/three-renderer/layout-engine/wireframe/design 页

---

## 1. 背景与目标

当前 `utils/cost-engine.js` 用一套硬编码的 xlsx 公式 + 硬编码价格常量算成本。所有柜子(标准/非标/加高)都走同一套公式,和真实上传的 glb 元数据脱节;板材、门板、五金的中文名和价格全写死在代码里,更新只能改代码 + 发版。

改造目标:

1. 成本计算改为 **数据驱动**——所有价格从 `price` 集合查,所有柜子的板件面积/五金数量从 `model_panel_hardware` 集合的 glb 元数据取。
2. UI 选项用 **code**(如 `panel_egger`)存储,不再存中文,避免"字符错就查不到价"的类问题。
3. 明细页显示的中文名从 `panel_name_dict` 集合按 `panel_code` 查。
4. 非标/加高柜没有独立 glb,复用基础柜的 hardware_list 数量,板件尺寸按严格公式实时算。

---

## 2. 数据源(三张云表)

三张表的样例数据存于 `docs/price.json` / `docs/panel_name_dict.json` / `docs/model_panel_hardware.json`。

### 2.1 `price` — 价格字典(扁平,每个文档 = 一条价格)

```
{ code, name, price, category, unit, brand_type }
```

- `code`: 主键(唯一)。示例:`panel_egger` / `door_material_piano_lacquer` / `door_craft_none` / `hinge_domestic` / `led_light_strip_import` / `transport_fee` / `install_fee`。
- `category`: `panel` / `door_material` / `door_craft` / `hardware` / `transport` / `install`。
- `brand_type`: `domestic` / `import` / `null`(非五金)。
- `unit`: 单位(㎡ / 个 / 米 / 副 / 套 …),明细页的"规格"列直接显示此字段。

### 2.2 `panel_name_dict` — 板件中英映射

```
{ panel_code, display_name, category, enable }
```

- `panel_code`: 主键。示例:`side_left_panel_18` / `top_panel_18` / `door_single_18` / `kick_front_18` / `hanging_rail_01`。
- `category`: `cabinet_frame` / `door_panel` / `drawer_component` / `kick_component` / `hanging_component`。
- 明细页面板名显示 `display_name`;`hanging_component` 类不计入板件面积成本(是五金)。

### 2.3 `model_panel_hardware` — glb 元数据

```
{ glb_file_name, overall_size{total_width,total_height,total_depth},
  board_list[{node_name, length, width, thickness, area}],
  total_body_area, total_door_area, total_raw_board_area,
  hanging_rail_list[{node_name, length}],
  hardware_list{hinge, slide, hanging_rail, minifix, countersunk_screw, wood_dowel,
                push_latch, self_tapping_screw_16, self_tapping_screw_30,
                support_arm, plinth, nylon_pre_inserted_nut, dust_strip,
                liquid_nails, access_panel_handle, cable_channel,
                led_light_strip, led_light_power, led_light_switch},
  is_online }
```

- 主键 `glb_file_name`(如 `50A.glb`)。
- `board_list[i].node_name` = `panel_code`(与 `panel_name_dict` 对齐)。
- `hardware_list` 是对象,key 是五金分类名,value 是数量。查价时拼 `${key}_${brand_type}` 得价格 code。

---

## 3. 新增/改动模块

| 文件 | 状态 | 职责 |
|---|---|---|
| `miniprogram/utils/price-dict.js` | 新增 | 价格字典,`preloadAll()` / `get(code)` / `all()` / `getByCategory(cat)` |
| `miniprogram/utils/panel-dict.js` | 新增 | 板件中英字典,`preloadAll()` / `get(panelCode)` / `all()` |
| `miniprogram/utils/model-meta-cache.js` | 补 API | 保留 `getMeta`/`peekMeta`;补 `preloadAll(filter)`,把 is_online=true 的元数据一次性拉进 storage |
| `miniprogram/utils/bootstrap.js` | 新增 | `ensureCostDataReady()` 并行触发三字典的 preload,吞异常写日志 |
| `miniprogram/utils/cost-engine.js` | 重写 | 数据驱动的 `calc({cabinets, materials, wall})` |
| `miniprogram/utils/panel-formulas.js` | 新增 | 非标/加高的严格板件公式表 `PANEL_FORMULAS[panel_code](W,H) → {length,width,thickness}` |
| `miniprogram/app.js` | 改 | `onLaunch` 里 `await bootstrap.ensureCostDataReady()` |
| `miniprogram/cabinet/pages/materials/index.js` | 改 | 选项数组 id 全部改成 code(见 §4);保留 name/desc 只用于 UI 显示 |
| `miniprogram/cabinet/pages/materials/index.wxml` | 不改 | 结构保持,只是绑定数据的 id 换了 |
| `miniprogram/cabinet/pages/cost/index.js` | 改 | `_loadCost()` 里先 `ensureCostDataReady()`;字典/元数据 miss 时 toast + 明细金额显 `——` |
| `miniprogram/cabinet/pages/cost/index.wxml` | 微改 | 部件"规格"列展示 `hw.unit`(现在只写死"数量") |
| `tests/price-dict.test.js` | 新增 | 单测 |
| `tests/panel-dict.test.js` | 新增 | 单测 |
| `tests/cost-engine.test.js` | 新增 | 端到端算例 |

---

## 4. materials 页(板材五金选择)选项 code

**衣柜板材品牌** (`materials.panel`)

| code | name | desc |
|---|---|---|
| `panel_e2_domestic` | E2 国产板 | 性价比之选 |
| `panel_tu_baby_domestic` | 兔宝宝 | 国产环保板材 |
| `panel_kronospan_domestic` | 国产克诺斯帮 | 中国制造,欧洲品牌 |
| `panel_kronospan_germany` | 德国克诺斯帮 | 德国原装进口 |
| `panel_egger` | 爱格 | 奥地利顶级板材 |

**门板材质** (`materials.doorPanel`)

| code | name | desc |
|---|---|---|
| `door_material_same_as_cabinet` | 与柜体相同 | 不加价 |
| `door_material_piano_lacquer` | 钢琴烤漆 | 光泽细腻 |
| `door_material_skin_feel_lacquer` | 肤感烤漆 | 柔和触感 |
| `door_material_aluminum_frame_ag_glass` | 铝框 AG 玻璃 | 通透显大 |
| `door_material_wood_veneer` | 实木贴皮 | 木纹纹理 |
| `door_material_rubber_solid_wood` | 橡胶实木 | 中等档次 |
| `door_material_ash_solid_wood` | 白蜡实木 | 高端实木 |

**门板工艺** (`materials.doorCraft`)

| code | name |
|---|---|
| `door_craft_none` | 无 |
| `door_craft_skeleton_line_shallow` | 骨格线 |
| `door_craft_european_deep` | 欧式 |
| `door_craft_grille_door` | 格栅门 |

**五金品牌** (`materials.hardware` — 存的是 brand_type)

| code | name | desc |
|---|---|---|
| `domestic` | 中国品牌 | 默认 DTC |
| `import` | 海外品牌 | 百隆 + 海福乐 |

**照明系统** (`materials.lighting`)

| code | name | desc |
|---|---|---|
| `none` | 无 | 无 |
| `led_domestic` | 国产灯带 | 铝框超薄 |
| `led_import` | 海福乐灯带 | 柔光均匀 |

`materials.lighting` 只做"是否算灯带、算哪套灯带"的分流:
- `none` → 五金遍历时,`led_light_strip` / `led_light_power` / `led_light_switch` 三项数量强制为 0
- `led_domestic` → 上述三项查价用 `<key>_domestic`(与 `materials.hardware` 无关)
- `led_import` → 用 `<key>_import`

保存到 `plan.materials` 的形状(default 值):

```js
{ panel: 'panel_e2_domestic',
  doorPanel: 'door_material_same_as_cabinet',
  doorCraft: 'door_craft_none',
  hardware: 'domestic',
  lighting: 'none' }
```

---

## 5. app 启动编排(bootstrap)

`app.onLaunch` 追加:

```js
const bootstrap = require('./utils/bootstrap.js');
bootstrap.ensureCostDataReady({ force: false });   // 火但不 await;下游 cost 页会再校验
```

云调用注意事项:微信小程序端 `db.collection().get()` 单次上限 20 条,`db.collection().count()` + 分页取值。三张表当前规模(price ~60 / panel_name_dict ~60 / model_panel_hardware ~20)都会跨过 20 条,`preloadAll` 内部要分页:先 count → for 循环 skip/limit 拉完。

`ensureCostDataReady({force})` 并行触发:

```
priceDict.preloadAll(force)       // Promise
panelDict.preloadAll(force)       // Promise
modelMetaCache.preloadAll(force)  // Promise
```

每个 preload:
1. `force=false` 且本地有整表缓存(key `cost_data_v1_<name>`)→ 直接 return
2. 拉云表 → 写 storage → return
3. 拉失败 → warn + return(不抛)

`ensureCostDataReady` 不 throw;`cost.onLoad` 用 `getReadyState()` 判断三张表状态,任一 miss 则 UI 走 §7 的降级路径。

---

## 6. cost-engine 计算流水

### 6.1 单柜路径判定 — `resolveGlbFile(cabinet)`

```js
switch (cabinet.kind) {
  case 'standard': return `${cabinet.w}${cabinet.code.toUpperCase()}.glb`;
  case 'corner':   return `${cabinet.code.toUpperCase()}-110-230.glb`;   // Y-110-230.glb / Z-110-230.glb
  case 'nonstandard':
    return cabinet.w <= 60 ? '50A.glb' : '100A.glb';
  case 'raise':
    // 加高模块按 code 分派各自的基础 glb:
    //   'g'  → 100G1.glb                (普通加高)
    //   'yg' → YG-110-230G1.glb         (右转角加高)
    //   'zg' → ZG-110-230G1.glb         (左转角加高,当前云 DB 里数据可能未上,miss 时走 §8 降级)
    if (cabinet.code === 'yg') return 'YG-110-230G1.glb';
    if (cabinet.code === 'zg') return 'ZG-110-230G1.glb';
    return '100G1.glb';
  case 'sk': case 'spacer': return null;   // 跳过,SK 由 wall 单独算
}
```

### 6.2 单柜成本 — `calcModule(cabinet, cfg)`

```js
const glbFile = resolveGlbFile(cabinet);
if (!glbFile) return null;

const baseMeta = modelMetaCache.peekMeta(glbFile);
if (!baseMeta) return { missing: 'meta', label: cabinet.label, glbFile };

// —— 决定用哪份 board_list & areas —— //
const isFormulaPath = cabinet.kind === 'nonstandard' || cabinet.kind === 'raise';
const meta = isFormulaPath
  ? rescaleMetadata(baseMeta, cabinet.w, cabinet.h)   // §6.3
  : baseMeta;

// —— 板件成本 —— //
const panelUnit = priceDict.get(cfg.panel)?.price ?? 0;
const doorMatUnit = priceDict.get(cfg.doorPanel)?.price ?? 0;
const doorCraftUnit = priceDict.get(cfg.doorCraft)?.price ?? 0;

const panelCost = meta.total_body_area * panelUnit;
const doorCost  = meta.total_door_area * (doorMatUnit + doorCraftUnit);

// —— 五金成本 —— //
const brand = cfg.hardware;               // 'domestic' | 'import'
const lighting = cfg.lighting;            // 'none' | 'led_domestic' | 'led_import'
const LED_KEYS = ['led_light_strip', 'led_light_power', 'led_light_switch'];

let hardwareCost = 0;
const hardwareDetail = [];
Object.entries(meta.hardware_list || {}).forEach(([key, qty]) => {
  let priceCode;
  if (LED_KEYS.includes(key)) {
    if (lighting === 'none') { qty = 0; }
    priceCode = `${key}_${lighting === 'led_import' ? 'import' : 'domestic'}`;
  } else {
    priceCode = `${key}_${brand}`;
  }
  const p = priceDict.get(priceCode);
  if (!p) { console.warn('[cost] price miss', priceCode); return; }
  const total = qty * p.price;
  hardwareCost += total;
  hardwareDetail.push({
    code: priceCode, name: p.name, spec: p.unit,
    qty, unit: p.price, total,
  });
});

return {
  label: cabinet.label, code: cabinet.code, w: cabinet.w, h: cabinet.h,
  glbFile,
  totalBodyArea: meta.total_body_area,
  totalDoorArea: meta.total_door_area,
  totalRawBoardArea: meta.total_raw_board_area,
  // 命名沿用现有 UI 契约:cost 页 "板材合计" 卡片就绑定 item.panelCost, 里面本来就含门板成本。
  panelCost: round2(panelCost + doorCost),
  hardwareCost: round2(hardwareCost),
  detail: {
    panels: buildPanelDetail(meta.board_list, panelUnit, doorMatUnit, doorCraftUnit),  // §7
    hardware: hardwareDetail,
  },
};
```

### 6.3 严格公式板件重算 — `rescaleMetadata(baseMeta, W, H)`

对 `baseMeta.board_list` 的每一项,按 `node_name` 查 `PANEL_FORMULAS`(见 `utils/panel-formulas.js`),用实际 W, H 算 `{length, width, thickness}`;算不出的 panel_code(不在表里)fallback 用 baseMeta 原尺寸并 `console.warn`。

`PANEL_FORMULAS` 一份完整表(基于当前 `cost-engine.js` 的 R6–R23 公式 + 实际 glb 数据的维度顺序推出):

```js
// 所有单位 cm;返回值的 length 是长边 / width 是短边,和 glb 存的一致。
const F = {
  // —— 柜体 —— //
  side_left_panel_18:  (W, H) => ({ length: H - 6,   width: 58,        thickness: 1.8 }),
  side_right_panel_18: (W, H) => ({ length: H - 6,   width: 58,        thickness: 1.8 }),
  top_panel_18:        (W, H) => ({ length: 58,      width: W - 3.6,   thickness: 1.8 }),
  bottom_panel_18:     (W, H) => ({ length: 58,      width: W - 3.6,   thickness: 1.8 }),
  back_panel_18:       (W, H) => ({ length: H - 9.6, width: W - 3.6,   thickness: 1.8 }),
  kick_front_18:       (W, H) => ({ length: W,       width: 5.5,       thickness: 1.8 }),
  access_panel_18:     (W, H) => ({ length: 19.8,    width: W - 4,     thickness: 1.8 }),

  // 层板 shelf_panel_01..10 都是同一个公式,statically 展开
  ...Object.fromEntries(
    Array.from({length:10}, (_, i) => [
      `shelf_panel_${String(i+1).padStart(2,'0')}_18`,
      (W, H) => ({ length: 56.2, width: W - 3.6, thickness: 1.8 })
    ])
  ),

  // —— 门板 —— //
  door_single_18: (W, H) => ({ length: H - 6.44, width: W - 0.6,       thickness: 1.8 }),
  door_left_18:   (W, H) => ({ length: H - 6.44, width: (W - 0.6) / 2, thickness: 1.8 }),
  door_right_18:  (W, H) => ({ length: H - 6.44, width: (W - 0.6) / 2, thickness: 1.8 }),

  // —— 抽屉 (01..05) —— //
  ...['01','02','03','04','05'].reduce((acc, id) => {
    acc[`drawer_box_front_${id}_18`]    = (W, H) => ({ length: W - 4,   width: 16,   thickness: 1.8 });
    acc[`drawer_box_left_${id}_18`]     = (W, H) => ({ length: 49,      width: 12,   thickness: 1.8 });
    acc[`drawer_box_right_${id}_18`]    = (W, H) => ({ length: 49,      width: 12,   thickness: 1.8 });
    acc[`drawer_box_back_${id}_18`]     = (W, H) => ({ length: W - 8.5, width: 10.7, thickness: 1.8 });
    acc[`drawer_box_bottom_${id}_18`]   = (W, H) => ({ length: 47.2,    width: W - 8.5, thickness: 1.8 });
    acc[`drawer_side_left_${id}_18`]    = (W, H) => ({ length: 56.2,    width: 16,   thickness: 1.8 });
    acc[`drawer_side_bottom_${id}_18`]  = (W, H) => ({ length: 56.2,    width: 16,   thickness: 1.8 });
    return acc;
  }, {}),
};
```

`rescaleMetadata` 生成:

```js
{
  ...baseMeta,
  overall_size: { total_width: W, total_height: H, total_depth: baseMeta.overall_size.total_depth },
  board_list: baseMeta.board_list.map(b => {
    const f = F[b.node_name];
    if (!f) { console.warn('[panel-formulas] miss', b.node_name); return b; }
    const dims = f(W, H);
    return {
      node_name: b.node_name,
      ...dims,
      area: round4(dims.length * dims.width / 10000),
    };
  }),
  // 重算 area 汇总:按 panelDict.get(node_name).category 分类
  total_body_area: <汇总 category ∈ {cabinet_frame, drawer_component, kick_component} 的 area>,
  total_door_area: <汇总 category = door_panel 的 area>,
  total_raw_board_area: total_body_area + total_door_area,
  // hardware_list 不变
}
```

hanging_rail_list 不参与板件成本(其数量由 hardware_list.hanging_rail 决定,已计五金)。

### 6.4 方案汇总 — `calc({cabinets, materials, wall})`

```js
const modules = cabinets.map(c => calcModule(c, cfg)).filter(Boolean);
const sumPanel = Σ modules[i].panelCost;
const sumHw    = Σ modules[i].hardwareCost;
const sumArea  = Σ modules[i].totalRawBoardArea;

const transportUnit = priceDict.get('transport_fee')?.price ?? 0;
const installUnit   = priceDict.get('install_fee')?.price ?? 0;
const transport = round2(sumArea * transportUnit);
const install   = round2(sumArea * installUnit);

// —— 收口条 SK:保留现有几何公式,单价用新字典 —— //
let sk = null;
if (wall && wall.w && wall.h) {
  const skPanelUnit = priceDict.get(cfg.panel)?.price ?? 0;
  const skDoorMat   = priceDict.get(cfg.doorPanel)?.price ?? 0;
  const skDoorCraft = priceDict.get(cfg.doorCraft)?.price ?? 0;
  const skUnit = skPanelUnit + skDoorMat + skDoorCraft;
  const skArea = round4((2 * wall.h + 2 * wall.h + (wall.w - 4) * 2) / 10000);
  sk = { label: '收口条', area: skArea, unit: skUnit, total: round2(skUnit * skArea) };
}

const grandTotal = round2(sumPanel + sumHw + transport + install + (sk?.total || 0));

// 每 module 补摊 transport / install 到卡片上(和现有 UI 契约一致)
modules.forEach(m => {
  m.transport = round2(m.totalRawBoardArea * transportUnit);
  m.install   = round2(m.totalRawBoardArea * installUnit);
  m.total     = round2(m.panelCost + m.hardwareCost + m.transport + m.install);
});

return { modules, sk, transport, install, panelTotal: round2(sumPanel),
         hardwareTotal: round2(sumHw), grandTotal };
```

---

## 7. 明细页显示 — `buildPanelDetail`

```js
buildPanelDetail(boardList, panelUnit, doorMatUnit, doorCraftUnit) → panels[]
```

对 boardList 每项 `b`:
- `dictEntry = panelDict.get(b.node_name)`
- `name = dictEntry?.display_name || b.node_name`
- `size = "${b.length}×${b.width}×${b.thickness}"`
- `category = dictEntry?.category || 'cabinet_frame'`
- 单价:`door_panel` → `panelUnit + doorMatUnit + doorCraftUnit`;`hanging_component` → 0(不计成本,只列出);其余 → `panelUnit`
- `qty = 1`(glb 里每块板独立列条目;shelf_panel_01 / _02 各算一条)
- `area = b.area`;`total = round2(area * unit)`

`hanging_component` 类板件不 push 到明细(避免和五金的 hanging_rail 重复展示)。

五金明细已在 `calcModule` 里生成(§6.2),字段:`{ code, name, spec, qty, unit, total }`;`spec = price 表的 unit 字段`(如 "㎡"/"个"/"米")。cost 页 wxml 的第 2 列绑定 `{{item.spec}}`(现在写死"数量",需要小改)。

---

## 8. 错误处理与降级

| 情况 | 行为 |
|---|---|
| 单个字典 preload 云调用失败 | `console.warn`,不阻断 app 启动;下次进 cost 页会再试 |
| 进入 cost 页时字典 miss | 页顶 toast "价格数据未就绪",所有金额显 `——`,加"重试"按钮 |
| 某柜的 glb metadata miss | 该柜 module.total = "——",明细为空,卡片标"元数据未上传" |
| 某 price code miss | 该项按 0 计成本,`console.warn(priceCode)`;明细里该行照常列(qty × 0) |
| 某 panel_code 不在 `panel_name_dict` | 明细名称 fallback 到英文 node_name,`console.warn(node_name)` |
| 某 panel_code 不在 `PANEL_FORMULAS`(非标/加高路径) | fallback 用 baseMeta 原尺寸,`console.warn(node_name)` |
| `wall` 缺失或 w/h 为 0 | 不显示 SK 卡片 |

---

## 9. 测试

`tests/price-dict.test.js`:
- preloadAll 首次:调 db.collection().get,写 storage,返回数据
- preloadAll 二次(有缓存):不再调云,直接返回
- preloadAll 云失败:warn + 返回 empty,不抛
- get(code):命中/miss 都返回 undefined 时不抛
- getByCategory('panel'):只返回 category=panel 的项

`tests/panel-dict.test.js`:
- 同上模式;补 `enable=false` 过滤

`tests/cost-engine.test.js`(用 docs/*.json 的样例数据构造 fixture):
- **case 1** 标 50A + panel_egger + door_material_same_as_cabinet + door_craft_none + hardware=domestic + lighting=none:验证 panelCost = total_body_area * 195,doorCost = total_door_area * 0,五金 led_* 三项 = 0,总和匹配
- **case 2** 标 100C + panel_e2_domestic + door_material_piano_lacquer + door_craft_none + hardware=import + lighting=led_import:验证门板成本含 200 加价,五金查 `hinge_import` = 27
- **case 3** 非标宽 30cm + 基础 50A:`rescaleMetadata` 后 kick_front_18 length=30、top_panel_18 width=26.4,total_body_area 重算正确,hardware_list 仍等于 50A.hardware_list
- **case 4** 加高 150cm + 基础 100G1:同 case 3 的验证方向,H 也参与部分板件公式
- **case 5** price 表缺 `hinge_domestic`:该项 0 + warn,其他项照常
- **case 6** wall={w:400,h:280} + 上述任一 case:SK 面积 = (2*280 + 2*280 + 396*2) / 10000

---

## 10. 交付与回滚

- 单 PR;实现顺序按 §3 表格从上到下(先字典模块 → bootstrap → panel-formulas → cost-engine → 页面接线 → 测试)。
- 回滚:git revert 单 PR 即可,数据表本身不改结构不受影响。
- 数据准备:上线前云开发控制台需要保证 `price` / `panel_name_dict` / `model_panel_hardware` 三张集合已按 `docs/*.json` 样例结构写入生产数据。
- **旧数据不做兼容**:存量 designs 里 `plan.materials` 用中文 id 的老方案会随本次上线被删除,cost-engine 直接按新 code 处理,查不到 code 就走 §8 降级路径。

---

## 11. 附录:cabinet.kind 与 glb 解析速查

| kind | code 举例 | 解析的 glb | 路径 |
|---|---|---|---|
| standard | 'a'/'b'/'c'/'d' + w=50/100 | 50A.glb / 100B.glb / … | 直读 metadata |
| corner | 'y' / 'z' | Y-110-230.glb / Z-110-230.glb | 直读 metadata |
| nonstandard | 'e1'(w ≤ 60) / 'e2'(w > 60) | 50A.glb / 100A.glb | 公式重算(§6.3) |
| raise | 'g' | 100G1.glb | 公式重算(§6.3) |
| raise | 'yg' | YG-110-230G1.glb | 公式重算(§6.3) |
| raise | 'zg' | ZG-110-230G1.glb | 公式重算(§6.3) |
| sk | 'SK' | — | 走 wall 分支 |
| spacer | — | — | 跳过 |
