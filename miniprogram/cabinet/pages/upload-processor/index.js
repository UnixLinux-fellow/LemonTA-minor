// 上传中转页:属于 cabinet 分包(threejs-miniprogram 已可用)。
// plan-list 收集 { file, category, subdir } 后 navigateTo 到这里。
// 本页面 onLoad → 立刻走 上传 → 解析 → 入库 → navigateBack + 全局 toast。
// 用户在此页面除等待外无其他交互;成功/失败均会自动跳回。

const glbMetadata = require('../../../utils/glb-metadata.js');
const modelMetaCache = require('../../../utils/model-meta-cache.js');
const modelSync = require('../../../utils/model-sync.js');
const { createScopedThreejs } = require('threejs-miniprogram');
const attachGLTFLoader = require('../../vendor/GLTFLoader.js');

// 管理员 openid 白名单。命中则 source_type = 'official_standard', 否则 'normal_user'。
// 目前空, 后续由运营手动填并发版。
const ADMIN_OPENIDS = [];

const MODEL_PANEL_HARDWARE = 'model_panel_hardware';
// 直接落到 cabinet-model/, 与现有官方模型同位。listCabinetModels 云函数会扫到,
// 其他用户下次冷启动 syncOnLaunch 自动拉到。本机上传后 registerLocalFile
// 立即插 manifest, 本会话 picker 即刻可见。
const UPLOAD_ROOT = 'cabinet-model';

async function _getOpenid() {
  const app = getApp();
  if (app && app.globalData && app.globalData.openid) return app.globalData.openid;
  try {
    const r = await wx.cloud.callFunction({
      name: 'quickstartFunctions',
      data: { type: 'getOpenId' },
    });
    const openid = r && r.result && r.result.openid;
    if (openid && app && app.globalData) app.globalData.openid = openid;
    return openid || '';
  } catch (e) {
    return '';
  }
}

// 拿隐藏 canvas → createScopedThreejs → attachGLTFLoader → 返回 { THREE, gltfLoader }
function getParseDeps(page) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page)
      .select('#glb-parse-canvas').fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('glb-parse-canvas node missing'));
          return;
        }
        const canvas = res[0].node;
        canvas.width = 1;
        canvas.height = 1;
        try {
          const THREE = createScopedThreejs(canvas);
          attachGLTFLoader(THREE);
          const gltfLoader = new THREE.GLTFLoader();
          resolve({ THREE, gltfLoader });
        } catch (e) {
          reject(e);
        }
      });
  });
}

// 页面结束: 弹 toast 并 navigateBack。toast 走 globalData 让 plan-list 的 onShow 消费。
function finishAndBack(msg, isSuccess) {
  const app = getApp();
  if (app && app.globalData) app.globalData.uploadToast = { msg, isSuccess };
  wx.navigateBack({ delta: 1 });
}

Page({
  data: {
    fileName: '',
    stageTitle: '准备中...',
  },

  onLoad() {
    const app = getApp();
    const pending = app && app.globalData && app.globalData.pendingUpload;
    if (!pending) {
      wx.showModal({
        title: '数据丢失',
        content: '未找到待上传的文件,请返回重试',
        showCancel: false,
        success: () => finishAndBack('未找到待上传文件', false),
      });
      return;
    }
    this.setData({ fileName: pending.file.name });
    // pending 消费即清,防止误跳转到本页时二次执行
    app.globalData.pendingUpload = null;
    this._pending = pending;
  },

  async onReady() {
    // onReady 才能保证 canvas 节点可查
    if (!this._pending) return;
    const { file, category, subdir } = this._pending;
    let uploadedFileID = '';
    try {
      // 1) COS 上传
      this.setData({ stageTitle: '上传到云端...' });
      const cloudPath = `${UPLOAD_ROOT}/${subdir}/${file.name}`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.path });
      const fileID = up && up.fileID;
      if (!fileID) throw new Error('upload_no_fileID');
      uploadedFileID = fileID;

      // 2) 解析 GLB
      this.setData({ stageTitle: '解析模型...' });
      const openid = await _getOpenid();
      const sourceType = ADMIN_OPENIDS.includes(openid)
        ? 'official_standard'
        : 'normal_user';
      const { THREE, gltfLoader } = await getParseDeps(this);
      const meta = await glbMetadata.parse(
        {
          filePath: file.path,
          fileName: file.name,
          modelCategory: category,
          fileSize: file.size,
          uploadOpenid: openid,
          sourceType,
        },
        {
          THREE,
          gltfLoader,
          fs: wx.getFileSystemManager(),
        }
      );
      meta.cos_path = fileID;

      // 3) overall_size 全 0 时让用户确认
      if (!meta.overall_size ||
          (meta.overall_size.total_width === 0 &&
           meta.overall_size.total_height === 0 &&
           meta.overall_size.total_depth === 0)) {
        console.warn('[upload-processor] overall_size all zero');
        const proceed = await new Promise((resolve) => {
          wx.showModal({
            title: 'GLB 解析尺寸为 0',
            content: '模型尺寸解析失败(可能 GLB 结构不标准)。仍继续入库供运维核对?',
            success: (res) => resolve(res.confirm),
            fail: () => resolve(false),
          });
        });
        if (!proceed) {
          console.warn('[upload-processor] GLB orphaned on COS after user declined:', uploadedFileID);
          finishAndBack('已取消入库', false);
          return;
        }
      }

      // 4) 写库(不刷新 stageTitle, 避免向用户暴露"写入数据库"字样)
      const db = wx.cloud.database();
      await db.collection(MODEL_PANEL_HARDWARE).add({ data: meta });

      // 5) 写本地缓存, 后续设计消费同名模型时直接命中, 不用再查库
      modelMetaCache.setMeta(file.name, meta);

      // 6) copy 到 model-sync 本地缓存 + 插 manifest → picker 本会话即可见
      const reg = modelSync.registerLocalFile({
        subdir,
        name: file.name,
        srcPath: file.path,
        fileID,
        size: file.size,
      });
      if (!reg.ok) {
        console.warn('[upload-processor] registerLocalFile fail:', reg.err);
      }

      finishAndBack('上传成功', true);
    } catch (err) {
      console.error('[upload-processor] failed', err);
      const baseMsg = (err && (err.errMsg || err.message)) || '未知错误';
      const content = uploadedFileID
        ? `文件已上传但入库失败:${baseMsg}\n\ncos_path: ${uploadedFileID}\n请联系运维处理孤儿文件或重试入库。`
        : baseMsg;
      wx.showModal({
        title: '上传失败',
        content,
        showCancel: false,
        success: () => finishAndBack('上传失败', false),
      });
    }
  },
});
