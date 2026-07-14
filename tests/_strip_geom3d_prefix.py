#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""去掉 100D.glb 中所有 node/mesh 名字的 'Geom3D_' 前缀 (in-place)。

上游建模工具导出时给每个 mesh 都加了 'Geom3D_' 前缀,
下游 upload-processor + panel-dict 用 node_name 查中文/查公式,
带前缀会导致 100% miss。这里做 in-place 修正,备份 -> .glb.bak。

用法: python tests/_strip_geom3d_prefix.py
"""
import os
import shutil
import sys

from pygltflib import GLTF2

HERE = os.path.dirname(os.path.abspath(__file__))
GLB = os.path.join(HERE, "100D.glb")
BACKUP = GLB + ".bak"
PREFIX = "Geom3D_"


def strip(name):
    if not name:
        return name
    return name[len(PREFIX):] if name.startswith(PREFIX) else name


def main():
    if not os.path.exists(GLB):
        print(f"NOT FOUND: {GLB}")
        sys.exit(1)

    if not os.path.exists(BACKUP):
        shutil.copy2(GLB, BACKUP)
        print(f"备份 -> {BACKUP}")
    else:
        print(f"备份已存在: {BACKUP} (跳过覆盖)")

    gltf = GLTF2().load(GLB)

    node_changed = 0
    for n in gltf.nodes:
        if n.name and n.name.startswith(PREFIX):
            n.name = strip(n.name)
            node_changed += 1

    mesh_changed = 0
    for m in gltf.meshes:
        if m.name and m.name.startswith(PREFIX):
            m.name = strip(m.name)
            mesh_changed += 1

    gltf.save(GLB)
    print(f"改写完成: node={node_changed}, mesh={mesh_changed}")


if __name__ == "__main__":
    main()
