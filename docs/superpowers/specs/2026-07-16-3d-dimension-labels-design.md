# 3D 场景尺寸标注

## 背景

设计衣柜页的 3D 场景要加尺寸标注,风格参考 `docs/宜家标尺.png`:黑底白字表示柜体自身尺寸,蓝底白字表示剩余空间,尺寸数字标在两头带竖线的标尺中点。

## 需求

1. **每个柜子标宽 W**(整数 cm)
2. **共享高 H**:底行一个(230),加高行一个(`H-232`,`hasRaise && H>250` 时才有)
3. **共享深 D**:标准柜 60 一个;每个转角柜额外标 110
4. **剩余宽**(蓝):`!isFull` 时显示,从最后放置柜的右边缘延伸到右墙(或右转角左缘)
5. **剩余高**(蓝):`!hasRaise && H>230` 时显示,从 y=230 到 y=H
6. **materials/cost 页截图不含标注**

## 现状回顾

- `three-renderer.js` 已有 `_cabinets = [{ mesh: group, item }]`,每项 `mesh.position.x` 是柜中心世界 x
- `_roomGroup` 旋转由 `_rotX/_rotY` 驱动(±π/6)
- `renderRows(state)` → `renderer.setItems({bottom, top})` 每次 recompute 都跑
- 截图流程:`captureLayoutImage/captureWireframeImage`(独立 render 路径)
- `threejs-miniprogram` 已带 `Sprite/SpriteMaterial/CanvasTexture`

## 架构

在 `three-renderer.js` 内新增:

- `this._dimGroup`(Group):挂 `_roomGroup` 下,跟房间一起旋转
- `_makeLabelSprite(text, style)`:离屏 2d canvas 画圆角矩形+文字 → `CanvasTexture` → `Sprite`
- `_makeRulerLines(from, to, capAxis, color)`:主线 + 两头短竖线,`LineSegments` 一次画出
- `setDimensionsInfo({wallW, wallH, hasRaise, isFull, cornerType})`:清空 `_dimGroup.children` 再重建

Design 页在每次 `renderer.setItems(...)` 之后紧跟一次 `renderer.setDimensionsInfo(...)`:三处 `onReady`(首次)、`recompute`、无更多入口。

## 位置(世界 cm)

原点:x=0 墙宽中央,y=0 地面,z=0 后墙内表面。`W=wall.w, H=wall.h, D_room=150`,标准柜前突 z 处 `cabZ+30`(即 `-D_room + 60`),转角柜 `cabZ+55`(即 `-D_room + 110`)。

| 标签 | 位置 | ruler 端点 | 何时显示 |
|---|---|---|---|
| 每柜宽 W | (x_center, -10, cabZ+it_depth/2+3) | (x-w/2, 0, ..) → (x+w/2, 0, ..),cap 向下,长 8 | 遍历 `_cabinets` 过滤 `standard/corner/nonstandard` |
| 底行高 230 | (-W/2-10, 115, -D_room+30) | (-W/2, 0, ..) → (-W/2, 230, ..),cap 向左,长 8 | 总是 |
| 加高行高 raiseH | (-W/2-10, 230+raiseH/2, -D_room+30) | (-W/2, 232, ..) → (-W/2, H, ..),cap 向左 | `hasRaise && H>250` |
| 标准柜深 60 | (x_ref, 240, cabZ) | (x_ref, 230, cabZ-30) → (x_ref, 230, cabZ+30),cap 向 y | 存在 standard/nonstandard 时。x_ref = `_cabinets` 里第一个 standard 的 `mesh.position.x`,不存在则用第一个 nonstandard |
| 转角柜深 110 | (x_corner, 240, cabZ_corner) | 沿 z 长 110 | 每个 corner |
| 剩余宽 | ((x_last+x_wall)/2, 115, cabZ+30) | (x_last, 115, ..) → (x_wall, 115, ..) | `!isFull && x_wall - x_last > 1` |
| 剩余高 | (0, (230+H)/2, cabZ+30) | (0, 230, ..) → (0, H, ..) | `!hasRaise && H>230` |

`x_last` = `_cabinets` 中非 sk 项最右一个的 `mesh.position.x + item.w/2`;若空(初始左转角态)= `-W/2 + 2 + 110`。

`x_wall` = `W/2 - (cornerType==='YZJ'||cornerType==='ZYZJ' ? 110 : 0) - 2`(-2 是右 SK 厚度)。

## Sprite 视觉

- 离屏 canvas:高 60px(dpr=2 折算实际 30px 视觉字号),宽自适应,padding 12px,圆角 8px
- 字体:`'PingFangSC, sans-serif' bold 24px`(dpr 前)
- 黑标签:bg `#0f172a` fg `#ffffff`
- 蓝标签:bg `#2563eb` fg `#ffffff`
- Sprite 世界高度固定 12cm(sprite.scale = `[12 * canvasAspect, 12, 1]`),不做恒定屏幕像素处理 — zoom 时同步缩放,可接受
- `SpriteMaterial({ map: canvasTex, transparent: true, depthTest: false, depthWrite: false })` — `depthTest:false` 保证标签不被柜体挡

## Ruler 视觉

- `LineBasicMaterial({ color: 0x0f172a })` for 柜尺寸;`{color: 0x2563eb}` for 剩余
- 主线 + 两端 8cm 短垂直线,合并到一个 `BufferGeometry` 用 `LineSegments`(每两点一段)
- `capAxis` 参数决定短线方向:水平 ruler 的 cap 在 y 方向,竖直 ruler 的 cap 在 x 方向,深度 ruler 的 cap 在 y 方向

## 截图排除标注

`captureLayoutImage / captureWireframeImage` 内部渲染前:
```js
const wasVisible = this._dimGroup && this._dimGroup.visible;
if (this._dimGroup) this._dimGroup.visible = false;
try { /* 原截图逻辑 */ } finally {
  if (this._dimGroup) this._dimGroup.visible = wasVisible;
}
```

保守做法:在两个 capture 函数入口加同样的 try/finally 包裹。

## 数据流

```
design page recompute()
  ↓ 
renderer.setItems(renderRows(state))    // 现有
  ↓
renderer.setDimensionsInfo({
  wallW, wallH,
  hasRaise: state.meta.hasRaise,
  isFull: state.meta.isFull,
  cornerType: state.meta.cornerType,
})
```

`setDimensionsInfo` 内部:
1. 若 `_dimGroup` 不存在 → 创建 + 加入 `_roomGroup`
2. 清空 `_dimGroup.children`(销毁旧 sprite/line 的 material/texture/geometry)
3. 按表格生成每种标签 + ruler,`_dimGroup.add(...)`

## 未处理项

- Sprite 大小随 zoom 变化(不做恒定屏幕像素处理,与 IKEA 参考图一致)
- Sprite 天然 billboard 面向相机,room 旋转不影响可读性
- 窄墙下左侧 H 标签(x=-W/2-10)可能贴到画布边;不做特殊避让
- Sprite `depthTest:false` 让标签始终显示在最上层,不被柜体几何遮挡
- 门板显隐、颜色切换不影响标注
- 前置资源:renderer 需持有 `wx.createOffscreenCanvas` 权限(小程序基础库 2.7.0+,LemonTA 已在用)

## 测试

难以自动化(涉及 WebGL 渲染)。手动验证矩阵:
- 无转角,3 个标准柜:6 个宽标签 + 230 + 60 + 剩余宽
- 双侧转角 + 加高:110×2 + 每标准柜 W + 230 + raiseH + 60 + 每转角 110
- 布满:剩余宽消失
- 加高开:剩余高消失,加高行高显现
- 旋转:所有标签可读、位置跟随
- 截图:materials 页展示的 previewImage 不含标注
