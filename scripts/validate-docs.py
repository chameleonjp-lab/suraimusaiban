#!/usr/bin/env python3
"""Validate this PR's design documents and original assets, not game behavior."""
from collections import Counter
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
import json
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'docs/requirements.md'
PLAN = ROOT / 'docs/superpowers/plans/2026-10-23-slime-trial.md'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def section(text, start, end):
    return text.split(start, 1)[1].split(end, 1)[0]


def main():
    spec = SPEC.read_text(encoding='utf-8')
    plan = PLAN.read_text(encoding='utf-8')
    cases_text = section(spec, '# 裁判で提示する20件の具体案', '# 個人の判決と全体の判決')
    cases = re.findall(r'^## ([HK]\d{2}) ([^\n]+)\n(.*?)(?=^## |\Z)', cases_text, re.M | re.S)
    expected_ids = {f'{kind}{i:02}' for kind in 'HK' for i in range(1, 11)}
    require(len(cases) == 20 and {c[0] for c in cases} == expected_ids,
            'Cases must be unique H01-H10 / K01-K10')
    for case_id, _, body in cases:
        for prefix in ('事実：', '検察：', '弁護士：'):
            require(body.count(prefix) == 1, f'{case_id}: missing/duplicate {prefix}')
    pairs_text = section(spec, '# 人物傾向の10項目', '## 計算と説明')
    pairs = re.findall(r'^\| (\d+) \| [^|]+ \| (H\d{2})と(K\d{2})。', pairs_text, re.M)
    require(len(pairs) == 10 and {int(p[0]) for p in pairs} == set(range(1, 11)),
            'Expected ten distinct axes')
    require(Counter(p for _, h, k in pairs for p in (h, k)) == Counter(expected_ids),
            'Every case must belong to exactly one axis')
    print('PASS: 20 cases, 10 exclusive pairs, three perspectives per case')

    verdict_text = section(spec, '## 20件の合計', '## 集計方法')
    rows = re.findall(r'^\| ([−＋\d][^|]*) \| ([^|]+) \| ([^|]+) \|$', verdict_text, re.M)
    require(len(rows) == 11, 'Expected 11 verdict rows')
    labels = [r[1].strip() for r in rows]
    bounds = []
    for raw, _, _ in rows:
        raw = raw.strip().replace('−', '-').replace('＋', '+')
        if raw == '0':
            bounds.append([('=', Decimal(0))])
        else:
            constraints = re.findall(r'([+-]?\d+)(以上|超|以下|未満)', raw)
            require(len(constraints) == 2, f'Cannot parse verdict range: {raw}')
            bounds.append([(op, Decimal(n)) for n, op in constraints])

    def match(value, constraints):
        return all({'=': value == n, '以上': value >= n, '超': value > n,
                    '以下': value <= n, '未満': value < n}[op] for op, n in constraints)

    def verdict(value):
        matches = [i for i, constraints in enumerate(bounds) if match(value, constraints)]
        require(len(matches) == 1, f'Gap/overlap at {value}: {matches}')
        return matches[0]

    samples = [Decimal(i) / 100 for i in range(-10000, 10001)]
    samples += [Decimal(n) + delta for n in range(-80, 81, 20)
                for delta in (Decimal('-0.000001'), Decimal('0.000001'))]
    for sample in samples:
        verdict(sample)
    require(labels[verdict(Decimal(-100))] == '悪魔の使いとして公開処刑', 'Wrong minimum verdict')
    require(labels[verdict(Decimal(100))] == '神の使いとして神殿管理', 'Wrong maximum verdict')
    require(labels[verdict(Decimal(0))] == '釈放', 'Zero must mean release')
    require(verdict(Decimal(-80)) == 1 and verdict(Decimal(80)) == 9, 'Wrong extreme boundary')
    require(verdict(Decimal('0.000001')) == 6 and verdict(Decimal('-0.000001')) == 4,
            'Nonzero mean must retain its sign')
    print(f'PASS: {len(samples):,} verdict samples, no gaps/overlaps, extremes and zero')

    formula_text = section(spec, '## 計算と説明', '# 裁判で提示する20件の具体案')
    compact = re.sub(r'\s+', '', formula_text)
    for formula in ('50＋5×（K−H）', '50−5×（H＋K）', '50＋5×（H＋K）'):
        require(formula in compact, f'Formula changed; review checker: {formula}')
    choices = list(range(-5, 0)) + list(range(1, 6))
    formula_ranges = [set(), set(), set()]
    for h in choices:
        for k in choices:
            for index, value in enumerate((50 + 5 * (k-h), 50 - 5 * (h+k), 50 + 5 * (h+k))):
                require(0 <= value <= 100, 'Axis outside 0-100')
                formula_ranges[index].add(value)
    require(all(min(values) == 0 and max(values) == 100 for values in formula_ranges),
            'Axis endpoints changed')
    require(sum([-5] * 20) == -100 and sum([5] * 20) == 100
            and sum([-5] * 10 + [5] * 10) == 0, 'Sum examples failed')
    print('PASS: 3 formulas x 100 answer pairs, 0-100 endpoints, sum examples')

    story_text = section(spec, '# 小説の表示規則', '# 完成を確認する条件')
    stories = re.findall(r'^## ([^\n]+)\n\n(.*?)(?=\n## |\Z)', story_text, re.M | re.S)
    require(len(stories) == 11 and [s[0] for s in stories] == labels, 'Story/verdict mismatch')
    for title, body in stories:
        body = body.strip()
        require(len(body) == 300, f'{title}: {len(body)} characters, expected 300')
        require(not any(c.isspace() for c in body), f'{title}: whitespace in story')
    print('PASS: 11 matching stories, each exactly 300 Unicode code points')

    reference_dir = ROOT / 'docs/references/slime'
    manifest = json.loads((reference_dir / 'manifest.json').read_text())
    require(len(manifest['images']) == 4, 'Expected four reference images')
    for record in manifest['images']:
        data = (reference_dir / record['file']).read_bytes()
        require(data.startswith(b'\xff\xd8\xff'), f"Not a JPEG: {record['file']}")
        require(len(data) == record['bytes'] and sha256(data).hexdigest() == record['sha256'],
                f"Reference bytes changed: {record['file']}")
    print('PASS: four original JPEG checksums and sizes')

    require(re.findall(r'^## (T\d{2})：', plan, re.M) == [f'T{i:02}' for i in range(1, 10)],
            'Plan must have T01-T09 in order')
    require('## Review Focus' in plan and plan.count('**Interfaces:**') == 9,
            'Plan needs failure modes and task interfaces')
    for word in ('3Dアニメ風', '神の使いとして神殿管理', '悪魔の使いとして公開処刑'):
        require(word in spec and word in plan, f'Missing requirement: {word}')
    require('保護区' not in spec, 'Superseded maximum treatment returned')

    links = 0
    for path in [ROOT / 'README.md', *sorted((ROOT / 'docs').rglob('*.md'))]:
        content = path.read_text(encoding='utf-8')
        # Ignore fenced examples; only repository-relative rendered links are checked.
        content = re.sub(r'```.*?```', '', content, flags=re.S)
        for target in re.findall(r'!?\[[^\]]*\]\(([^\s)]+)\)', content):
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            destination = (path.parent / target.split('#', 1)[0]).resolve()
            require(destination.is_relative_to(ROOT) and destination.exists(),
                    f'Broken local link: {path.relative_to(ROOT)} -> {target}')
            links += 1
    print(f'PASS: plan structure and {links} repository-relative links')
    print('Document checks passed. Game, database, and device behavior remain unimplemented/untested.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, IndexError, KeyError, OSError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
