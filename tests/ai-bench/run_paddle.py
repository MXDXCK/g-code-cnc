#!/usr/bin/env python3
"""Чистый OCR PaddleOCR (PP-OCRv5, Apache-2.0) на эталонных чертежах: сколько размерных надписей прочитано и сколько «лишних» чисел.
Только чтение текста — без структуры. Для сравнения с Tesseract (сейчас в Fresa) и с Vision-моделями."""
import glob, json, os, re, sys, time
from run_llama import DRAW, norm, nums

out = sys.argv[1] if len(sys.argv) > 1 else 'results'
os.makedirs(out, exist_ok=True)
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=True, lang='ru',
                device='cpu', enable_mkldnn=False)   # oneDNN на раннере GitHub падает (NotImplementedError ConvertPirAttribute)
rows = []
for img in sorted(glob.glob(os.path.join(DRAW, '*', 'drawing.png')) + glob.glob(os.path.join(DRAW, '*', 'plate.png')) + glob.glob(os.path.join(DRAW, '*', 'scan.jpg'))):
    E = json.load(open(os.path.join(os.path.dirname(img), 'expected.json'), encoding='utf-8'))
    dims = E.get('dims') or ['15', '90', '120', '15', '50', '80', '4 отв. Ø10', 'Толщина 10']
    t0 = time.time(); res = ocr.predict(img); dt = time.time() - t0
    texts = [t for r in res for t in (r.get('rec_texts') if hasattr(r, 'get') else r['rec_texts'])]
    got = [norm(t) for t in texts]
    hit = sum(1 for d in dims if any(norm(d) == g or norm(d) in g for g in got))
    allowed = set(n for d in dims for n in nums(d))
    invented = [t for t in texts if nums(t) and not all(n in allowed for n in nums(t))]
    row = {'model': 'paddleocr-ppocrv5', 'drawing': os.path.basename(os.path.dirname(img)), 'ocr': {'json': True, 'recall': round(hit / len(dims), 3), 'n_got': len(texts), 'invented': invented[:10]},
           'sec': [round(dt, 1)], 'texts': texts}
    print(json.dumps(row, ensure_ascii=False), flush=True); rows.append(row)
json.dump(rows, open(os.path.join(out, 'paddleocr-ppocrv5.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

# короткие надписи (tests/fixtures/ocr-phrases, искусственные искажения) — та же оценка, что в run_tess.mjs
PH = os.path.join(os.path.dirname(DRAW), 'ocr-phrases')
EP = json.load(open(os.path.join(PH, 'expected.json'), encoding='utf-8'))
NRM = lambda s: re.sub(r'[\s«»"\'`]', '', str(s).lower().replace('⌀', 'ø').replace('∅', 'ø').replace('×', 'x').replace('х', 'x').replace(',', '.'))
WRD = lambda s: re.findall(r'[а-яё]{3,}', str(s).lower())
pr, T = [], 0
for it in EP['items']:
    t0 = time.time(); res = ocr.predict(os.path.join(PH, it['file'])); T += time.time() - t0
    txt = ' '.join(t for r in res for t in (r.get('rec_texts') if hasattr(r, 'get') else r['rec_texts']))
    ne, ng = nums(it['text']), nums(txt)
    we, wg = WRD(it['text']), WRD(txt)
    pr.append({'engine': 'paddleocr', 'file': it['file'], 'variant': it['variant'], 'text': it['text'], 'got': txt, 'exact': NRM(txt) == NRM(it['text']),
               'nums': ne == ng, 'words': (sum(1 for w in we if w in wg) / len(we)) if we else None, 'invented': [n for n in ng if n not in ne]})
n = len(pr)
print('paddleocr фразы:', f"точно {sum(r['exact'] for r in pr)}/{n}", f"числа {sum(r['nums'] for r in pr)}/{n}",
      'слова', round(100 * sum(r['words'] for r in pr if r['words'] is not None) / max(1, sum(1 for r in pr if r['words'] is not None))), '%',
      f"лишние числа в {sum(1 for r in pr if r['invented'])}", f'{1000 * T / n:.0f} мс/картинка')
by = {}
for r in pr: by.setdefault(r['variant'], [0, 0]); by[r['variant']][0] += r['nums']; by[r['variant']][1] += 1
print(' '.join(f'{k}:{a}/{b}' for k, (a, b) in by.items()))
json.dump(pr, open(os.path.join(out, 'paddleocr-phrases.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
import resource
print('пик ОЗУ процесса:', resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, 'МБ')
