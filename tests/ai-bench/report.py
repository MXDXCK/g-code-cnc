#!/usr/bin/env python3
"""Сводка замеров (results/*.json + meta) → Markdown на русском."""
import glob, json, os, sys
d = sys.argv[1] if len(sys.argv) > 1 else 'results'
print('| Модель | Лицензия | Файлы, МБ | OCR: надписей прочитано | Выдуманных чисел (OCR) | Структура: отверстия X/Y | Ø | Габарит | Неверных координат | JSON | Сек. на картинку | Пик ОЗУ, МБ |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|')
for f in sorted(glob.glob(os.path.join(d, '*.json'))):
    if f.endswith('meta.json'): continue
    R = json.load(open(f, encoding='utf-8'));
    if not R: continue
    name = R[0]['model']; meta = {}
    mp = os.path.join(d, name + '.meta.json')
    if os.path.exists(mp): meta = json.load(open(mp))
    lic = meta.get('license') or '—'; mb = sum(v['bytes'] for v in meta.get('files', {}).values()) // 2**20 if meta.get('files') else '—'
    rec = sum(r['ocr']['recall'] for r in R) / len(R); inv = sum(len(r['ocr']['invented']) for r in R)
    S = [r.get('struct') for r in R if r.get('struct')]
    frac = lambda k: (sum(int(s[k].split('/')[0]) for s in S if k in s), sum(int(s[k].split('/')[1]) for s in S if k in s))
    xy, dd = frac('holes_xy'), frac('holes_d')
    plate = sum(1 for s in S if s.get('plate_ok')); wrong = sum(s.get('wrong_coords', 0) for s in S)
    js = sum(1 for r in R if r['ocr']['json']) + sum(1 for s in S if s.get('json'))
    sec = sum(sum(r['sec']) for r in R) / len(R); rss = max((r.get('rss_mb') or 0) for r in R)
    st = lambda p: f'{p[0]}/{p[1]}' if S else '—'
    print(f"| {name} | {lic} | {mb} | {rec:.0%} | {inv} | {st(xy)} | {st(dd)} | {plate}/{len(S) if S else '—'} | {wrong if S else '—'} | {js}/{len(R) + len(S)} | {sec:.0f} | {rss or '—'} |")
