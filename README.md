# 云开发 quickstart

这是云开发的快速启动指引，其中演示了如何上手使用云开发的三大基础能力：

- 数据库：一个既可在小程序前端操作，也能在云函数中读写的 JSON 文档型数据库
- 文件存储：在小程序前端直接上传/下载云端文件，在云开发控制台可视化管理
- 云函数：在云端运行的代码，微信私有协议天然鉴权，开发者只需编写业务逻辑代码

## 参考文档

- [云开发文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)

# LemonTA-minor

## 模型上传

"我的设计"页面标题右侧的"上传新模型"按钮支持将 GLB 上传到 `cabinet-model-standard/{50cm,100cm,zj}/`,并将元数据写入云数据库集合 `model_panel_hardware`。命名必须匹配 `50X.glb` / `100X.glb` / `Y*.glb` / `Z*.glb` / `YG*.glb` / `ZG*.glb`(不区分大小写),不匹配将被拒绝上传。GLB 解析用页面里的隐藏 webgl canvas 获取 scoped THREE + GLTFLoader,首次上传时懒初始化。上传的模型不会立即出现在设计页 picker 中——picker 仍从旧的 `cabinet-model/` 目录同步。
