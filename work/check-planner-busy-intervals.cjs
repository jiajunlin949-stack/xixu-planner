const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'xixu-harmony/web/modules/shell.js'), 'utf8');
const productivity = fs.readFileSync(path.join(root, 'xixu-harmony/web/modules/productivity.js'), 'utf8');
function sourceSection(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Production function section is present');
  return source.slice(from, to);
}
// Use the actual recurrence/reschedule selectors and planner functions, not a
// parallel scheduling implementation. Uncalled UI helpers need no browser.
const lessonSource = sourceSection(shell, '  function lessonPeriodNumbers(', '  const weekRange =');
const plannerSource = sourceSection(productivity, '  const minuteOf=', '  function timelineItems(');
const clone = value => JSON.parse(JSON.stringify(value));
const addDays = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const periods = [['08:30','09:10'],['09:15','09:55'],['10:15','10:55'],['11:00','11:40'],['11:45','12:25'],['14:00','14:40'],['14:45','15:25'],['15:45','16:25'],['16:30','17:10'],['17:15','17:55'],['19:00','19:40'],['19:40','20:20'],['20:30','21:10'],['21:10','21:50']];
function runtime(seed = {}) {
  let nextId = 0;
  const state = {
    TERM_MONDAY: '2026-08-31', DEMO_DAY: '2026-09-20', DEMO_NOW: Date.parse('2026-09-20T09:00:00+08:00'),
    lessons: [], tasks: [],
    scheduleSettings: {periods: periods.map(([start,end]) => ({start,end}))},
    blockPeriods: [[1,2],[3,4],[6,7],[8,9],[11,12],[13,14],[5]],
    addDays, uid: () => 'synthetic-' + (++nextId),
    top: value => '<h1>' + value + '</h1>', empty: value => '<p>' + value + '</p>',
    icon: () => '', esc: value => String(value), dateLabel: value => String(value), weekday: () => '',
    ...seed,
  };
  const api = vm.runInNewContext('let plannerDraft=null;\n' + lessonSource + '\n' + plannerSource + '\n({busyIntervals,freeSegments,renderPlanner,lessonOnDate,lessonsOnDate})', state);
  return {state, api, busy: (date, excluded) => clone(api.busyIntervals(date, excluded))};
}
const date = '2026-09-25';
const timed = (id, type, time, extra = {}) => ({id,type,time,date,done:false,sessions:[],...extra});
const lesson = (id, extra = {}) => ({id,course:'synthetic-course',day:4,weeks:[4],period:'1–2',...extra});
const checks = [];
function check(name, test) { test(); checks.push(name); }

check('cancelled original occurrence does not occupy its old date', () => {
  const value = runtime({lessons:[lesson('source',{cancelledDates:[date]})]});
  assert.equal(value.api.lessonsOnDate(date).length, 1, 'Production default includes a faded historical occurrence');
  assert.deepEqual(value.busy(date), []);
});
check('uncancelled recurrence still occupies its actual teaching date', () => {
  const value = runtime({lessons:[lesson('normal')]});
  assert.deepEqual(value.busy(date), [[510,595]]);
  assert.deepEqual(value.busy('2026-09-24'), []);
});
check('rescheduled incoming occurrence occupies only its exact override date', () => {
  const value = runtime({lessons:[lesson('incoming',{dateOverride:'2026-09-30',day:2,weeks:[5]})]});
  assert.deepEqual(value.busy('2026-09-30'), [[510,595]]);
  assert.deepEqual(value.busy('2026-10-07'), []);
  assert.deepEqual(value.busy(date), []);
});
check('cancelled source and incoming occurrence are resolved by the same production selectors', () => {
  const value = runtime({lessons:[lesson('source',{cancelledDates:[date]}),lesson('incoming',{dateOverride:'2026-09-30'})]});
  assert.deepEqual(value.busy(date), []);
  assert.deepEqual(value.busy('2026-09-30'), [[510,595]]);
});
check('valid teaching weeks after week 20 are not dropped by the planner', () => {
  const later = addDays('2026-08-31', 20 * 7);
  const value = runtime({lessons:[lesson('late',{day:0,weeks:[21]})]});
  assert.deepEqual(value.busy(later), [[510,595]]);
});
check('a far-future single-date reschedule is not dropped by a teaching-week cap', () => {
  const value = runtime({lessons:[lesson('late-incoming',{dateOverride:'2027-03-10'})]});
  assert.deepEqual(value.busy('2027-03-10'), [[510,595]]);
});
check('unfinished tasks, meetings, and exams each reserve the same estimated hour', () => {
  const value = runtime({tasks:[timed('task','task','09:00'),timed('meeting','meeting','11:00'),timed('exam','exam','14:00')]});
  assert.deepEqual(value.busy(date), [[540,600],[660,720],[840,900]]);
});
check('an unplanned homework deadline is a point and does not reserve an hour', () => {
  const value = runtime({tasks:[timed('homework','homework','15:00'),timed('legacy-summary','summary','16:00')]});
  assert.deepEqual(value.busy(date), []);
});
check('unfinished study sessions reserve their explicit duration including homework sessions', () => {
  const value = runtime({tasks:[timed('homework','homework','23:59',{sessions:[{date,time:'14:00',minutes:90,done:false}]})]});
  assert.deepEqual(value.busy(date), [[840,930]]);
});
check('completed events and completed parent tasks do not occupy slots through stale sessions', () => {
  const value = runtime({tasks:[timed('done-event','meeting','09:00',{done:true}),timed('done-parent','homework','23:59',{done:true,sessions:[{date,time:'14:00',minutes:90,done:false}]})]});
  assert.deepEqual(value.busy(date), []);
});
check('completed or other-date sessions are excluded', () => {
  const value = runtime({tasks:[timed('parent','homework','23:59',{sessions:[{date,time:'14:00',minutes:90,done:true},{date:'2026-09-24',time:'16:00',minutes:60,done:false}]})]});
  assert.deepEqual(value.busy(date), []);
});
check('excludeTaskId excludes both the task event and all of its study sessions', () => {
  const value = runtime({tasks:[timed('excluded','meeting','09:00',{sessions:[{date,time:'14:00',minutes:90,done:false}]}),timed('kept','exam','16:00')]});
  assert.deepEqual(value.busy(date, 'excluded'), [[960,1020]]);
});
check('an omitted excludeTaskId does not accidentally exclude an unlabelled legacy task', () => {
  const value = runtime({tasks:[timed(undefined,'meeting','09:00')]});
  assert.deepEqual(value.busy(date), [[540,600]]);
});
check('overlapping and nested intervals merge without duplicating occupied time', () => {
  const value = runtime({tasks:[timed('a','meeting','09:00'),timed('b','exam','09:30'),timed('c','homework','23:59',{sessions:[{date,time:'09:45',minutes:15,done:false}]})]});
  assert.deepEqual(value.busy(date), [[540,630]]);
});
check('adjacent half-open intervals are not treated as overlapping', () => {
  const value = runtime({tasks:[timed('a','meeting','09:00'),timed('b','exam','10:00')]});
  assert.deepEqual(value.busy(date), [[540,600],[600,660]]);
  assert.deepEqual(clone(value.api.freeSegments(date))[0], [660,720]);
});
check('overlap merging works across lessons, events, and study sessions', () => {
  const value = runtime({lessons:[lesson('class')],tasks:[timed('a','meeting','09:30'),timed('b','homework','23:59',{sessions:[{date,time:'10:00',minutes:60,done:false}]})]});
  assert.deepEqual(value.busy(date), [[510,660]]);
});
check('late-night events and sessions are clipped to the end of the same day', () => {
  const value = runtime({tasks:[timed('late-event','meeting','23:30'),timed('late-session','homework','23:59',{sessions:[{date,time:'23:50',minutes:90,done:false}]})]});
  assert.deepEqual(value.busy(date), [[1410,1440]]);
  assert.deepEqual(value.busy(addDays(date, 1)), [], 'No unrecorded next-day occupancy is invented');
});
check('invalid clock strings cannot contribute NaN, negative, or out-of-day slots', () => {
  const invalid = ['', 'bad', 'NaN:00', '-1:00', '25:00', '09:99', '09:00junk', '24:00'];
  const value = runtime({tasks:invalid.map((time,index) => timed('bad-' + index,'meeting',time))});
  assert.deepEqual(value.busy(date), []);
});
check('invalid, zero, negative, and infinite session durations are ignored', () => {
  const value = runtime({tasks:[timed('parent','homework','23:59',{sessions:[0,-10,NaN,Infinity,undefined].map(minutes => ({date,time:'14:00',minutes,done:false}))})]});
  assert.deepEqual(value.busy(date), []);
});
check('unknown lesson clock values and reversed intervals do not occupy the day', () => {
  const value = runtime({lessons:[lesson('bad')],scheduleSettings:{periods:[{start:'待确认',end:'09:10'},{start:'09:15',end:'09:55'}]}});
  assert.deepEqual(value.busy(date), []);
  const reversed = runtime({lessons:[lesson('reversed')],scheduleSettings:{periods:[{start:'10:00',end:'10:30'},{start:'09:00',end:'09:30'}]}});
  assert.deepEqual(reversed.busy(date), []);
});
check('an explicit 24:00 lesson end remains a valid day boundary', () => {
  const value = runtime({lessons:[lesson('midnight',{period:'1'})],scheduleSettings:{periods:[{start:'23:00',end:'24:00'}]}});
  assert.deepEqual(value.busy(date), [[1380,1440]]);
});
check('malformed session collections are ignored instead of throwing', () => {
  const value = runtime({tasks:[timed('parent','homework','23:59',{sessions:{unexpected:true}})]});
  assert.deepEqual(value.busy(date), []);
  const nullEntries = runtime({tasks:[timed('parent','homework','23:59',{sessions:[null,undefined,{date,time:'14:00',minutes:60,done:false}]})]});
  assert.deepEqual(nullEntries.busy(date), [[840,900]]);
});
check('occupation queries and interval merging leave all source records unchanged', () => {
  const value = runtime({lessons:[lesson('source',{cancelledDates:[date]}),lesson('in',{dateOverride:'2026-09-30'})],tasks:[timed('a','meeting','09:00'),timed('b','exam','09:30')]});
  const before = JSON.stringify({lessons:value.state.lessons,tasks:value.state.tasks});
  const result = value.busy(date);result[0][0] = 0;
  value.busy('2026-09-30');value.api.freeSegments(date);
  assert.equal(JSON.stringify({lessons:value.state.lessons,tasks:value.state.tasks}), before);
  assert.deepEqual(value.busy(date), [[540,630]]);
});

const target = timed('plan-target','homework','23:59',{title:'合成作业',estimateMinutes:120});
const notice = '未设置结束时间的会议/考试暂按1小时占用，请核对';
check('planner explains the one-hour estimate when a relevant unfinished timed meeting exists', () => {
  const value = runtime({tasks:[target,timed('relevant','meeting','14:00')]});
  assert.ok(value.api.renderPlanner(target).includes(notice));
});
check('planner explains the estimate for a relevant exam as well', () => {
  const value = runtime({tasks:[target,timed('relevant','exam','14:00')]});
  assert.ok(value.api.renderPlanner(target).includes(notice));
});
check('planner keeps the extra estimate notice absent for ordinary tasks and deadlines', () => {
  const value = runtime({tasks:[target,timed('ordinary','task','14:00'),timed('ddl','homework','15:00')]});
  assert.ok(!value.api.renderPlanner(target).includes(notice));
});
check('completed, untimed, invalid-time, past, and out-of-range events do not add a notice', () => {
  const value = runtime({tasks:[target,timed('done','exam','14:00',{done:true}),timed('untimed','meeting',''),timed('invalid','exam','25:00'),timed('past','meeting','14:00',{date:'2026-09-19'}),timed('after','exam','14:00',{date:'2026-09-26'})]});
  assert.ok(!value.api.renderPlanner(target).includes(notice));
});
check('the target item itself is excluded from the estimate notice', () => {
  const eventTarget = {...target,type:'exam',time:'14:00'};
  const value = runtime({tasks:[eventTarget]});
  assert.ok(!value.api.renderPlanner(eventTarget).includes(notice));
});
check('events beyond the actual 120-day planner horizon do not add a notice', () => {
  const farTarget = {...target,date:addDays('2026-09-20', 150)};
  const value = runtime({tasks:[farTarget,timed('too-far','meeting','14:00',{date:addDays('2026-09-20', 130)})]});
  assert.ok(!value.api.renderPlanner(farTarget).includes(notice));
});
check('rendering a plan is still a preview and does not write planned sessions to tasks', () => {
  const value = runtime({tasks:[target,timed('meeting','meeting','14:00')]});
  const before = JSON.stringify(value.state.tasks);
  value.api.renderPlanner(target);
  assert.equal(JSON.stringify(value.state.tasks), before);
});

console.log(JSON.stringify({passed:checks.length,environment:'Pure VM with production lesson selectors and planner; synthetic data only, no device test',checks},null,2));
