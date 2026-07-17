const costEngine = require('../../../utils/cost-engine.js');
const wireframeLabels = require('../../utils/wireframe-labels.js');
const imgCache = require('../../../utils/img-cache.js');
const bootstrap = require('../../../utils/bootstrap.js');
const pdfExporter = require('../../../utils/pdf-exporter.js');
const planImageCache = require('../../../utils/plan-image-cache.js');
const filenameCleaner = require('../../../utils/filename-cleaner.js');

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
    plan: null,
    from: 'design',
    cost: { modules: [], grandTotal: 0 },
    bottomRow: [],
    topRow: [],
    labelPositions: [],
    wireframeReady: false,
    detailOpen: false,
    currentDetail: null,
    floatToast: '',
    dataReady: true,
    dataNotice: '',
  },

  onLoad(query) {
    const from = query.from || 'design';
    const id = query.id;
    const app = getApp();
    // 优先内存 currentPlan；否则按 id 从 globalData.designs 找
    let plan = app.globalData.currentPlan;
    if ((!plan || plan.id !== id) && id) {
      plan = app.getDesignById(id) || plan;
    }
    if (!plan) {
      wx.navigateBack();
      return;
    }
    this._plan = plan;
    this._from = from;
    const cabinets = plan.cabinets || [];
    const bottomRow = cabinets.filter((c) => c.kind !== 'raise');
    const topRow = cabinets.filter((c) => c.kind === 'raise');
    // wireframeReady：图片本身已经烧了编号（且是当前版本）。true 时 wxml 里 DOM 编号
    // 不再叠画，避免"图 + DOM"两份橙字重合导致视觉重影。
    const wireframeReady = !!(plan.wireframeHasLabels
      && plan.wireframeLabelsVersion === wireframeLabels.WIREFRAME_LABELS_VERSION);
    this.setData({
      plan,
      from,
      bottomRow,
      topRow,
      labelPositions: wireframeLabels.computeLabelPositions(plan),
      wireframeReady,
    });
    this._maybeBakeWireframe();
    this._computeCost();
  },

  async _computeCost() {
    // 后台字典可能还没就绪; 保底再触发一次(有本地缓存立即返回, 无缓存则阻塞拉云)
    await bootstrap.ensureCostDataReady();
    const plan = this._plan;
    if (!bootstrap.isAllReady()) {
      this.setData({
        dataReady: false,
        dataNotice: '价格数据未就绪, 请重试',
        cost: { modules: [], grandTotal: '——' },
      });
      return;
    }
    const cost = costEngine.calc({
      cabinets: plan.cabinets || [],
      materials: plan.materials || {},
      wall: plan.wall,
    });
    this.setData({ dataReady: true, dataNotice: '', cost });
  },

  onRetryDataFetch() {
    this.setData({ dataNotice: '正在重试…' });
    bootstrap.ensureCostDataReady({ force: true }).then(() => this._computeCost());
  },

  _maybeBakeWireframe() {
    const plan = this.data.plan;
    if (!plan || !plan.wireframeImage) return;
    // 版本匹配才承认"已烘"。历史方案的 wireframeLabelsVersion 缺失 → 视作旧版本 → 重烧。
    // 参数变更（fov / dist 公式 / CAPTURE_ZOOM / 走 fov 或走 z）都会让存量图坐标与
    // DOM 覆盖坐标错位，出现"重影"。
    if (plan.wireframeHasLabels
        && plan.wireframeLabelsVersion === wireframeLabels.WIREFRAME_LABELS_VERSION) {
      return;
    }

    wx.createSelectorQuery().in(this)
      .select('#wf-canvas').fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const img = canvas.createImage();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0, img.width, img.height);

          const labels = wireframeLabels.computeLabelPositions(plan);
          const fontPx = Math.max(12, Math.round(img.width * 0.05));
          ctx.font = 'bold ' + fontPx + 'px sans-serif';
          ctx.fillStyle = '#EE822F';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          labels.forEach((label) => {
            const x = (label.left / 100) * img.width;
            const y = (label.top / 100) * img.height;
            ctx.fillText(String(label.idx), x, y);
          });

          wx.canvasToTempFilePath({
            canvas,
            fileType: 'png',
            success: (out) => {
              this._persistBakedWireframe(plan, out.tempFilePath);
            },
            fail: (err) => {
              console.warn('[cost] bake wireframe failed:', err && err.errMsg);
            },
          });
        };
        img.onerror = (err) => {
          console.warn('[cost] load wireframeImage failed:', err && err.errMsg);
        };
        img.src = plan.wireframeImage;
      });
  },

  /**
   * 烘完带编号的线框图后：上传新 fileID → 更新 designs 文档 → 清旧云文件与本地缓存
   */
  _persistBakedWireframe(plan, tempFilePath) {
    const app = getApp();
    const oldFileID = plan.wireframeFileID || '';

    const uploadStep = (wx.cloud && wx.cloud.uploadFile)
      ? wx.cloud.uploadFile({
          cloudPath: 'designs/' + plan.id + '_' + Date.now() + '_wire.png',
          filePath: tempFilePath,
        }).then((res) => (res && res.fileID) || '')
        .catch((err) => {
          console.warn('[cost] uploadFile wire 失败:', err && err.errMsg);
          return '';
        })
      : Promise.resolve('');

    uploadStep.then((newFileID) => {
      if (newFileID) {
        try { imgCache.register(newFileID, tempFilePath); } catch (e) { /* ignore */ }
      }
      const updated = Object.assign({}, plan, {
        wireframeImage: tempFilePath,
        wireframeHasLabels: true,
        wireframeLabelsVersion: wireframeLabels.WIREFRAME_LABELS_VERSION,
        wireframeFileID: newFileID || plan.wireframeFileID || '',
      });
      // wireframeReady=true → wxml 侧撤掉 DOM 编号，只保留图里烧的那一份
      this.setData({ plan: updated, wireframeReady: true });
      app.globalData.currentPlan = updated;

      // 更新云 doc（有 _id 才能 update）
      if (updated._id && newFileID) {
        app.saveDesign({
          _id: updated._id,
          wireframeFileID: newFileID,
          wireframeHasLabels: true,
          wireframeLabelsVersion: wireframeLabels.WIREFRAME_LABELS_VERSION,
        }).catch((err) => {
          console.warn('[cost] saveDesign 更新线框图 fileID 失败:', err);
        });
      }

      // 清旧云文件 + 本地缓存
      if (oldFileID && oldFileID !== newFileID && newFileID && wx.cloud && wx.cloud.deleteFile) {
        wx.cloud.deleteFile({ fileList: [oldFileID] }).catch((err) => {
          console.warn('[cost] 清旧线框图失败:', err);
        });
        try { imgCache.remove(oldFileID); } catch (e) { /* ignore */ }
      }
    });
  },

  openDetail(e) {
    const idx = e.currentTarget.dataset.idx;
    const m = this.data.cost.modules[idx];
    // 过滤数量/小计为 0 的明细行
    const filteredPanels = (m.detail.panels || []).filter((p) => p.qty > 0 && p.total > 0);
    const filteredHardware = (m.detail.hardware || []).filter((h) => h.qty > 0 && h.total > 0);
    const filtered = Object.assign({}, m, {
      detail: { panels: filteredPanels, hardware: filteredHardware },
    });
    this.setData({ detailOpen: true, currentDetail: filtered });
  },

  closeDetail() {
    this.setData({ detailOpen: false, currentDetail: null });
  },

  onChangeConfig() {
    const from = this.data.from || 'design';
    const id = (this.data.plan && this.data.plan.id) || '';
    wx.redirectTo({
      url: '/cabinet/pages/materials/index?from=' + from + '&id=' + id,
    });
  },

  // 一键下载：直接导出当前方案的"方案成本 PDF"（含成本透视），
  // 复用 plan-list 页的 exportPlansWithCost 流程。
  async onDownload() {
    const plan = this.data.plan;
    if (!plan) return;
    const fileName = filenameCleaner.cleanFileName(plan.name || '');

    wx.showLoading({ title: '正在生成 PDF…', mask: true });
    try {
      await planImageCache.resolvePlanImages([plan]);
      const canvas = await getPdfCanvas(this);
      const filePath = await pdfExporter.exportPlansWithCost({
        canvas,
        plans: [plan],
        fileName,
      });
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
      console.error('[cost] exportPlansWithCost failed:', err);
      wx.showToast({ title: '生成失败', icon: 'none', duration: 3000 });
    }
  },
});
