// app.js
var assets = require('./utils/assets.js');

App({
  globalData: {
    env: '',
    userInfo: null,
    isLoggedIn: false,
    openid: '',       // 方案A登录：openid 即用户唯一身份，由云函数 login 返回
    phone: '',        // 保留字段兼容旧页面引用，当前方案不收集手机号
    email: '',        // 同上，保留兼容
    avatarFileID: '', // 用户头像（云存储 cloud:// fileID），可空
    nickName: '',     // 用户昵称，可空
    designs: [],      // 用户保存的设计列表，最多30条
    // 跨页传递草稿
    draftPlan: null,
    currentPlan: null,
    currentDesignPreview: '', // 最近一次"确认布局"生成的整体渲染图路径（cost 页优先使用）

    // 全局可配置项（来自云数据库 config 集合，启动时拉取一次）
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
      { id: 13, title: '全屋水路设备图', subtitle: '净水系统 · 走管参考图', type: 'image', imageUrl: 'cloud://cloud1-5gbuna7d27dafeba.636c-cloud1-5gbuna7d27dafeba-1417087823/downloads/全屋净水-水路设备图.png' },
      { id: 14, title: '搬家核对清单', subtitle: '从准备到入住 · 逐项核对零遗漏', type: 'move' },
      { id: 15, title: '新家物品清单', subtitle: '106项物品核对 · 采购与签收跟踪', type: 'checklist' }
    ]
  },

  onLaunch: function () {
    // 初始化云开发环境
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

    // 柜体 GLB 模型云存储同步：不 await，后台跑
    try {
      var modelSync = require('./utils/model-sync.js');
      modelSync.syncOnLaunch().catch(function (err) {
        console.warn('[model-sync] launch sync failed:', err);
      });
    } catch (e) {
      console.warn('[model-sync] init failed:', e);
    }

    // 成本模块 3 字典 (价格/板件中英/glb元数据) 启动预拉:不 await, 后台跑;
    // 成本页会再校验字典状态, 缺则 toast + "——" 降级 (Task 9 处理)。
    // text_desc UI 文案字典同样 fire-and-forget, 供 option-scroll-card 组件使用。
    try {
      var bootstrap = require('./utils/bootstrap.js');
      bootstrap.ensureCostDataReady().catch(function (err) {
        console.warn('[bootstrap] ensureCostDataReady failed:', err);
      });
      bootstrap.ensureUiDescReady().catch(function (err) {
        console.warn('[bootstrap] ensureUiDescReady failed:', err);
      });
    } catch (e) {
      console.warn('[bootstrap] init failed:', e);
    }

    // 读取本地缓存的用户信息（老用户刷新小程序后仍能立即渲染账号卡）
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

    // 从本地缓存恢复设计列表（校验 openid 一致，否则丢弃防串号）
    try {
      var cache = wx.getStorageSync('DESIGNS_CACHE');
      if (cache && cache.data && Array.isArray(cache.data)) {
        if (!cache.openid || cache.openid === this.globalData.openid) {
          this.globalData.designs = cache.data;
        } else {
          wx.removeStorageSync('DESIGNS_CACHE');
        }
      }
    } catch (e) {
      console.warn('[cache] restore DESIGNS_CACHE failed:', e && e.errMsg);
    }

    // 一次性清理旧键（v1 本地方案库）
    try {
      if (wx.getStorageSync('PLAN_LIST')) {
        wx.removeStorageSync('PLAN_LIST');
        console.log('[migrate] cleaned legacy PLAN_LIST');
      }
    } catch (e) { /* ignore */ }

    // 启动时静默拉取 openid → 拉取用户资料 → 刷新设计列表
    var self = this;
    this.ensureLogin().then(function () {
      self.loadUserProfile();          // 云端拉取头像昵称
      self.loadAppConfig();            // 云端拉取全局可配置项（网盘链接等）
      return self.refreshDesigns();    // 云端拉取设计列表
    }).catch(function () {
      // 拿不到 openid 也尝试刷新一次（离线/网络问题下页面仍能渲染空态）
      self.loadAppConfig();
      self.refreshDesigns();
    });

    // 加载 HarmonyOS Sans SC 字体（Thin / Regular / Black 三个字重）
    this._loadHarmonyFonts();
  },

  /**
   * 确保已拿到 openid - 返回 Promise<openid>
   * 方案A核心：唯一登录动作 = 调 login 云函数拿 openid
   * - 内存已有：直接 resolve
   * - 内存没有：去云函数拿，并写入 globalData + 本地缓存
   * - 并发场景：多个页面同时调用只会触发一次真实云函数请求
   */
  ensureLogin: function () {
    var self = this;
    if (self.globalData.openid) {
      return Promise.resolve(self.globalData.openid);
    }
    if (self._loginPromise) {
      return self._loginPromise;
    }
    if (!wx.cloud) {
      return Promise.reject(new Error('wx.cloud 未初始化'));
    }
    self._loginPromise = wx.cloud.callFunction({ name: 'login' })
      .then(function (res) {
        var openid = res && res.result && res.result.openid;
        if (!openid) {
          throw new Error('login 云函数未返回 openid');
        }
        self.globalData.openid = openid;
        self.globalData.isLoggedIn = true;
        // 合并到 userInfo 缓存；若本地原无 userInfo 也建一个最小对象
        var merged = Object.assign({}, self.globalData.userInfo || {}, {
          openid: openid,
          loginTime: new Date().toISOString()
        });
        self.globalData.userInfo = merged;
        wx.setStorageSync('userInfo', merged);
        return openid;
      })
      .catch(function (err) {
        console.error('[login] 获取 openid 失败:', err);
        self._loginPromise = null; // 失败后允许下次重试
        throw err;
      });
    return self._loginPromise;
  },

  /**
   * 从云数据库 users 集合拉取当前用户资料（头像 / 昵称）
   * 查询按 _openid 自动隔离；无记录是正常情况（未完善资料）
   * @returns {Promise<{avatarFileID:string, nickName:string} | null>}
   */
  loadUserProfile: function () {
    var self = this;
    if (!wx.cloud) return Promise.resolve(null);
    var db = wx.cloud.database();
    return db.collection('users').limit(1).get().then(function (res) {
      var doc = (res.data || [])[0];
      if (!doc) return null;
      self.globalData.avatarFileID = doc.avatarFileID || '';
      self.globalData.nickName = doc.nickName || '';
      // 同步写回本地缓存
      var merged = Object.assign({}, self.globalData.userInfo || {}, {
        avatarFileID: self.globalData.avatarFileID,
        nickName: self.globalData.nickName
      });
      self.globalData.userInfo = merged;
      wx.setStorageSync('userInfo', merged);
      return { avatarFileID: self.globalData.avatarFileID, nickName: self.globalData.nickName };
    }).catch(function (err) {
      // 集合不存在或权限问题：不阻塞流程
      console.warn('[cloud] 拉取 users 资料失败（集合未建也会走这里）:', err);
      return null;
    });
  },

  /**
   * 从云数据库 config 集合拉取全局可配置项（如网盘下载链接）
   *
   * 集合：config（权限须设为"所有用户可读，仅创建者可读写"）
   * 文档：唯一一条，建议 _id = "app"，字段含 downloadUrl 等
   *
   * 失败（集合不存在 / 权限不足 / 网络异常）时静默回退到 globalData.appConfig 默认值，
   * 不阻塞任何业务流程。
   */
  loadAppConfig: function () {
    var self = this;
    if (!wx.cloud) return Promise.resolve(null);
    var db = wx.cloud.database();
    return db.collection('config').limit(1).get().then(function (res) {
      var doc = (res.data || [])[0];
      if (!doc) return null;
      // 合并到 globalData.appConfig，未在云端配置的字段保留默认值
      var merged = Object.assign({}, self.globalData.appConfig || {});
      if (doc.downloadUrl) merged.downloadUrl = doc.downloadUrl;
      self.globalData.appConfig = merged;
      return merged;
    }).catch(function (err) {
      console.warn('[cloud] 拉取 config 失败（集合未建/权限/网络）:', err && err.errMsg);
      return null;
    });
  },

  /**
   * 保存/更新用户资料（头像 fileID + 昵称）到云数据库 users 集合
   * 每个 openid 只保留一条记录（存在则更新，不存在则新增）
   * @param {{avatarFileID?:string, nickName?:string}} patch
   * @returns {Promise<{success:boolean, msg?:string}>}
   */
  saveUserProfile: function (patch) {
    var self = this;
    if (!wx.cloud) return Promise.resolve({ success: false, msg: '云开发未初始化' });
    return self.ensureLogin().then(function () {
      var db = wx.cloud.database();
      return db.collection('users').limit(1).get().then(function (res) {
        var existing = (res.data || [])[0];
        var now = db.serverDate();
        if (existing) {
          return db.collection('users').doc(existing._id).update({
            data: Object.assign({}, patch, { updateTime: now })
          });
        } else {
          return db.collection('users').add({
            data: Object.assign({
              avatarFileID: '',
              nickName: ''
            }, patch, { createTime: now, updateTime: now })
          });
        }
      });
    }).then(function () {
      // 成功后同步内存 + 本地缓存
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
      return { success: true };
    }).catch(function (err) {
      console.error('[cloud] 保存用户资料失败:', err);
      return { success: false, msg: (err && err.errMsg) || '保存失败' };
    });
  },

  /**
   * 加载 HarmonyOS Sans SC 字体（全局生效）
   */
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
  },

  // 保存/合并用户信息到本地（不覆盖已有 openid / 头像 / 昵称）
  saveUserInfo: function (info) {
    var merged = Object.assign({}, this.globalData.userInfo || {}, info || {});
    this.globalData.userInfo = merged;
    this.globalData.isLoggedIn = true;
    this.globalData.openid = merged.openid || this.globalData.openid || '';
    this.globalData.phone = merged.phone || '';
    this.globalData.email = merged.email || '';
    this.globalData.avatarFileID = merged.avatarFileID || this.globalData.avatarFileID || '';
    this.globalData.nickName = merged.nickName || this.globalData.nickName || '';
    wx.setStorageSync('userInfo', merged);
  },

  // ===================== 云数据库：设计方案 =====================

  /**
   * 把 designs 数据回填到 storage.DESIGNS_CACHE（保留 openid 防串号）
   */
  _writeDesignsCache: function () {
    try {
      wx.setStorageSync('DESIGNS_CACHE', {
        savedAt: Date.now(),
        openid: this.globalData.openid || '',
        data: this.globalData.designs || [],
      });
    } catch (e) {
      console.warn('[cache] write DESIGNS_CACHE failed:', e && e.errMsg);
    }
  },

  /**
   * 从云端拉取当前用户的设计列表（按 createTime 倒序）
   * 结果同步到 globalData.designs + 本地缓存
   * @returns {Promise<Array>}
   */
  refreshDesigns: function () {
    var self = this;
    if (!wx.cloud) {
      return Promise.resolve(self.globalData.designs || []);
    }
    // 云开发的数据库权限为"仅创建者可读写"，查询会自动按 _openid 过滤
    return self.ensureLogin().catch(function () {
      return null; // 拿不到 openid 也允许查询
    }).then(function () {
      var db = wx.cloud.database();
      return db.collection('designs')
        .orderBy('createTime', 'desc')
        .limit(30)
        .get();
    }).then(function (res) {
      self.globalData.designs = res.data || [];
      self._writeDesignsCache();
      return self.globalData.designs;
    }).catch(function (err) {
      console.warn('[cloud] 拉取设计列表失败:', err && err.errMsg);
      // 保持内存中的本地缓存值，不覆盖为空
      return self.globalData.designs || [];
    });
  },

  /**
   * 保存/更新设计方案到云端
   *   - 传入的 design 已有 _id → doc(_id).update
   *   - 无 _id → collection.add（并回填 _id 到内存条目）
   * 内存 & DESIGNS_CACHE 同步更新。
   * @param {object} design
   * @returns {Promise<{success:boolean, _id?:string, msg?:string}>}
   */
  saveDesign: function (design) {
    var self = this;
    if (!wx.cloud) {
      return Promise.resolve({ success: false, msg: '云开发未初始化' });
    }
    var db = wx.cloud.database();
    // 拆出内存/云端两份：云端 doc 不带临时 wxfile 路径
    var LOCAL_ONLY = ['previewImage', 'wireframeImage', 'photoPath'];

    if (design._id) {
      // update：只更新 design 里明确带的字段（不覆盖为 undefined）
      var patch = {};
      Object.keys(design).forEach(function (k) {
        if (k === '_id' || k === '_openid' || k === 'createTime') return;
        if (LOCAL_ONLY.indexOf(k) >= 0) return;
        patch[k] = design[k];
      });
      patch.updateTime = db.serverDate();
      return db.collection('designs').doc(design._id).update({ data: patch }).then(function () {
        var list = self.globalData.designs || [];
        for (var i = 0; i < list.length; i++) {
          if (list[i]._id === design._id) {
            list[i] = Object.assign({}, list[i], design, { updateTime: new Date() });
            break;
          }
        }
        self.globalData.designs = list;
        self._writeDesignsCache();
        return { success: true, _id: design._id };
      }).catch(function (err) {
        console.error('[cloud] 更新设计失败:', err);
        return { success: false, msg: '保存失败，请检查网络' };
      });
    }

    // add：先检查条数上限
    if ((self.globalData.designs || []).length >= 30) {
      return Promise.resolve({ success: false, msg: '设计库已满30条，需删除部分设计后新建' });
    }
    var doc = {};
    Object.keys(design).forEach(function (k) {
      if (LOCAL_ONLY.indexOf(k) >= 0) return;
      doc[k] = design[k];
    });
    doc.createTime = db.serverDate();
    doc.updateTime = db.serverDate();
    return db.collection('designs').add({ data: doc }).then(function (res) {
      var memDoc = Object.assign({}, design, {
        _id: res._id,
        createTime: new Date(),
        updateTime: new Date(),
      });
      self.globalData.designs = [memDoc].concat(self.globalData.designs || []);
      self._writeDesignsCache();
      return { success: true, _id: res._id };
    }).catch(function (err) {
      console.error('[cloud] 保存设计失败:', err);
      return { success: false, msg: '保存失败，请检查网络' };
    });
  },

  /**
   * 根据 _id 删除云端设计方案，同时清理云存储 3 张图和本地图片缓存。
   * @param {string} id
   * @returns {Promise<{success:boolean}>}
   */
  deleteDesignById: function (id) {
    var self = this;
    if (!wx.cloud || !id) {
      return Promise.resolve({ success: false });
    }
    var db = wx.cloud.database();
    var target = (self.globalData.designs || []).filter(function (d) {
      return d._id === id;
    })[0];

    var fileIDs = [];
    if (target) {
      if (target.previewFileID) fileIDs.push(target.previewFileID);
      if (target.wireframeFileID) fileIDs.push(target.wireframeFileID);
      if (target.photoFileID) fileIDs.push(target.photoFileID);
    }

    var cleanupFile = fileIDs.length
      ? wx.cloud.deleteFile({ fileList: fileIDs }).catch(function (err) {
          console.warn('[cloud] 删除设计图失败:', err);
        })
      : Promise.resolve();

    return cleanupFile.then(function () {
      return db.collection('designs').doc(id).remove();
    }).then(function () {
      self.globalData.designs = (self.globalData.designs || []).filter(function (d) {
        return d._id !== id;
      });
      self._writeDesignsCache();
      // 清本地图片缓存
      try {
        var imgCache = require('./utils/img-cache.js');
        fileIDs.forEach(function (f) { imgCache.remove(f); });
      } catch (e) { /* ignore */ }
      return { success: true };
    }).catch(function (err) {
      console.error('[cloud] 删除设计失败:', err);
      return { success: false };
    });
  },

  /**
   * 根据 id 或 _id 从内存缓存获取 design
   */
  getDesignById: function (id) {
    var list = this.globalData.designs || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i]._id === id || list[i].id === id) return list[i];
    }
    return null;
  },
});
