// components/option-scroll-card/index.js
// 横向自由滑动的选项条 + 下方图文说明区 (左图 200×200 + 右文)。
// 消费方: 空间设置页的转角选择, materials 页的板材品牌/门板材质/门板工艺。
//
// 图片: 拼 imageBase/{id}.png fileID → img-cache.resolve → 本地路径; 失败 fallback desc.png。
// 文字: text-desc-dict.getDesc(id) 同步查缓存, 缓存未就绪 → 挂 setTimeout 补一次。

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
    descImagePath: '',
    descText: '',
    // 自定义横向滑动条状态 (参照 cabinet/pages/design 的 .scroll-indicator)
    scrollNeeded: false,   // 选项数 > 2 (内容超出可视宽度) 才显示
    thumbWidthPct: 100,    // thumb 宽度 = 可视宽 / 内容宽 (首屏用 2/n 估算)
    thumbLeftPct: 0,       // thumb 距左端百分比 (由 bindscroll 反馈驱动)
  },
  observers: {
    // selectedId 变 或 imageBase/fallback 变 → 重刷图文;
    // selectedId 清空 (deselect) → 清掉说明区避免残留上次的图文
    'selectedId, imageBase, fallbackImageId': function (id) {
      if (id) {
        this._refreshDesc(id);
      } else {
        this.setData({ descText: '', descImagePath: '' });
      }
    },
    // options 变化 → 重算滑动条: 每屏可视 2 个, 超过 2 才需要滑
    'options': function (opts) {
      const n = (opts || []).length;
      if (n > 2) {
        this.setData({
          scrollNeeded: true,
          thumbWidthPct: (2 / n) * 100,   // 与 design 页 visibleCells/total 同构
          thumbLeftPct: 0,
        });
      } else {
        this.setData({ scrollNeeded: false, thumbWidthPct: 100, thumbLeftPct: 0 });
      }
    },
  },
  lifetimes: {
    attached() {
      const id = this.data.selectedId;
      if (!id) return;
      this._refreshDesc(id);
      // 冷启动首次进页 preload 可能还没完成; 挂一次补偿, 300ms 内基本就绪。
      if (!textDescDict.isReady()) {
        setTimeout(() => {
          if (this._detached) return;   // 组件已卸载, 不再 setData
          const cur = this.data.selectedId;
          if (cur) {
            this.setData({ descText: textDescDict.getDesc(cur) });
          }
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

    _refreshDesc(id) {
      // 同步先把文字更新掉 (miss → 空串)
      this.setData({ descText: textDescDict.getDesc(id) });

      if (!this.data.showDesc) return;

      const base = this.data.imageBase || DEFAULT_IMAGE_BASE;
      const fallback = this.data.fallbackImageId || DEFAULT_FALLBACK;
      const primaryID = base + '/' + id + '.png';
      const fallbackID = base + '/' + fallback;

      // requestSeq 防串: 快速点选时旧请求 resolve 后不应覆盖新请求结果。
      this._reqSeq = (this._reqSeq || 0) + 1;
      const mySeq = this._reqSeq;
      const setIfCurrent = (path) => {
        if (this._detached) return;           // 组件已卸载
        if (mySeq !== this._reqSeq) return;   // 已被后续点选覆盖
        this.setData({ descImagePath: path || '' });
      };

      imgCache.resolve(primaryID)
        .then(setIfCurrent)
        .catch(() => {
          imgCache.resolve(fallbackID)
            .then(setIfCurrent)
            .catch(() => setIfCurrent(''));
        });
    },

    // scroll-view 横滑回调: 把 scrollLeft 归一化到 thumb 的 left 百分比。
    // 参照 cabinet/pages/design/index.js#onPickerScroll 但简化 —— 不用户拖 thumb, thumb 只反显。
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
