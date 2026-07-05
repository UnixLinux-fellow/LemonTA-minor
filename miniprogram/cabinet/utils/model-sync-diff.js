// 纯 diff 函数：对比 local 与 remote manifest 数组，产出 added/updated/removed/kept，
// 以及基于 diff 与当前时间戳构造下一版 manifest。不依赖任何 wx / node fs API。
// 供 Node 单测与 wx 运行时共用。

// 唯一 key = `${subdir}/${name}`
function key(entry) {
  return entry.subdir + '/' + entry.name;
}

// 输入：
//   local  - 上一次持久化到 manifest.json 的 models 数组（可能带 downloaded/downloadedAt/pending）
//   remote - 云函数 listCabinetModels 返回的清单（只含 subdir/name/fileID/md5/size）
// 输出：{ added, updated, removed, kept }
//   added   - remote 有本地无：新柜型
//   updated - remote 与 local 同 key 但 md5 不同：内容变更；条目保留旧 md5/fileID/downloaded/downloadedAt
//             并挂 pending: { md5, fileID }
//   removed - local 有 remote 无：需要删除本地文件与 manifest 条目
//   kept    - md5 相同：完全保留旧条目
function diff(local, remote) {
  const localMap = {};
  local.forEach((m) => { localMap[key(m)] = m; });
  const remoteMap = {};
  remote.forEach((m) => { remoteMap[key(m)] = m; });

  const added = [];
  const updated = [];
  const kept = [];
  const removed = [];

  remote.forEach((r) => {
    const l = localMap[key(r)];
    if (!l) {
      added.push({
        subdir: r.subdir,
        name: r.name,
        fileID: r.fileID,
        md5: r.md5,
        size: r.size,
        downloaded: false,
        downloadedAt: 0,
        pending: null,
      });
    } else if (l.md5 !== r.md5) {
      updated.push({
        subdir: l.subdir,
        name: l.name,
        fileID: l.fileID,
        md5: l.md5,
        size: l.size,
        downloaded: !!l.downloaded,
        downloadedAt: l.downloadedAt || 0,
        pending: { md5: r.md5, fileID: r.fileID, size: r.size },
      });
    } else {
      kept.push({
        subdir: l.subdir,
        name: l.name,
        fileID: l.fileID,
        md5: l.md5,
        size: l.size,
        downloaded: !!l.downloaded,
        downloadedAt: l.downloadedAt || 0,
        pending: l.pending || null,
      });
    }
  });

  local.forEach((l) => {
    if (!remoteMap[key(l)]) removed.push(l);
  });

  return { added, updated, kept, removed };
}

// 基于 diff 结果构造新 manifest（不含 removed 条目）。added/updated/kept 全量合并写入。
function buildManifest(diffResult, nowMs) {
  return {
    version: 1,
    syncedAt: nowMs,
    models: [].concat(diffResult.kept, diffResult.added, diffResult.updated),
  };
}

module.exports = { diff, buildManifest, key };
