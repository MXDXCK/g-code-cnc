#!/usr/bin/env python3
"""Скачать GGUF-модель и проектор (mmproj) с Hugging Face по списку файлов репозитория; записать лицензию и SHA-256.
fetch_model.py <repo> <dir> [квант модели] [квант проектора]  → печатает пути model и mmproj (для GitHub Actions: в $GITHUB_OUTPUT)."""
import hashlib, json, os, sys, urllib.request

repo, out = sys.argv[1], sys.argv[2]
q_model = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
q_mm = sys.argv[4] if len(sys.argv) > 4 and sys.argv[4] else None
os.makedirs(out, exist_ok=True)
info = json.load(urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}'))
files = [s['rfilename'] for s in info.get('siblings', []) if s['rfilename'].endswith('.gguf')]
pref = lambda names, order: next((f for q in order for f in names if q.lower() in f.lower()), names[0] if names else None)
mm = pref([f for f in files if 'mmproj' in f.lower()], ([q_mm] if q_mm else []) + ['f16', 'q8_0', ''])
model = pref([f for f in files if 'mmproj' not in f.lower()], ([q_model] if q_model else []) + ['q4_k_m', 'q4_k', 'q8_0', 'f16', ''])
if q_model and q_model.lower() not in model.lower(): sys.exit(f'нет кванта {q_model} в {repo}: {files}')
if q_mm and q_mm.lower() not in mm.lower(): sys.exit(f'нет проектора {q_mm} в {repo}: {files}')
if not model or not mm: sys.exit(f'нет подходящих файлов в {repo}: {files}')
meta = {'repo': repo, 'license': (info.get('cardData') or {}).get('license') or next((t[8:] for t in info.get('tags', []) if t.startswith('license:')), None), 'files': {}}
paths = {}
for key, f in (('model', model), ('mmproj', mm)):
    dst = os.path.join(out, os.path.basename(f))
    if not os.path.exists(dst):
        urllib.request.urlretrieve(f'https://huggingface.co/{repo}/resolve/main/{f}', dst)
    h = hashlib.sha256()
    with open(dst, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''): h.update(b)
    meta['files'][key] = {'name': f, 'bytes': os.path.getsize(dst), 'sha256': h.hexdigest()}
    paths[key] = dst
json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
print(json.dumps(meta, indent=1))
gh = os.environ.get('GITHUB_OUTPUT')
if gh:
    with open(gh, 'a') as fh: fh.write(f"model={paths['model']}\nmmproj={paths['mmproj']}\n")
