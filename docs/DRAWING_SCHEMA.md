# Схема чертежа `fresa.drawing/1`

Статус: проект. Единицы — мм, углы — градусы, система координат чертежа: X вправо, Y вверх, ноль задаёт пользователь (по умолчанию — левый нижний угол габарита).

## Слои (разделены физически)

```jsonc
{
  "schema": "fresa.drawing/1",
  "id": "drw_…",
  "created": "2026-11-10T…", "app": "2.9.2",
  "sources": [ { "id": "src1", "kind": "dxf|pdf|image", "name": "plate.pdf", "page": 1,
                 "sha256": "…", "px2mm": null, "storedIn": "idb:drawings/src1" } ],
  "views": [ { "id": "v1", "name": "Главный", "plane": "XY", "bbox": [x0,y0,x1,y1], "sourceId": "src1" } ],

  "observations": [ /* то, что нашли алгоритмы/OCR/ИИ. Неизменяемо, только добавляется */ ],
  "confirmed":    [ /* то, что подтвердил человек. Меняется только действием пользователя */ ],
  "computed":     [ /* производные: контуры, массивы, центры — пересчитываются из confirmed */ ],
  "operations":   [ /* предложенные/принятые операции CAM со ссылками на confirmed */ ],
  "history":      [ /* журнал правок: кто, что, было → стало */ ]
}
```

## Общие поля элемента

```jsonc
{
  "id": "e12",
  "type": "Line|Arc|Circle|Polyline|ClosedContour|Hole|HolePattern|Pocket|Slot|Chamfer|Fillet|Thread|Dimension|Tolerance|UnknownFeature",
  "viewId": "v1",
  "geom": { /* по типу, ниже */ },
  "units": "mm",
  "dims": ["d3", "d7"],             // ссылки на Dimension
  "tol": { "upper": 0.018, "lower": 0, "fit": "H7" },
  "source": { "sourceId": "src1", "bbox": [..], "handle": "1F2" /* DXF */, "by": "dxf|pdf-vector|trace|ocr|vlm|user" },
  "confidence": 0.0,                // 1.0 только для векторных источников и ввода пользователя
  "status": "observed|suggested|confirmed|rejected|unsupported",
  "links": [ { "rel": "dimensionOf|partOf|patternOf|contradicts", "to": "e7" } ],
  "rev": 1
}
```

### geom по типам

| Тип | geom |
|---|---|
| Line | `{x1,y1,x2,y2}` |
| Arc | `{cx,cy,r,a1,a2,ccw}` (как примитив `A` в Чертеже 2D) |
| Circle | `{cx,cy,r}` |
| Polyline / ClosedContour | `{els:[Line|Arc …], closed}` — совместимо с `contour.els` |
| Hole | `{cx,cy,d,depth|null,through:bool,cbore?,csink?}` |
| HolePattern | `{holeRef, kind:'list|pcd|grid|line|arc', params}` — совместимо с `PAT` (`index.html:517`) |
| Pocket | `{contourRef|rect{cx,cy,w,h,r}|circle{cx,cy,d}, depth, floorR}` |
| Slot | `{x1,y1,x2,y2,w,depth}` |
| Chamfer / Fillet | `{edgeRef, size, angle}` / `{edgeRef, r}` |
| Thread | `{holeRef, spec:'M8x1.25', depth, hand}` |
| Dimension | `{kind:'linear|diameter|radius|angular|ordinate', value, text, from, to, tol}` |
| UnknownFeature | `{note}` — показать пользователю, в CAM не идёт |

## Правила

1. `observations` пишут только распознаватели; `confirmed` — только UI по действию пользователя. Новый ответ ИИ **никогда** не меняет `confirmed`: он добавляет `observation` с `links:[{rel:'contradicts',to}]`, и UI показывает конфликт.
2. Размер в пикселях ≠ размер: для растра `confidence ≤ 0.8`, пока размер не подтверждён числом с чертежа или пользователем.
3. Нет выдуманных значений: неизвестная глубина = `null`, CAM требует ввести.
4. Миграции: поле `schema` с версией; загрузчик знает все прошлые версии.
5. Хранение: JSON проекта (как сейчас) + исходные файлы и картинки в IndexedDB (`localStorage` ≈5 МБ не хватает — `index.html:2981`).

## Связь с текущими данными Fresa

| Схема | Сейчас в Fresa |
|---|---|
| Line/Arc/Circle | `st.sketch.ps` (`{t:'L'|'A'|'C',…}`) |
| ClosedContour | результат `skCont()` (`index.html:2743`) |
| Hole/HolePattern | операция `drill` + `PAT` |
| Pocket/Slot | `pocketRect`, `pocketCircle`, `pocketOval`, `pocketIsl`, `slot` |
| Операции | `st.ops` (`index.html:522`) |
