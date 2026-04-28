/**
 * 管理后台 - 完整 CRUD 管理控制台
 * 通过 API 接口管理撮合、商品货盘、达人数据
 * 支持：新建、编辑、删除、批量上传(Excel)、搜索、筛选、分页
 */

/* ========== API 基础地址 ========== */
const API_BASE = '';

/* ========== 认证 Token ========== */
function getAuthToken() {
  return localStorage.getItem('bizmatch_token') || '';
}

/* ========== 常量 ========== */
const STATUS_META = {
  recommend: { name: '货盘推荐', color: 'bg-slate-100 text-slate-700' },
  confirmed: { name: '确认合作', color: 'bg-violet-100 text-violet-700' },
  sampling:  { name: '样品寄送', color: 'bg-amber-100 text-amber-700' },
  selling:   { name: '开始带货', color: 'bg-emerald-100 text-emerald-700' },
};
const STATUS_KEYS = Object.keys(STATUS_META);
const COOP_MODES = ['纯佣-商品链接','纯佣-机构链接','投流+佣金-商品链接','投流+佣金-投流链接','互选','原生二次推广','素材合作'];
const TALENT_LEVELS = ['S','A','B','C'];
const CATEGORIES = ['少儿图书','教辅教材','文学小说','社科历史','科普百科','艺术生活','经管励志','童书绘本'];
const COURSE_TYPES = ['大班课','小班课','一对一','录播课','训练营'];
const COURSE_STAGES = ['学前','小学','初中','高中','大学','成人'];
const COURSE_SUBJECTS = ['语文','数学','英语','物理','化学','生物','历史','地理','政治','科学','编程','美术','音乐','体育','综合'];
const REGIONS = ['北京','上海','广州','深圳','杭州','成都','武汉','南京','长沙','西安','重庆','其他'];
const WILLINGNESS = ['强意愿','一般意愿','观望','暂无意愿'];
const UPDATE_FREQ = ['日更','每周3-5次','每周1-2次','每月4-6次','不定期','很少更新'];
const LIVE_FREQ = ['每日直播','每周3-5场','每周1-2场','每月4-6场','不定期','很少直播'];

/* ========== 状态 ========== */
const state = {
  activeTab: 'matches',
  products: [], talents: [], matches: [], users: [],
  search: '', filter: '',
  page: 1, pageSize: 20,
  selected: new Set(),
};

/* ========== 工具函数 ========== */
function esc(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtMoney(n) {
  n = Number(n); if (!isFinite(n) || n === 0) return '¥0';
  return n >= 10000 ? `¥${(n/10000).toFixed(2)}w` : `¥${n.toLocaleString()}`;
}
function fmtMulti(v) {
  if (v == null || v === '') return '-';
  if (Array.isArray(v)) return v.length ? v.join('、') : '-';
  return String(v);
}
function showToast(msg, type = 'success') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `admin-toast admin-toast-${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}

/* ========== API 调用 ========== */
async function api(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const config = { headers: {}, ...opts };
  // 自动携带认证 token
  const token = getAuthToken();
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  config.headers['Content-Type'] = 'application/json';
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }
  let resp;
  try {
    resp = await fetch(url, config);
  } catch (networkErr) {
    throw new Error(`网络请求失败（可能是跨域拦截或网络不通）: ${networkErr.message}`);
  }
  if (!resp.ok) {
    let errMsg = '';
    try {
      const ct = resp.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const errJson = await resp.json();
        errMsg = errJson.error || errJson.detail || JSON.stringify(errJson);
      } else {
        errMsg = await resp.text();
        if (errMsg.startsWith('<!') || errMsg.startsWith('<html')) {
          errMsg = '服务端返回了 HTML 页面而非 JSON，请检查 API 路径是否正确';
        }
      }
    } catch (_) { errMsg = resp.statusText; }
    throw new Error(`API ${resp.status}: ${errMsg}`);
  }
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const bodyPreview = await resp.text().catch(() => '');
    if (bodyPreview.startsWith('<!') || bodyPreview.startsWith('<html')) {
      throw new Error('API 返回了 HTML 页面而非 JSON 数据，请检查后端服务是否正常运行');
    }
    try { return JSON.parse(bodyPreview); } catch (_) {
      throw new Error(`API 返回了非 JSON 响应 (${contentType})，请检查后端服务是否正常运行`);
    }
  }
  return resp.json();
}

async function apiWithRetry(path, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await api(path);
    } catch (e) {
      console.warn(`[admin] ${path} 第${i+1}次请求失败:`, e.message);
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, delay * (i + 1)));
      } else {
        throw e;
      }
    }
  }
}

async function loadAll() {
  try {
    const [products, talents, matches, usersRes] = await Promise.all([
      apiWithRetry('/api/products'), apiWithRetry('/api/talents'), apiWithRetry('/api/matches'),
      api('/api/auth/users', { method: 'POST', body: { action: 'list' } }).catch(() => ({ ok: true, users: [] })),
    ]);
    state.products = products || [];
    state.talents = talents || [];
    state.matches = matches || [];
    state.users = (usersRes && usersRes.ok) ? (usersRes.users || []) : [];
  } catch (e) {
    console.error('加载数据失败:', e);
    showToast('数据加载失败: ' + e.message, 'error');
  }
}

/* ========== 模态框 ========== */
function openModal(html, opts = {}) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="admin-modal-overlay" id="modalOverlay"><div class="admin-modal">${html}</div></div>`;
  if (opts.onMount) opts.onMount(root.querySelector('.admin-modal'));
  root.querySelector('#modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeModal();
  });
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

/* ========== KPI 渲染 ========== */
function renderKPI() {
  const books = state.products.filter(p => (p.type||'book') === 'book');
  const courses = state.products.filter(p => (p.type||'book') === 'course');
  const levelCnt = { S:0, A:0, B:0, C:0 };
  state.talents.forEach(t => { if (levelCnt[t.level] != null) levelCnt[t.level]++; });
  const statusCnt = {};
  state.matches.forEach(m => { statusCnt[m.status] = (statusCnt[m.status]||0) + 1; });
  const gmv = state.matches.filter(m => m.status === 'selling').reduce((s,m) => s + (Number(m.gmv)||0), 0);

  document.getElementById('kpiSection').innerHTML = `
    <div class="kpi-card"><div class="text-xs text-slate-500">商品货盘总量</div>
      <div class="mt-1 flex items-baseline gap-1"><span class="text-2xl font-bold text-slate-900">${state.products.length}</span><span class="text-xs text-slate-400">条</span></div></div>
    <div class="kpi-card"><div class="text-xs text-slate-500">图书数量</div>
      <div class="mt-1 flex items-baseline gap-1"><span class="text-2xl font-bold text-brand-700">${books.length}</span><span class="text-xs text-slate-400">本</span></div></div>
    <div class="kpi-card"><div class="text-xs text-slate-500">课程数量</div>
      <div class="mt-1 flex items-baseline gap-1"><span class="text-2xl font-bold text-cyan-600">${courses.length}</span><span class="text-xs text-slate-400">门</span></div></div>
    <div class="kpi-card"><div class="text-xs text-slate-500">达人总数</div>
      <div class="mt-1 flex items-baseline gap-1"><span class="text-2xl font-bold text-slate-900">${state.talents.length}</span><span class="text-xs text-slate-400">位</span></div>
      <div class="mt-1 text-[11px] text-slate-500">S ${levelCnt.S} · A ${levelCnt.A} · B ${levelCnt.B} · C ${levelCnt.C}</div></div>
    <div class="kpi-card"><div class="text-xs text-slate-500">撮合总数</div>
      <div class="mt-1 flex items-baseline gap-1"><span class="text-2xl font-bold text-slate-900">${state.matches.length}</span><span class="text-xs text-slate-400">单</span></div>
      <div class="mt-1 text-[11px] text-slate-500">推荐 ${statusCnt.recommend||0} · 确认 ${statusCnt.confirmed||0} · 样品 ${statusCnt.sampling||0} · 带货 ${statusCnt.selling||0}</div></div>
    <div class="kpi-card"><div class="text-xs text-slate-500">累计 GMV</div>
      <div class="mt-1 flex items-baseline gap-1"><span class="text-2xl font-bold text-emerald-600">${fmtMoney(gmv)}</span></div>
      <div class="mt-1 text-[11px] text-slate-500">来自「开始带货」</div></div>`;
}

/* ========== 分页 ========== */
function paginate(list) {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.pageSize;
  return { items: list.slice(start, start + state.pageSize), total, totalPages, start };
}

function renderPagination(total, totalPages) {
  const bar = document.getElementById('paginationBar');
  const start = (state.page - 1) * state.pageSize + 1;
  const end = Math.min(state.page * state.pageSize, total);
  let pages = '';
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - state.page) > 1) {
      if (i === 3 || i === totalPages - 2) pages += `<span class="px-1 text-slate-400">…</span>`;
      continue;
    }
    pages += `<button class="page-btn ${i===state.page?'active':''}" data-page="${i}">${i}</button>`;
  }
  bar.innerHTML = `
    <div class="flex items-center gap-2">
      <span>共 ${total} 条 · 第 ${start}-${end} 条</span>
      <select id="pageSizeSel" class="text-xs border border-slate-200 rounded px-2 py-1">
        <option value="20" ${state.pageSize===20?'selected':''}>20条/页</option>
        <option value="50" ${state.pageSize===50?'selected':''}>50条/页</option>
        <option value="100" ${state.pageSize===100?'selected':''}>100条/页</option>
      </select>
    </div>
    <div class="flex items-center gap-1">
      <button class="page-btn" data-page="${Math.max(1,state.page-1)}" ${state.page<=1?'disabled':''}>‹</button>
      ${pages}
      <button class="page-btn" data-page="${Math.min(totalPages,state.page+1)}" ${state.page>=totalPages?'disabled':''}>›</button>
    </div>`;
  bar.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => {
    state.page = Number(b.dataset.page); renderTable();
  }));
  bar.querySelector('#pageSizeSel')?.addEventListener('change', e => {
    state.pageSize = Number(e.target.value); state.page = 1; renderTable();
  });
}

/* ========== Tab 计数 ========== */
function renderTabCounts() {
  document.getElementById('tabCntMatches').textContent = state.matches.length;
  document.getElementById('tabCntProducts').textContent = state.products.length;
  document.getElementById('tabCntTalents').textContent = state.talents.length;
  const el = document.getElementById('tabCntUsers');
  if (el) el.textContent = state.users.length;
}

/* ========== 搜索过滤 ========== */
function filterList(list, searchFields) {
  let result = list;
  const kw = state.search.trim().toLowerCase();
  if (kw) {
    result = result.filter(item => {
      const hay = searchFields(item).filter(Boolean).join(' ').toLowerCase();
      return hay.includes(kw);
    });
  }
  return result;
}

/* ========== 工具条渲染 ========== */
function renderToolbar() {
  const tb = document.getElementById('toolbar');
  const tab = state.activeTab;
  let html = `<input id="localSearch" placeholder="搜索…" value="${esc(state.search)}" class="px-3 py-1.5 border border-slate-200 rounded-lg text-sm outline-none focus:border-brand-500 w-48" />`;

  if (tab === 'matches') {
    html += `<select id="filterSel" class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
      <option value="">全部状态</option>${STATUS_KEYS.map(k => `<option value="${k}" ${state.filter===k?'selected':''}>${STATUS_META[k].name}</option>`).join('')}</select>`;
    html += `<button class="admin-btn admin-btn-primary" id="btnNewMatch">+ 新建撮合</button>`;
    html += `<button class="admin-btn admin-btn-success" id="btnUploadMatch">📤 批量上传</button>`;
  } else if (tab === 'products') {
    html += `<select id="filterSel" class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
      <option value="">全部类型</option><option value="book" ${state.filter==='book'?'selected':''}>图书</option><option value="course" ${state.filter==='course'?'selected':''}>课程</option></select>`;
    html += `<button class="admin-btn admin-btn-primary" id="btnNewBook">+ 录入图书</button>`;
    html += `<button class="admin-btn admin-btn-primary" id="btnNewCourse">+ 录入课程</button>`;
    html += `<button class="admin-btn admin-btn-success" id="btnUploadProduct">📤 批量上传</button>`;
  } else if (tab === 'talents') {
    html += `<select id="filterSel" class="px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
      <option value="">全部等级</option>${TALENT_LEVELS.map(l => `<option value="${l}" ${state.filter===l?'selected':''}>${l}级</option>`).join('')}</select>`;
    html += `<button class="admin-btn admin-btn-primary" id="btnNewTalent">+ 录入达人</button>`;
    html += `<button class="admin-btn admin-btn-success" id="btnUploadTalent">📤 批量上传</button>`;
  } else if (tab === 'users') {
    html += `<button class="admin-btn admin-btn-primary" id="btnNewUser">+ 新建用户</button>`;
    html += `<span class="text-xs text-slate-400 ml-2">管理员可管理所有账号</span>`;
  }

  html += `<div class="ml-auto flex items-center gap-2">`;
  if (state.selected.size > 0) {
    html += `<button class="admin-btn admin-btn-danger" id="btnDeleteSel">删除选中 (${state.selected.size})</button>`;
  }
  html += `<button class="admin-btn admin-btn-danger" id="btnDeleteAll" style="font-size:12px">一键清空</button>`;
  html += `</div>`;

  tb.innerHTML = html;
  bindToolbarEvents();
}

function bindToolbarEvents() {
  document.getElementById('localSearch')?.addEventListener('input', e => {
    state.search = e.target.value; state.page = 1; renderTable();
  });
  document.getElementById('filterSel')?.addEventListener('change', e => {
    state.filter = e.target.value; state.page = 1; renderTable();
  });
  // 撮合
  document.getElementById('btnNewMatch')?.addEventListener('click', openMatchForm);
  document.getElementById('btnUploadMatch')?.addEventListener('click', () => openBatchUpload('match'));
  // 商品
  document.getElementById('btnNewBook')?.addEventListener('click', () => openProductForm('book'));
  document.getElementById('btnNewCourse')?.addEventListener('click', () => openProductForm('course'));
  document.getElementById('btnUploadProduct')?.addEventListener('click', () => openBatchUpload('product'));
  // 达人
  document.getElementById('btnNewTalent')?.addEventListener('click', openTalentForm);
  document.getElementById('btnUploadTalent')?.addEventListener('click', () => openBatchUpload('talent'));
  // 用户管理
  document.getElementById('btnNewUser')?.addEventListener('click', () => openUserForm());
  // 删除
  document.getElementById('btnDeleteSel')?.addEventListener('click', deleteSelected);
  document.getElementById('btnDeleteAll')?.addEventListener('click', deleteAll);
}

/* ========== 表格渲染总入口 ========== */
function renderTable() {
  state.selected.clear();
  if (state.activeTab === 'matches') renderMatchesTable();
  else if (state.activeTab === 'products') renderProductsTable();
  else if (state.activeTab === 'talents') renderTalentsTable();
  else if (state.activeTab === 'users') renderUsersTable();
}

function emptyHtml(text) {
  return `<div class="py-16 text-center text-slate-400 text-sm">
    <svg viewBox="0 0 24 24" class="w-10 h-10 mx-auto mb-2 text-slate-300" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h18M3 12h18M3 17h18"/></svg>
    ${esc(text)}</div>`;
}

/* ---------- 撮合表格 ---------- */
function renderMatchesTable() {
  const byProd = Object.fromEntries(state.products.map(p => [p.id, p]));
  const byTal = Object.fromEntries(state.talents.map(t => [t.id, t]));
  let list = state.matches.slice();
  if (state.filter) list = list.filter(m => m.status === state.filter);
  list = filterList(list, m => {
    const p = byProd[m.productId] || {};
    const t = byTal[m.talentId] || {};
    return [m.id, m.owner, m.coopMode, p.name, t.name, t.videoAccount];
  });
  const { items, total, totalPages } = paginate(list);
  const view = document.getElementById('tableView');
  if (!items.length) { view.innerHTML = emptyHtml('暂无撮合数据'); renderPagination(total, totalPages); return; }
  view.innerHTML = `<table class="admin-tbl"><thead><tr>
    <th><input type="checkbox" class="admin-check" id="chkAll" /></th>
    <th>撮合单号</th><th>状态</th><th>达人</th><th>商品</th><th>合作模式</th><th>负责人</th><th class="text-right">GMV</th><th>操作</th>
  </tr></thead><tbody>${items.map(m => {
    const p = byProd[m.productId] || {};
    const t = byTal[m.talentId] || {};
    const meta = STATUS_META[m.status] || { name: m.status||'-', color:'bg-slate-100 text-slate-600' };
    const star = (m.status==='selling' && Number(m.changedCommissionRate)>Number(m.commissionRate)) ? ' <span class="text-rose-500">★</span>' : '';
    return `<tr>
      <td><input type="checkbox" class="admin-check row-chk" data-id="${esc(m.id)}" /></td>
      <td class="font-mono text-xs text-slate-500">${esc(m.id)}${star}</td>
      <td><span class="inline-block px-2 py-0.5 rounded text-xs ${meta.color}">${esc(meta.name)}</span></td>
      <td><div class="font-medium text-slate-800 cell-clip">${esc(t.videoAccount||t.name||'(未关联)')}</div><div class="text-[11px] text-slate-400">${esc(t.level?t.level+'级':'')} ${esc(fmtMulti(t.salesCategory))}</div></td>
      <td><div class="font-medium text-slate-800 cell-clip">${esc(p.name||'(未关联)')}</div><div class="text-[11px] text-slate-400">¥${p.price!=null?p.price:'-'}</div></td>
      <td class="text-xs">${esc(m.coopMode||'-')}</td>
      <td class="text-xs">${esc(m.owner||'-')}</td>
      <td class="text-right font-medium text-emerald-600">${fmtMoney(m.gmv||0)}</td>
      <td class="flex gap-1">
        <button class="admin-btn admin-btn-ghost" style="padding:4px 8px;font-size:12px" data-edit-match="${esc(m.id)}">编辑</button>
        <button class="admin-btn admin-btn-danger" style="padding:4px 8px;font-size:12px" data-del-match="${esc(m.id)}">删除</button>
      </td></tr>`;
  }).join('')}</tbody></table>`;
  renderPagination(total, totalPages);
  bindTableEvents('match');
}

/* ---------- 商品表格 ---------- */
function renderProductsTable() {
  let list = state.products.slice();
  if (state.filter) list = list.filter(p => (p.type||'book') === state.filter);
  list = filterList(list, p => [p.id, p.name, p.category, p.supplier, p.courseName]);
  const { items, total, totalPages } = paginate(list);
  const view = document.getElementById('tableView');
  if (!items.length) { view.innerHTML = emptyHtml('暂无商品数据'); renderPagination(total, totalPages); return; }
  view.innerHTML = `<table class="admin-tbl"><thead><tr>
    <th><input type="checkbox" class="admin-check" id="chkAll" /></th>
    <th>编号</th><th>类型</th><th>名称</th><th>分类/学段</th><th class="text-right">售价</th><th>纯佣金</th><th>投流佣金</th><th>供应链</th><th>操作</th>
  </tr></thead><tbody>${items.map(p => {
    const isBook = (p.type||'book') === 'book';
    const tag = isBook ? '<span class="inline-block px-2 py-0.5 rounded text-[11px] bg-violet-100 text-violet-700">图书</span>'
      : '<span class="inline-block px-2 py-0.5 rounded text-[11px] bg-cyan-100 text-cyan-700">课程</span>';
    const cate = isBook ? esc(p.category||'-') : `${fmtMulti(p.stage)} · ${fmtMulti(p.subject)}`;
    const cr = (p.commissionPolicy!=null&&p.commissionPolicy!=='') ? p.commissionPolicy+'%' : '-';
    const acr = (p.adCommissionPolicy!=null&&p.adCommissionPolicy!=='') ? p.adCommissionPolicy+'%' : '-';
    return `<tr>
      <td><input type="checkbox" class="admin-check row-chk" data-id="${esc(p.id)}" /></td>
      <td class="font-mono text-xs text-slate-500">${esc(p.id)}</td>
      <td>${tag}</td>
      <td class="cell-clip font-medium text-slate-800" style="max-width:240px">${esc(p.name||p.courseName||'-')}</td>
      <td class="text-xs">${cate}</td>
      <td class="text-right font-medium">¥${p.price!=null?p.price:(p.salePrice!=null?p.salePrice:'-')}</td>
      <td class="text-xs">${cr}</td><td class="text-xs">${acr}</td>
      <td class="text-xs cell-clip">${esc(p.supplier||'-')}</td>
      <td class="flex gap-1">
        <button class="admin-btn admin-btn-ghost" style="padding:4px 8px;font-size:12px" data-edit-product="${esc(p.id)}">编辑</button>
        <button class="admin-btn admin-btn-danger" style="padding:4px 8px;font-size:12px" data-del-product="${esc(p.id)}">删除</button>
      </td></tr>`;
  }).join('')}</tbody></table>`;
  renderPagination(total, totalPages);
  bindTableEvents('product');
}

/* ---------- 达人表格 ---------- */
function renderTalentsTable() {
  let list = state.talents.slice();
  if (state.filter) list = list.filter(t => t.level === state.filter);
  list = filterList(list, t => [t.id, t.name, t.videoAccount, t.region, t.salesOwner, ...(Array.isArray(t.salesCategory)?t.salesCategory:[])]);
  const { items, total, totalPages } = paginate(list);
  const view = document.getElementById('tableView');
  if (!items.length) { view.innerHTML = emptyHtml('暂无达人数据'); renderPagination(total, totalPages); return; }
  view.innerHTML = `<table class="admin-tbl"><thead><tr>
    <th><input type="checkbox" class="admin-check" id="chkAll" /></th>
    <th>编号</th><th>等级</th><th>视频号</th><th>品类赛道</th><th class="text-right">粉丝(万)</th><th class="text-right">短视频销售额</th><th class="text-right">直播销售额</th><th>地区</th><th>归属销售</th><th>操作</th>
  </tr></thead><tbody>${items.map(t => {
    const lvlColor = {S:'bg-violet-100 text-violet-700',A:'bg-blue-100 text-blue-700',B:'bg-cyan-100 text-cyan-700',C:'bg-slate-100 text-slate-600'}[t.level]||'bg-slate-100 text-slate-600';
    return `<tr>
      <td><input type="checkbox" class="admin-check row-chk" data-id="${esc(t.id)}" /></td>
      <td class="font-mono text-xs text-slate-500">${esc(t.id)}</td>
      <td><span class="inline-block px-2 py-0.5 rounded text-[11px] ${lvlColor}">${esc(t.level||'-')}</span></td>
      <td><div class="font-medium text-slate-800 cell-clip">${esc(t.videoAccount||t.name||'-')}</div></td>
      <td class="text-xs cell-clip" style="max-width:180px">${esc(fmtMulti(t.salesCategory))}</td>
      <td class="text-right text-xs">${t.videoFans!=null?t.videoFans:'-'}</td>
      <td class="text-right text-xs">${t.shortVideoSales!=null?t.shortVideoSales:'-'}</td>
      <td class="text-right text-xs">${t.liveSales!=null?t.liveSales:'-'}</td>
      <td class="text-xs">${esc(t.region||'-')}</td>
      <td class="text-xs">${esc(t.salesOwner||'-')}</td>
      <td class="flex gap-1">
        <button class="admin-btn admin-btn-ghost" style="padding:4px 8px;font-size:12px" data-edit-talent="${esc(t.id)}">编辑</button>
        <button class="admin-btn admin-btn-danger" style="padding:4px 8px;font-size:12px" data-del-talent="${esc(t.id)}">删除</button>
      </td></tr>`;
  }).join('')}</tbody></table>`;
  renderPagination(total, totalPages);
  bindTableEvents('talent');
}

/* ========== 表格事件绑定 ========== */
function bindTableEvents(kind) {
  const chkAll = document.getElementById('chkAll');
  chkAll?.addEventListener('change', () => {
    document.querySelectorAll('.row-chk').forEach(c => { c.checked = chkAll.checked; if (c.checked) state.selected.add(c.dataset.id); else state.selected.delete(c.dataset.id); });
    renderToolbar();
  });
  document.querySelectorAll('.row-chk').forEach(c => c.addEventListener('change', () => {
    if (c.checked) state.selected.add(c.dataset.id); else state.selected.delete(c.dataset.id);
    renderToolbar();
  }));
  if (kind === 'match') {
    document.querySelectorAll('[data-edit-match]').forEach(b => b.addEventListener('click', () => openMatchForm(b.dataset.editMatch)));
    document.querySelectorAll('[data-del-match]').forEach(b => b.addEventListener('click', () => deleteSingle('match', b.dataset.delMatch)));
  } else if (kind === 'product') {
    document.querySelectorAll('[data-edit-product]').forEach(b => b.addEventListener('click', () => {
      const p = state.products.find(x => x.id === b.dataset.editProduct);
      if (p) openProductForm((p.type||'book'), p);
    }));
    document.querySelectorAll('[data-del-product]').forEach(b => b.addEventListener('click', () => deleteSingle('product', b.dataset.delProduct)));
  } else if (kind === 'talent') {
    document.querySelectorAll('[data-edit-talent]').forEach(b => b.addEventListener('click', () => openTalentForm(b.dataset.editTalent)));
    document.querySelectorAll('[data-del-talent]').forEach(b => b.addEventListener('click', () => deleteSingle('talent', b.dataset.delTalent)));
  }
}

/* ========== 删除操作 ========== */
async function deleteSingle(kind, id) {
  if (!confirm(`确认删除 ${id} ？`)) return;
  const endpoint = kind === 'match' ? '/api/matches/delete' : kind === 'product' ? '/api/products/delete' : '/api/talents/delete';
  try {
    await api(endpoint, { method: 'POST', body: { ids: [id] } });
    showToast('删除成功');
    await loadAll(); fullRender();
  } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

async function deleteSelected() {
  if (!state.selected.size) return;
  if (!confirm(`确认删除选中的 ${state.selected.size} 条数据？`)) return;
  const ids = [...state.selected];
  const endpoint = state.activeTab === 'matches' ? '/api/matches/delete' : state.activeTab === 'products' ? '/api/products/delete' : '/api/talents/delete';
  try {
    await api(endpoint, { method: 'POST', body: { ids } });
    showToast(`已删除 ${ids.length} 条`);
    state.selected.clear();
    await loadAll(); fullRender();
  } catch (e) { showToast('删除失败: ' + e.message, 'error'); }
}

async function deleteAll() {
  const tabName = state.activeTab === 'matches' ? '撮合' : state.activeTab === 'products' ? '商品' : '达人';
  let msg = `确认清空所有${tabName}数据？此操作不可恢复！`;
  if (state.activeTab === 'products' && state.filter) {
    msg = `确认清空所有${state.filter==='book'?'图书':'课程'}数据？`;
  }
  if (state.activeTab === 'talents' && state.filter) {
    msg = `确认清空所有 ${state.filter} 级达人数据？`;
  }
  if (!confirm(msg)) return;
  const endpoint = state.activeTab === 'matches' ? '/api/matches/delete' : state.activeTab === 'products' ? '/api/products/delete' : '/api/talents/delete';
  const body = {};
  if (state.activeTab === 'products' && state.filter) body.type = state.filter;
  else if (state.activeTab === 'talents' && state.filter) body.level = state.filter;
  else body.all = true;
  try {
    await api(endpoint, { method: 'POST', body });
    showToast('清空成功');
    await loadAll(); fullRender();
  } catch (e) { showToast('清空失败: ' + e.message, 'error'); }
}

/* ========== 新建/编辑撮合表单 ========== */
function openMatchForm(editId) {
  const existing = editId ? state.matches.find(m => m.id === editId) : null;
  const m = existing || {};
  const prodOpts = state.products.map(p => `<option value="${esc(p.id)}" ${m.productId===p.id?'selected':''}>${esc(p.id)} - ${esc(p.name||p.courseName||'')}</option>`).join('');
  const talOpts = state.talents.map(t => `<option value="${esc(t.id)}" ${m.talentId===t.id?'selected':''}>${esc(t.id)} - ${esc(t.videoAccount||t.name||'')}</option>`).join('');
  const statusOpts = STATUS_KEYS.map(k => `<option value="${k}" ${(m.status||'recommend')===k?'selected':''}>${STATUS_META[k].name}</option>`).join('');
  const coopOpts = COOP_MODES.map(c => `<option value="${c}" ${m.coopMode===c?'selected':''}>${c}</option>`).join('');

  openModal(`
    <h3>${existing ? '编辑撮合' : '新建撮合'}</h3>
    <form id="matchForm">
      <div class="admin-form-row">
        <div class="admin-form-group"><label>达人 *</label><select name="talentId" required><option value="">请选择达人</option>${talOpts}</select></div>
        <div class="admin-form-group"><label>商品 *</label><select name="productId" required><option value="">请选择商品</option>${prodOpts}</select></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>当前状态</label><select name="status">${statusOpts}</select></div>
        <div class="admin-form-group"><label>合作模式</label><select name="coopMode"><option value="">请选择</option>${coopOpts}</select></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>负责人</label><input name="owner" value="${esc(m.owner||'')}" /></div>
        <div class="admin-form-group"><label>供应链名称</label><input name="supplier" value="${esc(m.supplier||'')}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>客户名称</label><input name="clientName" value="${esc(m.clientName||'')}" /></div>
        <div class="admin-form-group"><label>广告账户ID</label><input name="adAccountId" value="${esc(m.adAccountId||'')}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>商品价格</label><input name="price" type="number" step="0.01" value="${m.price||''}" /></div>
        <div class="admin-form-group"><label>商品佣金率(%)</label><input name="commissionRate" type="number" step="0.1" value="${m.commissionRate||''}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>变化佣金率(%)</label><input name="changedCommissionRate" type="number" step="0.1" value="${m.changedCommissionRate||''}" /></div>
        <div class="admin-form-group"><label>备注</label><input name="note" value="${esc(m.note||'')}" /></div>
      </div>
      <div class="admin-form-row" id="sellingFields" style="display:none">
        <div class="admin-form-group"><label>客单价</label><input name="unitPrice" type="number" step="0.01" value="${m.unitPrice||''}" /></div>
        <div class="admin-form-group"><label>订单数</label><input name="orderCount" type="number" value="${m.orderCount||''}" /></div>
      </div>
      <div class="admin-form-group" id="gmvField" style="display:none"><label>GMV（自动计算：客单价×订单数）</label><input name="gmv" type="number" step="0.01" value="${m.gmv||''}" readonly class="bg-slate-50" /></div>
      <div class="flex justify-end gap-3 mt-4">
        <button type="button" class="admin-btn admin-btn-ghost" onclick="document.getElementById('modalRoot').innerHTML=''">取消</button>
        <button type="submit" class="admin-btn admin-btn-primary">${existing ? '保存修改' : '创建撮合'}</button>
      </div>
    </form>`, {
    onMount(modal) {
      const form = modal.querySelector('#matchForm');
      const statusSel = form.querySelector('[name=status]');
      const toggleSelling = () => {
        const show = statusSel.value === 'selling';
        modal.querySelector('#sellingFields').style.display = show ? '' : 'none';
        modal.querySelector('#gmvField').style.display = show ? '' : 'none';
      };
      toggleSelling();
      statusSel.addEventListener('change', toggleSelling);
      const upInput = form.querySelector('[name=unitPrice]');
      const ocInput = form.querySelector('[name=orderCount]');
      const gmvInput = form.querySelector('[name=gmv]');
      const calcGmv = () => {
        const up = Number(upInput.value) || 0;
        const oc = Number(ocInput.value) || 0;
        if (up > 0 && oc > 0) gmvInput.value = (up * oc).toFixed(2);
      };
      upInput.addEventListener('input', calcGmv);
      ocInput.addEventListener('input', calcGmv);
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(form);
        const data = Object.fromEntries(fd.entries());
        if (existing) data.id = existing.id;
        if (data.status === 'selling') {
          const up = Number(data.unitPrice) || 0;
          const oc = Number(data.orderCount) || 0;
          if (up > 0 && oc > 0) data.gmv = up * oc;
        }
        try {
          await api('/api/matches', { method: 'POST', body: data });
          showToast(existing ? '撮合已更新' : '撮合已创建');
          closeModal(); await loadAll(); fullRender();
        } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
      });
    }
  });
}

/* ========== 新建/编辑商品表单 ========== */
function openProductForm(type, existing) {
  const p = existing || {};
  const isBook = type === 'book';
  const title = existing ? (isBook ? '编辑图书' : '编辑课程') : (isBook ? '录入图书' : '录入课程');

  let fieldsHtml = '';
  if (isBook) {
    fieldsHtml = `
      <div class="admin-form-row">
        <div class="admin-form-group"><label>书名 *</label><input name="name" value="${esc(p.name||'')}" required /></div>
        <div class="admin-form-group"><label>供应链名称</label><input name="supplier" value="${esc(p.supplier||'')}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>图书分类</label><select name="category"><option value="">请选择</option>${CATEGORIES.map(c=>`<option value="${c}" ${p.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="admin-form-group"><label>目标人群（多个用逗号分隔）</label><input name="targetAudience" value="${esc(Array.isArray(p.targetAudience)?p.targetAudience.join(','):(p.targetAudience||''))}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>带货售价</label><input name="salePrice" type="number" step="0.01" value="${p.salePrice||p.price||''}" /></div>
        <div class="admin-form-group"><label>规格</label><input name="spec" value="${esc(p.spec||'')}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>纯佣金(%)</label><input name="commissionPolicy" type="number" step="0.1" value="${p.commissionPolicy||''}" /></div>
        <div class="admin-form-group"><label>投流佣金(%)</label><input name="adCommissionPolicy" type="number" step="0.1" value="${p.adCommissionPolicy||''}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>物流快递</label><input name="logistics" value="${esc(p.logistics||'')}" /></div>
        <div class="admin-form-group"><label>库存</label><input name="stock" type="number" value="${p.stock||''}" /></div>
      </div>
      <div class="admin-form-group"><label>产品图片URL</label><input name="image" value="${esc(p.image||'')}" /></div>
      <div class="admin-form-group"><label>微信小店商品链接</label><input name="shopLink" value="${esc(p.shopLink||'')}" /></div>
      <div class="admin-form-group"><label>图书介绍</label><textarea name="intro">${esc(p.intro||'')}</textarea></div>`;
  } else {
    fieldsHtml = `
      <div class="admin-form-row">
        <div class="admin-form-group"><label>课程名称 *</label><input name="name" value="${esc(p.name||p.courseName||'')}" required /></div>
        <div class="admin-form-group"><label>客单价</label><input name="price" type="number" step="0.01" value="${p.price||''}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>货品类型（多个用逗号分隔）</label><input name="courseType" value="${esc(Array.isArray(p.courseType)?p.courseType.join(','):(p.courseType||''))}" /></div>
        <div class="admin-form-group"><label>学段（多个用逗号分隔）</label><input name="stage" value="${esc(Array.isArray(p.stage)?p.stage.join(','):(p.stage||''))}" /></div>
      </div>
      <div class="admin-form-group"><label>学科（多个用逗号分隔）</label><input name="subject" value="${esc(Array.isArray(p.subject)?p.subject.join(','):(p.subject||''))}" /></div>
      <div class="admin-form-group"><label>课程图片URL</label><input name="image" value="${esc(p.image||'')}" /></div>
      <div class="admin-form-group"><label>课程链接</label><input name="courseLink" value="${esc(p.courseLink||'')}" /></div>
      <div class="admin-form-group"><label>课程介绍</label><textarea name="intro">${esc(p.intro||'')}</textarea></div>`;
  }

  openModal(`
    <h3>${title}</h3>
    <form id="productForm">${fieldsHtml}
      <div class="flex justify-end gap-3 mt-4">
        <button type="button" class="admin-btn admin-btn-ghost" onclick="document.getElementById('modalRoot').innerHTML=''">取消</button>
        <button type="submit" class="admin-btn admin-btn-primary">${existing ? '保存修改' : '确认录入'}</button>
      </div>
    </form>`, {
    onMount(modal) {
      modal.querySelector('#productForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        data.type = type;
        if (existing) data.id = existing.id;
        // 处理多值字段
        if (isBook) {
          data.targetAudience = data.targetAudience ? data.targetAudience.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
          data.price = data.salePrice;
        } else {
          data.courseType = data.courseType ? data.courseType.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
          data.stage = data.stage ? data.stage.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
          data.subject = data.subject ? data.subject.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
          data.courseName = data.name;
        }
        try {
          await api('/api/products', { method: 'POST', body: data });
          showToast(existing ? '商品已更新' : '商品已录入');
          closeModal(); await loadAll(); fullRender();
        } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
      });
    }
  });
}

/* ========== 新建/编辑达人表单 ========== */
function openTalentForm(editId) {
  const existing = editId ? state.talents.find(t => t.id === editId) : null;
  const t = existing || {};
  const levelOpts = TALENT_LEVELS.map(l => `<option value="${l}" ${t.level===l?'selected':''}>${l}级</option>`).join('');
  const regionOpts = REGIONS.map(r => `<option value="${r}" ${t.region===r?'selected':''}>${r}</option>`).join('');
  const willOpts = (val) => WILLINGNESS.map(w => `<option value="${w}" ${val===w?'selected':''}>${w}</option>`).join('');
  const freqOpts = (val, list) => list.map(f => `<option value="${f}" ${val===f?'selected':''}>${f}</option>`).join('');

  openModal(`
    <h3>${existing ? '编辑达人' : '录入达人'}</h3>
    <form id="talentForm">
      <div class="admin-form-row">
        <div class="admin-form-group"><label>达人等级 *</label><select name="level" required><option value="">请选择</option>${levelOpts}</select></div>
        <div class="admin-form-group"><label>视频号账号名称 *</label><input name="videoAccount" value="${esc(t.videoAccount||'')}" required /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>带货品类赛道（多个用逗号分隔）</label><input name="salesCategory" value="${esc(Array.isArray(t.salesCategory)?t.salesCategory.join(','):(t.salesCategory||''))}" /></div>
        <div class="admin-form-group"><label>地区</label><select name="region"><option value="">请选择</option>${regionOpts}</select></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>视频号粉丝数量(万)</label><input name="videoFans" type="number" step="0.01" value="${t.videoFans||''}" /></div>
        <div class="admin-form-group"><label>归属销售</label><input name="salesOwner" value="${esc(t.salesOwner||'')}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>短视频品类销售额(月/万)</label><input name="shortVideoSales" type="number" step="0.01" value="${t.shortVideoSales||''}" /></div>
        <div class="admin-form-group"><label>直播品类销售额(月/万)</label><input name="liveSales" type="number" step="0.01" value="${t.liveSales||''}" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>可接受的合作类型</label><input name="coopAccept" value="${esc(Array.isArray(t.coopAccept)?t.coopAccept.join(','):(t.coopAccept||''))}" /></div>
        <div class="admin-form-group"><label>是否有MCN</label><select name="hasMCN"><option value="否" ${t.hasMCN!=='是'?'selected':''}>否</option><option value="是" ${t.hasMCN==='是'?'selected':''}>是</option></select></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>MCN名称</label><input name="mcnName" value="${esc(t.mcnName||'')}" /></div>
        <div class="admin-form-group"><label>是否已入驻互选</label><select name="joinedMutualSelect"><option value="否" ${t.joinedMutualSelect!=='是'?'selected':''}>否</option><option value="是" ${t.joinedMutualSelect==='是'?'selected':''}>是</option></select></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>图书品类带货意愿</label><select name="bookWillingness"><option value="">请选择</option>${willOpts(t.bookWillingness)}</select></div>
        <div class="admin-form-group"><label>少儿课程品类带货意愿</label><select name="courseWillingness"><option value="">请选择</option>${willOpts(t.courseWillingness)}</select></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>短视频更新频率</label><select name="videoUpdateFreq"><option value="">请选择</option>${freqOpts(t.videoUpdateFreq, UPDATE_FREQ)}</select></div>
        <div class="admin-form-group"><label>直播频率</label><select name="liveFreq"><option value="">请选择</option>${freqOpts(t.liveFreq, LIVE_FREQ)}</select></div>
      </div>
      <div class="flex justify-end gap-3 mt-4">
        <button type="button" class="admin-btn admin-btn-ghost" onclick="document.getElementById('modalRoot').innerHTML=''">取消</button>
        <button type="submit" class="admin-btn admin-btn-primary">${existing ? '保存修改' : '确认录入'}</button>
      </div>
    </form>`, {
    onMount(modal) {
      modal.querySelector('#talentForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        if (existing) data.id = existing.id;
        data.name = data.videoAccount;
        data.salesCategory = data.salesCategory ? data.salesCategory.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
        data.coopAccept = data.coopAccept ? data.coopAccept.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [];
        try {
          await api('/api/talents', { method: 'POST', body: data });
          showToast(existing ? '达人已更新' : '达人已录入');
          closeModal(); await loadAll(); fullRender();
        } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
      });
    }
  });
}

/* ========== 批量上传（Excel） ========== */
function openBatchUpload(kind) {
  const kindName = kind === 'match' ? '撮合' : kind === 'product' ? '商品' : '达人';
  let templateInfo = '';
  if (kind === 'match') {
    templateInfo = '模板列：达人视频号名称, 商品名称, 状态(货盘推荐/确认合作/样品寄送/开始带货), 合作模式, 负责人, 供应链名称, 客户名称, 广告账户ID, 商品价格, 商品佣金率(%), 变化佣金率(%), 客单价, 订单数, GMV';
  } else if (kind === 'product') {
    templateInfo = '图书模板列：书名, 供应链名称, 目标人群, 图书分类, 规格, 带货售价, 纯佣金(%), 投流佣金(%), 物流快递, 库存, 图书介绍, 微信小店商品链接, 产品图片URL<br>课程模板列：课程名称, 客单价, 货品类型, 学段, 学科, 课程介绍, 课程链接, 课程图片URL';
  } else {
    templateInfo = '模板列：达人等级, 视频号账号名称, 带货品类赛道, 短视频品类销售额(月/万), 直播品类销售额(月/万), 视频号粉丝数量(万), 可接受的合作类型, 图书品类带货意愿, 少儿课程品类带货意愿, 短视频更新频率, 直播频率, 是否有MCN, MCN名称, 地区, 是否已入驻互选, 归属销售';
  }

  openModal(`
    <h3>批量上传${kindName}数据</h3>
    <div class="mb-4 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed">${templateInfo}</div>
    <div class="mb-4">
      <button class="admin-btn admin-btn-ghost" id="btnDownloadTpl">📥 下载Excel模板</button>
    </div>
    <div class="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center mb-4 hover:border-brand-400 transition" id="dropZone">
      <svg viewBox="0 0 24 24" class="w-10 h-10 mx-auto mb-2 text-slate-400" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"/></svg>
      <div class="text-sm text-slate-500 mb-2">拖拽Excel文件到此处，或点击选择文件</div>
      <input type="file" accept=".xlsx,.xls,.csv" id="fileInput" class="hidden" />
      <button class="admin-btn admin-btn-primary" id="btnSelectFile">选择文件</button>
    </div>
    <div id="previewArea" class="hidden">
      <div class="text-sm font-medium text-slate-700 mb-2">预览数据 (<span id="previewCount">0</span> 条)</div>
      <div class="overflow-auto max-h-60 border border-slate-200 rounded-lg"><table class="admin-tbl" id="previewTable"></table></div>
      <div class="flex justify-end gap-3 mt-4">
        <button class="admin-btn admin-btn-ghost" onclick="document.getElementById('modalRoot').innerHTML=''">取消</button>
        <button class="admin-btn admin-btn-primary" id="btnConfirmUpload">确认导入</button>
      </div>
    </div>`, {
    onMount(modal) {
      let parsedData = [];
      const fileInput = modal.querySelector('#fileInput');
      modal.querySelector('#btnSelectFile').addEventListener('click', () => fileInput.click());
      modal.querySelector('#btnDownloadTpl').addEventListener('click', () => downloadTemplate(kind));

      // 拖拽
      const dropZone = modal.querySelector('#dropZone');
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('border-brand-500'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-brand-500'));
      dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('border-brand-500'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

      fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

      function handleFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
            if (!rows.length) { showToast('文件为空', 'error'); return; }
            parsedData = mapImportData(kind, rows);
            showPreview(parsedData);
          } catch (err) { showToast('文件解析失败: ' + err.message, 'error'); }
        };
        reader.readAsArrayBuffer(file);
      }

      function showPreview(data) {
        if (!data.length) return;
        modal.querySelector('#previewArea').classList.remove('hidden');
        modal.querySelector('#previewCount').textContent = data.length;
        const keys = Object.keys(data[0]).slice(0, 8);
        const table = modal.querySelector('#previewTable');
        table.innerHTML = `<thead><tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead>
          <tbody>${data.slice(0, 10).map(row => `<tr>${keys.map(k => `<td class="cell-clip text-xs">${esc(String(row[k]||''))}</td>`).join('')}</tr>`).join('')}</tbody>`;
        if (data.length > 10) {
          table.innerHTML += `<tfoot><tr><td colspan="${keys.length}" class="text-center text-xs text-slate-400 py-2">... 还有 ${data.length - 10} 条数据</td></tr></tfoot>`;
        }
      }

      modal.querySelector('#btnConfirmUpload')?.addEventListener('click', async () => {
        if (!parsedData.length) { showToast('没有可导入的数据', 'error'); return; }
        try {
          const endpoint = kind === 'match' ? '/api/matches/batch' : kind === 'product' ? '/api/products/batch' : '/api/talents/batch';
          await api(endpoint, { method: 'POST', body: parsedData });
          showToast(`成功导入 ${parsedData.length} 条${kindName}数据`);
          closeModal(); await loadAll(); fullRender();
        } catch (err) { showToast('导入失败: ' + err.message, 'error'); }
      });
    }
  });
}

/* ========== Excel 数据映射 ========== */
function mapImportData(kind, rows) {
  if (kind === 'match') {
    return rows.map(r => {
      const talentName = r['达人视频号名称'] || r['达人名称'] || '';
      const productName = r['商品名称'] || '';
      const talent = state.talents.find(t => (t.videoAccount||t.name||'') === talentName);
      const product = state.products.find(p => (p.name||'') === productName);
      const statusMap = { '货盘推荐':'recommend', '确认合作':'confirmed', '样品寄送':'sampling', '开始带货':'selling' };
      return {
        talentId: talent?.id || '', productId: product?.id || '',
        status: statusMap[r['状态']] || 'recommend',
        coopMode: r['合作模式'] || '',
        owner: r['负责人'] || '',
        supplier: r['供应链名称'] || '',
        clientName: r['客户名称'] || '',
        adAccountId: r['广告账户ID'] || '',
        price: r['商品价格'] || '',
        commissionRate: r['商品佣金率(%)'] || r['商品佣金率'] || '',
        changedCommissionRate: r['变化佣金率(%)'] || r['变化佣金率'] || '',
        unitPrice: r['客单价'] || '',
        orderCount: r['订单数'] || '',
        gmv: r['GMV'] || '',
      };
    });
  } else if (kind === 'product') {
    return rows.map(r => {
      const hasCourseName = r['课程名称'] != null && r['课程名称'] !== '';
      const isBook = !hasCourseName;
      if (isBook) {
        const ta = r['目标人群'] || '';
        return {
          type: 'book', name: r['书名'] || r['名称'] || '',
          supplier: r['供应链名称'] || '', targetAudience: ta ? ta.split(/[,，]/).map(s=>s.trim()).filter(Boolean) : [],
          category: r['图书分类'] || '', spec: r['规格'] || '',
          salePrice: r['带货售价'] || '', price: r['带货售价'] || '',
          commissionPolicy: r['纯佣金(%)'] || r['纯佣金'] || '',
          adCommissionPolicy: r['投流佣金(%)'] || r['投流佣金'] || '',
          logistics: r['物流快递'] || '', stock: r['库存'] || '',
          intro: r['图书介绍'] || '', shopLink: r['微信小店商品链接'] || '',
          image: r['产品图片URL'] || r['产品图片'] || '',
        };
      } else {
        return {
          type: 'course', name: r['课程名称'], courseName: r['课程名称'],
          price: r['客单价'] || '',
          courseType: (r['货品类型']||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),
          stage: (r['学段']||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),
          subject: (r['学科']||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),
          intro: r['课程介绍'] || '', courseLink: r['课程链接'] || '',
          image: r['课程图片URL'] || r['课程图片'] || '',
        };
      }
    });
  } else {
    return rows.map(r => ({
      level: r['达人等级'] || '',
      videoAccount: r['视频号账号名称'] || r['视频号名称'] || '',
      name: r['视频号账号名称'] || r['视频号名称'] || '',
      salesCategory: (r['带货品类赛道']||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),
      shortVideoSales: r['短视频品类销售额(月/万)'] || r['短视频销售额'] || '',
      liveSales: r['直播品类销售额(月/万)'] || r['直播销售额'] || '',
      videoFans: r['视频号粉丝数量(万)'] || r['视频号粉丝数量'] || '',
      coopAccept: (r['可接受的合作类型']||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean),
      bookWillingness: r['图书品类带货意愿'] || '',
      courseWillingness: r['少儿课程品类带货意愿'] || '',
      videoUpdateFreq: r['短视频更新频率'] || '',
      liveFreq: r['直播频率'] || '',
      hasMCN: r['是否有MCN'] || '否',
      mcnName: r['MCN名称'] || '',
      region: r['地区'] || '',
      joinedMutualSelect: r['是否已入驻互选'] || '否',
      salesOwner: r['归属销售'] || '',
    }));
  }
}

/* ========== 下载模板 ========== */
function downloadTemplate(kind) {
  let headers = [];
  if (kind === 'match') {
    headers = ['达人视频号名称','商品名称','状态','合作模式','负责人','供应链名称','客户名称','广告账户ID','商品价格','商品佣金率(%)','变化佣金率(%)','客单价','订单数','GMV'];
  } else if (kind === 'product') {
    // 默认图书模板
    headers = ['书名','供应链名称','目标人群','图书分类','规格','带货售价','纯佣金(%)','投流佣金(%)','物流快递','库存','图书介绍','微信小店商品链接','产品图片URL'];
  } else {
    headers = ['达人等级','视频号账号名称','带货品类赛道','短视频品类销售额(月/万)','直播品类销售额(月/万)','视频号粉丝数量(万)','可接受的合作类型','图书品类带货意愿','少儿课程品类带货意愿','短视频更新频率','直播频率','是否有MCN','MCN名称','地区','是否已入驻互选','归属销售'];
  }
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '模板');
  XLSX.writeFile(wb, `${kind === 'match' ? '撮合' : kind === 'product' ? '商品' : '达人'}导入模板.xlsx`);
}

/* ========== 全局渲染 ========== */
function fullRender() {
  renderKPI();
  renderTabCounts();
  renderToolbar();
  renderTable();
}

/* ========== Tab 切换 ========== */
document.querySelectorAll('[data-tab]').forEach(el => {
  el.addEventListener('click', () => {
    state.activeTab = el.dataset.tab;
    state.search = ''; state.filter = ''; state.page = 1; state.selected.clear();
    document.querySelectorAll('[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === state.activeTab));
    renderToolbar(); renderTable();
  });
});

/* ========== 全局搜索 ========== */
document.getElementById('adminSearch')?.addEventListener('input', e => {
  state.search = e.target.value; state.page = 1; renderTable();
});

/* ========== 刷新按钮 ========== */
document.getElementById('btnRefresh')?.addEventListener('click', async () => {
  showToast('正在刷新数据…', 'info');
  await loadAll(); fullRender();
  showToast('数据已刷新');
});

/* ========== 初始化 ========== */
(async function init() {
  await loadAll();
  fullRender();
})();

/* ==================== 用户管理模块 ==================== */

function renderUsersTable() {
  let list = state.users.slice();
  if (state.filter) {
    if (state.filter === 'admin') list = list.filter(u => u.role === 'admin');
    else if (state.filter === 'operator') list = list.filter(u => u.role === 'operator');
  }
  list = filterList(list, u => [u.id, u.username, u.name, u.dept]);
  const { items, total, totalPages } = paginate(list);
  const view = document.getElementById('tableView');
  if (!items.length) { view.innerHTML = emptyHtml('暂无用户数据'); renderPagination(total, totalPages); return; }

  view.innerHTML = `<table class="admin-tbl"><thead><tr>
    <th>ID</th><th>用户名</th><th>姓名</th><th>角色</th><th>部门</th><th>状态</th>
    <th>最后登录</th><th>创建时间</th><th>操作</th>
  </tr></thead><tbody>${items.map(u => {
    const roleTag = u.role === 'admin'
      ? '<span class="inline-block px-2 py-0.5 rounded text-[11px] bg-violet-100 text-violet-700">管理员</span>'
      : '<span class="inline-block px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600">运营</span>';
    const statusTag = Number(u.status) === 1
      ? '<span class="text-emerald-600 font-medium">正常</span>'
      : '<span class="text-rose-500 font-medium">禁用</span>';
    return `<tr>
      <td class="font-mono text-xs text-slate-400">${u.id}</td>
      <td class="font-medium">${esc(u.username)}</td>
      <td>${esc(u.name)}</td>
      <td>${roleTag}</td>
      <td class="text-xs">${esc(u.dept||'-')}</td>
      <td>${statusTag}</td>
      <td class="text-xs text-slate-500">${u.last_login || '-'}</td>
      <td class="text-xs text-slate-500">${u.created_at || '-'}</td>
      <td class="flex gap-1">
        ${u.username !== 'admin' ? `
          <button class="admin-btn admin-btn-ghost" style="padding:4px 8px;font-size:12px" data-edit-user="${u.id}">编辑</button>
          <button class="admin-btn admin-btn-danger" style="padding:4px 8px;font-size:12px" data-del-user="${u.id}">删除</button>
        ` : '<span class="text-xs text-slate-400">系统账号</span>'}
      </td></tr>`;
  }).join('')}</tbody></table>`;
  renderPagination(total, totalPages);

  // 绑定事件
  document.querySelectorAll('[data-edit-user]').forEach(b =>
    b.addEventListener('click', () => openUserForm(b.dataset.editUser))
  );
  document.querySelectorAll('[data-del-user]').forEach(b =>
    b.addEventListener('click', () => deleteUser(b.dataset.delUser))
  );
}

function openUserForm(editId) {
  const user = editId ? state.users.find(u => u.id == editId) : null;
  const u = user || {};
  const title = user ? '编辑用户' : '新建用户';

  openModal(`
    <h3>${title}</h3>
    <form id="userForm">
      <div class="admin-form-row">
        <div class="admin-form-group"><label>用户名 *</label>
          <input name="username" value="${esc(u.username||'')}" required ${user?'readonly':''} placeholder="用于登录" /></div>
        <div class="admin-form-group"><label>姓名 *</label>
          <input name="name" value="${esc(u.name||'')}" required placeholder="显示名称" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>角色</label>
          <select name="role">
            <option value="operator" ${u.role!=='admin'?'selected:''}>运营 (operator)</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>管理员 (admin)</option>
          </select></div>
        <div class="admin-form-group"><label>部门</label>
          <input name="dept" value="${esc(u.dept||'')}" placeholder="可选" /></div>
      </div>
      <div class="admin-form-row">
        <div class="admin-form-group"><label>${user?'新密码（留空不修改）':'密码 *'}</label>
          <input name="password" type="password" placeholder="${user?'留空则不修改':'设置登录密码'}" ${user?'':'required'} /></div>
        <div class="admin-form-group"><label>确认密码</label>
          <input name="password2" type="password" placeholder="再次输入密码" /></div>
      </div>
      ${!user ? '' : `
      <div class="admin-form-row">
        <div class="admin-form-group"><label>账号状态</label>
          <select name="status">
            <option value="1" ${Number(u.status)===1?'selected':''}>正常</option>
            <option value="0" ${Number(u.status)!==1?'selected':''}>禁用</option>
          </select></div>
        <div class="admin-form-group"></div>
      </div>`}
      <div class="flex justify-end gap-3 mt-4">
        <button type="button" class="admin-btn admin-btn-ghost" onclick="document.getElementById('modalRoot').innerHTML=''">取消</button>
        <button type="submit" class="admin-btn admin-btn-primary">${user ? '保存修改' : '创建用户'}</button>
      </div>
    </form>`, {
    onMount(modal) {
      modal.querySelector('#userForm').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());

        // 密码校验
        if (!editId && !data.password) { showToast('请输入密码', 'error'); return; }
        if (data.password && data.password !== data.password2) { showToast('两次密码不一致', 'error'); return; }

        try {
          if (editId) {
            data.id = editId;
            if (!data.password) delete data.password;
            delete data.password2;
            await api('/api/auth/users', { method: 'POST', body: { action: 'update', ...data } });
            showToast('用户已更新');
          } else {
            delete data.password2;
            await api('/api/auth/users', { method: 'POST', body: { action: 'create', ...data } });
            showToast('用户已创建');
          }
          closeModal(); await loadAll(); fullRender();
        } catch (err) { showToast('操作失败: ' + err.message, 'error'); }
      });
    }
  });
}

async function deleteUser(id) {
  const user = state.users.find(u => u.id == id);
  if (!user) return;
  if (!confirm(`确认删除用户 "${user.username}" ？`)) return;

  try {
    await api('/api/auth/users', { method: 'POST', body: { action: 'delete', id: Number(id) } });
    showToast('用户已删除');
    await loadAll(); fullRender();
  } catch (err) { showToast('删除失败: ' + err.message, 'error'); }
}