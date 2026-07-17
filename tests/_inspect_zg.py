# 用 os.listdir 拿到系统正确编码的路径, 再传给 GLTF2.
import os
from pygltflib import GLTF2

DIR = r"D:\工程\柠檬塔\标准柜\glb模型上传解析及计算必须文档\su模型--标准板\cabinet-model"


def dump(fname):
    path = os.path.join(DIR, fname)
    g = GLTF2.load_binary(path)
    print(f"=== {fname} ===")
    prefixed = [n.name for n in g.nodes if n.name and n.name.startswith("Geom3D_")]
    print(f"节点总数={len(g.nodes)}  Geom3D_ 节点={len(prefixed)}")
    print("节点列表:")
    for i, n in enumerate(g.nodes):
        marker = " *" if n.name and n.name.startswith("Geom3D_") else ""
        mesh_ref = f"  mesh={n.mesh}" if n.mesh is not None else ""
        print(f"  [{i:2}] {n.name!r}{marker}{mesh_ref}")
    print()


files = sorted(os.listdir(DIR))
print("目录里 ZG 相关文件:", [f for f in files if "ZG" in f])
print()
for f in files:
    if "ZG-110-230G1" in f:
        dump(f)
