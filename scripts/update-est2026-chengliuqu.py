#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把粘贴的城六区 122 所预估线表（scripts/chengliuqu-est2026.csv）更新到 schools.json。
匹配：schoolType==="high" 且 district 一致，按校名精确/规范化匹配（不按 code）。
更新字段：est2026（预估分→referenceScore 由 normalize 派生）、tier、batch。
先 DRY_RUN 核对命中率与未匹配项；加 --apply 真实写入。
"""
import csv, json, sys
from pathlib import Path

ROOT = Path("C:/Users/Administrator/Documents/中考网站架构/finalapp")
CSV_PATH = ROOT / "scripts" / "chengliuqu-est2026.csv"
SCHOOLS_PATH = ROOT / "data" / "schools.json"
DRY_RUN = "--apply" not in sys.argv

PREFIXES = ["西安市", "西安", "西咸新区", "陕西省"]
SUFFIXES = ["附属中学", "高级中学", "完全中学", "实验学校", "中学", "学校", "分校", "校区"]

# CSV 校名 -> 库里真实校名（收敛明显同一所、仅差字的）
MANUAL_ALIASES = {
    "太乙路中学": "太乙路中学(26中分校)",
    "西安工业大学附中": "西安工业大学附中",
}
# 明确不自动合并、需人工确认的
SKIP_REVIEW = {}

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
    if bs.startswith("一批") or bs.startswith("第一"):
        return 1
    if bs.startswith("二批") or bs.startswith("第二"):
        return 2
    return None

def tier_of(t: str):
    if "省示范" in t:
        return "省示范"
    if "省标" in t:
        return "省标"
    if "普高" in t:
        return "普高"
    return None

def main():
    rows = []
    with CSV_PATH.open(encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            rows.append({
                "district": r["district"].strip(),
                "name": r["name"].strip(),
                "batch_raw": r["batch_raw"].strip(),
                "tier": tier_of(r["tier"]),
                "score": int(r["score"].strip()),
            })
    print(f"CSV 行数: {len(rows)}")

    schools = json.loads(SCHOOLS_PATH.read_text(encoding="utf-8"))
    # 仅普高，且按区县分桶
    highs = [s for s in schools if s.get("schoolType") == "high"]
    by_exact, by_norm = {}, {}
    for s in highs:
        nm = s.get("name", "")
        by_exact.setdefault(nm, []).append(s)
        by_norm.setdefault(norm(nm), []).append(s)

    matched, dup_groups, fuzzy, unmatched, skipped = [], [], [], [], []
    updates = []
    for r in rows:
        if r["name"] in SKIP_REVIEW:
            skipped.append((r["name"], SKIP_REVIEW[r["name"]]))
            continue
        target = MANUAL_ALIASES.get(r["name"], r["name"])
        cands = by_exact.get(target, [])
        if not cands:
            cands = [c for c in by_norm.get(norm(r["name"]), []) if c.get("district") == r["district"]]
        if not cands:
            # contains fallback within district
            hit = None
            for s in highs:
                if s.get("district") != r["district"]:
                    continue
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
    print(f"模糊匹配(contains): {len(fuzzy)}")
    for n, c in fuzzy:
        print(f"  模糊: CSV[{n}] -> DB{c}")
    print(f"需人工确认(已跳过): {len(skipped)}")
    for n, why in skipped:
        print(f"  跳过: {n} — {why}")
    print(f"未匹配: {len(unmatched)}")
    for n in unmatched:
        print(f"  缺失: {n}")

    if DRY_RUN:
        print("\n[DRY_RUN] 应用样例（前 15 条）：")
        for s, r in updates[:15]:
            print(f"  {s.get('name')} [{s.get('district')}]: est2026 {s.get('est2026')} -> {r['score']} | tier {s.get('tier')} -> {r['tier']} | batch {s.get('batch')} -> {batch_of(r['batch_raw'])}")
        print("\n(加 --apply 执行真实写入)")
        return

    changed = 0
    for s, r in updates:
        new_tier = r["tier"]
        new_batch = batch_of(r["batch_raw"])
        if s.get("est2026") != r["score"]:
            s["est2026"] = r["score"]
            changed += 1
        if new_tier and s.get("tier") != new_tier:
            s["tier"] = new_tier
        if new_batch and s.get("batch") != new_batch:
            s["batch"] = new_batch
    SCHOOLS_PATH.write_text(json.dumps(schools, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[APPLY] est2026 被改动的学校数: {changed} / 总更新条目(含重复): {len(updates)}")
    print(f"需人工确认(未写入): {len(skipped)} | 完全未匹配: {len(unmatched)}")

if __name__ == "__main__":
    main()
