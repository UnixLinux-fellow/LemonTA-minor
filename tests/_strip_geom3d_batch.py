#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""批量去掉指定目录下所有 .glb 文件的 node/mesh 名字 'Geom3D_' 前缀。

用法:
  # 预览(不写入):
  python tests/_strip_geom3d_batch.py --dry-run
  # 执行:
  python tests/_strip_geom3d_batch.py

默认目标目录 = D:\\工程\\柠檬塔\\标准柜\\glb模型上传解析及计算必须文档\\su模型--标准板\\cabinet-model
每个文件首次改动前会备份到 <name>.glb.bak (若备份已存在则跳过覆盖备份)。
"""
import argparse
import os
import shutil
import sys

from pygltflib import GLTF2

DEFAULT_DIR = r"D:\工程\柠檬塔\标准柜\glb模型上传解析及计算必须文档\su模型--标准板\cabinet-model"
PREFIX = "Geom3D_"


def strip(name):
    if not name:
        return name
    return name[len(PREFIX):] if name.startswith(PREFIX) else name


def process(glb_path, dry_run):
    gltf = GLTF2().load(glb_path)
    node_hits = sum(1 for n in gltf.nodes if n.name and n.name.startswith(PREFIX))
    mesh_hits = sum(1 for m in gltf.meshes if m.name and m.name.startswith(PREFIX))
    total = node_hits + mesh_hits
    if total == 0:
        return (0, 0, False)

    if dry_run:
        return (node_hits, mesh_hits, False)

    backup = glb_path + ".bak"
    if not os.path.exists(backup):
        shutil.copy2(glb_path, backup)
        backed_up = True
    else:
        backed_up = False

    for n in gltf.nodes:
        if n.name and n.name.startswith(PREFIX):
            n.name = strip(n.name)
    for m in gltf.meshes:
        if m.name and m.name.startswith(PREFIX):
            m.name = strip(m.name)

    gltf.save(glb_path)
    return (node_hits, mesh_hits, backed_up)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR, help="目标目录(含 .glb)")
    ap.add_argument("--dry-run", action="store_true", help="只统计, 不改文件")
    args = ap.parse_args()

    tgt = args.dir
    if not os.path.isdir(tgt):
        print(f"目录不存在: {tgt}")
        sys.exit(1)

    files = sorted(f for f in os.listdir(tgt) if f.lower().endswith(".glb"))
    if not files:
        print(f"目录里没有 .glb: {tgt}")
        sys.exit(0)

    mode = "[DRY-RUN]" if args.dry_run else "[EXECUTE]"
    print(f"{mode} 目录: {tgt}")
    print(f"{mode} 文件数: {len(files)}")
    print("-" * 76)

    total_files = 0
    total_nodes = 0
    total_meshes = 0
    total_backed = 0

    for fn in files:
        path = os.path.join(tgt, fn)
        try:
            n_hits, m_hits, backed_up = process(path, args.dry_run)
        except Exception as e:
            print(f"  {fn:<32}  ERROR: {e}")
            continue
        if n_hits + m_hits == 0:
            print(f"  {fn:<32}  (无 Geom3D_ 前缀, 跳过)")
        else:
            tag = "" if args.dry_run else (" [已备份]" if backed_up else " [备份已存在, 未再备份]")
            print(f"  {fn:<32}  node={n_hits} mesh={m_hits}{tag}")
            total_files += 1
            total_nodes += n_hits
            total_meshes += m_hits
            if backed_up:
                total_backed += 1

    print("-" * 76)
    print(f"{mode} 汇总: 涉及文件 {total_files} 个 | 节点改名 {total_nodes} | mesh 改名 {total_meshes} | 新增备份 {total_backed}")
    if args.dry_run:
        print("↑ 未做实际修改。去掉 --dry-run 即可写入。")


if __name__ == "__main__":
    main()
