# 从 ZG-110-230G1.glb / YG-110-230G1.glb 的 mesh 拿到实际 w1_ 板件 XYZ 尺寸,
# 帮助推导 PANEL_FORMULAS。
import os
from pygltflib import GLTF2

DIR = r"D:\工程\柠檬塔\标准柜\glb模型上传解析及计算必须文档\su模型--标准板\cabinet-model"


def bbox_size(g, accessor_idx):
    a = g.accessors[accessor_idx]
    if a.min and a.max:
        return [abs(a.max[i] - a.min[i]) for i in range(3)]
    return None


def dims_by_node(g):
    """dict: node_name → [x, y, z]  (mesh accessor 的 POSITION min/max 差)"""
    out = {}
    for n in g.nodes:
        if n.mesh is None or not n.name:
            continue
        mesh = g.meshes[n.mesh]
        for prim in mesh.primitives:
            pos = prim.attributes.POSITION
            if pos is None:
                continue
            sz = bbox_size(g, pos)
            if sz is None:
                continue
            # 记录第一个 primitive 的尺寸
            out.setdefault(n.name, []).append(sz)
    return out


def dump(fname):
    g = GLTF2.load_binary(os.path.join(DIR, fname))
    dims = dims_by_node(g)
    print(f"=== {fname} ===")
    for name, sizes in dims.items():
        for s in sizes:
            print(f"  {name:<32}  {s[0]:>8.3f}  {s[1]:>8.3f}  {s[2]:>8.3f}")
    print()


for f in ["YG-110-230G1.glb", "ZG-110-230G1.glb", "100G1.glb"]:
    if os.path.exists(os.path.join(DIR, f)):
        dump(f)
