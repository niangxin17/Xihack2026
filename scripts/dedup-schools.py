import json, sys
from pathlib import Path

ROOT = Path("C:/Users/Administrator/Documents/中考网站架构/finalapp")
SCHOOLS_PATH = ROOT / "data" / "schools.json"

data = json.loads(SCHOOLS_PATH.read_text(encoding="utf-8"))
by_id = {}
order = []
for s in data:
    by_id.setdefault(s["id"], []).append(s)

# 选出要保留的条目：优先有 est2026，其次名字更长（更正式），再其次第一个
keep_ids = set()
remove_list = []  # (id, name, reason)
for sid, arr in by_id.items():
    if len(arr) == 1:
        keep_ids.add(id(arr[0]))
        continue
    # 有 est2026 的优先
    with_est = [s for s in arr if s.get("est2026") is not None]
    if with_est:
        best = max(with_est, key=lambda s: len(s.get("name", "")))
    else:
        best = max(arr, key=lambda s: len(s.get("name", "")))
    keep_ids.add(id(best))
    for s in arr:
        if id(s) != id(best):
            remove_list.append((sid, s.get("name"), "重复条目"))

# 构建去重后列表（保持原顺序）
new_data = [s for s in data if id(s) in keep_ids]

apply = "--apply" in sys.argv
print(f"原始总数: {len(data)}")
print(f"id 重复组数: {len([1 for a in by_id.values() if len(a) > 1])}")
print(f"将删除条数: {len(remove_list)}")
print(f"去重后总数: {len(new_data)}")
print("--- 删除明细 ---")
for sid, name, reason in remove_list:
    print(f"  [删] {sid} | {name}")

if apply:
    SCHOOLS_PATH.write_text(json.dumps(new_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n已写入 schools.json（去重完成）")
else:
    print("\n（dry-run，未写入。加 --apply 执行落盘）")
