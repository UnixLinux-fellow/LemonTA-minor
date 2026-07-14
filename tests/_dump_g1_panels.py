#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""解析 100G1.glb 和 50G1.glb 的板件, 打印到 tests/jg.txt。

对每块板件输出 node_name / length / width / thickness (cm) + 面积 (m²)。
长/宽/厚 = XYZ 排序后 max/mid/min; GLB 原生米, 板件 cm = 原始 AABB × 100。
"""
import os
import struct

import numpy as np
from pygltflib import GLTF2

SRC_DIR = r"D:\工程\柠檬塔\标准柜\glb模型上传解析及计算必须文档\su模型--标准板\cabinet-model"
FILES = ["100G1.glb", "50G1.glb"]

HERE = os.path.dirname(os.path.abspath(__file__))
DST_TXT = os.path.join(HERE, "jg.txt")


def load_glb_buffers(gltf, glb_path):
    with open(glb_path, "rb") as f:
        data = f.read()
    if data[:4] != b"glTF":
        raise ValueError("not a GLB file")
    json_len = struct.unpack("<I", data[12:16])[0]
    bin_len_off = 12 + 8 + json_len
    bin_len = struct.unpack("<I", data[bin_len_off:bin_len_off + 4])[0]
    bin_off = bin_len_off + 8
    bin_data = data[bin_off:bin_off + bin_len]

    buffers = []
    for buf in gltf.buffers:
        if buf.uri is None:
            buffers.append(bin_data)
        elif buf.uri.startswith("data:"):
            import base64
            _, b64 = buf.uri.split(",", 1)
            buffers.append(base64.b64decode(b64))
        else:
            with open(os.path.join(os.path.dirname(glb_path), buf.uri), "rb") as f:
                buffers.append(f.read())
    return buffers


def read_positions(gltf, buffers, accessor_idx):
    acc = gltf.accessors[accessor_idx]
    if acc.type != "VEC3" or acc.componentType != 5126:
        return None
    view = gltf.bufferViews[acc.bufferView]
    stride = view.byteStride or 12
    offset = (view.byteOffset or 0) + (acc.byteOffset or 0)
    buf = buffers[view.buffer]
    if stride == 12:
        raw = buf[offset:offset + acc.count * 12]
        return np.frombuffer(raw, dtype="<f4").reshape(acc.count, 3).copy()
    out = np.empty((acc.count, 3), dtype=np.float32)
    for i in range(acc.count):
        out[i] = np.frombuffer(buf, dtype="<f4", count=3, offset=offset + i * stride)
    return out


def node_matrix(node):
    if node.matrix:
        return np.array(node.matrix, dtype=np.float64).reshape(4, 4).T
    m = np.eye(4)
    if node.scale:
        m = m @ np.diag([node.scale[0], node.scale[1], node.scale[2], 1.0])
    if node.rotation:
        x, y, z, w = node.rotation
        R = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w),     0],
            [2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w),     0],
            [2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y), 0],
            [0, 0, 0, 1],
        ])
        m = R @ m
    if node.translation:
        T = np.eye(4)
        T[:3, 3] = node.translation
        m = T @ m
    return m


def transform_points(mat, pts):
    h = np.hstack([pts, np.ones((pts.shape[0], 1))])
    return (h @ mat.T)[:, :3]


def collect_parts(gltf, buffers):
    parts = []
    scene = gltf.scenes[gltf.scene if gltf.scene is not None else 0]

    def walk(node_idx, parent_mat, inherited_name):
        node = gltf.nodes[node_idx]
        world = parent_mat @ node_matrix(node)
        name = node.name or inherited_name
        if node.mesh is not None:
            mesh = gltf.meshes[node.mesh]
            mesh_name = name or mesh.name or f"mesh_{node.mesh}"
            for pi, prim in enumerate(mesh.primitives):
                pos_acc = prim.attributes.POSITION
                if pos_acc is None:
                    continue
                pts = read_positions(gltf, buffers, pos_acc)
                if pts is None or pts.size == 0:
                    continue
                pw = transform_points(world, pts)
                part_name = mesh_name if len(mesh.primitives) == 1 else f"{mesh_name}#{pi}"
                parts.append((part_name, pw.min(axis=0), pw.max(axis=0)))
        for c in (node.children or []):
            walk(c, world, name)

    for r in scene.nodes:
        walk(r, np.eye(4), None)
    return parts


def human_bytes(n):
    if n < 1024:
        return f"{n} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.2f} KB"
    return f"{n / 1024 / 1024:.2f} MB"


def dump_one(glb_path):
    file_size = os.path.getsize(glb_path)
    gltf = GLTF2().load(glb_path)
    buffers = load_glb_buffers(gltf, glb_path)
    parts = collect_parts(gltf, buffers)

    if parts:
        all_min = np.min([p[1] for p in parts], axis=0) * 100.0
        all_max = np.max([p[2] for p in parts], axis=0) * 100.0
        cabinet_dims = all_max - all_min
    else:
        cabinet_dims = np.zeros(3)

    rows = []
    total_area = 0.0
    for name, mn, mx in parts:
        dims_cm = (mx - mn) * 100.0
        L, W, T = sorted(dims_cm, reverse=True)
        area = L * W / 10000.0
        rows.append((name, L, W, T, area))
        total_area += area

    lines = []
    lines.append(f"{os.path.basename(glb_path)} 板件尺寸清单")
    lines.append("=" * 88)
    lines.append(f"源文件      : {glb_path}")
    lines.append(f"文件大小    : {file_size} 字节 ({human_bytes(file_size)})")
    lines.append(f"整柜 AABB   : {cabinet_dims[0]:.1f}(W) × {cabinet_dims[1]:.1f}(H) × {cabinet_dims[2]:.1f}(D) cm")
    lines.append(f"板件总数    : {len(rows)}")
    lines.append(f"板件总面积  : {total_area:.4f} m²")
    lines.append("")
    lines.append(
        f"{'#':>3}  {'node_name':<48}  "
        f"{'length(cm)':>10}  {'width(cm)':>10}  {'thickness(cm)':>13}  {'area(m²)':>10}"
    )
    lines.append("-" * 100)
    for i, (name, L, W, T, A) in enumerate(rows, 1):
        lines.append(
            f"{i:>3}  {name:<48}  "
            f"{L:>10.1f}  {W:>10.1f}  {T:>13.1f}  {A:>10.4f}"
        )
    return "\n".join(lines)


def main():
    blocks = []
    for fn in FILES:
        path = os.path.join(SRC_DIR, fn)
        if not os.path.exists(path):
            blocks.append(f"[SKIP] 未找到: {path}\n")
            continue
        blocks.append(dump_one(path))

    text = ("\n\n" + "=" * 88 + "\n\n").join(blocks)
    with open(DST_TXT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"OK -> {DST_TXT}")


if __name__ == "__main__":
    main()
