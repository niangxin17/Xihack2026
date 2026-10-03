#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把桌面最新预估分 CSV 更新到 schools.json。
匹配策略：按校名精确/规范化匹配（不按 code，code 体系不一致）。
更新字段：est2026（预估分）、tier（省示范/省标/普高）、ownership（public/private）、batch（1/2）。
先 DRY_RUN 核对命中率与未匹配项。
"""
import csv, json, sys
from pathlib import Path

ROOT = Path("C:/Users/Administrator/Documents/中考网站架构/finalapp")
CSV_PATH = Path("C:/Users/Administrator/Desktop/表格_20260718(1).csv")
SCHOOLS_PATH = ROOT / "data" / "schools.json"
DRY_RUN = "--apply" not in sys.argv

PREFIXES = ["西安市", "西安", "西咸新区", "陕西省"]
SUFFIXES = ["附属中学", "高级中学", "完全中学", "实验学校", "中学", "学校", "分校", "校区"]

# CSV 校名 -> 库里真实校名（仅收敛明显同一所、仅差字的）
MANUAL_ALIASES = {
    "西安高新第四完全中学": "西安高新区第四完全中学",
}
# 明确不自动合并、需人工确认的（避免交大/西大等高校前缀混淆）
SKIP_REVIEW = {
    "西安交大附中浐灞中学": "库里无此校；疑似『西安市西大附中浐灞中学』(571分) 或需新增，待确认",
}

def norm(name: str) -> str:
    n = name.strip()
    for p in PREFIXES:
        if n.startswith(p):
            n = n[len(p):]
    for s in SUFFIXES:
        if n.endswith(s):
            n = n[: len(n) - len(s)]
    return n.strip()

def batch_of(bs: str):
    if bs.startswith("一批"):
        return 1
    if bs.startswith("二批") or bs.startswith("智学"):
        return 2
    return None

def tier_of(bs: str):
    if "省示范" in bs:
        return "省示范"
    if "省标" in bs:
        return "省标"
    if "普高" in bs:
        return "普高"
    return None

OWN_MAP = {"公办": "public", "民办": "private"}

def main():
    rows = []
    with CSV_PATH.open(encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append({
                "batch_raw": r["批次"].strip(),
                "name": r["学校名称"].strip(),
                "ownership_raw": r["办学性质"].strip(),
                "score": int(r["预估分数线"].strip()),
            })
    print(f"CSV 行数: {len(rows)}")

    schools = json.loads(SCHOOLS_PATH.read_text(encoding="utf-8"))
    highs = [s for s in schools if s.get("schoolType") != "junior"]
    by_exact, by_norm = {}, {}
    for s in highs:
        nm = s.get("name", "")
        by_exact.setdefault(nm, []).append(s)
        by_norm.setdefault(norm(nm), []).append(s)

    matched, dup_groups, fuzzy, unmatched, skipped = [], [], [], [], []
    updates = []  # (school, row)
    for r in rows:
        if r["name"] in SKIP_REVIEW:
            skipped.append((r["name"], SKIP_REVIEW[r["name"]]))
            continue
        target = MANUAL_ALIASES.get(r["name"], r["name"])
        if target in by_exact:
            cands = by_exact[target]
        else:
            cands = by_norm.get(norm(r["name"]), [])
        if not cands:
            # contains fallback
            hit = None
            for s in highs:
                sn = s.get("name", "")
                if r["name"] in sn or sn in r["name"]:
                    hit = s
                    break
            if hit:
                fuzzy.append((r["name"], [hit.get("name") + " (contains)"]))
                updates.append((hit, r))
                matched.append(r["name"])
            else:
                unmatched.append(r["name"])
            continue
        if len(cands) > 1:
            dup_groups.append((r["name"], [c.get("name") for c in cands]))
        for c in cands:
            updates.append((c, r))
        matched.append(r["name"])

    print(f"匹配(含重复): {len(matched)}")
    print(f"重复条目组(全量更新): {len(dup_groups)}")
    for n, c in dup_groups:
        print(f"  重复: CSV[{n}] -> DB{c}")
    print(f"模糊匹配(contains, 需复核): {len(fuzzy)}")
    for n, c in fuzzy:
        print(f"  模糊: CSV[{n}] -> DB{c}")
    print(f"需人工确认(已跳过): {len(skipped)}")
    for n, why in skipped:
        print(f"  跳过: {n} — {why}")
    print(f"未匹配: {len(unmatched)}")
    for n in unmatched:
        print(f"  缺失: {n}")

    if DRY_RUN:
        print("\n[DRY_RUN] 应用样例（前 12 条）：")
        for s, r in updates[:12]:
            print(f"  {s.get('name')}: est2026 {s.get('est2026')} -> {r['score']} | tier {s.get('tier')} -> {tier_of(r['batch_raw'])} | own {s.get('ownership')} -> {OWN_MAP.get(r['ownership_raw'])} | batch {s.get('batch')} -> {batch_of(r['batch_raw'])}")
        print("\n(加 --apply 执行真实写入)")
        return

    changed = 0
    for s, r in updates:
        new_tier = tier_of(r["batch_raw"])
        new_own = OWN_MAP.get(r["ownership_raw"])
        new_batch = batch_of(r["batch_raw"])
        if s.get("est2026") != r["score"]:
            s["est2026"] = r["score"]
            changed += 1
        if new_tier and s.get("tier") != new_tier:
            s["tier"] = new_tier
        if new_own and s.get("ownership") != new_own:
            s["ownership"] = new_own
        if new_batch and s.get("batch") != new_batch:
            s["batch"] = new_batch
    SCHOOLS_PATH.write_text(json.dumps(schools, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[APPLY] est2026 被改动的学校数: {changed} / 总更新条目(含重复): {len(updates)}")
    print(f"需人工确认(未写入): {len(skipped)} | 完全未匹配: {len(unmatched)}")

if __name__ == "__main__":
    main()
