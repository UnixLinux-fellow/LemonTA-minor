# 单文件清理: 复用 _strip_geom3d_batch.py 的 process() 处理单个 glb。
# 需要清另一个文件时, 改 TGT 常量后重跑即可。
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _strip_geom3d_batch import process  # noqa: E402

TGT = r"D:\工程\柠檬塔\标准柜\glb模型上传解析及计算必须文档\su模型--标准板\cabinet-model\50B.glb"

if not os.path.isfile(TGT):
    print(f"文件不存在: {TGT}")
    sys.exit(1)

# 先 dry-run
n, m, _ = process(TGT, dry_run=True)
print(f"[DRY-RUN] {os.path.basename(TGT)}: node={n} mesh={m}")
if n + m == 0:
    print("(无 Geom3D_ 前缀, 无需处理)")
    sys.exit(0)

# 执行
n, m, backed_up = process(TGT, dry_run=False)
tag = " [已备份]" if backed_up else " [.bak 已存在, 未再备份]"
print(f"[EXECUTE] {os.path.basename(TGT)}: node={n} mesh={m}{tag}")

# 二次确认
n2, m2, _ = process(TGT, dry_run=True)
print(f"[VERIFY]  {os.path.basename(TGT)}: 剩余 node={n2} mesh={m2} (应为 0)")
