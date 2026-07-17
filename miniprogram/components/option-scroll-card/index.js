// components/option-scroll-card/index.js
// 横向自由滑动的选项卡片列表。每张卡片 = 顶部左图 + 右文 + 底部选项名, 横滑时整卡移动。
// 消费方: 空间设置页的转角选择, materials 页的板材品牌/门板材质/门板工艺。
//
// 图片: 每个选项 imageBase/{id}.png fileID → img-cache.resolve → 本地路径; 失败 fallback desc.png。
// 文字: text-desc-dict.getDesc(id) 同步查缓存; 缓存未就绪则挂一次 setTimeout 补文本。

const imgCache = require('../../utils/img-cache.js');
const textDescDict = require('../../utils/text-desc-dict.js');

const DEFAULT_IMAGE_BASE = 'cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/option-images';
const DEFAULT_FALLBACK = 'desc.png';

Component({
  properties: {
    options: { type: Array, value: [] },
    selectedId: { type: String, value: '' },
    imageBase: { type: String, value: DEFAULT_IMAGE_BASE },
    fallbackImageId: { type: String, value: DEFAULT_FALLBACK },
    showDesc: { type: Boolean, value: true },
  },
  data: {
    // options 的富化版本: 每项额外挂 { imagePath, descText }, 供 wxml 直接渲染。
    // 与原始 options 分离, 避免污染父页面传下来的常量数组。
    displayOptions: [],
    // 自定义横向滑动条状态 (参照 cabinet/pages/design 的 .scroll-indicator)
    scrollNeeded: false,   // 选项数 > 2 (内容超出可视宽度) 才显示
    thumbWidthPct: 100,    // thumb 宽度 = 可视宽 / 内容宽 (2/n)
    thumbLeftPct: 0,       // thumb 距左端百分比 (由 bindscroll 反馈驱动)
  },
  observers: {
    // options / imageBase / fallback 变化都要重新构建 displayOptions
    'options, imageBase, fallbackImageId': function (opts) {
      this._rebuildDisplayOptions();
      // 顺便算滑动条: 每屏可视 2 个, 超过 2 才需要滑
      const n = (opts || []).length;
      if (n > 2) {
        this.setData({
          scrollNeeded: true,
          thumbWidthPct: (2 / n) * 100,
          thumbLeftPct: 0,
        });
      } else {
        this.setData({ scrollNeeded: false, thumbWidthPct: 100, thumbLeftPct: 0 });
      }
    },
  },
  lifetimes: {
    attached() {
      this._rebuildDisplayOptions();
      // 冷启动首次进页 text-desc-dict preload 可能还没完成; 挂一次补偿, 300ms 内基本就绪
      if (!textDescDict.isReady()) {
        setTimeout(() => {
          if (this._detached) return;
          this._rebuildDisplayOptions();
        }, 300);
      }
    },
    detached() {
      this._detached = true;
    },
  },
  methods: {
    onPick(e) {
      const id = e.currentTarget.dataset.id;
      if (!id || id === this.data.selectedId) return;
      this.triggerEvent('change', { id });
      // 不本地 setData({selectedId}): 由父页面控制 (单向数据源, 与现有 materials 页 pattern 对齐)
    },

    // 按当前 options 构建 displayOptions: 每项挂 descText (同步) + imagePath (异步 img-cache)。
    // buildSeq 防串: 快速切 options 时旧 batch 的图片 resolve 不应覆盖新 batch。
    _rebuildDisplayOptions() {
      const opts = this.data.options || [];
      const base = this.data.imageBase || DEFAULT_IMAGE_BASE;
      const fallback = this.data.fallbackImageId || DEFAULT_FALLBACK;
      this._buildSeq = (this._buildSeq || 0) + 1;
      const mySeq = this._buildSeq;

      // 先同步铺一遍文字 + 空图, 立即渲染出结构; 图片链路异步补
      const initial = opts.map((o) => ({
        id: o.id,
        name: o.name,
        desc: o.desc || '',
        descText: textDescDict.getDesc(o.id),
        imagePath: '',
      }));
      this.setData({ displayOptions: initial });

      if (!this.data.showDesc) return;

      opts.forEach((o, idx) => {
        const primaryID = base + '/' + o.id + '.png';
        const fallbackID = base + '/' + fallback;
        const applyImg = (path) => {
          if (this._detached) return;
          if (mySeq !== this._buildSeq) return;   // options 已换, 这条 resolve 作废
          // 只 setData 变化的那一项路径, 避免全量 rerender
          const key = 'displayOptions[' + idx + '].imagePath';
          this.setData({ [key]: path || '' });
        };
        imgCache.resolve(primaryID)
          .then(applyImg)
          .catch(() => {
            imgCache.resolve(fallbackID).then(applyImg).catch(() => applyImg(''));
          });
      });
    },

    // scroll-view 横滑回调: 把 scrollLeft 归一化到 thumb 的 left 百分比。
    // 参照 cabinet/pages/design/index.js#onPickerScroll 但简化 —— 不允许用户拖 thumb, thumb 只反显。
    onListScroll(e) {
      if (!this.data.scrollNeeded) return;
      const { scrollLeft, scrollWidth } = e.detail;
      const visibleRatio = this.data.thumbWidthPct / 100;
      const visibleWidth = scrollWidth * visibleRatio;
      const maxScroll = Math.max(scrollWidth - visibleWidth, 1);
      const progress = Math.min(1, Math.max(0, scrollLeft / maxScroll));
      const range = 100 - this.data.thumbWidthPct;
      this.setData({ thumbLeftPct: progress * range });
    },
  },
});
