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

function checkCover(list) {
  const errs = [];
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
checkHolidays(win.HOLIDAYS).concat(checkCover(win.COVER)).forEach(e => expect('holidays.js：' + e, false));

// ---- 字級下限 12px ----
const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
[...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].forEach(m => {
  const line = css.slice(0, m.index).split('\n').length;
  expect('字級 ' + m[1] + 'px 小於 12px（style 第 ' + line + ' 行）', Number(m[1]) >= 12);
});

if (fail) { console.log(fail + ' 項沒過'); process.exit(1); }
console.log('預約頁檢查全部通過（停診 ' + (win.HOLIDAYS || []).length + ' 筆、代診 ' + (win.COVER || []).length + ' 筆）');
