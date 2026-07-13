const pdfExporter = require('../../utils/pdf-exporter.js');
const hardwarePdfCloud = require('../../utils/hardware-pdf-cloud.js');
const filenameCleaner = require('../../utils/filename-cleaner.js');
const planImageCache = require('../../utils/plan-image-cache.js');
const glbMetadata = require('../../utils/glb-metadata.js');
const { createScopedThreejs } = require('threejs-miniprogram');
const attachGLTFLoader = require('../../cabinet/vendor/GLTFLoader.js');

function getPdfCanvas(page) {
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page)
      .select('#pdf-canvas').fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('pdf-canvas node missing'));
          return;
        }
        resolve(res[0].node);
      });
  });
}

// 拿 GLB 解析用的隐藏 webgl canvas, 首次调用时 createScopedThreejs + attachGLTFLoader,
// 缓存到 page._glbParseDeps 复用。
function getGlbParseDeps(page) {
  if (page._glbParseDeps) return Promise.resolve(page._glbParseDeps);
  return new Promise((resolve, reject) => {
    wx.createSelectorQuery().in(page)
      .select('#glb-parse-canvas').fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('glb-parse-canvas node missing'));
          return;
        }
        const canvas = res[0].node;
        // 1x1 隐藏 canvas, 只是拿来给 createScopedThreejs 挂 WebGL 上下文;
        // 不做实际渲染, 尺寸最小化即可。
        canvas.width = 1;
        canvas.height = 1;
        try {
          const THREE = createScopedThreejs(canvas);
          attachGLTFLoader(THREE);
          const gltfLoader = new THREE.GLTFLoader();
          page._glbParseDeps = { THREE, gltfLoader };
          resolve(page._glbParseDeps);
        } catch (e) {
          reject(e);
        }
      });
  });
}

// 从 app.globalData.openid 拿 openid; 没有则通过 cloud.callFunction 兜底。
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

const MAX_DESIGNS = 30;

// 管理员 openid 白名单。命中则 source_type = 'official_standard', 否则 'normal_user'。
// 目前空, 后续由运营手动填并发版。
const ADMIN_OPENIDS = [];

const MODEL_PANEL_HARDWARE = 'model_panel_hardware';
const UPLOAD_ROOT = 'cabinet-model-standard';

Page({
  data: {
    plans: [],
    confirmDelete: null,
    toast: '',
    exportSelectOpen: false,
    exportNameOpen: false,
    _selectedExportIds: [],
    costExportSelectOpen: false,
    costExportNameOpen: false,
    _costSelectedIds: [],
    statusBarHeight: 20,
    navBarHeight: 44,
    uploadModalVisible: false,
  },

  onLoad: function() {
    try {
      var sysInfo = wx.getWindowInfo();
      var menuBtn = wx.getMenuButtonBoundingClientRect();
      var statusBarHeight = sysInfo.statusBarHeight || 20;
      var navBarHeight = (menuBtn.top - statusBarHeight) * 2 + menuBtn.height;
      this.setData({ statusBarHeight: statusBarHeight, navBarHeight: navBarHeight });
    } catch (e) {
      this.setData({ statusBarHeight: 20, navBarHeight: 44 });
    }
  },

  onShow() {
    const app = getApp();
    // 先渲染内存里的（冷启动来自本地缓存；热切回来是云端最新）
    this.setData({ plans: app.globalData.designs || [] });
    // 异步拉云端覆盖；失败静默保留本地兜底
    app.refreshDesigns().then((designs) => {
      this.setData({ plans: designs || [] });
    }).catch((err) => {
      console.warn('[plan-list] refreshDesigns 失败:', err);
    });
  },

  onTapStart() {
    const app = getApp();
    if ((app.globalData.designs || []).length >= MAX_DESIGNS) {
      this.showToast('设计库已满30条，需删除部分设计后新建');
      return;
    }
    app.globalData.draftPlan = null;
    wx.navigateTo({ url: '/pages/space-setup/index' });
  },

  onOpenUploadModal() {
    this.setData({ uploadModalVisible: true });
  },

  onCancelUploadModal() {
    this.setData({ uploadModalVisible: false });
  },

  async onConfirmUploadModal(e) {
    const { file, category } = e.detail || {};
    if (!file || !file.name || !file.path) {
      wx.showToast({ title: '未选择文件', icon: 'none' });
      return;
    }
    // 1) 命名校验 → 子目录归类
    const subdir = glbMetadata.parseSubdir(file.name);
    if (!subdir) {
      wx.showModal({
        title: '文件名格式无效',
        content: '请使用形如 50A.glb / 100C.glb / Y110.glb / YG120.glb 的命名',
        showCancel: false,
      });
      return;
    }

    let uploadedFileID = '';
    wx.showLoading({ title: '上传中...', mask: true });
    try {
      // 2) 上传到 cabinet-model-standard/{subdir}/{name}
      const cloudPath = `${UPLOAD_ROOT}/${subdir}/${file.name}`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath: file.path });
      const fileID = up && up.fileID;
      if (!fileID) throw new Error('upload_no_fileID');
      uploadedFileID = fileID;

      // 3) 解析 GLB → 元数据 (懒初始化 scoped THREE + gltfLoader)
      const openid = await _getOpenid();
      const sourceType = ADMIN_OPENIDS.includes(openid)
        ? 'official_standard'
        : 'normal_user';
      const { THREE, gltfLoader } = await getGlbParseDeps(this);
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

      // 4) parse 后校验:overall_size 全 0 意味着 GLB 根节点无几何,兜底 unitToCm=1 后
      // 尺寸会失真。仍继续入库(便于运维追踪), 但先提示用户。
      if (!meta.overall_size ||
          (meta.overall_size.total_width === 0 &&
           meta.overall_size.total_height === 0 &&
           meta.overall_size.total_depth === 0)) {
        console.warn('[plan-list] overall_size all zero, GLB may have nested transforms');
        wx.hideLoading();
        const proceed = await new Promise((resolve) => {
          wx.showModal({
            title: 'GLB 解析尺寸为 0',
            content: '模型尺寸解析失败(可能 GLB 结构不标准)。仍继续入库供运维核对?',
            success: (res) => resolve(res.confirm),
            fail: () => resolve(false),
          });
        });
        if (!proceed) {
          // 用户取消入库, 但 COS 上文件已上传成功。留个日志给运维追踪孤儿。
          console.warn('[plan-list] GLB orphaned on COS after user declined:', uploadedFileID);
          this.setData({ uploadModalVisible: false });
          return;
        }
        wx.showLoading({ title: '写入数据库...', mask: true });
      }

      // 5) 写库
      const db = wx.cloud.database();
      await db.collection(MODEL_PANEL_HARDWARE).add({ data: meta });

      wx.hideLoading();
      this.setData({ uploadModalVisible: false });
      wx.showToast({ title: '上传成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('[plan-list] upload model failed', err);
      const baseMsg = (err && (err.errMsg || err.message)) || '未知错误';
      const content = uploadedFileID
        ? `文件已上传但入库失败:${baseMsg}\n\ncos_path: ${uploadedFileID}\n请联系运维处理孤儿文件或重试入库。`
        : baseMsg;
      wx.showModal({ title: '上传失败', content, showCancel: false });
    }
  },

  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();
    const plan = app.getDesignById(id);
    if (!plan) return;
    // 云端拉回的 plan 只带 previewFileID / wireframeFileID / photoFileID，
    // 先把三个本地路径字段（materials/cost/space-setup 页 wxml 直接绑的字段）补齐再跳。
    // 命中 imgCache 时全流程同步可完成 → 不显示 loading；真要下载才 loading。
    const navigate = () => {
      app.globalData.currentPlan = plan;
      wx.navigateTo({
        url: '/cabinet/pages/materials/index?from=list&id=' + id,
      });
    };
    const report = planImageCache.diagnosePlanImages([plan]);
    if (!report.ready) {
      // 真机排查用：哪个字段为什么 not ready 一目了然
      console.log('[plan-list] onTapItem loading, diagnosis:', report.details);
      wx.showLoading({ title: '加载中…', mask: true });
    }
    planImageCache.resolvePlanImages([plan]).then(() => {
      if (!report.ready) wx.hideLoading();
      navigate();
    });
  },

  onAskDelete(e) {
    const id = e.currentTarget.dataset.id;
    const app = getApp();
    const plan = app.getDesignById(id);
    if (!plan) return;
    this.setData({ confirmDelete: { id: plan._id || id, name: plan.name } });
  },

  onConfirmDeleteCancel() {
    this.setData({ confirmDelete: null });
  },

  onConfirmDeleteOk() {
    const id = this.data.confirmDelete && this.data.confirmDelete.id;
    if (!id) return;
    const app = getApp();
    app.deleteDesignById(id).then((res) => {
      if (res && res.success) {
        this.setData({
          plans: app.globalData.designs || [],
          confirmDelete: null,
        });
      } else {
        this.setData({ confirmDelete: null });
        wx.showToast({ title: '删除失败', icon: 'none' });
      }
    });
  },

  onTapExport() {
    if (!this.data.plans.length) return;
    this.setData({ exportSelectOpen: true });
  },

  onExportSelectCancel() {
    this.setData({ exportSelectOpen: false });
  },

  onExportSelectConfirm(e) {
    this.setData({
      exportSelectOpen: false,
      exportNameOpen: true,
      _selectedExportIds: e.detail.ids || [],
    });
  },

  onExportNameCancel() {
    this.setData({ exportNameOpen: false, _selectedExportIds: [] });
  },

  async onExportNameConfirm(e) {
    const fileName = filenameCleaner.cleanFileName(e.detail.value);
    const ids = this.data._selectedExportIds || [];
    this.setData({ exportNameOpen: false, _selectedExportIds: [] });
    if (!ids.length) return;

    const app = getApp();
    const plans = ids
      .map((id) => app.getDesignById(id))
      .filter(Boolean);

    wx.showLoading({ title: '正在生成 PDF…', mask: true });
    try {
      await planImageCache.resolvePlanImages(plans);
      const canvas = await getPdfCanvas(this);
      const filePath = await pdfExporter.exportPlans({ canvas, plans, fileName });
      wx.hideLoading();
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        fail: (err) => {
          wx.showModal({
            title: '预览失败',
            content: 'PDF 已生成在 ' + filePath + '\n错误: ' + (err && err.errMsg),
            showCancel: false,
          });
        },
      });
    } catch (err) {
      wx.hideLoading();
      console.error('exportPlans failed:', err);
      wx.showToast({ title: '生成失败', icon: 'none', duration: 3000 });
    }
  },

  onTapExportHardware() {
    const openPdf = (filePath) => {
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        fail: (err) => {
          wx.showModal({
            title: '预览失败',
            content: 'PDF 已下载到 ' + filePath + '\n错误: ' + (err && err.errMsg),
            showCancel: false,
          });
        },
      });
    };

    // 本地已有缓存：立即打开，不显示 loading；后台静默拉一次远端更新缓存
    const cachedPath = hardwarePdfCloud.getCachedPdfPath();
    if (cachedPath) {
      openPdf(cachedPath);
      hardwarePdfCloud.fetchHardwarePdf().catch((err) => {
        console.warn('[plan-list] background refresh hardware pdf failed:', err);
      });
      return;
    }

    // 无缓存：正常展示 loading + 下载
    wx.showLoading({ title: '正在下载文档…', mask: true });
    hardwarePdfCloud
      .fetchHardwarePdf({
        onProgress: (p) => wx.showLoading({ title: '正在下载 ' + p + '%', mask: true }),
      })
      .then((filePath) => {
        wx.hideLoading();
        openPdf(filePath);
      })
      .catch(() => {
        wx.hideLoading();
        wx.showModal({
          title: '下载失败',
          content: '请检查网络后重试',
          showCancel: false,
        });
      });
  },

  onTapExportCost() {
    if (!this.data.plans.length) return;
    this.setData({ costExportSelectOpen: true });
  },

  onCostExportSelectCancel() {
    this.setData({ costExportSelectOpen: false });
  },

  onCostExportSelectConfirm(e) {
    this.setData({
      costExportSelectOpen: false,
      costExportNameOpen: true,
      _costSelectedIds: e.detail.ids || [],
    });
  },

  onCostExportNameCancel() {
    this.setData({ costExportNameOpen: false, _costSelectedIds: [] });
  },

  async onCostExportNameConfirm(e) {
    const fileName = filenameCleaner.cleanFileName(e.detail.value);
    const ids = this.data._costSelectedIds || [];
    this.setData({ costExportNameOpen: false, _costSelectedIds: [] });
    if (!ids.length) return;

    const app = getApp();
    const plans = ids.map((id) => app.getDesignById(id)).filter(Boolean);

    wx.showLoading({ title: '正在生成 PDF…', mask: true });
    try {
      await planImageCache.resolvePlanImages(plans);
      const canvas = await getPdfCanvas(this);
      const filePath = await pdfExporter.exportPlansWithCost({ canvas, plans, fileName });
      wx.hideLoading();
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        fail: (err) => {
          wx.showModal({
            title: '预览失败',
            content: 'PDF 已生成在 ' + filePath + '\n错误: ' + (err && err.errMsg),
            showCancel: false,
          });
        },
      });
    } catch (err) {
      wx.hideLoading();
      console.error('exportPlansWithCost failed:', err);
      wx.showToast({ title: '生成失败', icon: 'none', duration: 3000 });
    }
  },

  showToast(msg) {
    this.setData({ toast: msg });
    setTimeout(() => this.setData({ toast: '' }), 2000);
  },
});
