# LEMONTA 设计模块 - 设计文档

## 背景

LEMONTA 是一款定制衣柜微信小程序。本次需求实现"设计模块"——用户从方案列表入口，依次完成空间设置 → 衣柜布局 → 板材五金选择 → 成本透视的完整流程。需求文档：`utils/LEMONTA.docx`。

## 范围与策略

需求覆盖范围广泛，包括 3D 模型渲染、PBR 材质、模型增量同步、CAD/百度网盘文件生成等。本设计聚焦"前端可独立交付"的部分；与服务端深度耦合或需要外部资源的能力先以可替换的占位实现保留接口。

**本期实现：**

- 5 个核心页面与跳转链路（方案列表 / 空间设置 / 设计 / 板材五金 / 成本透视）
- 完整表单与校验（空间名称、墙体尺寸、转角柜、加高模块）
- 3D 空间使用 three.js (mini-program 版) 渲染：墙面、地板、灯光、衣柜模型摆放、旋转/缩放
- 衣柜模型管理（本地兜底 + 业务后端拉取接口）；本地内置占位 GLB 资源目录与命名规范
- 衣柜摆放算法：宽度区段计算、转角柜/收口条/加高模块自动放置、最后一格非标拉伸（e1 单门 / e2 双门）
- 颜色切换（白/米/灰/原木 4 种）、柜门显隐
- 板材五金选项页（板材、门板材质、门板工艺、五金、照明）
- 成本透视页（线框图、模块卡片、模块明细弹窗、下载弹窗、总计）
- 本地存储（最多 30 个方案）+ 云函数读写接口

**本期占位（保留接口，可后续替换）：**

- PBR/IBL 高品质渲染管线（先用基础 MeshStandardMaterial）
- 服务端模型增量更新与压缩下载（接口已对接，资源由后台后续提供）
- CAD 图纸/拆单/PDF 生成与百度网盘上传（云函数返回固定示例链接）
- 精准成本计算引擎（按板件面积 × 单价 + 五金件数量 × 单价做线性估算，单价表落本地 JSON）

## 架构

```
miniprogram/
  app.js / app.json / app.wxss              # 入口与全局 tabBar 调整
  pages/
    index/                                  # 保留官方欢迎页，新增"开始设计"入口
    plan-list/                              # 方案列表
    space-setup/                            # 空间设置
    design/                                 # 设计页（3D + 模型选择）
    materials/                              # 板材五金选择
    cost/                                   # 成本透视
  components/
    cabinet-toast/                          # 红色字体 2 秒自动消失提示
    confirm-dialog/                         # 二次确认弹窗
    module-detail-modal/                    # 模块成本明细
    download-modal/                         # 一键下载弹窗
  utils/
    cabinet-rules.js                        # 校验 + 宽度区段算法
    cabinet-model.js                        # 模型命名/解析/分类
    layout-engine.js                        # 摆放引擎（推/弹/确定布局）
    cost-engine.js                          # 成本计算
    plan-store.js                           # 本地方案存储 (wx.storage)，30 条上限
    cloud.js                                # 云函数封装
    three/                                  # three.js mini-program 适配 + 渲染器
      scene.js                              # 3D 母空间/墙体/地板
      cabinet-renderer.js                   # 衣柜模型加载与颜色切换
  models/                                   # 兜底 glb（含 README 说明命名）
    50-230-600-a.glb ... 100-230-600-d.glb  # 12 个本地兜底模型
  config/
    materials.json                          # 板材/门板/五金/照明价目
    colors.json                             # 4 种颜色
cloudfunctions/
  quickstartFunctions/
    index.js                                # 增加：getModelInfo / savePlan / saveMaterials / getDownloadLinks
```

## 关键模块说明

### 1. 校验引擎 `cabinet-rules.js`

纯函数，零副作用：

- `validateWall(width, height)` → 44 ≤ W ≤ 1000 且 232 ≤ H ≤ 1000，返回 `{ ok, message }`
- `validateCorner(width, cornerType)` → cornerType ∈ `WZJ|ZZJ|YZJ|ZYZJ`；W < 114 时仅 `WZJ`；114 ≤ W < 224 时不可选 `ZYZJ`
- `validateRaise(height, hasRaise)` → 加高模块要求 H > 250
- `computeStandardRange(width, cornerCount)` → 标准模块可摆放总宽 x：在区间 `[W-124-z*110, W-44-z*110]` 中找能被 50 整除的最大值
- `computeNonStandardWidth(remaining)` → 给出非标模块宽度（40–120cm 范围）

### 2. 模型管理 `cabinet-model.js`

命名解析：`{宽}-{高}-{深}-{编码}.glb`，编码字母映射 a..l/g/SK/y/yg/z/zg。

接口：

- `parse(name)` / `format({w,h,d,code})`
- `localModels()` 返回内置 12 个模型清单
- `fetchRemoteModels(localList)` 调云函数 `getModelInfo`，返回应下载列表（占位实现：直接 resolve 空数组）
- `categorize(models)` → `{ s50: [], s100: [], raise: [], corner: [], sk: [] }`

### 3. 摆放引擎 `layout-engine.js`

状态：`{ placed: [], pending: <next slot>, isFull: false, color: 'white', showDoor: false }`。

方法：

- `init({ wall, hasRaise, cornerType })`：放置左右收口、左右转角柜（若有）、可选加高模块占位、第一格默认 50cm a 型
- `addNext(modelCode, size)`：把所选模型放入下一个标准格；若进入最后一格，按宽度自动选 e1/e2 拉伸
- `removeLast()`：删除最后一格；满状态下点击则一次删两格（最后一个非标 + 它前面的标准）；只剩一格时弹错误
- `applyColor(color)` / `toggleDoor()`
- `serialize(meta)`：输出存储格式（参考需求文档 3.3.3.2 节示例）

### 4. 3D 渲染 `three/*.js`

使用 `three.js`（精简打包）+ WeChat mini-program 的 `wx.createCanvas` / `Canvas` API。

- `scene.js`：根据墙宽高建立矩形房间，五个面（左右顶底+正面），地板人字形纹理，米色调；正交+轨道控制（角度 ±30°），缩放 75%–150%
- `cabinet-renderer.js`：按 GLB 加载柜体、按颜色切换 PBR baseColor、门板显隐通过控制 `door` 子节点 `visible`

### 5. 数据流

```
plan-list ─→ space-setup ─→ design ─→ materials ─→ cost
                                        ↑           │
                                        └───────────┘ (更换配置)
plan-list ──────────────→ materials ─→ cost (从已保存方案进入)
```

页面间通过 `wx.navigateTo` URL 参数 + `getApp().globalData.draftPlan` 暂存。最终落地到 `plan-store.js` 与云端。

### 6. 本地存储 `plan-store.js`

- 键名：`PLAN_LIST`，值是数组（最多 30 项）
- 单条结构：

```js
{
  id, userTag, createdAt, name,
  wall: { w, h, d },
  cornerType, hasRaise,
  photoPath,
  layout: { items: [...], colors, sk, raise },
  layoutPreview, wireframePreview,
  materials: { panel, doorPanel, doorCraft, hardware, lighting }
}
```

- API：`list / get / upsert / remove / countCheck`

### 7. 云函数

新增 `type` 分支：

- `getModelInfo(localList)` → 返回 `{ added: [], removed: [] }`，本期固定空
- `savePlan(plan)` / `saveMaterials({ planId, materials })` → 写入 `lemonta_plans` 集合
- `getPlan / listPlans` → 读取
- `requestDownload(planId)` → 返回示例百度网盘链接

## 错误处理

| 场景 | 行为 |
| --- | --- |
| 方案 ≥ 30 时新建 | 顶部红字 toast 2s 自动消失 |
| 名称重复 / 尺寸超界 / 转角不符 / 加高不符 | 墙体尺寸下方红字提示，校验错误时禁用确认按钮 |
| 仅剩一个模块时点上一模块 | 红字 toast "第一个模块只能替换，不能删除" |
| 模型加载失败 | 回退本地兜底；console.warn |
| 云函数失败 | `wx.showToast` "网络异常，请稍后重试" |

## 测试策略

- 纯函数（rules / engine / cost）使用简易断言脚本 `tests/run.js`，Node 直接执行，不引外部框架
- 页面 / 3D 因小程序 IDE 限制，提供手测脚本 `docs/manual-test.md`，覆盖每条校验分支与边界
- 验收口径：所有 11 条校验规则、4 个跳转路径、最大 30 方案上限、典型墙宽 320 / 480 / 1000 与 232 / 260 / 300 高度组合下布局算法输出符合需求示例

## 不在本期范围

- 鉴权 / 登录 / 注册（沿用云开发匿名）
- 工厂开料 XML / CSV、CAD 图纸、PDF 总结文档生成
- IBL/PBR 高品质管线
- 板材五金历史方案对比页
- 设计页 35° 旋转的 IK 轨道控制（先用 OrbitControls 默认值并夹紧）

