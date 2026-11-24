// 預約頁檢查：node tests/book.test.js（在 book 資料夾）或 node book/tests/book.test.js（在主 repo）
// 1. holidays.js 的 HOLIDAYS／COVER 格式。打錯時 index.html 會默默略過那一行，病人就約得到停診的時段，所以要在這裡擋。
// 2. 字級下限 12px：手機上 9px、11px 的小字長輩看不清楚。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 從 index.html 讀出醫師與排班，跟頁面用同一份設定
function constOf(name) {
  const m = html.match(new RegExp('const ' + name + ' = (\\{[^\\n]*\\});'));
  if (!m) throw new Error('index.html 找不到 const ' + name);
  return vm.runInNewContext('(' + m[1] + ')');
}
const DOCTORS = constOf('DOCTORS');
const DOC = constOf('DOC');
const SESS = { '早診': 'AM', '午診': 'PM', '晚診': 'EVE' };
const NAMES = Object.values(DOCTORS).map(d => d.name);

function realDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}
// 這一天這一診原本排誰（沒有門診回傳 null）
function scheduled(dt, sess) {
  const c = DOC[SESS[sess]][dt.getDay()];
  return DOCTORS[c] ? c : null;
}

function checkHolidays(list) {
  const errs = [];
  const seen = new Set();
  (list || []).forEach(raw => {
    const line = String(raw).trim();
    const where = '停診「' + raw + '」';
    if (seen.has(line)) errs.push(where + '重複');
    seen.add(line);
    const parts = line.split(/\s+/);
    if (parts.length > 2) { errs.push(where + '多了字，格式是「年-月-日」或「年-月-日 早診」'); return; }
    const dt = realDate(parts[0]);
    if (!dt) { errs.push(where + '日期要寫成 2026-12-25 這種格式，而且要是真的日期'); return; }
    if (parts[1] === undefined) return;
    if (!SESS[parts[1]]) { errs.push(where + '診別只能寫早診、午診、晚診'); return; }
    if (!scheduled(dt, parts[1])) errs.push(where + '那天原本就沒有' + parts[1]);
  });
  return errs;
}

function checkCover(list, holidays) {
  const errs = [];
  const off = new Set((holidays || []).map(h => String(h).trim()));
  const seen = new Set();
  (list || []).forEach(raw => {
    const line = String(raw).trim();
    const where = '代診「' + raw + '」';
    const parts = line.split(/\s+/);
    if (parts.length !== 3) { errs.push(where + '格式是「年-月-日 早診 醫師全名」，中間用空格隔開'); return; }
    const [date, sess, who] = parts;
    const dt = realDate(date);
    if (!dt) { errs.push(where + '日期要寫成 2026-12-14 這種格式，而且要是真的日期'); return; }
    if (!SESS[sess]) { errs.push(where + '診別只能寫早診、午診、晚診'); return; }
    const code = Object.keys(DOCTORS).find(k => DOCTORS[k].name === who);
    if (!code) { errs.push(where + '醫師要寫全名：' + NAMES.join('或')); return; }
    const orig = scheduled(dt, sess);
    if (!orig) errs.push(where + '那天原本就沒有' + sess);
    else if (orig === code) errs.push(where + '那一診本來就是' + who);
    if (off.has(date) || off.has(date + ' ' + sess)) errs.push(where + '那一診已經停診，代診不會生效，請刪掉其中一行');
    if (seen.has(date + ' ' + sess)) errs.push(where + '同一診寫了兩次');
    seen.add(date + ' ' + sess);
  });
  return errs;
}

let fail = 0;
function expect(name, ok, detail) {
  if (ok) return;
  fail++;
  console.log('✗ ' + name + (detail ? '\n    ' + detail : ''));
}

// ---- 自我測試：故意打錯的寫法一定要被抓到 ----
const BAD = [
  ['停診寫夜診', checkHolidays(['2026-12-15 夜診'])],
  ['停診日期不存在', checkHolidays(['2026-02-30'])],
  ['停診日期少補零', checkHolidays(['2026-1-1'])],
  ['停診那天原本沒那一診', checkHolidays(['2026-12-13 午診'])], // 週日沒有午診
  ['代診寫夜診', checkCover(['2026-12-14 夜診 李品翰醫師'])],
  ['代診醫師名打錯', checkCover(['2026-12-14 晚診 李品瀚醫師'])],
  ['代診只寫姓', checkCover(['2026-12-14 晚診 李醫師'])],
  ['代診少了醫師', checkCover(['2026-12-14 晚診'])],
  ['代診給原本的醫師', checkCover(['2026-12-14 晚診 林彥廷醫師'])], // 週一晚診本來就是林醫師
  ['代診那一診已停診', checkCover(['2026-12-16 晚診 李品翰醫師'], ['2026-12-16 晚診'])],
  ['代診那天整天停診', checkCover(['2026-12-16 晚診 李品翰醫師'], ['2026-12-16'])],
];
BAD.forEach(([name, errs]) => expect('自我測試：' + name + '應該報錯', errs.length > 0));
const GOOD = [
  ['停診整天', checkHolidays(['2026-12-25'])],
  ['停診早診', checkHolidays(['2026-12-13 早診'])],
  ['代診', checkCover(['2026-12-14 晚診 李品翰醫師'])],
];
GOOD.forEach(([name, errs]) => expect('自我測試：' + name + '不該報錯', errs.length === 0, errs.join('；')));

// ---- 檢查真正的 holidays.js ----
const win = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'holidays.js'), 'utf8'), { window: win });
checkHolidays(win.HOLIDAYS).concat(checkCover(win.COVER, win.HOLIDAYS)).forEach(e => expect('holidays.js：' + e, false));

// ---- 字級下限 12px ----
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
[...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].forEach(m => {
  const line = css.slice(0, m.index).split('\n').length;
  expect('字級 ' + m[1] + 'px 小於 12px（style 第 ' + line + ' 行）', Number(m[1]) >= 12);
});

// ---- 排班與送出訊息：把 index.html 的主程式放進 node 跑，時間固定在 2026-12-14（一）09:30 ----
// 頁面程式碼不改結構，這裡用最小的假 DOM 讓它能執行；停診與代診用下面的固定資料，不受 holidays.js 影響。
function loadPage(opts) {
  const NOW = new Date(2026, 11, 14, 9, 30).getTime();
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
  }
  const noop = () => {};
  function el() {
    const t = { value: '', hidden: false, textContent: '', innerHTML: '', dataset: {}, style: { setProperty: noop },
      classList: { add: noop, remove: noop, toggle: noop, contains: () => false } };
    return new Proxy(t, {
      get: (o, k) => (k in o || typeof k === 'symbol') ? o[k] : () => el(),
      set: (o, k, v) => { o[k] = v; return true; },
    });
  }
  const els = {};
  const document = {
    getElementById: id => els[id] || (els[id] = el()),
    createElement: el, querySelector: el, querySelectorAll: () => [],
    body: el(), addEventListener: noop, write: noop, execCommand: noop, hidden: false, activeElement: null,
  };
  const ctx = {
    Date: FakeDate, document, URLSearchParams,
    location: { search: (opts && opts.search) || '', pathname: '/book/', hash: '' },
    localStorage: { getItem: k => (opts && opts.store && opts.store[k]) || null, setItem: noop, removeItem: noop },
    navigator: {}, matchMedia: () => ({ matches: true }),
    setTimeout: noop, setInterval: noop, requestAnimationFrame: noop, addEventListener: noop,
    HOLIDAYS: ['2026-12-25', '2026-12-16 晚診', '2026-12-19'],
    COVER: ['2026-12-21 晚診 李品翰醫師'].concat((opts && opts.cover) || []),
  };
  if (opts && opts.noHolidays) delete ctx.HOLIDAYS; // 模擬 holidays.js 沒載入
  ctx.window = ctx;
  const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('===== 設定區 ====='));
  vm.runInNewContext(main + '\nglobalThis.__T = { st, ITEMS, S };', ctx);
  ctx.$ = document.getElementById;
  ctx.item = name => ctx.__T.ITEMS.find(i => i.name === name);
  return ctx;
}

const P = loadPage();
const on = (name, date) => P.sessionsOn(P.item(name), P.parse(date)).join(',');
[
  ['當天早診已過截止時間，只剩午診晚診', on('健保門診', '2026-12-14'), 'PM,EVE'],
  ['週二三診都開', on('健保門診', '2026-12-15'), 'AM,PM,EVE'],
  ['腸胃鏡只排林醫師的診', on('腸胃鏡／痔瘡諮詢', '2026-12-15'), 'AM,PM'],
  ['整天停診', on('健保門診', '2026-12-25'), ''],
  ['只停晚診', on('健保門診', '2026-12-16'), 'AM,PM'],
  ['週日只有早診', on('健保門診', '2026-12-13'), 'AM'],
  ['代診後林醫師的項目約不到', on('腸胃鏡／痔瘡諮詢', '2026-12-21'), ''],
  ['代診後李醫師的項目多了晚診', on('傷口照護', '2026-12-21'), 'AM,PM,EVE'],
  ['代診醫師名字', P.doctorOf('EVE', P.parse('2026-12-21')), '李品翰醫師'],
].forEach(([name, got, want]) => expect('排班：' + name, got === want, '得到「' + got + '」，應該是「' + want + '」'));

// 近期停診公告：整天停診但那天本來只有一診（週六、週日只有早診），寫那一診，不寫「全天」（YT 2026-11-19）
const notice = P.$('notice-list').innerHTML;
[
  ['週六整天停診寫早診', '12月19日（週六）早診，<b>停診</b>'],
  ['平日整天停診寫全天', '12月25日（週五）全天，<b>停診</b>'],
].forEach(([name, want]) => expect('停診公告：' + name, notice.includes(want), '公告內容：' + notice));

// 依序填好表單後比對整段訊息
function msgOf(page, fill) {
  const st = page.__T.st;
  Object.assign(st, { typed: true, isNew: false, item: null, date: null, session: null }, fill.st);
  Object.entries(fill.val || {}).forEach(([id, v]) => { page.$(id).value = v; });
  return page.message();
}
const M = [
  ['複診', msgOf(loadPage(), { st: { item: P.item('健保門診'), date: '2026-12-15', session: 'AM' }, val: { patientName: '王小明' } }),
    '【預約】複診\n姓名：王小明\n項目：健保門診\n時間：12月15日（週二）早診\n醫師：林彥廷醫師'],
  ['初診', msgOf(loadPage(), { st: { isNew: true, item: P.item('傷口照護'), date: '2026-12-21', session: 'EVE' },
    val: { patientName: '王小明', idNumber: 'a123456789', phone: '0912-345-678', bY: '1980', bM: '3', bD: '5', note: '右手割傷' } }),
    '【預約】初診\n姓名：王小明\n項目：傷口照護\n時間：12月21日（週一）晚診\n醫師：李品翰醫師\nＩＤ：A123456789\n生日：1980年3月5日\n（民國69年3月5日）\n手機：0912345678\n備註：右手割傷'],
  ['複診填了生日', msgOf(loadPage(), { st: { item: P.item('健保門診'), date: '2026-12-15', session: 'AM' }, val: { patientName: '王小明', bY: '1980', bM: '3', bD: '5' } }),
    '【預約】複診\n姓名：王小明\n生日：1980年3月5日\n（民國69年3月5日）\n項目：健保門診\n時間：12月15日（週二）早診\n醫師：林彥廷醫師'],
  // YT 2026-11-19：怕病人覺得被追蹤，網址參數一律不帶進訊息，來源只由初診病人自己勾選
  ['網址帶 utm 也不寫進訊息', msgOf(loadPage({ search: '?utm_source=threads&v=1' }), { st: { item: P.item('健保門診'), date: '2026-12-15', session: 'AM' }, val: { patientName: '王小明' } }),
    '【預約】複診\n姓名：王小明\n項目：健保門診\n時間：12月15日（週二）早診\n醫師：林彥廷醫師'],
  ['取消', msgOf(loadPage(), { st: { change: true, action: '取消' }, val: { patientName: '王小明', origDate: '2026-12-15', origSess: 'AM', note: '臨時出差' } }),
    '【取消】\n姓名：王小明\n原預約：12月15日（週二）早診\n備註：臨時出差'],
  ['取消時就算選過項目也不帶', msgOf(loadPage(), { st: { change: true, action: '取消', item: P.item('健保門診'), date: '2026-12-15', session: 'AM' }, val: { patientName: '王小明', origDate: '2026-12-15', origSess: 'AM' } }),
    '【取消】\n姓名：王小明\n原預約：12月15日（週二）早診'],
  ['改約', msgOf(loadPage(), { st: { change: true, action: '改約', item: P.item('健保門診'), date: '2026-12-16', session: 'PM' }, val: { patientName: '王小明', origDate: '2026-12-15', origSess: 'AM', bY: '1980', bM: '3', bD: '5' } }),
    '【改約】\n姓名：王小明\n生日：1980年3月5日\n（民國69年3月5日）\n原預約：12月15日（週二）早診\n改為：健保門診\n時間：12月16日（週三）午診\n醫師：李品翰醫師'],
];
M.push(['改約不記得原預約', msgOf(loadPage(), { st: { change: true, action: '改約', item: P.item('健保門診'), date: '2026-12-16', session: 'PM' }, val: { patientName: '王小明', origDate: 'unknown' } }),
  '【改約】\n姓名：王小明\n原預約：不記得，請櫃台幫我查\n改為：健保門診\n時間：12月16日（週三）午診\n醫師：李品翰醫師']);
M.forEach(([name, got, want]) => expect('送出訊息：' + name, got === want, '得到：\n' + got + '\n  應該是：\n' + want));

// ---- 2026-11-24 第三批：D1 停診資料沒載入、D2 姓名帶入提示、D3 停診代診衝突、O1 類別不預設、O2 原預約選單 ----
const msgs = page => page.missing().map(m => m.msg);
{
  const p = loadPage({ noHolidays: true });
  Object.assign(p.__T.st, { typed: true, item: p.item('健保門診'), date: '2026-12-15', session: 'AM' });
  p.$('patientName').value = '王小明';
  expect('D1：停診資料沒載入要擋送出', msgs(p).some(m => m.includes('停診資料沒載入')), msgs(p).join('；'));
  Object.assign(p.__T.st, { change: true, action: '取消' });
  p.$('origDate').value = '2026-12-15'; p.$('origSess').value = 'AM';
  expect('D1：取消不需要停診資料', msgs(p).length === 0, msgs(p).join('；'));
}
expect('D2：有記住的姓名要顯示提示', loadPage({ store: { 'muzi-book-name': '王小明' } }).$('name-hint').hidden === false);
expect('D2：沒記住姓名不顯示提示', loadPage().$('name-hint').hidden === true);
{
  const n = loadPage({ cover: ['2026-12-16 晚診 李品翰醫師'] }).$('notice-list').innerHTML;
  expect('D3：已停診的那一診不列代診', !n.includes('12月16日（週三）晚診，由'), n);
}
{
  const p = loadPage();
  expect('O1：一開始沒選類別', p.__T.st.typed === false);
  expect('O1：沒選類別要擋送出，而且排第一個', (msgs(p)[0] || '').includes('預約類別'), msgs(p).join('；'));
}
{
  const p = loadPage();
  Object.assign(p.__T.st, { typed: true, change: true, action: '改約', item: p.item('健保門診'), date: '2026-12-16', session: 'PM' });
  p.$('patientName').value = '王小明'; p.$('origDate').value = '2026-12-15';
  expect('O2：原預約選了日期沒選時段要擋', msgs(p).some(m => m.includes('原本預約的時段')), msgs(p).join('；'));
  p.$('origDate').value = 'unknown';
  expect('O2：不記得原預約可以送出', msgs(p).length === 0, msgs(p).join('；'));
}

if (fail) { console.log(fail + ' 項沒過'); process.exit(1); }
console.log('預約頁檢查全部通過（停診 ' + (win.HOLIDAYS || []).length + ' 筆、代診 ' + (win.COVER || []).length + ' 筆）');
