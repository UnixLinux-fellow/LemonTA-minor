# 衣柜模型选择区缩略图 - 设计文档

## 背景

设计页（`pages/design/`）下方 picker-bar 里的 `.model-thumb` 当前只是一个纯色 view：

```html
<view class="model-thumb" style="background:{{colorCss}}"></view>
```

不同型号（50A/50B/50C/50D 等）的缩略图完全一样，用户无法靠视觉区分柜内结构（上下短衣/中长衣/抽屉/层板等差别），只能靠下方"50cm"这种文案猜。

## 目标

每个 thumb 渲染对应柜型的 **3D 预览图**，效果参照 `miniprogram/utils/display.png`：

- 单柜居中、轻微透视，可见侧板/层板/抽屉/挂衣杆的纵深结构
- 视觉风格与主画布完全一致（同一套光照、材质、边线、色彩映射）
- 颜色跟随上方色卡：选哪种色，thumb 中柜体就是哪种色
- 不引入额外 GLB/PNG 资源
- 不影响主画布渲染稳定性

## 关键约束

| 约束 | 影响 |
|------|------|
| 微信小程序每个 `<canvas type="webgl">` 是独立上下文，安卓老机上限 ~4 | 不能给每个 thumb 一个独立 canvas（≥7 个会崩） |
| `wx.createOffscreenCanvas` 对 webgl 支持不稳定 | 需要用页面里的真实 canvas 节点 |
| `wx.canvasToTempFilePath` 对 webgl canvas 可用，但每次截图 ~50–100ms；调用前必须调过 `renderer.render()` 一次 | 一次切 tab 出 4–6 个模型 ~300–600ms；首屏需要占位 |

## 架构

```
pages/design/
  index.wxml            # 增加一个隐藏 canvas + 在 thumb 里塞 <image>
  index.js              # onReady 后驱动 thumb-generator；色卡变化触发重渲

utils/
  three-renderer.js     # 拆成两个对外入口：initRoom / initPreview
  thumb-generator.js    # 新增：调度隐藏 canvas 上的 preview 渲染 + 截图缓存
```

### 1. `three-renderer.js` 重构

把当前的"墙体房间 + 多柜摆放"逻辑与"单柜预览"逻辑分离，共用底层工具。

**对外入口**：

```js
class ThreeRenderer {
  // 主画布：墙体 + 多柜摆放（行为不变）
  initRoom(canvas, sizeInfo, { wall, hasRaise }) { ... }

  // 预览画布：透明/中性灰底，单柜居中，无房间
  initPreview(canvas, sizeInfo) { ... }

  // 在 preview 模式下：清掉旧柜体，加载并渲染单柜型（item = { code, w, h, kind }），
  // 用指定 color 着色，render 一帧后 resolve
  renderSingle(item, color) { ... returns Promise<void> }
}
```

**底层共用**（不动）：
- GLB 加载与缓存（`_loadItemMesh` / `_loaderCache`）
- 材质归一化（`_normalizeMaterials`）
- 颜色应用（`_applyColor`）
- 边线（`_applyEdges`）
- 门可见性（`_applyDoorVisibility`，已修复 `'men'` bug）

**preview 模式与 room 模式的差异**：

| 项 | room 模式 | preview 模式 |
|----|-----------|--------------|
| 场景背景 | `0xfaf6ec` 暖米色 | `null`（透明）/ 浅中性灰 |
| 墙体/天花板/地板 | 构建 | 不构建 |
| 相机 | 透视，看 wall 中心 | 透视，看单柜中心，距离按柜尺寸算 |
| 阴影 | 启用 PCF 软阴影 | 启用（让柜体不漂浮）但只投到一块薄底板上 |
| 灯光 | 4 盏（环境 + 主光 + 侧补 + 顶光） | 简化为 3 盏（环境 + 主光 + 侧补） |
| 旋转/缩放 | 跟随手势 | 固定一个略带俯视的角度（如 `rotX = -0.15, rotY = 0.25`） |

### 2. `thumb-generator.js`

调度器，职责：
1. 拿到一个隐藏的 webgl canvas 节点 + 一个 `ThreeRenderer` preview 实例
2. 接收一组 `{ code, w, color }` 任务，**顺序**渲染（避免同时占 GL 状态）
3. 每渲染完一个，调 `wx.canvasToTempFilePath` 截图，缓存 `key = ${code}_${w}_${color}` → tempFilePath
4. 用回调把每个 thumb 的 url 增量回传给页面，让用户能看到 thumb 一个个变出来
5. 提供 `regenerateForColor(color)` 用于色卡切换后清缓存重渲

**接口**：

```js
const generator = new ThumbGenerator({
  canvas,            // 隐藏 webgl canvas
  size,              // { cssWidth, cssHeight, dpr }
  models,            // [{ code, w }, ...]
  onThumbReady,      // (key, tempFilePath) => void  key = `${code}_${w}`
});
generator.start(color);                     // 按当前色卡渲染所有
generator.regenerateForColor(nextColor);    // 色卡变了，旧 thumb 留着不闪烁，新 thumb 渲完依次覆盖
generator.dispose();
```

**key 不带颜色**：`thumbUrls[code_w] = tempPath`。换色时同一 key 的 url 被新颜色的截图直接覆盖，旧颜色的 thumb 在新色出图前继续可见，无闪烁。

### 3. 设计页改动

**`index.wxml`** —— 新增隐藏 canvas，model-thumb 内置 `<image>`：

```html
<!-- 隐藏在屏幕外的渲染画布 -->
<canvas type="webgl" id="thumb-webgl" class="thumb-canvas-hidden"></canvas>

<!-- model-thumb 替换为 image + 占位 -->
<view class="model-thumb">
  <image
    wx:if="{{thumbUrls[item.code + '_' + item.w]}}"
    class="model-thumb-img"
    src="{{thumbUrls[item.code + '_' + item.w]}}"
    mode="aspectFit"
  />
  <view wx:else class="model-thumb-placeholder" style="background:{{colorCss}}"></view>
</view>
```

**`index.wxss`** —— 隐藏 canvas（屏幕外但保留可被 wx 引用），thumb 内图样式：

```css
.thumb-canvas-hidden {
  position: fixed;
  left: -9999px;
  top: 0;
  width: 200px;
  height: 280px;
  pointer-events: none;
}
.model-thumb-img {
  width: 100%;
  height: 100%;
}
.model-thumb-placeholder {
  width: 100%;
  height: 100%;
  border-radius: 6rpx;
}
```

**`index.js`**：

```js
onReady() {
  // 主画布初始化（保持现状）
  initMainRenderer();

  // 拿到隐藏 canvas，启动 thumb generator
  wx.createSelectorQuery()
    .select('#thumb-webgl').fields({ node: true, size: true })
    .exec((res) => {
      this._thumbGen = new ThumbGenerator({
        canvas: res[0].node,
        size: { cssWidth: 200, cssHeight: 280, dpr: ... },
        models: this._allModels.filter(/* 只渲染 picker 里会出现的 */),
        onThumbReady: (key, url) => {
          this.setData({ [`thumbUrls.${key}`]: url });
        },
      });
      this._thumbGen.start(this.data.color);
    });
},

onPickColor(e) {
  // ...原有逻辑...
  if (this._thumbGen) this._thumbGen.regenerateForColor(state.meta.color);
},

onUnload() {
  // ...原有 dispose...
  if (this._thumbGen) this._thumbGen.dispose();
}
```

## 边界条件

- **首屏占位**：thumb 未生成完时显示当前色的纯色占位（即现有行为），避免空白闪烁
- **色卡切换**：**不显示占位、不闪烁**——继续展示旧颜色的 thumb，直到新颜色的 thumb 渲染完成后逐个替换。即 `thumbUrls` 的 key 不带颜色（`${code}_${w}`），新颜色的截图直接覆盖旧 url
- **色卡切换并发**：用户连续点色卡时，新任务应取消进行中的旧任务（generator 内置 `_currentToken` 比对，过期任务的截图丢弃，避免"按 A→B→C 但 B 的截图比 C 慢、最后显示 B"）
- **失败兜底**：某个模型加载/截图失败，对应 thumb 留占位+控制台 warn，不阻塞其他模型
- **页面 dispose**：onUnload 必须 dispose generator（取消 raf、清缓存）
- **加高模块（g1/g2）**：当前 picker 只展示 standard 类（s50/s100），加高模块由布局自动放置不进 picker；如果后续放进 picker，generator 不需额外改动，传 `{ code: 'g1', w: 50 }` 即可

## 不做

- thumb 的旋转手势（固定视角）
- thumb 内开柜门切换（保持柜门隐藏）
- thumb 高质量光照（沿用 room 模式同款，不引入 IBL）
- 把已生成的 thumb 持久化到本地存储（每次进入页面重新生成；标准 8 个 + 加高 4 个不算重负担）
- corner 柜（y/z/yg/zg）的 thumb：转角柜由布局引擎自动放置，不在 picker 出现

## 测试与验证

- 真机（iOS 主流 + 一台中低端安卓）首屏进入 design 页：thumb 在 ~1s 内全部呈现
- 切色卡：thumb 颜色跟随更新，无错位、无截图错乱
- 主画布的旋转/缩放/选模型/换色/开关门：行为不受 thumb 流程影响
- 反复进出页面：无内存泄漏（WebGL 上下文按 dispose 清理）
