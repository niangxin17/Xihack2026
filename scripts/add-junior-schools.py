import json
import re
from pathlib import Path

ROOT = Path("C:/Users/Administrator/Documents/中考网站架构/finalapp")
SCHOOLS_PATH = ROOT / "data" / "schools.json"
DIRECTIONAL_PATH = ROOT / "app" / "lib" / "directional-data.ts"

# 区县 key -> (数据区县 district, 中文 region)
DISTRICT_META = {
    "xincheng": ("chengliuqu", "新城区"),
    "beilin": ("chengliuqu", "碑林区"),
    "lianhu": ("chengliuqu", "莲湖区"),
    "yanta": ("chengliuqu", "雁塔区"),
    "bashan": ("chengliuqu", "灞桥区"),
    "weiyang": ("chengliuqu", "未央区"),
    "xixian": ("xixian", "西咸新区"),
}

# 兜底清洗（源文件已修，这里再保险一层）
CLEAN = {
    "中西学安滨河学校(原铁一滨河)": "西安滨河学校(原铁一滨河)",
    "学西安国际港务区高新一中陆": "西安国际港务区高新一中陆港中学",
    "校西安市浐灞第一中学": "西安市浐灞第一中学",
    "港西中安学市庆华中学": "西安市庆华中学",
    "西安国际港务区陆港初级中": "西安国际港务区陆港初级中学",
    "西安市交大附中浐灞右岸学": "西安市交大附中浐灞右岸学校",
    "西安港务区铁一中陆港初级": "西安港务区铁一中陆港初级中学",
}

def extract_junior():
    text = DIRECTIONAL_PATH.read_text(encoding="utf-8")
    # 截取到 DIRECTIONAL_MAP 之前
    block = text.split("JUNIOR_SCHOOLS_BY_DISTRICT", 1)[1].split("DIRECTIONAL_MAP", 1)[0]
    result = {}
    for m in re.finditer(r'"([a-z]+)":\s*\[(.*?)\]\s*[,}]', block, re.DOTALL):
        key = m.group(1)
        inner = m.group(2)
        names = re.findall(r'"([^"]+)"', inner)
        names = [CLEAN.get(n, n) for n in names]
        result[key] = names
    return result

def main():
    junior = extract_junior()
    schools = json.loads(SCHOOLS_PATH.read_text(encoding="utf-8"))

    # 1) 给现有高中补 schoolType=high
    for s in schools:
        if "schoolType" not in s:
            s["schoolType"] = "high"

    existing_pairs = {(s.get("name"), s.get("schoolType")) for s in schools}
    existing_ids = {s.get("id") for s in schools}

    added = 0
    for key, names in junior.items():
        data_district, region = DISTRICT_META.get(key, ("chengliuqu", "城六区"))
        for name in names:
            if (name, "junior") in existing_pairs:
                continue
            sid = f"junior_{added+1:03d}"
            while sid in existing_ids:
                added += 1
                sid = f"junior_{added+1:03d}"
            entry = {
                "id": sid,
                "name": name,
                "district": data_district,
                "region": region,
                "schoolType": "junior",
                "tier": "初中",
                "ownership": "public",
                "planStatus": "pending_review",
            }
            schools.append(entry)
            existing_pairs.add((name, "junior"))
            existing_ids.add(sid)
            added += 1

    SCHOOLS_PATH.write_text(json.dumps(schools, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Junior schools added: {added}")
    print(f"Total schools now: {len(schools)}")
    # 统计
    from collections import Counter
    cnt = Counter(s.get("schoolType") for s in schools)
    print("By schoolType:", dict(cnt))

if __name__ == "__main__":
    main()
