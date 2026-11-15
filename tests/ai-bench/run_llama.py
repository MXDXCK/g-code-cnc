#!/usr/bin/env python3
"""Замер локальных Vision-моделей на эталонных чертежах Fresa (запускается в GitHub Actions, не в приложении).

Для каждой картинки tests/fixtures/drawings/*/drawing.png (и plate.png, scan.jpg) две задачи:
  A) OCR: прочитать все размерные надписи как написано;
  B) структура: габарит пластины и отверстия (X, Y от левого нижнего угла, Ø) в JSON, неизвестное — null.
Сравнение с expected.json: полнота и точность надписей, ВЫДУМАННЫЕ числа, отверстия, корректность JSON,
время и пиковая память процесса (/usr/bin/time -v).

Использование: run_llama.py --cli path/llama-mtmd-cli --model m.gguf --mmproj p.gguf --name qwen3vl2b --out results/
"""
import argparse, json, os, re, subprocess, time, glob

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DRAW = os.path.join(ROOT, 'tests', 'fixtures', 'drawings')

P_OCR = ("This image is a mechanical engineering drawing (GOST style). Read every dimension label exactly as written: "
         "numbers, diameter sign Ø, radius R, tolerances like ±0,2 or H7, hole counts like '4 отв.'. Do not invent labels. "
         'Answer ONLY with JSON: {"dims": ["label1", "label2", ...]}')
P_STRUCT = ("This image is a mechanical engineering drawing of a flat plate. Using ONLY the dimension labels on the drawing, "
            "give the plate size and every round hole: centre X and Y measured from the lower-left corner of the plate, and diameter. "
            "If a value cannot be determined from the labels, use null. Do not guess. "
            'Answer ONLY with JSON: {"plate": {"w": number|null, "h": number|null}, "holes": [{"x": number|null, "y": number|null, "d": number|null}]}')


def norm(s):
    s = str(s).replace('%%c', 'Ø').replace('⌀', 'Ø').replace('∅', 'Ø').replace(',', '.').replace(' ', '').lower()
    return s.replace('отв.', 'отв').replace('x', '×')


def nums(s):
    return [float(x.replace(',', '.')) for x in re.findall(r'\d+(?:[.,]\d+)?', str(s))]


def extract_json(text):
    """Последний ВНЕШНИЙ JSON-объект в ответе модели (вложенные объекты внутри него не считаются отдельными)."""
    best, end = None, -1
    for m in re.finditer(r'\{', text):
        if m.start() < end: continue                 # внутри уже разобранного объекта
        depth = 0
        for j in range(m.start(), len(text)):
            if text[j] == '{': depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    try: best, end = json.loads(text[m.start():j + 1]), j + 1
                    except Exception: pass
                    break
    return best


def run(cli, model, mmproj, image, prompt, threads, ctx, extra=()):
    cmd = ['/usr/bin/time', '-v', cli, '-m', model, '--mmproj', mmproj, '--image', image, '-p', prompt,
           '--temp', '0', '-n', '600', '-t', str(threads), '-c', str(ctx), '--no-warmup', *extra]
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    dt = time.time() - t0
    rss = re.search(r'Maximum resident set size \(kbytes\): (\d+)', p.stderr)
    return p.stdout, dt, int(rss.group(1)) // 1024 if rss else None, p.returncode, p.stderr[-1500:]


def score_ocr(E, out):
    j = extract_json(out)
    got = [str(x) for x in (j or {}).get('dims', [])] if isinstance(j, dict) else []
    want = [norm(d) for d in E.get('dims', [])]
    gotn = [norm(g) for g in got]
    hit = sum(1 for w in want if w in gotn)
    # выдуманные: числа в ответе, которых нет ни в одной надписи чертежа
    allowed = set()
    for d in E.get('dims', []): allowed.update(nums(d))
    invented = [g for g in got if nums(g) and not all(n in allowed for n in nums(g))]
    return {'json': j is not None, 'recall': round(hit / max(1, len(want)), 3), 'n_got': len(got), 'invented': invented[:10]}


def score_struct(E, out):
    j = extract_json(out)
    if not isinstance(j, dict): return {'json': False}
    holes = [h for h in j.get('holes', []) if isinstance(h, dict)]
    exp = E['holes']
    used, ok_d, ok_xy, wrong = set(), 0, 0, []
    for h in exp:
        k = next((i for i, g in enumerate(holes) if i not in used and g.get('x') is not None and g.get('y') is not None
                  and abs(float(g['x']) - h['x']) < 0.51 and abs(float(g['y']) - h['y']) < 0.51), None)
        if k is None: continue
        used.add(k); ok_xy += 1
        if holes[k].get('d') is not None and abs(float(holes[k]['d']) - h['d']) < 0.01: ok_d += 1
    for i, g in enumerate(holes):
        if i in used: continue
        if any(g.get(c) is not None for c in ('x', 'y')): wrong.append(g)       # неверные координаты (не null) — «выдумано»
    pl = j.get('plate') or {}
    plate_ok = isinstance(pl, dict) and pl.get('w') is not None and pl.get('h') is not None and \
        abs(float(pl['w']) - E['plate']['w']) < 0.01 and abs(float(pl['h']) - E['plate']['h']) < 0.01
    return {'json': True, 'holes_xy': f'{ok_xy}/{len(exp)}', 'holes_d': f'{ok_d}/{len(exp)}', 'wrong_coords': len(wrong),
            'n_holes': len(holes), 'plate_ok': plate_ok}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cli', required=True); ap.add_argument('--model', required=True); ap.add_argument('--mmproj', required=True)
    ap.add_argument('--name', required=True); ap.add_argument('--out', default='results'); ap.add_argument('--threads', type=int, default=4)
    ap.add_argument('--ctx', type=int, default=8192); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--maxpx', type=int, default=1280, help='длинная сторона картинки, пикс.')
    ap.add_argument('--extra', default='', help='доп. параметры llama-mtmd-cli, через пробел')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    imgs = sorted(glob.glob(os.path.join(DRAW, '*', 'drawing.png')) + glob.glob(os.path.join(DRAW, '*', 'plate.png')) + glob.glob(os.path.join(DRAW, '*', 'scan.jpg')))
    if a.limit: imgs = imgs[:a.limit]
    rows = []
    # картинки уменьшаются до 1280 пикс. по длинной стороне (как фото с телефона после сжатия), чтобы токены изображения
    # помещались в контекст у всех моделей одинаково
    from PIL import Image
    tmp = os.path.join(a.out, '_img'); os.makedirs(tmp, exist_ok=True)
    for img in imgs:
        im = Image.open(img).convert('RGB'); im.thumbnail((a.maxpx, a.maxpx))
        small = os.path.join(tmp, os.path.basename(os.path.dirname(img)) + '.png'); im.save(small)
        E = json.load(open(os.path.join(os.path.dirname(img), 'expected.json'), encoding='utf-8'))
        if 'dims' not in E:   # эталон №01 старого формата — надписи известны из генератора
            E['dims'] = ['15', '90', '120', '15', '50', '80', '4 отв. Ø10', 'Толщина 10']
        row = {'model': a.name, 'drawing': os.path.basename(os.path.dirname(img)), 'ctx': a.ctx, 'maxpx': a.maxpx, 'extra': a.extra,
               'quant': os.path.basename(a.model), 'mmproj': os.path.basename(a.mmproj)}
        ex = a.extra.split()
        o1, t1, m1, rc1, e1 = run(a.cli, a.model, a.mmproj, small, P_OCR, a.threads, a.ctx, ex)
        o2, t2, m2, rc2, e2 = run(a.cli, a.model, a.mmproj, small, P_STRUCT, a.threads, a.ctx, ex)
        row.update({'ocr': score_ocr(E, o1), 'struct': score_struct(E, o2), 'sec': [round(t1, 1), round(t2, 1)],
                    'rss_mb': max(x for x in (m1, m2, 0) if x is not None), 'rc': [rc1, rc2],
                    'raw_ocr': o1[-1200:], 'raw_struct': o2[-1500:], 'err': (e1 if rc1 else '') + (e2 if rc2 else '')})
        print(json.dumps({k: v for k, v in row.items() if not k.startswith('raw')}, ensure_ascii=False), flush=True)
        rows.append(row)
    json.dump(rows, open(os.path.join(a.out, f'{a.name}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
