#!/usr/bin/env python3
"""Чистый OCR PaddleOCR (PP-OCRv5, Apache-2.0) на эталонных чертежах: сколько размерных надписей прочитано и сколько «лишних» чисел.
Только чтение текста — без структуры. Для сравнения с Tesseract (сейчас в Fresa) и с Vision-моделями."""
import glob, json, os, re, sys, time
from run_llama import DRAW, norm, nums

out = sys.argv[1] if len(sys.argv) > 1 else 'results'
os.makedirs(out, exist_ok=True)
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=True, lang='ru')
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
