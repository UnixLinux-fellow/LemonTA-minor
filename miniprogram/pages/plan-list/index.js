const planStore = require('../../utils/plan-store.js');
const cloud = require('../../utils/cloud.js');
const pdfExporter = require('../../utils/pdf-exporter.js');
const hardwarePdfCloud = require('../../utils/hardware-pdf-cloud.js');
const filenameCleaner = require('../../utils/filename-cleaner.js');

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

Page({
  data: {
    plans: [],
    confirmDelete: null,
    toast: '',
    exportSelectOpen: false,
    exportNameOpen: false,
    _selectedExportIds: [],
  },

  onShow() {
    const plans = planStore.list();
    this.setData({ plans });
    cloud.listPlans().then((res) => {
      if (res.ok && res.data && res.data.success) {
        // 简单合并：以本地为主
      }
    });
  },

  onTapStart() {
    if (planStore.isFull()) {
      this.showToast('设计库已满30条，需删除部分设计后新建');
      return;
    }
    getApp().globalData.draftPlan = null;
    wx.navigateTo({ url: '/pages/space-setup/index' });
  },

  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    const plan = planStore.get(id);
    if (!plan) return;
    getApp().globalData.currentPlan = plan;
    wx.navigateTo({
      url: '/cabinet/pages/materials/index?from=list&id=' + id,
    });
  },

  onAskDelete(e) {
    const id = e.currentTarget.dataset.id;
    const plan = planStore.get(id);
    if (!plan) return;
    this.setData({ confirmDelete: { id, name: plan.name } });
  },

  onConfirmDeleteCancel() {
    this.setData({ confirmDelete: null });
  },

  onConfirmDeleteOk() {
    const id = this.data.confirmDelete && this.data.confirmDelete.id;
    if (id) {
      planStore.remove(id);
      this.setData({
        plans: planStore.list(),
        confirmDelete: null,
      });
    }
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

    const plans = ids
      .map((id) => planStore.get(id))
      .filter(Boolean);

    wx.showLoading({ title: '正在生成 PDF…', mask: true });
    try {
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
    wx.showLoading({ title: '正在下载文档…', mask: true });
    hardwarePdfCloud
      .fetchHardwarePdf({
        onProgress: (p) => wx.showLoading({ title: '正在下载 ' + p + '%', mask: true }),
      })
      .then((filePath) => {
        wx.hideLoading();
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
      })
      .catch((err) => {
        wx.hideLoading();
        console.error('[plan-list] fetchHardwarePdf failed:', err);
        wx.showModal({
          title: '下载失败',
          content: '请检查网络后重试',
          showCancel: false,
        });
      });
  },

  showToast(msg) {
    this.setData({ toast: msg });
    setTimeout(() => this.setData({ toast: '' }), 2000);
  },
});
