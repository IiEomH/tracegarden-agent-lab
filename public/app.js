const $ = selector => document.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  flask: '<path d="M9 3h6M10 3v6L4 19a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M8 14h8"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="m8 4 13 8-13 8V4Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  terminal: '<path d="m4 7 5 5-5 5M13 17h7"/>',
  book: '<path d="M3 4h6c2 0 3 1 3 2 0-1 1-2 3-2h6v16h-6c-2 0-3 1-3 1s-1-1-3-1H3V4Zm9 2v15"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
  filter: '<path d="M3 6h18M6 12h12M9 18h6"/>',
  edit: '<path d="m15 4 5 5M4 20l1-6L16 3l5 5-11 11-6 1Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  shield: '<path d="M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4L3 10M3 5v5h5M4 13a8 8 0 0 0 14.6 4L21 14m0 5v-5h-5"/>',
  alert: '<path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.layers}</svg>`;
const money = n => n === null || n === undefined ? '—' : `$${n.toFixed(n < .01 ? 6 : 4)}`;
const latency = n => n === undefined || n === null ? '—' : `${(n / 1000).toFixed(2)}s`;
const when = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const statuses = { queued: '等待中', running: '运行中', completed: '已完成', cancelled: '已取消', interrupted: '已中断', error: '错误' };
const evaluatorNames = { contains: '关键词命中', json: 'JSON 格式', tool: 'Tool Use' };
const state = { workspace: null, projectId: localStorage.getItem('tg.project'), page: 'overview', run: null, selectedModels: new Set(), selectedCases: new Set(), search: '', filter: 'all', busy: false, polling: false, traceId: null, testingModelId: null };
let toastTimer;
function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').className = `visible ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, 3500);
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
const project = () => state.workspace.projects.find(p => p.id === state.projectId);
const cases = () => state.workspace.cases.filter(c => c.projectId === state.projectId);
const runs = () => state.workspace.runs.filter(r => r.projectId === state.projectId);
async function refresh() {
  state.workspace = await api('/api/workspace');
  if (!project()) state.projectId = state.workspace.projects[0]?.id;
  if (!state.selectedModels.size) state.workspace.models.filter(m => m.demo).forEach(m => state.selectedModels.add(m.id));
  const valid = new Set(state.workspace.models.map(m => m.id));
  state.selectedModels = new Set([...state.selectedModels].filter(id => valid.has(id)));
  const validCases = new Set(cases().map(c => c.id));
  if (!state.selectedCases.size) cases().forEach(c => state.selectedCases.add(c.id));
  state.selectedCases = new Set([...state.selectedCases].filter(id => validCases.has(id)));
}
function badge(value, type = '') { return `<span class="badge ${type}">${h(value)}</span>`; }
function verdict(result) {
  if (result.status !== 'completed') return badge(statuses[result.status], result.status === 'error' ? 'red' : 'neutral');
  return badge(result.passed ? '通过' : '未通过', result.passed ? 'green' : 'red');
}
function failureType(result) {
  if (result.status === 'completed') return result.passed ? '' : '规则未命中';
  const reason = String(result.reason || '');
  if (/401|API Key|鉴权/i.test(reason)) return '鉴权失败';
  if (/429|限流|额度|余额/i.test(reason)) return '限流 / 额度';
  if (/超时|timeout/i.test(reason)) return '请求超时';
  if (/400|协议|parameter|参数|chat\/completions|responses/i.test(reason)) return '协议 / 参数';
  if (/Base URL|模型 ID|404/i.test(reason)) return '连接配置';
  return result.status === 'error' ? '上游请求' : '';
}
function resultVerdict(result) {
  const type = failureType(result);
  return `<span class="verdict-stack">${verdict(result)}${type ? `<small>${h(type)}</small>` : ''}</span>`;
}
function summary() {
  const results = state.run?.results ?? [];
  const finished = results.filter(r => !['queued', 'running'].includes(r.status));
  const completed = results.filter(r => r.status === 'completed');
  const errors = results.filter(r => r.status === 'error').length;
  const pass = completed.filter(r => r.passed).length;
  const durations = results.filter(r => r.duration !== undefined);
  const priced = results.filter(r => r.cost !== null && r.cost !== undefined);
  return { results, finished, completed, errors, pass, rate: completed.length ? Math.round(pass / completed.length * 100) : null, duration: durations.length ? durations.reduce((sum, r) => sum + r.duration, 0) / durations.length : null, cost: priced.length ? priced.reduce((sum, r) => sum + r.cost, 0) : null, partial: priced.length !== finished.length };
}
const selectedCases = () => cases().filter(c => state.selectedCases.has(c.id));
const previousRun = () => runs().find(r => r.id !== state.run?.id && r.status !== 'running' && r.demo === state.run?.demo && r.summary?.completed > 0 && r.createdAt < state.run?.createdAt
  && r.models?.map(m => m.id).sort().join(',') === state.run?.models?.map(m => m.id).sort().join(',')
  && r.cases?.map(c => c.id).sort().join(',') === state.run?.cases?.map(c => c.id).sort().join(','));
function healthBadge(model) {
  if (model.demo) return badge('DEMO', 'neutral');
  if (state.testingModelId === model.id) return badge('检测中…', 'amber');
  if (model.health?.status === 'ok') return badge(`可用 · ${latency(model.health.latency)}`, 'green');
  if (model.health?.status === 'error') return badge('需检查', 'red');
  return badge('未验证', 'neutral');
}
function render() {
  const pageLabels = { overview: '评测工作台', cases: '测试集', models: '模型连接', history: '运行记录' };
  $('#app').innerHTML = `
    <aside class="sidebar">
      <a href="/" class="brand"><img src="/favicon.svg" width="33" height="33" alt=""><span>tracegarden<span class="brand-dot">.</span></span></a>
      <button class="workspace-picker" data-action="project-menu"><span class="workspace-avatar">${h(project()?.name.slice(0, 1))}</span><span><strong>Personal workspace</strong><small>本地开发空间</small></span>${icon('down')}</button>
      <p class="nav-label">WORKSPACE</p>
      <nav aria-label="主导航">${[['overview', 'grid', '评测工作台'], ['cases', 'flask', '测试集'], ['models', 'layers', '模型连接'], ['history', 'clock', '运行记录']].map(([key, i, label]) => `<button class="nav-item ${state.page === key ? 'active' : ''}" data-page="${key}">${icon(i)}<span>${label}</span>${key === 'cases' ? `<span class="nav-count">${cases().length}</span>` : key === 'models' ? `<span class="nav-count">${state.workspace.models.length}</span>` : ''}</button>`).join('')}</nav>
      <div class="sidebar-bottom"><div class="build-note"><span class="note-icon">✳</span><strong>Build. Measure. Iterate.</strong><p>用可复现的评测，<br>找到下一次迭代的方向。</p><button data-action="guide">快速开始 ${icon('arrow')}</button></div><button class="local-status" data-action="guide"><span class="status-dot"></span>Local-first · v0.1<span>${icon('lock')}</span></button><div class="profile"><span class="profile-avatar">TG</span><span><strong>个人工作区</strong><small>数据保存在本机</small></span><span class="profile-tag">LOCAL</span></div></div>
    </aside>
    <div class="main-shell">
      <header class="topbar"><div class="breadcrumb"><span>Workspace</span>${icon('chevron')}<span>${h(project()?.name)}</span>${icon('chevron')}<strong>${pageLabels[state.page]}</strong></div><div class="topbar-right"><span class="local-pill"><span class="status-dot"></span>本地服务已连接</span><button class="icon-button" data-action="guide" aria-label="使用说明">${icon('book')}</button></div></header>
      <main>
        <div class="page-heading"><div><div class="eyebrow">AGENT EVALUATION / ${String(Object.keys(pageLabels).indexOf(state.page) + 1).padStart(2, '0')}</div><h1>${pageLabels[state.page]}<span class="heading-dot">.</span></h1><p>${({ overview: '把模型表现从「感觉不错」，变成可比较的证据。', cases: '用真实任务定义标准，让每一次迭代都可复现。', models: '统一连接不同协议，保留各自的 Agent 能力。', history: '回看每次实验的输入、配置与结果。' })[state.page]}</p></div><div class="heading-actions">${state.page === 'overview' ? `<button class="button" data-action="export" ${state.run ? '' : 'disabled'}>${icon('download')}导出报告</button><button class="button primary" data-action="run" ${state.busy || state.run?.status === 'running' ? 'disabled' : ''}>${icon('play')}新建评测</button>` : state.page === 'cases' ? `<button class="button primary" data-action="add-case">${icon('plus')}添加测试用例</button>` : state.page === 'models' ? `<button class="button primary" data-action="add-model">${icon('plus')}添加模型连接</button>` : `<button class="button primary" data-page="overview">${icon('flask')}前往工作台</button>`}</div></div>
        ${state.page === 'overview' ? overview() : state.page === 'cases' ? casePage() : state.page === 'models' ? modelPage() : historyPage()}
        <footer><span>TRACEGARDEN <span class="footer-cross">✳</span> 让 Agent 的进步有迹可循</span><span>LOCAL WORKSPACE <span>·</span> ${new Date().toLocaleDateString('en-CA')}</span></footer>
      </main>
    </div>`;
}
function overview() {
  const s = summary();
  const selected = state.workspace.models.filter(m => state.selectedModels.has(m.id));
  const allDemo = selected.every(m => m.demo);
  const runCases = selectedCases();
  const baseline = previousRun()?.summary;
  const rateDelta = baseline?.rate !== null && baseline?.rate !== undefined && s.rate !== null ? s.rate - baseline.rate : null;
  const durationDelta = s.completed.length && baseline?.duration && s.duration !== null ? Math.round((s.duration - baseline.duration) / baseline.duration * 100) : null;
  const rateNote = s.completed.length ? `${s.pass} / ${s.completed.length} 项完成任务通过${s.errors ? ` · ${s.errors} 项请求错误` : ''}${rateDelta === null ? '' : ` · 较上次 ${rateDelta >= 0 ? '+' : ''}${rateDelta}pp`}` : s.errors ? `${s.errors} 项请求错误，暂无有效评测` : '运行后自动计算';
  const durationNote = `含多轮模型调用与工具执行${durationDelta === null ? '' : ` · 较上次 ${durationDelta >= 0 ? '+' : ''}${durationDelta}%`}`;
  return `<section class="intro-strip"><div class="intro-icon">${icon('terminal')}</div><div><strong>从一次小实验，开始理解你的 Agent。</strong><p>同一组任务，多模型并行运行。对比质量、耗时与成本，定位每一步 Tool Use。</p></div><button data-action="guide">查看指南 ${icon('arrow')}</button><div class="strip-pattern" aria-hidden="true">✳</div></section>
    <section class="metric-grid" aria-label="本次评测指标">
      ${metric('评测通过率', s.rate === null ? '—' : `${s.rate}<span>%</span>`, rateNote, 'check', 'green')}
      ${metric('平均端到端耗时', s.duration === null ? '—' : `${(s.duration / 1000).toFixed(2)}<span>s</span>`, durationNote, 'clock')}
      ${metric('估算 API 成本', money(s.cost), state.run?.demo ? '演示数据不产生 API 费用' : s.cost === null ? '配置单价后显示 · USD' : s.partial ? '仅含已知成本 · 部分缺失' : '按配置单价估算 · USD', 'bolt')}
      ${metric('测试覆盖', `${runCases.length}<span>cases</span>`, `${selected.length} 个模型 · ${runCases.length * selected.length} 项任务`, 'flask')}
    </section>
    <section class="workspace-grid"><div class="panel config-panel"><div class="panel-title"><div><span class="section-index">01</span><h2>评测配置</h2></div>${badge(state.run?.status === 'running' ? 'RUNNING' : 'READY', state.run?.status === 'running' ? 'amber' : 'neutral')}</div><div class="config-body"><div class="field-heading"><label for="project-select">当前项目</label><button class="text-button" data-action="add-project">${icon('plus')}新建项目</button></div><select id="project-select">${state.workspace.projects.map(p => `<option value="${p.id}" ${p.id === state.projectId ? 'selected' : ''}>${h(p.name)}</option>`).join('')}</select><div class="field-heading model-heading"><label>参评模型</label><button class="text-button" data-page="models">管理连接 ${icon('arrow')}</button></div><div class="model-options">${state.workspace.models.map(m => `<label class="model-option ${state.selectedModels.has(m.id) ? 'selected' : ''}"><input type="checkbox" data-model="${m.id}" ${state.selectedModels.has(m.id) ? 'checked' : ''}><span class="provider-mark ${m.protocol}">${m.protocol === 'anthropic' ? '✳' : m.protocol === 'openai' ? '◎' : '✦'}</span><span class="model-option-name"><strong>${h(m.name)}</strong><small>${h(m.modelId)}</small></span>${healthBadge(m)}</label>`).join('') || '<p class="muted">添加第一个模型连接以开始。</p>'}</div><div class="field-heading case-heading"><label>本次用例</label><button class="text-button" data-page="cases">管理 Dataset ${icon('arrow')}</button></div><div class="case-options">${cases().map(c => `<label class="case-option ${state.selectedCases.has(c.id) ? 'selected' : ''}"><input type="checkbox" data-case="${c.id}" ${state.selectedCases.has(c.id) ? 'checked' : ''}><span><strong>${h(c.name)}</strong><small>${h(evaluatorNames[c.evaluator])} · ${h(c.tag || '自定义')}</small></span></label>`).join('') || '<p class="muted">添加第一个测试用例以开始。</p>'}</div><div class="config-summary"><span>${icon('flask')}${runCases.length}/${cases().length} 条用例 · ${runCases.length * selected.length} 项任务</span><button class="text-button" data-page="cases">编辑测试集 ${icon('chevron')}</button></div><button class="button primary wide" data-action="run" ${state.busy || state.run?.status === 'running' || !runCases.length || !selected.length ? 'disabled' : ''}>${icon('play')}${state.run?.status === 'running' ? '评测正在运行…' : allDemo ? '运行演示评测' : '运行真实评测'}<span>${runCases.length * selected.length} TASKS</span></button><p class="config-footnote">${allDemo ? '模拟输出仅用于体验流程，不代表真实模型表现。' : '将使用已保存的 API Key，产生实际 API 费用。'}</p></div></div>
      <div class="panel comparison-panel"><div class="panel-title"><div><span class="section-index">02</span><h2>模型表现</h2></div><span class="panel-caption">${state.run ? state.run.demo ? 'SIMULATED DATA' : 'CURRENT RUN' : 'WAITING FOR RUN'}</span></div>${comparison(s)}<div class="comparison-note">${icon('filter')}通过率衡量当前测试集，不能等同于模型整体能力。</div></div></section>
    <section class="panel results-panel"><div class="panel-title"><div><span class="section-index">03</span><h2>评测结果</h2>${state.run ? badge(state.run.demo ? '演示运行' : '真实运行', state.run.demo ? 'amber' : 'green') : ''}</div><div class="result-actions">${state.run?.status === 'running' ? `<span class="running-dot">${s.finished.length}/${state.run.total}</span><button class="text-button danger" data-action="cancel">取消运行</button>` : ''}<button class="text-button" data-page="history">全部记录 ${icon('arrow')}</button></div></div><div class="table-toolbar"><div class="result-tabs"><button class="${state.filter === 'all' ? 'selected' : ''}" data-filter="all">全部 <span>${s.results.length}</span></button><button class="${state.filter === 'passed' ? 'selected' : ''}" data-filter="passed">通过 <span>${s.pass}</span></button><button class="${state.filter === 'failed' ? 'selected' : ''}" data-filter="failed">未通过 <span>${s.completed.length - s.pass}</span></button><button class="${state.filter === 'error' ? 'selected' : ''}" data-filter="error">请求错误 <span>${s.errors}</span></button></div><div class="table-tools">${state.run ? `<span class="run-label">${h(state.run.name)}</span>` : ''}<label class="search-box">${icon('search')}<input id="result-search" type="search" value="${h(state.search)}" placeholder="搜索用例或模型" aria-label="搜索结果"></label></div></div><div id="results-table">${resultTable(s.results)}</div></section>`;
}
function metric(label, value, note, i, cls = '') { return `<article class="metric-card ${cls}"><div class="metric-label">${label}${icon(i)}</div><div class="metric-value">${value}</div><div class="metric-note">${h(note)}</div></article>`; }
function comparison(s) {
  if (!state.run) return `<div class="chart-empty"><div class="chart-illustration"><span></span><span></span><span></span><i>✳</i></div><strong>好的决策，始于一次对照实验</strong><p>选择左侧模型，运行你的第一组评测。</p><span class="empty-kicker">SAME TASKS. DIFFERENT MODELS.</span></div>`;
  return `<div class="comparison-chart"><div class="chart-head"><span>模型 / 通过率</span><span>平均耗时</span></div>${state.run.models.map(m => {
    const results = s.results.filter(r => r.modelId === m.id && !['queued', 'running'].includes(r.status));
    const completed = results.filter(r => r.status === 'completed');
    const errors = results.filter(r => r.status === 'error').length;
    const pass = completed.filter(r => r.passed).length;
    const rate = completed.length ? Math.round(pass / completed.length * 100) : null;
    const prior = previousRun();
    const priorResults = prior ? (state.workspace.runs.find(r => r.id === prior.id)?.summary ?? null) : null;
    const delta = priorResults?.rate !== null && priorResults?.rate !== undefined && rate !== null ? rate - priorResults.rate : null;
    const timed = results.filter(r => r.duration !== undefined);
    return `<div class="chart-model"><div class="chart-model-heading"><span><span class="provider-dot ${m.protocol}"></span>${h(m.name)}</span><span>${timed.length ? latency(timed.reduce((a, r) => a + r.duration, 0) / timed.length) : '—'}</span></div><div class="chart-bar-row"><progress class="chart-progress ${m.protocol}" value="${rate ?? 0}" max="100" aria-label="${h(m.name)} ${rate === null ? '没有有效评测' : `通过率 ${rate}%`}"></progress><strong>${rate === null ? '—' : `${rate}%`}</strong></div><small>${completed.length ? `${pass} / ${completed.length} 通过` : '0 项完成'}${errors ? ` · ${errors} 项错误` : ''}${delta === null ? '' : ` · 较上次 ${delta >= 0 ? '+' : ''}${delta}pp`}${m.demo ? ' · 模拟结果' : ''}</small></div>`;
  }).join('')}<div class="chart-axis"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div>`;
}
function resultTable(results) {
  const filtered = results.filter(r => {
    const matchesFilter = state.filter === 'all' || state.filter === 'passed' && r.status === 'completed' && r.passed === true || state.filter === 'failed' && r.status === 'completed' && r.passed === false || state.filter === 'error' && r.status === 'error';
    return matchesFilter && `${r.caseName} ${r.modelName}`.toLowerCase().includes(state.search.toLowerCase());
  });
  if (!results.length) return `<div class="empty-results">${icon('layers')}<strong>还没有评测结果</strong><p>运行后，每个任务的结果和完整 Trace 会出现在这里。</p><button class="text-button" data-action="run">开始第一次评测 ${icon('arrow')}</button></div>`;
  if (!filtered.length) return '<div class="empty-results compact"><p>没有符合条件的结果。</p></div>';
  return `<div class="table-scroll"><table><thead><tr><th>测试用例</th><th>模型连接</th><th>结果</th><th>端到端耗时</th><th>Tokens <small>IN / OUT</small></th><th>成本 <small>USD</small></th><th>人工评分</th><th></th></tr></thead><tbody>${filtered.map(r => `<tr data-result="${r.id}"><td><span class="case-cell">${icon('flask')}<strong>${h(r.caseName)}</strong></span></td><td><span class="model-cell">${h(r.modelName)}</span></td><td>${resultVerdict(r)}</td><td class="mono">${latency(r.duration)}</td><td class="mono muted">${r.usage ? `${r.usage.input.toLocaleString()} <span class="token-divider">/</span> ${r.usage.output.toLocaleString()}` : '—'}</td><td class="mono">${money(r.cost)}</td><td>${r.rating ? `<span class="rating-value">★ ${r.rating}<small>/5</small></span>` : '<span class="muted">待评分</span>'}</td><td><button class="trace-link" data-action="trace" data-id="${r.id}">Trace ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div><div class="table-bottom"><span>${filtered.length} 项结果 · 点击 Trace 查看完整执行过程</span><span>${state.run?.demo ? 'DEMO · 所有输出及 Token 数均为模拟' : '成本为估算值，非账单金额'}</span></div>`;
}
function casePage() {
  return `<div class="info-line">${icon('book')}当前项目：${h(project()?.name)}<span>用例会在运行时保存快照，后续修改不影响历史报告。</span></div><section class="case-grid">${cases().map((c, i) => `<article class="panel case-card"><div class="case-card-top"><span class="case-number">CASE / ${String(i + 1).padStart(2, '0')}</span><div><button class="icon-button" data-action="edit-case" data-id="${c.id}" aria-label="编辑 ${h(c.name)}">${icon('edit')}</button><button class="icon-button" data-action="delete-case" data-id="${c.id}" aria-label="删除 ${h(c.name)}">${icon('trash')}</button></div></div><h2>${h(c.name)}</h2>${badge(c.tag, 'neutral')}<div class="prompt-block"><span>USER PROMPT</span><p>${h(c.prompt)}</p></div><div class="case-evaluator"><span>${evaluatorNames[c.evaluator]}</span><code>${h(c.expected)}</code></div></article>`).join('')}<button class="add-card" data-action="add-case">${icon('plus')}<strong>添加测试用例</strong><span>把真实问题沉淀为评测标准</span></button></section><section class="panel system-panel"><div class="panel-title"><div>${icon('terminal')}<h2>Agent 执行环境</h2></div>${badge('READ ONLY', 'neutral')}</div><div class="system-content"><p class="field-label">SYSTEM PROMPT</p><p>${h(state.workspace.system)}</p><p class="field-label">AVAILABLE TOOLS</p><div class="tool-tags">${state.workspace.tools.map(t => `<span>${icon('bolt')}<code>${t.name}</code><small>${h(t.description)}</small></span>`).join('')}</div><p class="muted">首版使用内置本地工具；最多 5 轮模型调用、每轮最多 8 次工具执行。不会执行任意代码或访问业务后台。</p></div></section>`;
}
function modelPage() {
  return `<div class="info-line">${icon('lock')}API Key 仅保存在本机后端，浏览器不会收到已保存的 Key。<span>先 Test connection，再开始真实评测；单价单位：USD / 1M Tokens。</span></div><section class="connection-grid">${state.workspace.models.map(m => `<article class="panel connection-card"><div class="connection-top"><span class="provider-mark large ${m.protocol}">${m.protocol === 'anthropic' ? '✳' : m.protocol === 'openai' ? '◎' : '✦'}</span>${healthBadge(m)}</div><h2>${h(m.name)}</h2><p class="model-id">${h(m.modelId)}</p><dl><dt>协议</dt><dd>${h(m.protocol === 'openai' ? 'OpenAI Chat Completions' : m.protocol === 'anthropic' ? 'Anthropic Messages' : 'Gemini generateContent')}</dd><dt>Base URL</dt><dd title="${h(m.baseUrl)}">${h(m.baseUrl || '本地模拟 · 不发送网络请求')}</dd><dt>输入 / 输出单价</dt><dd>${m.demo ? '不计费' : `${m.inputPrice === null ? '未配置' : '$' + m.inputPrice} / ${m.outputPrice === null ? '未配置' : '$' + m.outputPrice}`}</dd><dt>API Key</dt><dd>${m.hasKey ? '已加密保存' : '无需配置'}</dd></dl>${m.health ? `<div class="health-note ${m.health.status}">${icon(m.health.status === 'ok' ? 'shield' : 'alert')}<span>${h(m.health.message)}${m.health.checkedAt ? `<small>${when(m.health.checkedAt)}</small>` : ''}</span></div>` : ''}<div class="connection-actions">${m.demo ? '<span class="muted">仅用于演示工作流程</span>' : `<button class="text-button" data-action="test-model" data-id="${m.id}" ${state.testingModelId ? 'disabled' : ''}>${icon('refresh')}Test connection</button><button class="text-button" data-action="edit-model" data-id="${m.id}">${icon('edit')}编辑</button>`}<button class="icon-button" data-action="delete-model" data-id="${m.id}" aria-label="删除 ${h(m.name)}">${icon('trash')}</button></div></article>`).join('')}<button class="add-card" data-action="add-model">${icon('plus')}<strong>连接一个模型</strong><span>支持官方 API 与兼容网关</span></button></section><div class="bottom-note">接入 claudeapi、code0 时，使用对应协议的完整 Base URL 与模型 ID。Test connection 会发送一条最小请求，不执行评测用例；Bedrock 原生 SigV4、流式响应及 OpenAI Responses 尚未接入。</div>`;
}
function historyPage() {
  const history = runs();
  return `<section class="panel"><div class="panel-title"><div><span class="section-index">LOG</span><h2>${h(project()?.name)}</h2></div><span class="panel-caption">${history.length} RUNS</span></div>${!history.length ? `<div class="empty-results">${icon('clock')}<strong>每次实验都值得被记录</strong><p>运行一次评测后，在这里回看配置和结果。</p><button class="button" data-page="overview">进入评测工作台 ${icon('arrow')}</button></div>` : `<div class="table-scroll"><table><thead><tr><th>评测名称</th><th>创建时间</th><th>类型</th><th>通过率</th><th>请求错误</th><th>平均耗时</th><th>任务数</th><th></th></tr></thead><tbody>${history.map(r => `<tr><td><strong>${h(r.name)}</strong><small class="run-id">${r.id.slice(0, 8)} · ${statuses[r.status]}</small></td><td class="mono">${when(r.createdAt)}</td><td>${badge(r.demo ? '演示' : '真实', r.demo ? 'amber' : 'green')}</td><td><strong class="history-rate">${r.summary?.rate === null || r.summary?.rate === undefined ? '—' : `${r.summary.rate}%`}</strong></td><td>${r.summary?.errors ? badge(`${r.summary.errors} errors`, 'red') : '<span class="muted">0</span>'}</td><td class="mono">${latency(r.summary?.duration)}</td><td class="mono">${r.total}</td><td><button class="trace-link" data-action="open-run" data-id="${r.id}">查看报告 ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`}</section>`;
}
let restoreFocus;
function modal(title, content, { wide = false, drawer = false, kicker = 'WORKSPACE' } = {}) {
  restoreFocus = document.activeElement;
  $('#overlay').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide-modal' : ''} ${drawer ? 'drawer' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><span class="eyebrow">${kicker}</span><h2 id="modal-title">${h(title)}</h2></div><button class="icon-button" data-action="close" aria-label="关闭">${icon('x')}</button></div>${content}</section></div>`;
  document.body.classList.add('modal-open');
  const form = $('#overlay form');
  if (form) form.addEventListener('submit', handleFormSubmit);
  setTimeout(() => $('#overlay input:not([type=hidden]), #overlay textarea, #overlay select, #overlay button')?.focus(), 0);
}
function closeModal() { $('#overlay').innerHTML = ''; state.traceId = null; document.body.classList.remove('modal-open'); restoreFocus?.focus(); }
function field(label, name, value = '', extra = '', type = 'text') { return `<label class="form-field"><span>${label}</span><input type="${type}" name="${name}" value="${h(value)}" ${extra}></label>`; }
function formFooter(label) { return `<p class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="button" data-action="close">取消</button><button type="submit" class="button primary">${label}</button></div>`; }
function openCase(caseId) {
  const c = cases().find(c => c.id === caseId) ?? { name: '', prompt: '', evaluator: 'contains', expected: '', tag: '' };
  modal(caseId ? '编辑测试用例' : '添加测试用例', `<form id="case-form" class="modal-body" novalidate><input type="hidden" name="id" value="${h(c.id || '')}">${field('用例名称', 'name', c.name, 'required maxlength="100" placeholder="例如：验证 Tool Use 结果"')}${field('分类标签', 'tag', c.tag, 'maxlength="40" placeholder="例如：产品知识"')}<label class="form-field"><span>User Prompt</span><textarea name="prompt" required rows="5" maxlength="12000" placeholder="输入一个可复现的真实任务…">${h(c.prompt)}</textarea></label><label class="form-field"><span>自动评测方式</span><select name="evaluator" id="evaluator-select">${Object.entries(evaluatorNames).map(([key, name]) => `<option value="${key}" ${c.evaluator === key ? 'selected' : ''}>${name}</option>`).join('')}</select></label><div id="expected-field">${expectedField(c.evaluator, c.expected)}</div>${formFooter('保存用例')}</form>`, { kicker: 'DATASET / TEST CASE' });
}
function expectedField(type, value = '') {
  if (type === 'tool') return `<label class="form-field"><span>预期成功执行的工具</span><select name="expected">${state.workspace.tools.map(t => `<option value="${t.name}" ${value === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label><p class="form-hint">验证工具是否成功执行；不校验最终答案的计算正确性。</p>`;
  return `${field(type === 'json' ? 'JSON 必填字段' : '必须包含的关键词', 'expected', value, `required maxlength="2000" placeholder="${type === 'json' ? 'product,protocols' : 'Anthropic|Bedrock|Tool Use'}"`)}<p class="form-hint">${type === 'json' ? '用英文逗号分隔字段名。仅检查合法 JSON 和顶层字段，不进行 JSON Schema 校验。' : '用 | 分隔。输出需命中全部关键词，忽略英文大小写。'}</p>`;
}
function openModel(modelId) {
  const m = state.workspace.models.find(m => m.id === modelId) ?? { name: '', protocol: 'openai', modelId: '', baseUrl: 'https://api.openai.com/v1', inputPrice: null, outputPrice: null };
  modal(modelId ? '编辑模型连接' : '连接模型', `<form id="model-form" class="modal-body" novalidate><input name="id" type="hidden" value="${h(m.id || '')}">${field('连接名称', 'name', m.name, 'required maxlength="80" placeholder="例如：code0 · 代码修复模型"')}<label class="form-field"><span>API 协议</span><select name="protocol" id="protocol-select">${[['openai', 'OpenAI · Chat Completions'], ['anthropic', 'Anthropic · Messages'], ['gemini', 'Gemini · generateContent']].map(([key, label]) => `<option value="${key}" ${m.protocol === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${field('Base URL', 'baseUrl', m.baseUrl, 'required type="url" placeholder="https://your-gateway.example/v1"')}${field('模型 ID', 'modelId', m.modelId, 'required maxlength="160" placeholder="填写渠道实际支持的模型 ID"')}<p class="form-hint">填写协议根地址。OpenAI / Anthropic 通常以 /v1 结尾，Gemini 通常以 /v1beta 结尾。不要填写具体请求路径。</p>${field(modelId ? 'API Key（留空保留现有 Key）' : 'API Key', 'apiKey', '', `${modelId ? '' : 'required'} autocomplete="off" maxlength="2000" placeholder="仅发送至本地后端"`, 'password')}<div class="form-columns">${field('输入单价 · USD / 1M', 'inputPrice', m.inputPrice ?? '', 'min="0" max="100000" step="any" placeholder="留空不估算"', 'number')}${field('输出单价 · USD / 1M', 'outputPrice', m.outputPrice ?? '', 'min="0" max="100000" step="any" placeholder="留空不估算"', 'number')}</div><div class="form-notice">${icon('lock')}Key 在本地加密保存；加密主密钥也在本机。请勿分享 data 目录。保存连接不会发起 API 请求。</div>${formFooter('保存连接')}</form>`, { kicker: 'PROVIDER / CONNECTION' });
}
function openTrace(resultId) {
  const r = state.run.results.find(r => r.id === resultId);
  if (!r) return;
  state.traceId = resultId;
  const testCase = state.run.cases.find(c => c.id === r.caseId);
  modal(r.caseName, `<div class="trace-overview"><div><span class="mono">${h(r.modelName)}</span>${verdict(r)}${r.demo ? badge('SIMULATED', 'amber') : ''}</div><div class="trace-metrics"><span>耗时 <strong>${latency(r.duration)}</strong></span><span>Tokens <strong>${r.usage ? r.usage.input + r.usage.output : '—'}</strong></span><span>估算成本 <strong>${money(r.cost)}</strong></span></div></div><div class="trace-scroll"><div class="trace-section-label">EXECUTION TRACE <span>${r.trace.length} EVENTS</span></div><div class="timeline">${r.trace.map((event, i) => `<details class="trace-event ${event.error || event.type === 'error' ? 'event-error' : ''}" open><summary><span class="event-node">${icon(event.type === 'tool' ? 'bolt' : event.type === 'input' ? 'terminal' : event.type === 'evaluation' ? 'check' : event.type === 'error' ? 'x' : 'layers')}</span><span><strong>${h(event.name)}</strong><small>${h(event.type.toUpperCase())}${event.duration !== undefined ? ` · ${event.duration}ms` : ''}</small></span><time>+${event.at}ms</time>${icon('down')}</summary><div class="event-body">${event.args ? `<span class="code-caption">ARGUMENTS</span><pre>${h(JSON.stringify(event.args, null, 2))}</pre>` : ''}${event.calls?.length ? `<span class="code-caption">TOOL CALLS</span><pre>${h(JSON.stringify(event.calls, null, 2))}</pre>` : ''}<pre>${h(event.content || '（模型请求调用工具）')}</pre>${event.usage ? `<span class="code-caption">USAGE ${h(JSON.stringify(event.usage))}</span>` : ''}</div></details>`).join('')}</div><div class="output-box"><p class="field-label">FINAL OUTPUT</p><pre>${h(r.output || r.reason || '等待最终输出…')}</pre></div><p class="form-hint">评测规则：${h(evaluatorNames[testCase?.evaluator])} · ${h(testCase?.expected)}<br>${h(r.reason || '')}</p><form id="rating-form"><input name="id" type="hidden" value="${r.id}"><div class="rating-heading"><h3>人工评审</h3><span>独立于自动评测结果</span></div><label class="form-field"><span>质量评分</span><select name="rating"><option value="">未评分</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${r.rating === n ? 'selected' : ''}>${n} / 5${n === 1 ? ' · 不可用' : n === 5 ? ' · 可直接交付' : ''}</option>`).join('')}</select></label><label class="form-field"><span>评审备注</span><textarea name="note" rows="3" maxlength="2000" placeholder="记录回答质量、失败原因或下一步改进…">${h(r.note)}</textarea></label><p class="form-error" role="alert"></p><button type="submit" class="button primary wide">保存评审</button></form></div>`, { drawer: true, kicker: `TRACE / ${r.id.slice(0, 8).toUpperCase()}` });
}
function guide() {
  modal('从一次可复现的评测开始', `<div class="modal-body guide"><div><span>01</span><section><h3>先运行演示，理解完整流程</h3><p>默认 3 个模拟模型、3 条用例，共 9 项任务。两种失败场景用于展示如何定位问题，演示结果不代表任何真实模型能力。</p></section></div><div><span>02</span><section><h3>连接你实际使用的模型</h3><p>在「模型连接」添加官方 API、claudeapi 或 code0 的模型 ID、Base URL 与 Key。选择真实连接时，请取消演示连接，二者不可混跑。</p></section></div><div><span>03</span><section><h3>用真实任务建立基线</h3><p>编辑测试集，选择关键词、JSON 或 Tool Use 规则。运行后查看 Trace，补充人工评分，导出 JSON 报告。修改后的用例可以重新评测，历史记录保留旧配置快照。</p></section></div><div class="guide-boundary"><strong>当前版本边界</strong><p>单人本地 MVP，内置只读文档检索与四则运算工具，非模型来源鉴定工具。暂未接入登录、团队权限、流式输出、自定义工具、LLM Judge、Bedrock 原生签名和 OpenAI Responses。</p><p>成本按手填 USD 单价估算；缓存或 thinking 用量存在时显示未知，不替代渠道账单。</p><p>Key 加密文件与主密钥同在本机。不要公开部署此服务或分享 data 目录；真实运行会产生 API 费用。</p></div><button class="button primary wide" data-action="close">开始使用 ${icon('arrow')}</button></div>`, { kicker: 'GETTING STARTED', wide: true });
}
async function loadRun(runId) { state.run = await api(`/api/runs/${runId}`); state.selectedModels = new Set(state.run.models.map(m => m.id)); state.selectedCases = new Set(state.run.cases.map(c => c.id)); state.page = 'overview'; state.filter = 'all'; state.search = ''; render(); if (state.run.status === 'running') void poll(); }
async function poll() {
  if (state.polling) return;
  state.polling = true;
  try {
    while (state.run?.status === 'running') {
      await new Promise(resolve => setTimeout(resolve, 900));
      const runId = state.run.id;
      const updated = await api(`/api/runs/${runId}`);
      if (state.run?.id !== runId) continue;
      state.run = updated;
      // Do not replace forms while the user is reviewing a trace or editing a case.
      if (state.page === 'overview' && !$('#overlay').children.length && document.activeElement?.id !== 'result-search') render();
      if (updated.status !== 'running') {
        await refresh();
        if (state.page === 'overview' && !$('#overlay').children.length) render();
        toast(updated.status === 'completed' ? '评测已完成，结果已保存' : '评测已结束');
      }
    }
  } catch (error) { toast(error.message, true); }
  finally { state.polling = false; }
}
async function run() {
  if (state.busy) return;
  const selected = state.workspace.models.filter(m => state.selectedModels.has(m.id));
  const runCases = selectedCases();
  if (!selected.length || !runCases.length) return toast('请先选择模型和本次测试用例', true);
  if (new Set(selected.map(m => m.demo)).size > 1) return toast('请将演示模型与真实模型分开运行', true);
  if (!selected[0].demo) {
    modal('运行真实评测', `<div class="modal-body"><p>将运行 <strong>${runCases.length * selected.length} 项任务</strong>，使用已保存的 API Key。模型调用会产生实际费用。</p><p class="muted">并发 3 项，单次请求超时 45 秒；每项任务最多 5 轮调用。请确认测试集不包含敏感信息。</p><form id="run-form">${field('评测名称', 'name', `${project().name} · ${new Date().toLocaleDateString('zh-CN')}`, 'required maxlength="100"')}<p class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="button" data-action="close">取消</button><button type="submit" class="button primary">${icon('play')}开始评测</button></div></form></div>`, { kicker: 'LIVE RUN' });
    return;
  }
  await startRun('演示 · API 客服 Agent');
}
async function startRun(name) {
  state.busy = true;
  try {
    state.run = await api('/api/runs', { method: 'POST', body: { projectId: state.projectId, modelIds: [...state.selectedModels], caseIds: [...state.selectedCases], name } });
    closeModal();
    state.page = 'overview'; state.filter = 'all'; state.search = '';
    await refresh(); render(); void poll();
  } finally { state.busy = false; }
}
async function remove(kind, recordId) {
  const item = kind === 'cases' ? cases().find(c => c.id === recordId) : state.workspace.models.find(m => m.id === recordId);
  modal('删除确认', `<div class="modal-body"><p>删除「${h(item?.name)}」？历史评测快照会保留。</p><div class="modal-footer"><button class="button" data-action="close">取消</button><button class="button danger-button" data-action="confirm-delete" data-kind="${kind}" data-id="${recordId}">删除</button></div></div>`, { kicker: 'REMOVE RECORD' });
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  try {
    if (button.type === 'submit' && button.form) {
      event.preventDefault();
      if (button.form.getAttribute('id') === 'model-form') {
        await saveModelForm(button.form);
        return;
      }
      await handleFormSubmit({ preventDefault() {}, target: button.form });
      return;
    }
    if (button.dataset.page) { state.page = button.dataset.page; render(); return; }
    if (button.dataset.filter) { state.filter = button.dataset.filter; render(); return; }
    const action = button.dataset.action;
    const recordId = button.dataset.id;
    if (action === 'close') { closeModal(); if (state.page === 'overview') render(); }
    if (action === 'guide') guide();
    if (action === 'run') await run();
    if (action === 'add-case' || action === 'edit-case') openCase(recordId);
    if (action === 'add-model' || action === 'edit-model') openModel(recordId);
    if (action === 'test-model') {
      state.testingModelId = recordId;
      render();
      try {
        const model = await api(`/api/models/${recordId}/test`, { method: 'POST', body: {} });
        await refresh();
        toast(model.health?.status === 'ok' ? `连接可用 · ${model.health.latency}ms` : `连接失败：${model.health?.message || '请检查配置'}`, model.health?.status !== 'ok');
      } finally {
        state.testingModelId = null;
        render();
      }
    }
    if (action === 'trace') openTrace(recordId);
    if (action === 'open-run') await loadRun(recordId);
    if (action === 'cancel') { await api(`/api/runs/${state.run.id}/cancel`, { method: 'POST', body: {} }); toast('正在取消，已完成的结果会保留'); }
    if (action === 'delete-case' || action === 'delete-model') await remove(action === 'delete-case' ? 'cases' : 'models', recordId);
    if (action === 'confirm-delete') { await api(`/api/${button.dataset.kind}/${recordId}`, { method: 'DELETE', body: {} }); closeModal(); await refresh(); render(); toast('已删除，历史报告保留'); }
    if (action === 'export') {
      const report = await api(`/api/runs/${state.run.id}/export`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `tracegarden-${report.id.slice(0, 8)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('报告已导出（不包含 API Key）');
    }
    if (action === 'add-project') modal('创建项目', `<form id="project-form" class="modal-body">${field('项目名称', 'name', '', 'required maxlength="80" placeholder="例如：代码修复 Agent"')}${field('项目说明', 'description', '', 'maxlength="200" placeholder="这组评测要验证什么？"')}${formFooter('创建项目')}</form>`, { kicker: 'NEW PROJECT' });
    if (action === 'project-menu') modal('切换项目', `<div class="modal-body project-list">${state.workspace.projects.map(p => `<button data-action="switch-project" data-id="${p.id}"><span>${h(p.name)}<small>${h(p.description)}</small></span>${icon('chevron')}</button>`).join('')}<button class="button" data-action="add-project">${icon('plus')}新建项目</button></div>`);
    if (action === 'switch-project') { state.projectId = recordId; localStorage.setItem('tg.project', recordId); state.run = null; state.selectedCases.clear(); state.selectedModels.clear(); closeModal(); await refresh(); const latest = runs()[0]; if (latest) await loadRun(latest.id); else render(); }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('change', async event => {
  const target = event.target;
  try {
    if (target.dataset.model) { if (target.checked) state.selectedModels.add(target.dataset.model); else state.selectedModels.delete(target.dataset.model); render(); }
    if (target.dataset.case) { if (target.checked) state.selectedCases.add(target.dataset.case); else state.selectedCases.delete(target.dataset.case); render(); }
    if (target.id === 'project-select') {
      state.projectId = target.value; localStorage.setItem('tg.project', target.value); state.run = null; state.selectedCases.clear(); state.selectedModels.clear(); await refresh();
      if (runs()[0]) await loadRun(runs()[0].id); else render();
    }
    if (target.id === 'evaluator-select') $('#expected-field').innerHTML = expectedField(target.value);
    if (target.id === 'protocol-select') {
      const input = $('#model-form [name=baseUrl]');
      if (['https://api.openai.com/v1', 'https://api.anthropic.com/v1', 'https://generativelanguage.googleapis.com/v1beta'].includes(input.value)) input.value = ({ openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta' })[target.value];
    }
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('input', event => { if (event.target.id === 'result-search') { state.search = event.target.value; $('#results-table').innerHTML = resultTable(summary().results); } });
// Capture submit before the browser's native navigation. The modal forms are rendered dynamically,
// so relying on a submitter-specific listener would allow a full-page reload in some browsers.
async function handleFormSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    if (form.id === 'case-form') await api('/api/cases', { method: 'POST', body: { ...values, projectId: state.projectId } });
    if (form.id === 'model-form') {
      await saveModelForm(form);
      return;
    }
    if (form.id === 'project-form') { const p = await api('/api/projects', { method: 'POST', body: values }); state.projectId = p.id; localStorage.setItem('tg.project', p.id); state.run = null; state.page = 'cases'; }
    if (form.id === 'run-form') { await startRun(values.name); return; }
    if (form.id === 'rating-form') { await api(`/api/results/${values.id}`, { method: 'PATCH', body: { rating: values.rating ? Number(values.rating) : null, note: values.note } }); state.run = await api(`/api/runs/${state.run.id}`); }
    closeModal(); await refresh(); render(); toast('已保存');
  } catch (error) { form.querySelector('.form-error').textContent = error.message; }
  finally { submit.disabled = false; }
}
async function saveModelForm(form) {
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    await api('/api/models', { method: 'POST', body: values });
    closeModal();
    await refresh();
    render();
    toast('模型连接已保存');
  } catch (error) {
    form.querySelector('.form-error').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}
document.addEventListener('keydown', event => {
  if (!$('#overlay').children.length) return;
  if (event.key === 'Escape') { closeModal(); return; }
  if (event.key === 'Tab') {
    const focusable = [...$('#overlay').querySelectorAll('button:not(:disabled), input:not([type=hidden]), textarea, select, summary, a[href]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
async function boot() {
  try { await refresh(); const latest = runs()[0]; if (latest) await loadRun(latest.id); else render(); }
  catch (error) { $('#app').innerHTML = `<div class="boot"><strong>无法连接本地服务</strong><p>${h(error.message)}</p><p>请在 agent-lab 目录运行 npm start 后刷新。</p></div>`; }
}
void boot();
