# 衣柜白色纹理贴图 — 设计文档

日期:2026-06-25
范围:单文件改动 — `miniprogram/utils/three-renderer.js`

## 目标

用户在设计页面选择"白色"色卡时,衣柜柜面应使用 `utils/white1000.png` 作为颜色贴图,而非现有的纯色平涂。贴图的 `repeat`(tile)按每个柜体的物理尺寸自动计算。

## 物理参考

- 一张 `white1000.png` 代表 100cm × 100cm 的真实柜面
- `repeat.x = item.w / 100`(50cm 柜 → 0.5;100cm 柜 → 1.0)
- `repeat.y = item.h / 100`(230cm 柜 → 2.3;60cm 加高块 → 0.6)

## 架构

单文件改动:`miniprogram/utils/three-renderer.js`。页面层(design/index.js, .wxml)无变化 —— 用户依然通过现有"白色"色卡触发,贴图细节归 renderer 内部职责。

### 新增

`_ensureWhiteTexture()` —— 镜像现有 `_ensureWoodTexture` 的懒加载结构,从 `/utils/white1000.png` 异步读图,缓存到 `this._whiteImage`(Image 对象,而非 Texture)。image 就绪后若 `this._color === 'white'`,把 `_cabinets` 和 `_previewGroup.children` 全部重刷一遍材质。

### 修改

| 位置 | 改动 |
|---|---|
| `_applyMaterial(group, colorId)` | 第 3 个参数加 `item`,white 分支判断 `_whiteImage` 就绪后挂 map |
| `_placeRow` | 调用 `_applyMaterial(group, this._color, it)` 透传 item |
| `renderSingle` | 调用 `_applyMaterial(group, colorId, item)` 透传 item |
| `setColor` | 遍历 `_cabinets` 时把 `c.item` 一起传给 `_applyMaterial` |
| `initRoom` 末尾 | 调用 `_ensureWhiteTexture()` 提前预加载,与 `_ensureWoodTexture` 并列 |
| `initPreview` 末尾 | 同上 |

## Texture 实例化策略

`THREE.Texture.repeat` 是材质级状态,多个柜共享同一个 Texture 会互相覆盖 repeat。因此走"image 共享 + Texture 实例每柜独立"的标准做法:

- `_ensureWhiteTexture` 缓存 `Image`(`this._whiteImage`),不缓存 Texture
- `_applyMaterial` 在 white 分支内 `new THREE.Texture(this._whiteImage)`,设独立 repeat
- WebGL 上传层识别同一 Image,GPU 端只占一份纹理内存
- 不缓存的 Texture 实例由 GC 回收,无内存泄漏

### `_applyMaterial` 白色分支(伪码)

```js
const useWhiteTex = colorId === 'white' && !!this._whiteImage;
const useWood = colorId === 'wood' && !!this._woodTexture;

if (useWhiteTex) {
  const tex = new THREE.Texture(this._whiteImage);
  if (THREE.RepeatWrapping) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  if (THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
  const w = (item && item.w) || 100;
  const h = (item && item.h) || 100;
  tex.repeat.set(w / 100, h / 100);
  // 各向异性过滤,与 wall/floor 一致
  try {
    const maxAniso = this.renderer && this.renderer.capabilities
      && this.renderer.capabilities.getMaxAnisotropy
      && this.renderer.capabilities.getMaxAnisotropy();
    if (maxAniso) tex.anisotropy = Math.min(8, maxAniso);
  } catch (e) { /* ignore */ }
  tex.needsUpdate = true;
  // 应用到 group 内每个 mesh(跳过 back / rod 与现有逻辑一致),mat.color 设为白避免反向 tint
}
```

## 错误处理与边界

- **加载失败**:`image.onerror` 时 `_whiteImagePromise = null`、`_whiteImage` 保持 falsy。`_applyMaterial` 看到 `useWhiteTex = false`,自动走 hex 纯色 `#f0f0e7`(原行为)。静默回退,无 toast。
- **加载延迟**:`image.onload` 内部检查 `this._color === 'white'`,真则二次刷新已落地柜体和预览。沿用 wood 模式。
- **切色清理**:non-white 分支会 `m.map = null` + 恢复 `mat.color = flatColor`,解除残留 white texture 引用。
- **保留固有色部件**:`_applyMaterial` 已有的 `if (nm === 'back' || nm === 'rod') return` 规则在 white 分支同样适用(背板纵深、挂衣杆金属感不被覆盖)。
- **item 缺失兜底**:理论不可能,但 `repeat` 计算时若 item 为空,fallback 到 `(1, 1)`。

## 不在范围内

- 不改 wood/wall/floor 已有逻辑
- 不引入新 UI 控件
- 不调整阴影、光照参数
- 不为 beige/gray 加贴图
- 不做 bumpMap / roughnessMap(只做 color map)
- 不做相邻柜贴图 UV 拼接(YAGNI)
- 不在 `MeshStandardMaterial` 之外引入新材质类型

## 测试与验证

**手动视觉验证**(微信开发者工具):
1. 进入 design 页,色卡选"白色"
2. 柜面应显示 white1000.png 纹理,而非纯色
3. tile 自动调整核验:
   - 50A(50×230)→ 横向半张、纵向 ~2.3 张
   - 100A(100×230)→ 横向 1 张、纵向 ~2.3 张
   - 加高块(100×60)→ 横向 1 张、纵向 ~0.6 张
4. 切色 white → beige(纯色)→ white,贴图无残影
5. 底部 picker 缩略图同样应有 white 贴图
6. materials 页 previewImage 含贴图效果

**失败路径**:临时改 src 为不存在路径,应静默回退原纯色,无报错弹窗。

**回归**:wood 仍正常加载;beige/gray 仍纯色;切色 / 切尺寸 / 加减柜 / door 开关功能不变。

**不做**:自动化单元测试(项目无 Three.js 测试基建);真机回归(改动仅材质层,不涉及 iOS 特有路径)。
