const cloud = require("wx-server-sdk");
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
  }
};
