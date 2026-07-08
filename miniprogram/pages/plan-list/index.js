const pdfExporter = require('../../utils/pdf-exporter.js');
const hardwarePdfCloud = require('../../utils/hardware-pdf-cloud.js');
const filenameCleaner = require('../../utils/filename-cleaner.js');
const planImageCache = require('../../utils/plan-image-cache.js');

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

const MAX_DESIGNS = 30;

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
