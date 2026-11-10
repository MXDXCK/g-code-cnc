// Эталонный G-код: одинаковые входы → тот же G-код байт в байт.
// Обновить эталоны (только при НАМЕРЕННОМ изменении генератора): UPDATE_GOLDEN=1 npx playwright test tests/e2e/golden.spec.js
const { test, expect } = require('playwright/test');
const fs = require('fs');
const path = require('path');
const { openApp, ROOT } = require('../helpers');

const GOLD = path.join(ROOT, 'tests', 'golden');
const SETUPS = {
  default: '',
  corner: "(()=>{Object.assign(__fcam.st().stock,{origin:'corner'});})()",
  rodflats: `(()=>{const st=__fcam.st();st.prog.mp={mode:'off'};Object.assign(st.stock,{shape:'rod',d:32,rl:83.7,rx:-16,rz:'axis',adir:'1'});st.ops=[];
    st.tools.push({id:'e40',num:9,type:'endmill',d:40,fl:4,s:796,f:509});
    addOp('rodFlats',{th:15.6,len:20,step:1,fdir:'y',cnt:'2'});st.ops[0].tool='e40';})()`,
  rodflats_drill: `(()=>{const st=__fcam.st();st.prog.mp={mode:'off'};Object.assign(st.stock,{shape:'rod',d:32,rl:84,rx:-4,rz:'axis',adir:'1'});st.ops=[];
    st.tools.push({id:'e16',num:7,type:'endmill',d:16,fl:4,s:3000,f:600});
    addOp('rodFlats',{th:12,xe:-4,xs:30,cnt:'2',a0:0,step:2,strat:'one'});st.ops[0].tool='e16';
    addOp('drill',{pat:'list',list:'12 0',cycle:'G83',depth:14,q:3});const d=st.ops[1];d.aA='0';d.zt=6;})()`,
};

function compare(name, got) {
  const f = path.join(GOLD, name + '.nc');
  if (process.env.UPDATE_GOLDEN || !fs.existsSync(f)) { fs.mkdirSync(GOLD, { recursive: true }); fs.writeFileSync(f, got); return; }
  const want = fs.readFileSync(f, 'utf8');
  if (got !== want) {
    const a = want.split(/\r?\n/), b = got.split(/\r?\n/);
    if (a.length === b.length && a.every((line, k) => line === b[k])) return;
    const i = a.findIndex((l, k) => l !== b[k]);
    throw new Error(`${name}: G-код отличается от эталона, первая разница в строке ${i + 1}:\n  было:  ${a[i]}\n  стало: ${b[i]}`);
  }
}

for (const [name, js] of Object.entries(SETUPS)) {
  for (const fmt of ['plain', 'macro']) {
    test(`эталон ${name} / ${fmt}`, async ({ page }) => {
      const errors = await openApp(page);
      if (js) await page.evaluate(js);
      const code = await page.evaluate(f => { __fcam.st().prog.fmt = f; return __fcam.gen(); }, fmt);
      compare(`${name}_${fmt}`, code);
      expect(errors).toEqual([]);
    });
  }
}

test('эталоны всех шаблонов деталей (обычный G-код)', async ({ page }) => {
  const errors = await openApp(page);
  const n = await page.evaluate(() => document.querySelectorAll('.tpl').length);
  expect(n).toBeGreaterThan(10);
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate(i => {
      tplUse(i); const st = __fcam.st(); st.prog.fmt = 'plain';
      const bad = st.ops.map(o => { try { __fcam.opCode(o); return null; } catch (e) { return o.type + ': ' + e.message; } }).filter(Boolean);
      return { name: st.prog.name, bad, code: __fcam.gen() };
    }, i);
    expect(r.bad, `шаблон ${i} ${r.name}`).toEqual([]);
    compare(`tpl_${String(i).padStart(2, '0')}`, r.code);
  }
  expect(errors).toEqual([]);
});
