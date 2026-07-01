# 消除 Three.js NPOT 纹理警告

## 背景

`miniprogram/utils/three-renderer.js` 加载的几张贴图（`wood.jpg`、`wood_NormalMap.jpg`、`wall.png`、`floor.jpg`、`white1000.png`）尺寸不是 2 的幂（NPOT），但代码统一给它们设了 `THREE.RepeatWrapping`。WebGL1（小程序底层）不支持 NPOT 纹理走 `RepeatWrapping`，Three.js 会输出警告：

```
THREE.WebGLRenderer: Texture is not power of two.
Texture.wrapS and Texture.wrapT should be set to THREE.ClampToEdgeWrapping.
```

WebGL1 在这种情况下实际上把 wrap 当 Clamp 处理，所以贴图的 `repeat.x/y` 设置在运行时就被 GPU 忽略 —— 当前视觉效果其实是 Clamp 后的样子，不是开发者意图中的 Repeat tile 效果。

## 目标

消除控制台里的这条警告，视觉效果保持现状不变。

不在范围内的：把图片重做成 2 的幂尺寸来真正启用 tile（视觉会变，需要素材改造，本次不做）。

## 方案

把所有 NPOT 图像加载后创建 Texture 的位置，`wrapS / wrapT` 从 `RepeatWrapping` 改为 `ClampToEdgeWrapping`。

`repeat.x/y` 的 setData 保留不动 —— GPU 反正忽略，删除会扩大改动面积、增加回归风险，无收益。

## 改动点

文件：`miniprogram/utils/three-renderer.js`，5 处。

| # | 函数 | 位置 | 当前 wrapS/wrapT 值 |
|---|------|------|--------------------|
| 1 | `_ensureWoodTexture` | 第 746-749 行 | RepeatWrapping |
| 2 | `_ensureWoodNormalTexture` | 第 790-793 行 | RepeatWrapping |
| 3 | `_ensureWallTexture` | 第 838-841 行 | RepeatWrapping |
| 4 | `_ensureFloorTexture` | 第 893-896 行 | RepeatWrapping |
| 5 | `_applyMaterial`（白色柜面 Texture） | 第 950-953 行 | RepeatWrapping |

每处的改动模式一致：

```javascript
// 改前
if (THREE.RepeatWrapping) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
}

// 改后
if (THREE.ClampToEdgeWrapping) {
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
}
```

`if (THREE.XxxWrapping)` 守卫保留 —— 与现有代码风格一致，避免 Three.js 子集没暴露这个常量时崩。

## 不改的地方

- `_makeWallNoiseTexture`（第 466-467 行）：DataTexture，size 是 128（2 的幂），不会触发警告，也确实需要 Repeat。
- `_ensureWhiteTexture`：只缓存 `Image` 对象，不创建 Texture。Texture 在 `_applyMaterial` 里按柜体新建（这是改动 #5 的位置）。
- `_buildEnv` 里的 CubeTexture：6 张离屏 canvas 程序生成，size 256（2 的幂），不触发警告。
- 各处 `tex.repeat.x/y` 的 setData 调用：保留，无副作用。

## 验证

无自动化测试。验证方式：

1. 在微信开发者工具里打开小程序，走到任一带 3D 渲染的页面（design / cost）
2. 观察控制台
3. 预期：`THREE.WebGLRenderer: Texture is not power of two` 警告不再出现
4. 视觉对比：墙面、地板、柜体（白色 / 原木色）渲染效果与改前一致
