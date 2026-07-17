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
  },
});
