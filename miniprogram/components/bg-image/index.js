// components/bg-image/index.js
// 页面背景图组件。原本 <image src="/assets/bg/T3.jpg" ...>, T1/T2/T3 迁到云存储后
// 用本组件替代: 命中 img-cache 磁盘缓存则用本地路径 (最快), miss 时用 cloud fileID
// (WeChat <image> 原生支持 cloud://, 走内建缓存, 首屏不空白)。
//
// 用法:
//   <bg-image name="T3" bg-class="bg-image bg-image-light" />
//
// 外部通过 externalClasses 传 wxss class, 兼容原本地图片的 .bg-image / .bg-image-light 等类。

const bgCache = require('../../utils/bg-cache.js');

Component({
  externalClasses: ['bg-class'],
  properties: {
    name: { type: String, value: '' },   // 'T1' / 'T2' / 'T3'
  },
  data: {
    resolvedSrc: '',
  },
  observers: {
    'name': function (name) {
      if (name) this._resolve(name);
    },
  },
  lifetimes: {
    attached() {
      const name = this.data.name;
      if (name) this._resolve(name);
    },
  },
  methods: {
    _resolve(name) {
      // 先同步用 cloud fileID 兜底 (WeChat 内建缓存, 冷启动首屏不空白),
      // 再异步 resolve img-cache 本地路径覆盖 (磁盘 hit → 秒回, miss → 触发下载)。
      this.setData({ resolvedSrc: bgCache.fileIdOf(name) });
      require('../../utils/img-cache.js').resolve(bgCache.fileIdOf(name))
        .then((path) => {
          if (path) this.setData({ resolvedSrc: path });
        })
        .catch(() => { /* 保持 cloud fileID 兜底 */ });
    },
  },
});
