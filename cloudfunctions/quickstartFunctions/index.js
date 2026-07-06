const cloud = require("wx-server-sdk");
const CloudBase = require("@cloudbase/manager-node");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const PLAN_COLLECTION = "lemonta_plans";
const MATERIALS_HISTORY = "lemonta_materials_history";

// 获取openid
const getOpenId = async () => {
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
};

// 获取小程序二维码
const getMiniProgramCode = async () => {
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 创建集合（保留原 quickstart 行为）
const createCollection = async () => {
  try {
    await db.createCollection("sales");
    await db.collection("sales").add({ data: { region: "华东", city: "上海", sales: 11 } });
    await db.collection("sales").add({ data: { region: "华东", city: "南京", sales: 11 } });
    await db.collection("sales").add({ data: { region: "华南", city: "广州", sales: 22 } });
    await db.collection("sales").add({ data: { region: "华南", city: "深圳", sales: 22 } });
    return { success: true };
  } catch (e) {
    return { success: true, data: "create collection success" };
  }
};

const selectRecord = async () => db.collection("sales").get();

const updateRecord = async (event) => {
  try {
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({ _id: event.data[i]._id })
        .update({ data: { sales: event.data[i].sales } });
    }
    return { success: true, data: event.data };
  } catch (e) {
    return { success: false, errMsg: e };
  }
};

const insertRecord = async (event) => {
  try {
    const r = event.data;
    await db.collection("sales").add({ data: { region: r.region, city: r.city, sales: Number(r.sales) } });
    return { success: true, data: event.data };
  } catch (e) {
    return { success: false, errMsg: e };
  }
};

const deleteRecord = async (event) => {
  try {
    await db.collection("sales").where({ _id: event.data._id }).remove();
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: e };
  }
};

// === LEMONTA 设计模块云函数 ===

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    // already exists
  }
}

const getModelInfo = async (event) => {
  // 本期占位实现：服务端无新模型，返回空增量。
  return { success: true, added: [], removed: [] };
};

const savePlan = async (event) => {
  await ensureCollection(PLAN_COLLECTION);
  const wxContext = cloud.getWXContext();
  const plan = event.plan || {};
  plan.openid = wxContext.OPENID;
  plan.updatedAt = Date.now();
  try {
    if (plan._id) {
      const _id = plan._id;
      const doc = Object.assign({}, plan);
      delete doc._id;
      delete doc._openid;
      await db.collection(PLAN_COLLECTION).doc(_id).update({ data: doc });
      return { success: true, _id };
    }
    const r = await db.collection(PLAN_COLLECTION).add({ data: plan });
    return { success: true, _id: r._id };
  } catch (e) {
    return { success: false, errMsg: String(e) };
  }
};

const saveMaterials = async (event) => {
  await ensureCollection(PLAN_COLLECTION);
  await ensureCollection(MATERIALS_HISTORY);
  const wxContext = cloud.getWXContext();
  const planId = event.planId;
  const materials = event.materials || {};
  try {
    if (planId) {
      await db
        .collection(PLAN_COLLECTION)
        .doc(planId)
        .update({ data: { materials, updatedAt: Date.now() } });
    }
    await db.collection(MATERIALS_HISTORY).add({
      data: {
        openid: wxContext.OPENID,
        planId,
        materials,
        createdAt: Date.now(),
      },
    });
    return { success: true };
  } catch (e) {
    return { success: false, errMsg: String(e) };
  }
};

const listPlans = async () => {
  await ensureCollection(PLAN_COLLECTION);
  const wxContext = cloud.getWXContext();
  try {
    const r = await db
      .collection(PLAN_COLLECTION)
      .where({ openid: wxContext.OPENID })
      .orderBy("updatedAt", "desc")
      .limit(30)
      .get();
    return { success: true, data: r.data };
  } catch (e) {
    return { success: false, errMsg: String(e), data: [] };
  }
};

const requestDownload = async (event) => {
  // 占位：业务后端整理 CAD/拆单/PDF + 上传百度网盘后回填。本期返回固定示例。
  return {
    success: true,
    link: "https://pan.baidu.com/s/lemonta-demo",
    code: "lmt8",
    message: "已复制，请5到10分钟后到百度网盘App复制下载",
  };
};

// 列 cabinet-model/{50cm,100cm,zj}/ 下全部 glb，供小程序做本地缓存对账
// 注：单一 subdir 失败不阻塞其他 subdir；但如果全部失败，返回 success:false
// 让客户端走"本地兜底"分支，避免把 models=[] 当成"云上真的一个都没有"→ 误删全部本地缓存
// 假设：单个 subdir 内 glb 数量 << 单次 listDirectoryFiles 分页上限（当前 21 个，上限典型 1000），
// 未做分页处理。若未来需要，改为循环 marker/nextMarker。
const listCabinetModels = async () => {
  // wx-server-sdk 的 DYNAMIC_CURRENT_ENV 是 Symbol/占位符，只能给 CloudBase.init 用；
  // 用 getWXContext().ENV 拿字符串 envId。
  // fileID 必须是 `cloud://<envId>.<bucket>/<key>` —— 少了 bucket 段 getTempFileURL 会失败。
  // 通过 app.storage.cloudPathToFileId(key) 让 SDK 从当前 env 配置里读 Bucket 并拼装，避免手写 bucket。
  const envId = cloud.getWXContext().ENV;
  const app = CloudBase.init({ envId });
  const subdirs = ["50cm", "100cm", "zj"];
  const models = [];
  let anyOk = false;
  for (const subdir of subdirs) {
    let files = [];
    try {
      files = await app.storage.listDirectoryFiles(`cabinet-model/${subdir}/`);
      anyOk = true;
    } catch (e) {
      console.warn("[listCabinetModels] list fail", subdir, e && e.message);
      continue;
    }
    files.forEach((f) => {
      const key = f.Key || "";
      if (!/\.glb$/i.test(key)) return;
      const name = key.split("/").pop();
      models.push({
        subdir,
        name,
        fileID: app.storage.cloudPathToFileId(key),
        md5: String(f.ETag || "").replace(/^"|"$/g, ""),
        size: Number(f.Size) || 0,
      });
    });
  }
  if (!anyOk) {
    return { success: false, errMsg: "list all subdirs failed", models: [], serverTime: Date.now() };
  }
  return { success: true, models, serverTime: Date.now() };
};

exports.main = async (event, context) => {
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "createCollection":
      return await createCollection();
    case "selectRecord":
      return await selectRecord();
    case "updateRecord":
      return await updateRecord(event);
    case "insertRecord":
      return await insertRecord(event);
    case "deleteRecord":
      return await deleteRecord(event);
    case "getModelInfo":
      return await getModelInfo(event);
    case "savePlan":
      return await savePlan(event);
    case "saveMaterials":
      return await saveMaterials(event);
    case "listPlans":
      return await listPlans(event);
    case "requestDownload":
      return await requestDownload(event);
    case "listCabinetModels":
      return await listCabinetModels();
  }
};
