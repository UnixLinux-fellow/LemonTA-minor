// app.js
var assets = require('./utils/assets.js');

App({
  globalData: {
    env: '',
    userInfo: null,
    isLoggedIn: false,
    openid: '',
    phone: '',
    email: '',
    avatarFileID: '',
    nickName: '',
    designs: [],
    // 跨页传递草稿
    draftPlan: null,
    currentPlan: null,
    currentDesignPreview: '',

    // 全局可配置项（当前 Mock：不从云端拉，直接用默认值）
    appConfig: {
      downloadUrl: 'https://pan.baidu.com/s/14hTB_JKE53ABqnxqLSmKGQ?pwd=45q3'
    },

    tutorials: [
      {
        id: 1,
        title: '设计指南',
        bgImage: assets.bg('T1'),
        sections: [
          { title: '1  新建设计，输入墙面的 长度 / 高度\n输入是否有 左/右/双侧转角柜', content: '', gif: '' },
          { title: '2  点击 🍋 选择对应位置的 衣柜布局\n点击已放置柜子 可更换布局配置', content: '', gif: '' },
          { title: '3  全部摆放完毕后点击 确认布局\n点击 确认 以 保存设计', content: '', gif: '' },
          { title: '4  在已保存设计中更换配置/加工需求\n点击确认，可查看 成本透视表\n点击 一键下载，获得 全套图纸+配件表', content: '', gif: '' }
        ]
      },
      {
        id: 2,
        title: '知识库指南',
        bgImage: assets.bg('T2'),
        sections: [
          { title: '1  知识库以 标签 进行内容分类，\n选择对应标签，点击打开 对应内容', content: '', gif: '' },
          { title: '2  即可 在线查看\n后缀带有【下载】的条目，含可下载模\n型与成本、拆单文件或合同模板', content: '', gif: '' }
        ]
      }
    ],

    knowledgeList: [
      { id: 0, title: '柠檬塔快速预算', subtitle: '输入面积，一键测算全屋成本', type: 'budget' },
      { id: 10, title: '柠檬塔需求匹配表', subtitle: '场景化需求梳理 · 精准落地', type: 'needs' },
      { id: 12, title: '快速验收', subtitle: '清单式验收 · 零遗漏', type: 'inspect' },
      { id: 13, title: '全屋水路设备图', subtitle: '净水系统 · 走管参考图', type: 'image', imageUrl: 'cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/downloads/全屋净水-水路设备图.png' }
    ]
  },

  onLaunch: function () {
    // 初始化云开发（失败静默：本项目无 login 云函数，只是让 wx.cloud 有个 env）
    try {
      if (wx.cloud) {
        wx.cloud.init({
          env: 'cloud1-5gbuna7d27dafeba',
          traceUser: true
        });
      }
    } catch (e) {
      console.warn('[cloud] init failed:', e && e.errMsg);
    }

    // 读取本地缓存的用户信息（首次为空 —— profile 显示"未登录"外壳）
    var userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.globalData.isLoggedIn = !!userInfo.openid;
      this.globalData.openid = userInfo.openid || '';
      this.globalData.phone = userInfo.phone || '';
      this.globalData.email = userInfo.email || '';
      this.globalData.avatarFileID = userInfo.avatarFileID || '';
      this.globalData.nickName = userInfo.nickName || '';
    }

    this._loadHarmonyFonts();
  },

  // ===== Mock 云方法（保留原签名与 Promise 返回类型）=====

  ensureLogin: function () {
    // 无云函数 login，直接返回空 openid → profile 保持未登录外壳
    return Promise.resolve(this.globalData.openid || '');
  },

  loadUserProfile: function () {
    return Promise.resolve(null);
  },

  loadAppConfig: function () {
    return Promise.resolve(null);
  },

  saveUserProfile: function (patch) {
    // 只写本地：同步 globalData + storage
    var self = this;
    if (typeof patch.avatarFileID === 'string') {
      self.globalData.avatarFileID = patch.avatarFileID;
    }
    if (typeof patch.nickName === 'string') {
      self.globalData.nickName = patch.nickName;
    }
    var merged = Object.assign({}, self.globalData.userInfo || {}, {
      avatarFileID: self.globalData.avatarFileID,
      nickName: self.globalData.nickName
    });
    self.globalData.userInfo = merged;
    wx.setStorageSync('userInfo', merged);
    return Promise.resolve({ success: true });
  },

  saveUserInfo: function (info) {
    var merged = Object.assign({}, this.globalData.userInfo || {}, info || {});
    this.globalData.userInfo = merged;
    this.globalData.isLoggedIn = !!merged.openid;
    this.globalData.openid = merged.openid || this.globalData.openid || '';
    this.globalData.phone = merged.phone || '';
    this.globalData.email = merged.email || '';
    this.globalData.avatarFileID = merged.avatarFileID || this.globalData.avatarFileID || '';
    this.globalData.nickName = merged.nickName || this.globalData.nickName || '';
    wx.setStorageSync('userInfo', merged);
  },

  refreshDesigns: function () {
    this.globalData.designs = [];
    return Promise.resolve([]);
  },

  saveDesign: function (design) {
    return Promise.resolve({ success: false, msg: '离线版暂不支持云端保存' });
  },

  deleteDesignById: function (id) {
    return Promise.resolve({ success: false });
  },

  getDesignById: function (id) {
    var list = this.globalData.designs || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i]._id === id) return list[i];
    }
    return null;
  },

  // ===== 字体加载（拷源实现）=====

  _loadHarmonyFonts: function () {
    if (!wx.loadFontFace) return;
    var fm = wx.getFileSystemManager();
    var USER = wx.env.USER_DATA_PATH;
    var tasks = [
      { weight: '100', pkgPath: '/assets/fonts/HarmonyOS_Sans_SC_Thin.ttf',  dst: USER + '/HarmonyOS_Sans_SC_Thin.ttf' },
      { weight: '900', pkgPath: '/assets/fonts/HarmonyOS_Sans_SC_Black.ttf', dst: USER + '/HarmonyOS_Sans_SC_Black.ttf' }
    ];
    tasks.forEach(function (t) {
      var registerFromWxfile = function () {
        wx.loadFontFace({
          global: true,
          scopes: ['webview', 'native'],
          family: 'HarmonyOS Sans SC',
          source: 'url("' + t.dst + '")',
          desc: { style: 'normal', weight: t.weight },
          success: function () { /* loaded */ },
          fail: function (err) {
            console.warn('[font] loadFontFace(' + t.weight + ') fail:', err && err.errMsg);
          }
        });
      };
      try {
        fm.accessSync(t.dst);
        registerFromWxfile();
      } catch (e) {
        fm.copyFile({
          srcPath: t.pkgPath,
          destPath: t.dst,
          success: registerFromWxfile,
          fail: function (err) {
            console.warn('[font] copyFile(' + t.weight + ') fail:', err && err.errMsg);
          }
        });
      }
    });
  }
});
