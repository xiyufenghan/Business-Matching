// 商达撮合系统 - 前端逻辑
const API_BASE = '/api';
let currentUser = null;
let navigationHistory = [];
let notificationCount = 0;

// ============ 工具函数 ============
async function fetchAPI(url, options = {}) {
  try {
    // 为所有 GET 请求默认禁用缓存，确保拿到最新数据（如管理员列表修改后立即生效）
    const method = (options.method || 'GET').toUpperCase();
    const finalOptions = {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      ...options
    };
    // 给 GET 接口 URL 追加时间戳避免任何中间代理缓存
    let finalUrl = API_BASE + url;
    if (method === 'GET') {
      finalUrl += (finalUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
    }
    const res = await fetch(finalUrl, finalOptions);
    return await res.json();
  } catch (err) {
    showToast('网络请求失败: ' + err.message, 'error');
    return { success: false, error: err.message };
  }
}

function isMobile() { return window.innerWidth <= 768; }

// 非超管管理员数据过滤参数
function getOperatorFilter() {
  if (currentUser && currentUser.role === 'admin' && !currentUser.is_super) {
    if (currentUser.admin_role === '销售') {
      // 销售角色：按sales_owner_id过滤，只看归属自己的+无归属的
      return `&sales_owner_id=${currentUser.id}`;
    }
    return `&operator_id=${currentUser.id}`;
  }
  return '';
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  toast.innerHTML = `<span>${type === 'error' ? '!' : 'OK'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function openModal(title, bodyHTML, footerHTML = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-footer').innerHTML = footerHTML;
  document.getElementById('modal-overlay').classList.add('active');
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('active'); }

function openImagePreview(imageUrl) {
  openModal('图片预览', `<div style="text-align:center"><img src="${imageUrl}" style="max-width:100%;max-height:70vh;border-radius:8px;object-fit:contain"></div>`, `<button class="btn btn-outline" onclick="closeModal()">关闭</button>`);
}

function formatNumber(num) { if (num>= 10000) return (num / 10000).toFixed(1) + '万'; return (num || 0).toString(); }

// 百分比字段规范化显示：兼容数据库中两种存储格式（整数百分数如25，和小数比率如0.25）
// 规则：数值> 1 按百分数直接显示（25 -> "25%"）；0 < 数值 ≤ 1 视为比率乘100（0.25 -> "25%"）；0/null/空显示 0%
function formatPercent(v) {
  if (v === null || v === undefined || v === '') return '0%';
  const n = Number(v);
  if (isNaN(n) || n === 0) return '0%';
  const pct = n> 1 ? n : n * 100;
  // 保留最多2位小数，去掉多余0
  return parseFloat(pct.toFixed(2)) + '%';
}
function formatDate(dateStr) { if (!dateStr) return '-'; return new Date(dateStr).toLocaleDateString('zh-CN'); }

function getStatusBadge(status) {
  const map = { published: '<span class="badge badge-open">已发布</span>', closed: '<span class="badge badge-closed">已关闭</span>', accepted: '<span class="badge badge-accepted">已接单</span>', pending: '<span class="badge badge-pending">待处理</span>', confirmed: '<span class="badge badge-confirmed">已确认</span>', rejected: '<span class="badge badge-rejected">已拒绝</span>' };
  return map[status] || `<span class="badge">${status || ''}</span>`;
}

function getStageBadge(stage) {
  return `<span class="stage-badge ${stage}">${stage}</span>`;
}

function getLevelColor(level) {
  const map = { S: '#ef4444', A: '#f59e0b', B: '#3b82f6', C: '#6b7280' };
  return map[level] || '#94a3b8';
}

// ============ 分页组件 ============
function renderPagination(pagination, onPageChange) {
  if (!pagination || pagination.total <= 0) return '';
  const { page, pageSize, total, totalPages } = pagination;
  return `
    <div class="pagination-bar">
      <div class="pagination-info">共 <strong>${total}</strong> 条，第 ${page}/${totalPages} 页</div>
      <div class="pagination-controls">
        <select class="page-size-select" onchange="${onPageChange}(1, parseInt(this.value))">
          <option value="20" ${pageSize === 20 ? 'selected' : ''}>20条/页</option>
          <option value="50" ${pageSize === 50 ? 'selected' : ''}>50条/页</option>
          <option value="100" ${pageSize === 100 ? 'selected' : ''}>100条/页</option>
        </select>
        <button class="btn btn-sm btn-outline" ${page <= 1 ? 'disabled' : ''} onclick="${onPageChange}(${page - 1})">上一页</button>
        <span class="page-num">${page}</span>
        <button class="btn btn-sm btn-outline" ${page>= totalPages ? 'disabled' : ''} onclick="${onPageChange}(${page + 1})">下一页</button>
      </div>
    </div>`;
}

// ============ 返回按钮 ============
function renderBackButton() {
  if (navigationHistory.length <= 1) return '';
  return `<button class="btn btn-outline btn-sm back-btn" onclick="goBack()">← 返回</button>`;
}
function goBack() { if (navigationHistory.length> 1) { navigationHistory.pop(); const prev = navigationHistory[navigationHistory.length - 1]; navigateTo(prev, true); } }

// ============ 侧边栏控制 ============
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('active');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

// ============ 登录与权限 ============

// ============ 激活页（/?activate=CODE） ============
// 在页面加载时检测 URL 参数，若带 activate=xxx 则显示激活页
(function initActivateCheck() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('activate');
  const autoUser = params.get('u');
  if (code) {
    // 隐藏登录页，显示激活页
    document.addEventListener('DOMContentLoaded', () => {
      const loginPage = document.getElementById('login-page');
      const activatePage = document.getElementById('activate-page');
      if (loginPage) loginPage.style.display = 'none';
      if (activatePage) activatePage.style.display = 'flex';
      loadActivateInfo(code);
    });
    return;
  }
  // 非激活场景：若 URL 带 ?u= 则自动预填登录账号输入框（来自激活跳转）
  if (autoUser) {
    document.addEventListener('DOMContentLoaded', () => {
      const inp = document.getElementById('login-username');
      if (inp) inp.value = autoUser;
      const pwd = document.getElementById('login-password');
      if (pwd) pwd.focus();
    });
  }
})();

async function loadActivateInfo(code) {
  const loadingEl = document.getElementById('activate-loading');
  const errorEl = document.getElementById('activate-error');
  const formEl = document.getElementById('activate-form');
  const subtitle = document.getElementById('activate-subtitle');
  try {
    const res = await fetch('/api/invitations/validate?code=' + encodeURIComponent(code));
    const data = await res.json();
    if (!data.success) {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.textContent = data.error || '邀请链接无效';
      subtitle.textContent = '请联系邀请人重新获取';
      return;
    }
    // 显示表单
    loadingEl.style.display = 'none';
    formEl.style.display = 'block';
    subtitle.textContent = `您好，${data.data.display_name}`;
    document.getElementById('activate-verify-label').textContent =
      data.data.kind === 'merchant' ? '确认公司名称' : '确认视频号账号名';
    document.getElementById('activate-verify-hint').textContent = data.data.verify_hint || '';
    // 暂存 code 到 form
    formEl.dataset.code = code;
  } catch (e) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    errorEl.textContent = '网络错误，请稍后重试';
  }
}

async function handleActivate(event) {
  event.preventDefault();
  const formEl = document.getElementById('activate-form');
  const code = formEl.dataset.code;
  const verifyValue = document.getElementById('activate-verify-value').value.trim();
  const password = document.getElementById('activate-password').value;
  const password2 = document.getElementById('activate-password2').value;
  const errorEl = document.getElementById('activate-form-error');

  if (password !== password2) {
    errorEl.style.display = 'block';
    errorEl.textContent = '两次密码输入不一致';
    return;
  }
  if (password.length < 6) {
    errorEl.style.display = 'block';
    errorEl.textContent = '密码至少 6 位';
    return;
  }

  try {
    const res = await fetch('/api/invitations/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verify_value: verifyValue, password })
    });
    const data = await res.json();
    if (data.success) {
      const loginUsername = (data.data && data.data.login_username) || '';
      const kind = (data.data && data.data.kind) || '';
      let msg = '账号激活成功！\n\n';
      if (loginUsername) {
        if (kind === 'merchant') {
          msg += `登录账号（手机号）：${loginUsername}\n密码：刚才设置的密码\n\n即将跳转到登录页...`;
        } else {
          msg += `登录账号：${loginUsername}\n密码：刚才设置的密码\n\n即将跳转到登录页...`;
        }
      } else {
        msg += '即将跳转到登录页，请使用刚才设置的密码登录。';
      }
      alert(msg);
      // 带上用户名到登录页自动填
      window.location.href = '/?u=' + encodeURIComponent(loginUsername);
    } else {
      errorEl.style.display = 'block';
      errorEl.textContent = data.error || '激活失败';
    }
  } catch (e) {
    errorEl.style.display = 'block';
    errorEl.textContent = '网络错误，请稍后重试';
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  if (!username) { showLoginError('请输入账号'); return; }
  if (!password) { showLoginError('请输入密码'); return; }

  errorEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = '登录中...';

  const res = await fetchAPI('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });

  btn.disabled = false;
  btn.textContent = '登 形';

  if (res.success) {
    currentUser = res.data;
    errorEl.style.display = 'none';
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    initApp();
    showToast('欢迎回来，' + currentUser.name);
  } else {
    showLoginError(res.error || '登录失败，请检查账号密码');
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function logout() {
  currentUser = null;
  navigationHistory = [];
  document.getElementById('app-container').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
  const pwd = document.getElementById('login-password'); if (pwd) { pwd.value = ''; }
  const usr = document.getElementById('login-username'); if (usr) { usr.value = ''; }
  const errorEl = document.getElementById('login-error'); if (errorEl) errorEl.style.display = 'none';
  // 聚焦账号输入框
  setTimeout(() => { document.getElementById('login-username')?.focus(); }, 100);
}

// ============ 应用初始化 ============
function initApp() {
  renderNavMenu();
  updateUserInfo();
  checkNotifications();
  const firstNav = getDefaultNav();
  navigateTo(firstNav);
}

function getDefaultNav() {
  if (currentUser.role === 'admin') return 'dashboard';
  if (currentUser.role === 'merchant') return 'merchant-demands';
  return 'influencer-demands';
}

function updateUserInfo() {
  const roleMap = { admin: '管理员', merchant: '商家', influencer: '达人' };
  let roleLabel = roleMap[currentUser.role] || '';
  if (currentUser.role === 'admin') {
    if (currentUser.is_super) {
      roleLabel = '超级管理员';
    } else {
      roleLabel = currentUser.admin_role ? '管理员（' + currentUser.admin_role + '）' : '管理员';
    }
  }
  const info = document.getElementById('user-info');
  info.innerHTML = '<div>' + currentUser.name + '</div><div style="margin-top:2px;opacity:0.7">' + roleLabel + '</div>';
  const mobileBadge = document.getElementById('mobile-user-badge');
  if (mobileBadge) mobileBadge.textContent = currentUser.name;
}

async function checkNotifications() {
  if (!currentUser) return;
  const res = await fetchAPI(`/cooperation/notifications/count?user_id=${currentUser.id}&role=${currentUser.role}`);
  if (res.success) {
    notificationCount = res.data.count;
    renderNavMenu();
  }
}

// 折叠状态记忆（默认全部展开）
let navCollapsed = JSON.parse(localStorage.getItem('navCollapsed') || '{}');

function toggleNavGroup(groupId) {
  navCollapsed[groupId] = !navCollapsed[groupId];
  localStorage.setItem('navCollapsed', JSON.stringify(navCollapsed));
  renderNavMenu();
}

function renderNavMenu() {
  const menu = document.getElementById('nav-menu');
  let groups = [];
  
  if (currentUser.role === 'admin') {
    if (currentUser.is_super) {
      groups = [
        { id: 'workspace', label: '工作台', items: [
          { id: 'dashboard', icon: 'chart', label: '数据看板' },
        ]},
        { id: 'resource', label: '资源中心', items: [
          { id: 'influencer-plaza', icon: 'star', label: '达人广场' },
          { id: 'merchant-demands', icon: 'store', label: '商家货盘' },
          { id: 'merchant-recruitments', icon: 'megaphone', label: '商家需求' },
          { id: 'influencer-demands', icon: 'target', label: '达人需求' },
        ]},
        { id: 'business', label: '撮合作业', items: [
          { id: 'matchmaking', icon: 'link', label: '撮合管理', badge: notificationCount },
        ]},
        { id: 'system', label: '系统管理', items: [
          { id: 'merchant-manage', icon: 'building', label: '商家管理' },
          { id: 'influencer-manage', icon: 'star', label: '达人管理' },
          { id: 'admin-manage', icon: 'shield', label: '管理员管理' },
        ]},
      ];
    } else {
      groups = [
        { id: 'workspace', label: '工作台', items: [
          { id: 'dashboard', icon: 'chart', label: '数据看板' },
        ]},
        { id: 'resource', label: '资源中心', items: [
          { id: 'influencer-plaza', icon: 'star', label: '达人广场' },
          { id: 'merchant-demands', icon: 'store', label: '商家货盘' },
          { id: 'merchant-recruitments', icon: 'megaphone', label: '商家需求' },
          { id: 'influencer-demands', icon: 'target', label: '达人需求' },
        ]},
        { id: 'business', label: '撮合作业', items: [
          { id: 'matchmaking', icon: 'link', label: '撮合管理', badge: notificationCount },
        ]},
        { id: 'system', label: '系统管理', items: [
          { id: 'merchant-manage', icon: 'building', label: '商家管理' },
          { id: 'influencer-manage', icon: 'star', label: '达人管理' },
        ]},
      ];
    }
  } else if (currentUser.role === 'merchant') {
    groups = [
      { id: 'workspace', label: '我的工作台', items: [
        { id: 'profile', icon: 'user', label: '个人中心', badge: notificationCount },
      ]},
      { id: 'resource', label: '找达人', items: [
        { id: 'influencer-plaza', icon: 'star', label: '达人广场' },
        { id: 'influencer-demands', icon: 'target', label: '达人需求' },
      ]},
      { id: 'business', label: '我的货盘', items: [
        { id: 'merchant-demands', icon: 'store', label: '我的需求' },
        { id: 'merchant-recruitments', icon: 'megaphone', label: '我的招募' },
      ]},
      { id: 'cooperation', label: '合作管理', items: [
        { id: 'matchmaking', icon: 'link', label: '合作管理', badge: notificationCount },
      ]},
    ];
  } else {
    // 达人视角
    groups = [
      { id: 'workspace', label: '我的工作台', items: [
        { id: 'profile', icon: 'user', label: '个人中心', badge: notificationCount },
      ]},
      { id: 'resource', label: '找商家', items: [
        { id: 'merchant-demands', icon: 'store', label: '商家货盘' },
        { id: 'merchant-recruitments', icon: 'megaphone', label: '商家需求' },
      ]},
      { id: 'business', label: '我的需求', items: [
        { id: 'influencer-demands', icon: 'target', label: '我的需求' },
      ]},
    ];
  }
  
  const activeId = navigationHistory[navigationHistory.length-1];
  menu.innerHTML = groups.map(g => {
    const isCollapsed = navCollapsed[g.id] === true;
    // 单 item 的 group 不显示标题（如商家"找达人"只有 1 项）
    const showHeader = g.items.length > 1 || g.id === 'workspace';
    const itemsHtml = g.items.map(item => `
      <div class="nav-item ${activeId === item.id ? 'active' : ''}" onclick="navigateTo('${item.id}')">
        <span class="icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.badge > 0 ? '<span class="badge-dot">' + item.badge + '</span>' : ''}
      </div>
    `).join('');
    
    if (!showHeader) {
      return `<div class="nav-group">${itemsHtml}</div>`;
    }
    return `
      <div class="nav-group ${isCollapsed?'nav-group-collapsed':''}">
        <div class="nav-group-header" onclick="toggleNavGroup('${g.id}')">
          <span class="nav-group-label">${g.label}</span>
          <svg class="nav-group-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="nav-group-items">${itemsHtml}</div>
      </div>
    `;
  }).join('');
}

function navigateTo(page, isBack = false) {
  if (!isBack) {
    if (navigationHistory[navigationHistory.length - 1] !== page) navigationHistory.push(page);
  }
  renderNavMenu();
  closeSidebar();
  
  const container = document.getElementById('page-container');
  container.scrollTop = 0;
  container.setAttribute('data-module', page);
  window.scrollTo(0, 0);
  
  switch(page) {
    case 'dashboard': renderDashboard(); break;
    case 'merchant-demands': renderMerchantDemands(); break;
    case 'influencer-demands': renderInfluencerDemands(); break;
    case 'merchant-recruitments': renderMerchantRecruitments(); break;
    case 'influencer-plaza': renderInfluencerPlaza(); break;
    case 'matchmaking': renderMatchmaking(); break;
    case 'profile': renderProfile(); break;
    case 'merchant-manage': renderMerchantManage(); break;
    case 'influencer-manage': renderInfluencerManage(); break;
    case 'admin-manage': renderAdminManage(); break;
    default: renderDashboard();
  }
}

// ============ 数据看板 ============
let dashFilters = { range: 30, type: '', salesId: '' };
let echartInstances = {};  // 缓存图表实例

function disposeAllCharts() {
  Object.values(echartInstances).forEach(c => { try { c.dispose(); } catch(e) {} });
  echartInstances = {};
}

// 大数字格式化（万/亿）
function formatBigNumber(n) {
  if (n == null) return '0';
  if (n >= 100000000) return (n / 100000000).toFixed(2) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return n.toLocaleString();
}

async function renderDashboard() {
  const container = document.getElementById('page-container');
  disposeAllCharts();
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载看板数据中...</p></div>';

  const opFilter = getOperatorFilter();
  const isSuperAdmin = currentUser.role === 'admin' && currentUser.is_super === true;
  const isMerchant = currentUser.role === 'merchant';
  const isInfluencer = currentUser.role === 'influencer';

  const range = dashFilters.range || 30;
  const baseQs = `?days=${range}` + (opFilter || '');

  // 并行调用所有看板接口
  let dashRes, funnelRes, trendRes, distRes, salesRes, topRes, timelineRes;
  try {
    [dashRes, funnelRes, trendRes, distRes, topRes, timelineRes] = await Promise.all([
      fetchAPI('/stats/dashboard' + baseQs),
      fetchAPI('/stats/funnel' + baseQs),
      fetchAPI('/stats/trend' + baseQs),
      fetchAPI('/stats/distribution' + (opFilter ? '?' + opFilter.substring(1) : '')),
      fetchAPI('/stats/top-entities' + (opFilter ? '?' + opFilter.substring(1) : '')),
      fetchAPI('/stats/timeline?limit=15' + (opFilter || '')),
    ]);
    if (isSuperAdmin) {
      salesRes = await fetchAPI('/stats/sales-ranking');
    }
  } catch (e) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#ef4444">看板数据加载失败：' + e.message + '</p>';
    return;
  }

  if (!dashRes || !dashRes.success) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#ef4444">数据接口异常</p>';
    return;
  }

  const d = dashRes.data;
  const funnel = funnelRes.success ? funnelRes.data : [];
  const trend = trendRes.success ? trendRes.data : [];
  const dist = distRes.success ? distRes.data : { typeStats:[], categoryStats:[], levelStats:[], fansBuckets:[] };
  const top = topRes.success ? topRes.data : { topMerchants:[], topInfluencers:[] };
  const timeline = timelineRes.success ? timelineRes.data : [];
  const salesRank = (salesRes && salesRes.success) ? salesRes.data : [];

  // 渲染 HTML 骨架
  container.innerHTML = `
    ${renderBackButton()}
    <div class="dashboard-page">
      <!-- 顶部：标题 + 时间范围筛选 -->
      <div class="dash-header">
        <div>
          <h2 style="font-size:22px;margin:0;color:#1e293b">数据看板</h2>
          <p style="font-size:12px;color:#94a3b8;margin:4px 0 0">实时业务数据 · ${new Date().toLocaleString('zh-CN')}</p>
        </div>
        <div class="dash-toolbar">
          <div class="range-selector">
            ${[7, 30, 90].map(r => `
              <button class="range-btn ${dashFilters.range===r?'active':''}" onclick="onDashRangeChange(${r})">${r}天</button>
            `).join('')}
          </div>
          <button class="btn btn-sm btn-outline" onclick="renderDashboard()" title="刷新">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            刷新
          </button>
        </div>
      </div>

      <!-- Level 1: 北极星指标（4 张大卡） -->
      <div class="kpi-row kpi-row-primary">
        <div class="kpi-card kpi-blue">
          <div class="kpi-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg></div>
          <div class="kpi-content">
            <div class="kpi-label">已确认合作</div>
            <div class="kpi-value">${d.confirmedCooperations}</div>
            <div class="kpi-sub">总撮合 ${d.totalCooperations} 次</div>
          </div>
        </div>
        <div class="kpi-card kpi-green">
          <div class="kpi-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg></div>
          <div class="kpi-content">
            <div class="kpi-label">潜在合作金额 <span class="kpi-tip" title="估算：已确认合作的需求售价之和">ⓘ</span></div>
            <div class="kpi-value">¥${formatBigNumber(d.potentialGmv)}</div>
            <div class="kpi-sub">基于已确认合作估算</div>
          </div>
        </div>
        <div class="kpi-card kpi-orange">
          <div class="kpi-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
          <div class="kpi-content">
            <div class="kpi-label">撮合达成率</div>
            <div class="kpi-value">${d.matchRate}%</div>
            <div class="kpi-sub">已确认 / 总撮合</div>
          </div>
        </div>
        <div class="kpi-card kpi-purple">
          <div class="kpi-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
          <div class="kpi-content">
            <div class="kpi-label">活跃主体</div>
            <div class="kpi-value">${d.activeMerchants + d.activeInfluencers}</div>
            <div class="kpi-sub">商家 ${d.activeMerchants} · 达人 ${d.activeInfluencers}</div>
          </div>
        </div>
      </div>

      <!-- Level 2: 过程指标（8 张小卡） -->
      <div class="kpi-row kpi-row-secondary">
        ${renderMiniKpi('入驻商家', d.merchantCount, '#3b82f6')}
        ${renderMiniKpi('入驻达人', d.influencerCount, '#06b6d4')}
        ${renderMiniKpi('销售人员', d.salesCount, '#10b981')}
        ${renderMiniKpi('管理员', d.adminCount, '#64748b')}
        ${renderMiniKpi('商家需求', d.totalDemands, '#8b5cf6')}
        ${renderMiniKpi('达人需求', d.totalInfDemands, '#ec4899')}
        ${renderMiniKpi('待处理合作', d.pendingCooperations, '#f59e0b')}
        ${renderMiniKpi('本周新增需求', d.newDemandsThisWeek, '#ef4444')}
      </div>

      <!-- 漏斗 + 类型饼图 -->
      <div class="dash-grid-2">
        <div class="dash-chart-card">
          <div class="dash-chart-title">撮合转化漏斗 <span class="dash-chart-sub">最近 ${range} 天</span></div>
          <div id="chart-funnel" style="height:340px"></div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">需求类型 / 类目分布</div>
          <div id="chart-distribution" style="height:340px"></div>
        </div>
      </div>

      <!-- 时间趋势 -->
      <div class="dash-chart-card" style="margin-bottom:16px">
        <div class="dash-chart-title">${range}天业务趋势 <span class="dash-chart-sub">每日新增需求 / 合作 / 接单</span></div>
        <div id="chart-trend" style="height:300px"></div>
      </div>

      <!-- 达人结构画像 -->
      <div class="dash-grid-2">
        <div class="dash-chart-card">
          <div class="dash-chart-title">达人等级分布</div>
          <div id="chart-level" style="height:280px"></div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">达人粉丝量段</div>
          <div id="chart-fans" style="height:280px"></div>
        </div>
      </div>

      <!-- 销售排行（仅超管） -->
      ${isSuperAdmin && salesRank.length > 0 ? `
      <div class="dash-chart-card" style="margin-bottom:16px">
        <div class="dash-chart-title">销售业绩排行</div>
        <div id="chart-sales-rank" style="height:${Math.max(140, salesRank.length * 50)}px"></div>
      </div>
      ` : ''}

      <!-- Top10 + 时间线 -->
      <div class="dash-grid-3">
        <div class="dash-chart-card">
          <div class="dash-chart-title">商家 Top10 <span class="dash-chart-sub">按已确认合作</span></div>
          <div class="rank-list">
            ${top.topMerchants.length === 0 ? '<div class="empty-mini">暂无数据</div>' : top.topMerchants.map((m, i) => `
              <div class="rank-item">
                <span class="rank-no rank-no-${i<3?i+1:'rest'}">${i+1}</span>
                <div class="rank-name" title="${m.company || m.name}">${m.company || m.name}</div>
                <div class="rank-stat">
                  <span class="rank-num">${m.confirmed_count}</span>
                  <span class="rank-unit">/ ${m.demand_count}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">达人 Top10 <span class="dash-chart-sub">按已确认合作</span></div>
          <div class="rank-list">
            ${top.topInfluencers.length === 0 ? '<div class="empty-mini">暂无数据</div>' : top.topInfluencers.map((inf, i) => `
              <div class="rank-item">
                <span class="rank-no rank-no-${i<3?i+1:'rest'}">${i+1}</span>
                <div class="rank-name" title="${inf.name||'未命名'}">
                  ${inf.name || '未命名'}
                  <span class="rank-level rank-level-${(inf.level||'').replace('级','')}">${inf.level || ''}</span>
                </div>
                <div class="rank-stat">
                  <span class="rank-num">${inf.confirmed_count}</span>
                  <span class="rank-unit">/ ${inf.coop_count}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">最新动态 <span class="dash-chart-sub">最近 15 条</span></div>
          <div class="timeline-list">
            ${timeline.length === 0 ? '<div class="empty-mini">暂无动态</div>' : timeline.map(ev => renderTimelineItem(ev)).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  // 初始化图表（在 DOM 渲染后）
  setTimeout(() => {
    initFunnelChart(funnel);
    initDistributionChart(dist);
    initTrendChart(trend);
    initLevelChart(dist.levelStats);
    initFansChart(dist.fansBuckets);
    if (isSuperAdmin && salesRank.length > 0) initSalesRankChart(salesRank);
  }, 50);

  // 响应式
  window.onresize = () => {
    Object.values(echartInstances).forEach(c => { try { c.resize(); } catch(e) {} });
  };
}

function onDashRangeChange(days) {
  dashFilters.range = days;
  renderDashboard();
}

function renderMiniKpi(label, value, color) {
  return `
    <div class="mini-kpi">
      <div class="mini-kpi-bar" style="background:${color}"></div>
      <div class="mini-kpi-value">${formatBigNumber(value || 0)}</div>
      <div class="mini-kpi-label">${label}</div>
    </div>
  `;
}

function renderTimelineItem(ev) {
  const time = ev.created_at ? formatRelativeTime(ev.created_at) : '';
  if (ev.kind === 'demand') {
    const typeLabel = ev.subtype === 'book' ? '图书' : '课程';
    const typeColor = ev.subtype === 'book' ? '#3b82f6' : '#8b5cf6';
    return `
      <div class="tl-item">
        <span class="tl-dot" style="background:${typeColor}"></span>
        <div class="tl-content">
          <div class="tl-text"><span class="tl-tag" style="background:${typeColor}15;color:${typeColor}">${typeLabel}</span> ${ev.text || '未命名'}</div>
          <div class="tl-meta">${ev.merchant_name || '-'} · ${time}</div>
        </div>
      </div>
    `;
  } else {
    const stMap = { confirmed: ['已确认', '#10b981'], pending: ['待处理', '#f59e0b'], rejected: ['已拒绝', '#ef4444'] };
    const [stLabel, stColor] = stMap[ev.text] || [ev.text, '#64748b'];
    return `
      <div class="tl-item">
        <span class="tl-dot" style="background:${stColor}"></span>
        <div class="tl-content">
          <div class="tl-text"><span class="tl-tag" style="background:${stColor}15;color:${stColor}">合作${stLabel}</span> ${ev.merchant_name||'-'} → ${ev.influencer_name||'-'}</div>
          <div class="tl-meta">${ev.subtype === 'merchant' ? '商家发起' : '达人申请'} · ${time}</div>
        </div>
      </div>
    `;
  }
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  const t = new Date(isoStr.replace(' ', 'T'));
  const now = new Date();
  const diffMs = now - t;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return diffMin + '分钟前';
  if (diffMin < 1440) return Math.floor(diffMin / 60) + '小时前';
  if (diffMin < 43200) return Math.floor(diffMin / 1440) + '天前';
  return t.toLocaleDateString('zh-CN');
}

// ============ ECharts 图表初始化 ============

function initFunnelChart(data) {
  const dom = document.getElementById('chart-funnel');
  if (!dom || !data || !data.length) return;
  const chart = echarts.init(dom);
  echartInstances['funnel'] = chart;
  chart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: (p) => `${p.name}<br/>数量: <b>${p.value}</b><br/>转化率: <b>${data[p.dataIndex].conversionFromTop}%</b>`
    },
    series: [{
      type: 'funnel',
      left: '10%', top: 20, bottom: 20, width: '80%',
      min: 0, max: data[0]?.count || 1,
      sort: 'descending',
      gap: 4,
      label: {
        show: true, position: 'inside',
        formatter: (p) => `${p.name}\n${p.value} (${data[p.dataIndex].conversionFromTop}%)`,
        color: '#fff', fontWeight: 600, fontSize: 13
      },
      labelLine: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      emphasis: { label: { fontSize: 14 } },
      data: data.map((f, i) => ({
        value: f.count,
        name: f.stage,
        itemStyle: { color: ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd'][i] }
      }))
    }]
  });
}

function initDistributionChart(dist) {
  const dom = document.getElementById('chart-distribution');
  if (!dom) return;
  const chart = echarts.init(dom);
  echartInstances['dist'] = chart;
  
  const typeData = (dist.typeStats || []).map(t => ({
    name: t.type === 'book' ? '图书' : (t.type === 'course' ? '课程' : t.type),
    value: t.count
  }));
  const catData = (dist.categoryStats || []).slice(0, 8).map(c => ({
    name: c.category, value: c.count
  }));
  
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} ({d}%)' },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        name: '类型', type: 'pie',
        radius: ['0%', '30%'], center: ['50%', '45%'],
        label: { position: 'inner', formatter: '{b}\n{d}%', fontSize: 11, color: '#fff' },
        data: typeData,
        color: ['#3b82f6', '#8b5cf6']
      },
      {
        name: '类目', type: 'pie',
        radius: ['45%', '70%'], center: ['50%', '45%'],
        labelLine: { length: 8, length2: 8 },
        label: { fontSize: 11, formatter: '{b} {d}%' },
        data: catData,
        color: ['#60a5fa','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#64748b']
      }
    ]
  });
}

function initTrendChart(trend) {
  const dom = document.getElementById('chart-trend');
  if (!dom || !trend || !trend.length) return;
  const chart = echarts.init(dom);
  echartInstances['trend'] = chart;
  
  const dates = trend.map(t => t.date.slice(5));  // MM-DD
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { data: ['新增需求', '新增合作', '新增接单'], top: 0 },
    grid: { left: 40, right: 20, top: 40, bottom: 40 },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLabel: { fontSize: 11, color: '#94a3b8' },
      axisLine: { lineStyle: { color: '#e2e8f0' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 11, color: '#94a3b8' },
      splitLine: { lineStyle: { color: '#f1f5f9' } }
    },
    series: [
      {
        name: '新增需求', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        itemStyle: { color: '#3b82f6' }, lineStyle: { width: 2.5 },
        areaStyle: { color: { type: 'linear', x:0,y:0,x2:0,y2:1, colorStops: [{offset:0,color:'rgba(59,130,246,0.3)'},{offset:1,color:'rgba(59,130,246,0)'}] } },
        data: trend.map(t => t.demands)
      },
      {
        name: '新增合作', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        itemStyle: { color: '#10b981' }, lineStyle: { width: 2.5 },
        data: trend.map(t => t.cooperations)
      },
      {
        name: '新增接单', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
        itemStyle: { color: '#f59e0b' }, lineStyle: { width: 2.5 },
        data: trend.map(t => t.orders)
      }
    ]
  });
}

function initLevelChart(levelStats) {
  const dom = document.getElementById('chart-level');
  if (!dom) return;
  const chart = echarts.init(dom);
  echartInstances['level'] = chart;
  const data = (levelStats || []).map(l => ({ name: l.level, value: l.count }));
  if (data.length === 0) {
    chart.setOption({ title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#94a3b8', fontSize: 13 } } });
    return;
  }
  const colors = { 'S': '#ef4444', 'A级': '#f59e0b', 'A': '#f59e0b', 'B级': '#3b82f6', 'B': '#3b82f6', 'C级': '#10b981', 'C': '#10b981', 'D级': '#94a3b8', 'D': '#94a3b8' };
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: data.map(d => d.name), axisLabel: { fontSize: 11 } },
    yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar', data: data.map(d => ({ value: d.value, itemStyle: { color: colors[d.name] || '#64748b', borderRadius: [4,4,0,0] } })),
      label: { show: true, position: 'top', fontSize: 11 },
      barWidth: '48%'
    }]
  });
}

function initFansChart(fansBuckets) {
  const dom = document.getElementById('chart-fans');
  if (!dom) return;
  const chart = echarts.init(dom);
  echartInstances['fans'] = chart;
  const data = fansBuckets || [];
  if (data.length === 0) {
    chart.setOption({ title: { text: '暂无数据', left: 'center', top: 'center', textStyle: { color: '#94a3b8', fontSize: 13 } } });
    return;
  }
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 80, right: 30, top: 20, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    yAxis: { type: 'category', data: data.map(b => b.bucket), axisLabel: { fontSize: 11 } },
    series: [{
      type: 'bar',
      data: data.map(b => b.count),
      label: { show: true, position: 'right', fontSize: 11 },
      barWidth: '50%',
      itemStyle: {
        color: { type: 'linear', x:0,y:0,x2:1,y2:0, colorStops: [{offset:0,color:'#60a5fa'},{offset:1,color:'#2563eb'}] },
        borderRadius: [0,6,6,0]
      }
    }]
  });
}

function initSalesRankChart(rank) {
  const dom = document.getElementById('chart-sales-rank');
  if (!dom || !rank.length) return;
  const chart = echarts.init(dom);
  echartInstances['salesRank'] = chart;
  const sorted = [...rank].sort((a, b) => a.confirmed_count - b.confirmed_count); // 倒序让大的在上
  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const r = sorted[params[0].dataIndex];
        return `${r.name}<br/>商家数: ${r.merchant_count}<br/>需求数: ${r.demand_count}<br/>已确认合作: <b>${r.confirmed_count}</b><br/>合作总数: ${r.total_coop_count}<br/>成交率: ${r.dealRate}%`;
      }
    },
    legend: { data: ['已确认合作', '需求数', '商家数'], top: 0 },
    grid: { left: 80, right: 40, top: 40, bottom: 30 },
    xAxis: { type: 'value', axisLabel: { fontSize: 11 } },
    yAxis: { type: 'category', data: sorted.map(r => r.name), axisLabel: { fontSize: 11 } },
    series: [
      { name: '已确认合作', type: 'bar', data: sorted.map(r => r.confirmed_count), itemStyle: { color: '#10b981', borderRadius: [0,4,4,0] }, label: { show: true, position: 'right', fontSize: 11 } },
      { name: '需求数', type: 'bar', data: sorted.map(r => r.demand_count), itemStyle: { color: '#3b82f6', borderRadius: [0,4,4,0] } },
      { name: '商家数', type: 'bar', data: sorted.map(r => r.merchant_count), itemStyle: { color: '#f59e0b', borderRadius: [0,4,4,0] } },
    ]
  });
}

// ============ 商家需求大厅 ============
let mdFilters = { type: '', category: '', status: '', keyword: '', book_category: '', grade_level: '', pure_commission_min: '', pure_commission_max: '', ad_commission_min: '', ad_commission_max: '', filter_sales_id: '' };

async function renderMerchantDemands(page = 1, pageSize = 20) {
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';
  
  const isInfluencer = currentUser.role === 'influencer';
  const isMerchant = currentUser.role === 'merchant';
  // 仅超级管理员可见"归属销售"列与筛选项（普通销售管理员只看到自己负责的需求，无需再筛销售）
  const showSales = currentUser.role === 'admin' && currentUser.is_super === true;
  const title = isMerchant ? '我的需求' : '商家货盘';
  
  let url = `/demands?page=${page}&pageSize=${pageSize}`;
  if (isMerchant) url += `&merchant_id=${currentUser.id}`;
  if (mdFilters.type) url += `&demand_type=${encodeURIComponent(mdFilters.type)}`;
  if (mdFilters.status) url += `&status=${encodeURIComponent(mdFilters.status)}`;
  if (mdFilters.book_category) url += `&book_category=${encodeURIComponent(mdFilters.book_category)}`;
  if (mdFilters.grade_level) url += `&grade_level=${encodeURIComponent(mdFilters.grade_level)}`;
  if (mdFilters.pure_commission_min) url += `&pure_commission_min=${encodeURIComponent(mdFilters.pure_commission_min)}`;
  if (mdFilters.pure_commission_max) url += `&pure_commission_max=${encodeURIComponent(mdFilters.pure_commission_max)}`;
  if (mdFilters.ad_commission_min) url += `&ad_commission_min=${encodeURIComponent(mdFilters.ad_commission_min)}`;
  if (mdFilters.ad_commission_max) url += `&ad_commission_max=${encodeURIComponent(mdFilters.ad_commission_max)}`;
  if (mdFilters.filter_sales_id) url += `&filter_sales_id=${encodeURIComponent(mdFilters.filter_sales_id)}`;
  if (mdFilters.keyword) url += `&keyword=${encodeURIComponent(mdFilters.keyword)}`;
  if (mdViewMode === 'list') { url += `&sortField=${mdSortField}&sortOrder=${mdSortOrder}`; }
  url += getOperatorFilter();
  
  const res = await fetchAPI(url);
  if (!res.success) { container.innerHTML = '<p>加载失败</p>'; return; }
  
  // 获取筛选下拉项（图书分类、学段、销售列表）
  let bookCategories = [];
  let gradeLevels = [];
  let salesList = [];
  try {
    const optsRes = await fetchAPI('/demands/filter-options');
    if (optsRes && optsRes.success && optsRes.data) {
      bookCategories = optsRes.data.book_categories || [];
      gradeLevels = optsRes.data.grade_levels || [];
      salesList = optsRes.data.sales_list || [];
    }
  } catch(e) { /* 兜底 */ }
  
  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header">
      <h2>${title}</h2>
      <div class="page-header-actions" style="display:flex;gap:8px;align-items:center;">
        <span id="demand-count-badge" style="font-size:12px;color:#94a3b8;background:#f1f5f9;padding:4px 10px;border-radius:12px;">共 ${res.pagination.total} 条</span>
      </div>
    </div>
    
    <!-- 筛选面板：基于发布需求页字段，类型联动显示分类/学段 -->
    <div class="filter-panel" id="md-filter-panel" style="display:${(!isInfluencer && mdFilterPanelOpen) ? 'block' : 'none'}">
      <div class="filter-row">
        <div class="filter-item">
          <label>需求类型</label>
          <select id="md-filter-type" onchange="onMdFilterChange('type', this.value); applyMdFilter()">
            <option value="">全部</option>
            <option value="book" ${mdFilters.type==='book'?'selected':''}>图书需求</option>
            <option value="course" ${mdFilters.type==='course'?'selected':''}>课程需求</option>
          </select>
        </div>
        <div class="filter-item">
          <label>发布状态</label>
          <select id="md-filter-status" onchange="onMdFilterChange('status', this.value); applyMdFilter()">
            <option value="">全部</option>
            <option value="published" ${mdFilters.status==='published'?'selected':''}>已发布</option>
            <option value="accepted" ${mdFilters.status==='accepted'?'selected':''}>已接单</option>
            <option value="closed" ${mdFilters.status==='closed'?'selected':''}>已关闭</option>
          </select>
        </div>
        ${(mdFilters.type === 'book' || mdFilters.type === '') ? `
        <div class="filter-item">
          <label>图书分类</label>
          <select id="md-filter-book-cat" onchange="onMdFilterChange('book_category', this.value); applyMdFilter()">
            <option value="">全部</option>
            ${bookCategories.map(c => `<option value="${c}" ${mdFilters.book_category===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>` : ''}
        ${(mdFilters.type === 'course' || mdFilters.type === '') ? `
        <div class="filter-item">
          <label>课程学段</label>
          <select id="md-filter-grade" onchange="onMdFilterChange('grade_level', this.value); applyMdFilter()">
            <option value="">全部</option>
            ${gradeLevels.map(g => `<option value="${g}" ${mdFilters.grade_level===g?'selected':''}>${g}</option>`).join('')}
          </select>
        </div>` : ''}
        ${showSales ? `
        <div class="filter-item">
          <label>归属销售</label>
          <select id="md-filter-sales" onchange="onMdFilterChange('filter_sales_id', this.value); applyMdFilter()">
            <option value="">全部</option>
            ${salesList.map(s => `<option value="${s.id}" ${mdFilters.filter_sales_id===s.id?'selected':''}>${s.name}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>
      <!-- 第二行：佣金范围筛选（仅图书需求） -->
      ${(mdFilters.type === 'book' || mdFilters.type === '') ? `
      <div class="filter-row" style="margin-top:10px;">
        <div class="filter-item" style="flex:0 0 auto;">
          <label>纯佣金 (%)</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="number" id="md-filter-pure-min" placeholder="最低" value="${mdFilters.pure_commission_min || ''}" style="width:80px"
              onchange="onMdFilterChange('pure_commission_min', this.value)">
            <span style="color:#94a3b8">-</span>
            <input type="number" id="md-filter-pure-max" placeholder="最高" value="${mdFilters.pure_commission_max || ''}" style="width:80px"
              onchange="onMdFilterChange('pure_commission_max', this.value)">
          </div>
        </div>
        <div class="filter-item" style="flex:0 0 auto;">
          <label>投流佣金 (%)</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="number" id="md-filter-ad-min" placeholder="最低" value="${mdFilters.ad_commission_min || ''}" style="width:80px"
              onchange="onMdFilterChange('ad_commission_min', this.value)">
            <span style="color:#94a3b8">-</span>
            <input type="number" id="md-filter-ad-max" placeholder="最高" value="${mdFilters.ad_commission_max || ''}" style="width:80px"
              onchange="onMdFilterChange('ad_commission_max', this.value)">
          </div>
        </div>
        <button class="btn btn-primary btn-sm" style="align-self:flex-end;margin-bottom:0;" onclick="applyMdFilter()">应用佣金筛选</button>
      </div>` : ''}
      <!-- 第三行：搜索 + 重置 -->
      <div class="filter-row" style="margin-top:10px;">
        <div class="filter-item" style="flex:1">
          <input type="text" id="md-filter-keyword" placeholder="搜索图书名/课程名/商家名${showSales ? '/归属销售' : ''}..." value="${mdFilters.keyword || ''}"
            onkeypress="if(event.key==='Enter'){ onMdFilterChange('keyword', this.value); applyMdFilter(); }">
        </div>
        <button class="btn btn-primary btn-sm" onclick="onMdFilterChange('keyword', document.getElementById('md-filter-keyword').value); applyMdFilter()">搜索</button>
        ${(mdFilters.type||mdFilters.status||mdFilters.book_category||mdFilters.grade_level||mdFilters.keyword||mdFilters.pure_commission_min||mdFilters.pure_commission_max||mdFilters.ad_commission_min||mdFilters.ad_commission_max||mdFilters.filter_sales_id) ? '<button class="btn btn-sm btn-outline" onclick="resetMdFilter()">重置</button>' : ''}
      </div>
    </div>

    <!-- 工具栏：视图切换 + 筛选/清空 -->
    <div class="md-toolbar">
      <div class="md-toolbar-left">
        ${currentUser.role !== 'influencer' ? `<button class="btn btn-sm btn-success" onclick="showPublishGoodsModal()">+ 发布货品</button>` : ''}
        ${(currentUser.role === 'admin') ? `<button class="btn btn-sm btn-outline" onclick="showImportGoodsModal()">Excel 导入</button>` : ''}
        ${!isInfluencer ? `<button class="btn btn-sm ${mdFilterPanelOpen?'btn-primary':'btn-outline'}" onclick="toggleMdFilter()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          筛选${getActiveFilterCount() > 0 ? ' ('+getActiveFilterCount()+')' : ''}
        </button>` : ''}
        ${currentUser.role !== 'influencer' ? '<button class="btn btn-sm btn-danger-outline" onclick="clearAllMerchantDemands()">清空</button>' : ''}
      </div>
      <div class="md-toolbar-right">
        <button class="btn btn-sm ${mdViewMode==='list'?'btn-primary':'btn-outline'}" onclick="switchMdView('list')" title="列表视图">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> 列表
        </button>
        <button class="btn btn-sm ${mdViewMode==='card'?'btn-primary':'btn-outline'}" onclick="switchMdView('card')" title="卡片视图">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> 卡片
        </button>
      </div>
    </div>
    <div class="${mdViewMode==='card' ? 'demand-grid' : 'demand-list'}" id="merchant-demand-list">
      ${res.data.length === 0 
        ? '<div class="empty-state"><div class="icon">-</div><p>暂无匹配的需求</p><button class="btn btn-sm btn-primary mt-16" onclick="resetMdFilter()" style="margin-top:12px">清除筛选条件</button></div>'
        : mdViewMode === 'card'
          ? res.data.map(d => renderMerchantDemandCard(d, isInfluencer)).join('')
          : renderMdTableHeader(isInfluencer, showSales) + res.data.map(d => renderMerchantDemandRow(d, isInfluencer, showSales)).join('')
      }
    </div>
    ${renderPagination(res.pagination, 'pageMerchantDemands')}`;
}

let mdViewMode = 'list'; // 默认列表模式
let mdSortField = 'created_at'; // 默认按创建时间排序
let mdSortOrder = 'desc';      // 降序

function switchMdView(mode) {
  mdViewMode = mode;
  renderMerchantDemands();
}

function switchMdSort(field) {
  if (mdSortField === field) {
    mdSortOrder = mdSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    mdSortField = field;
    mdSortOrder = 'asc';
  }
  renderMerchantDemands();
}

function getMdSortIcon(field) {
  if (mdSortField !== field) return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2"><path d="M7 15l5 5 5-5M7 9l5-5 5 5"/></svg>';
  const icon = mdSortOrder === 'asc'
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="#2563eb" stroke="#2563eb" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="#2563eb" stroke="#2563eb" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>';
  return icon;
}

function renderMdTableHeader(isInfluencer, showSales) {
  // align: left | center | right
  const sortTh = (label, field, align = 'left') => {
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    const icon = `<span class="sort-icon">${getMdSortIcon(field)}</span>`;
    return `<div class="demand-th ${cls}" onclick="switchMdSort('${field}')">${label}${icon}</div>`;
  };
  const plainTh = (label, align = 'left') => {
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    return `<div class="demand-th no-hover ${cls}">${label}</div>`;
  };

  const hasSales = showSales;
  const headerClass = hasSales ? 'demand-row-header has-sales' : 'demand-row-header';
  return `
    <div class="${headerClass}">
      ${plainTh('', 'center')}
      ${sortTh('类型', 'type', 'center')}
      ${plainTh('需求信息', 'left')}
      ${sortTh('售价', 'price', 'right')}
      ${plainTh('库存', 'right')}
      ${sortTh('纯佣金', 'commission', 'right')}
      ${plainTh('投流佣金', 'right')}
      ${hasSales ? sortTh('归属销售', 'sales', 'center') : ''}
      ${sortTh('状态', 'status', 'center')}
      ${sortTh('创建时间', 'created_at', 'right')}
      ${plainTh('操作', 'right')}
    </div>`;
}

function renderMerchantDemandRow(d, isInfluencer, showSales) {
  const isBook = d.demand_type === 'book';
  const typeLabel = isBook ? '图书' : '课程';
  const typeColor = isBook ? '#3b82f6' : '#8b5cf6';
  const priceVal = isBook ? `¥${d.selling_price || 0}` : `¥${d.unit_price || 0}`;
  const pureComm = isBook
    ? formatPercent(d.pure_commission || 0)
    : (d.course_pure_commission != null ? formatPercent(d.course_pure_commission) : '-');
  const adComm = isBook
    ? formatPercent(d.ad_commission || 0)
    : (d.course_ad_commission != null ? formatPercent(d.course_ad_commission) : '-');
  const stockVal = isBook ? (d.stock != null ? formatNumber(d.stock) : '-') : '-';
  const merchantName = d.merchant_company || d.merchant_name || '-';
  // 副信息：商家 · 分类 · 目标人群/学段
  let subParts = [merchantName];
  if (isBook) {
    if (d.book_category) subParts.push(d.book_category);
    if (d.book_target_audience) subParts.push(d.book_target_audience);
    if (d.specification) subParts.push(d.specification);
  } else {
    if (d.grade_level) subParts.push(d.grade_level);
    if (d.subject) subParts.push(d.subject);
  }
  const titleText = d.title || (isBook ? d.book_name : d.course_name) || '未命名';
  const rowClass = showSales ? 'demand-row has-sales' : 'demand-row';
  const salesCol = showSales ? `<span class="demand-row-sales" title="归属销售">${d.merchant_sales_owner_name||'<span style="color:#cbd5e1">-</span>'}</span>` : '';
  return `
    <div class="${rowClass}" data-id="${d.id}">
      <input type="checkbox" class="demand-checkbox" value="${d.id}">
      <span class="type-badge-sm" style="background:${typeColor}15;color:${typeColor}">${typeLabel}</span>
      <div class="demand-row-main">
        <div class="demand-row-title">${titleText}</div>
        <div class="demand-row-sub">${subParts.join(' · ')}</div>
      </div>
      <span class="demand-row-price">${priceVal}</span>
      <span class="demand-row-stock">${stockVal}</span>
      <span class="demand-row-commission">${pureComm}</span>
      <span class="demand-row-ad-commission">${adComm}</span>
      ${salesCol}
      <span class="demand-row-status">${getStatusBadge(d.status)}</span>
      <span class="demand-row-date">${formatDate(d.created_at)}</span>
      <div class="demand-row-actions">
        ${isInfluencer ? `<button class="btn btn-xs btn-primary" onclick="applyCooperation('${d.id}','${d.merchant_id}')">申请合作</button>` : ''}
        ${(currentUser.role === 'admin' || currentUser.role === 'merchant') && d.ref_demand_id ? `<button class="btn btn-xs btn-outline" onclick="editMerchantDemand('${d.ref_demand_id}','${d.demand_type}')">编辑</button>` : ''}
        ${currentUser.role === 'admin' || currentUser.role === 'merchant' ? `<button class="btn btn-xs btn-danger-outline" onclick="deleteMerchantDemand('${d.id}')">删除</button>` : ''}
      </div>
    </div>`;
}

let mdFilterPanelOpen = false;
function toggleMdFilter() {
  mdFilterPanelOpen = !mdFilterPanelOpen;
  renderMerchantDemands();
}

function getActiveFilterCount() {
  const keys = ['type','status','book_category','grade_level','keyword','pure_commission_min','pure_commission_max','ad_commission_min','ad_commission_max','filter_sales_id'];
  return keys.filter(k => mdFilters[k] !== '' && mdFilters[k] != null).length;
}

function onMdFilterChange(key, value) {
  mdFilters[key] = value;
}

function applyMdFilter() {
  renderMerchantDemands(1, 20);
}

function resetMdFilter() {
  mdFilters = { type: '', category: '', status: '', keyword: '', book_category: '', grade_level: '', pure_commission_min: '', pure_commission_max: '', ad_commission_min: '', ad_commission_max: '', filter_sales_id: '' };
  renderMerchantDemands(1, 20);
}

function searchMerchantDemands() {
  mdFilters.keyword = document.getElementById('merchant-demand-search')?.value?.trim() || '';
  renderMerchantDemands(1, 20);
}

function renderMerchantDemandCard(d, isInfluencer) {
  const typeLabel = d.demand_type === 'book' ? '图书' : '课程';
  const typeColor = d.demand_type === 'book' ? '#3b82f6' : '#8b5cf6';
  // 仅超级管理员可见归属销售字段（商家、达人、销售管理员均不外显）
  const showSales = currentUser.role === 'admin' && currentUser.is_super === true;
  
  return `
    <div class="demand-card-v2">
      <div class="demand-header">
        <input type="checkbox" class="demand-checkbox" value="${d.id}">
        <span class="type-badge" style="background:${typeColor}15;color:${typeColor}">${typeLabel}</span>
        <span class="demand-title">${d.title || d.book_name || d.course_name || '未命名'}</span>
        ${getStatusBadge(d.status)}
      </div>

      <!-- 核心信息区 -->
      <div class="demand-body">
        <div class="demand-info-grid">
          <div class="info-item">
            <span class="info-label">发布商家</span>
            <span class="info-value">${d.merchant_company || d.merchant_name || '-'}</span>
          </div>
          <div class="info-item">
            <span class="info-label">需求类目</span>
            <span class="info-value">${d.category || '-'}</span>
          </div>
        </div>
        
        ${d.demand_type === 'book' && d.book_name ? `
        <div class="demand-info-grid">
          <div class="info-item"><span class="info-label">图书名称</span><span class="info-value">${d.book_name}</span></div>
          <div class="info-item"><span class="info-label">目标人群</span><span class="info-value">${d.book_target_audience || '-'}</span></div>
          ${showSales ? `<div class="info-item"><span class="info-label">归属销售</span><span class="info-value" style="color:#16a34a;font-weight:600">${d.merchant_sales_owner_name||'未分配'}</span></div>` : ''}
        </div>
        <div class="demand-info-grid">
          <div class="info-item highlight"><span class="info-label">售价</span><span class="info-value price-text">¥${d.selling_price || 0}</span></div>
          <div class="info-item"><span class="info-label">纯佣金</span><span class="info-value">${formatPercent(d.pure_commission)}</span></div>
          <div class="info-item"><span class="info-label">投流佣金</span><span class="info-value">${formatPercent(d.ad_commission)}</span></div>
          <div class="info-item"><span class="info-label">库存</span><span class="info-value">${d.stock || 0}</span></div>
          <div class="info-item"><span class="info-label">规格</span><span class="info-value">${d.specification || '-'}</span></div>
          <div class="info-item"><span class="info-label">物流</span><span class="info-value">${d.logistics || '-'}</span></div>
        </div>` : ''}

        ${d.demand_type === 'course' && d.course_name ? `
        <div class="demand-info-grid">
          <div class="info-item"><span class="info-label">课程名称</span><span class="info-value">${d.course_name}</span></div>
          <div class="info-item"><span class="info-label">学段</span><span class="info-value">${d.grade_level || '-'}</span></div>
          <div class="info-item"><span class="info-label">学科</span><span class="info-value">${d.subject || '-'}</span></div>
          ${showSales ? `<div class="info-item"><span class="info-label">归属销售</span><span class="info-value" style="color:#16a34a;font-weight:600">${d.merchant_sales_owner_name||'未分配'}</span></div>` : ''}
        </div>
        <div class="demand-info-grid">
          <div class="info-item highlight"><span class="info-label">单价</span><span class="info-value price-text">¥${d.unit_price || 0}</span></div>
          <div class="info-item"><span class="info-label">纯佣金</span><span class="info-value">${d.course_pure_commission != null ? formatPercent(d.course_pure_commission) : '-'}</span></div>
          <div class="info-item"><span class="info-label">投流佣金</span><span class="info-value">${d.course_ad_commission != null ? formatPercent(d.course_ad_commission) : '-'}</span></div>
        </div>` : ''}
        
        ${d.description ? `<div class="demand-desc">${d.description.length > 120 ? d.description.slice(0, 120) + '...' : d.description}</div>` : ''}
        ${(d.fans_requirement || d.requirements) ? `
        <div class="demand-requirements">
          ${d.fans_requirement ? `<span>粉丝要求: ${d.fans_requirement}</span>` : ''}
          ${d.requirements ? `<span>需求: ${d.requirements}</span>` : ''}
        </div>` : ''}
      </div>

      <div class="demand-footer">
        <span class="demand-meta">${d.merchant_company || ''} · ${formatDate(d.created_at)}</span>
        <div class="demand-actions">
          ${isInfluencer ? `<button class="btn btn-sm btn-primary" onclick="applyCooperation('${d.id}','${d.merchant_id}')">申请合作</button>` : ''}
          ${(currentUser.role === 'admin' || currentUser.role === 'merchant') && d.ref_demand_id ? `<button class="btn btn-sm btn-outline" onclick="editMerchantDemand('${d.ref_demand_id}','${d.demand_type}')">编辑</button>` : ''}
          ${currentUser.role === 'admin' || currentUser.role === 'merchant' ? `<button class="btn btn-sm btn-danger-outline" onclick="deleteMerchantDemand('${d.id}')">删除</button>` : ''}
        </div>
      </div>
    </div>`;
}

async function deleteMerchantDemand(id) {
  if (!confirm('确定删除此需求？')) return;
  await fetchAPI(`/demands/${id}`, { method: 'DELETE' });
  showToast('删除成功');
  renderMerchantDemands();
}
async function clearAllMerchantDemands() {
  if (!confirm('确定清空所有商家需求？此操作不可恢复！')) return;
  let url = '/demands/all/clear';
  if (currentUser.role === 'merchant') url += `?merchant_id=${currentUser.id}`;
  await fetchAPI(url, { method: 'DELETE' });
  showToast('已清空');
  renderMerchantDemands();
}

// ============ 编辑商家需求（图书/课程）============
async function editMerchantDemand(refId, demandType) {
  // 拉取详情：借助 /demands 列表里已有的 ref_demand_id，或直接查询子表
  const res = await fetchAPI(`/demands?page=1&pageSize=200`);
  if (!res.success) { showToast('加载失败', 'error'); return; }
  const row = res.data.find(x => x.ref_demand_id === refId && x.demand_type === demandType);
  if (!row) { showToast('未找到该需求数据', 'error'); return; }

  if (demandType === 'book') {
    const body = `
      <div class="form-grid-2">
        <div class="form-group"><label>图书名称 *</label><input id="edm-book-name" value="${escapeHtml(row.book_name || '')}"></div>
        <div class="form-group"><label>图书商家 *</label><input id="edm-book-merchant" value="${escapeHtml(row.book_merchant || '')}"></div>
        <div class="form-group"><label>目标人群</label><input id="edm-target-audience" value="${escapeHtml(row.book_target_audience || '')}"></div>
        <div class="form-group"><label>图书分类</label><input id="edm-book-category" value="${escapeHtml(row.book_category || '')}"></div>
        <div class="form-group"><label>规格</label><input id="edm-specification" value="${escapeHtml(row.specification || '')}"></div>
        <div class="form-group"><label>售价(元)</label><input type="number" step="0.01" id="edm-selling-price" value="${row.selling_price || 0}"></div>
        <div class="form-group"><label>纯佣金(%)</label><input type="number" step="0.01" id="edm-pure-commission" value="${row.pure_commission || 0}"></div>
        <div class="form-group"><label>投流佣金(%)</label><input type="number" step="0.01" id="edm-ad-commission" value="${row.ad_commission || 0}"></div>
        <div class="form-group"><label>物流</label><input id="edm-logistics" value="${escapeHtml(row.logistics || '')}"></div>
        <div class="form-group"><label>库存</label><input type="number" id="edm-stock" value="${row.stock || 0}"></div>
        <div class="form-group"><label>图书图片URL</label><input id="edm-book-image" value="${escapeHtml(row.book_image || '')}"></div>
        <div class="form-group"><label>商品图片URL</label><input id="edm-product-image" value="${escapeHtml(row.product_image || '')}"></div>
        <div class="form-group" style="grid-column:1/-1"><label>视频号小店链接</label><input id="edm-wechat-shop-link" value="${escapeHtml(row.wechat_shop_link || '')}"></div>
        <div class="form-group" style="grid-column:1/-1"><label>图书介绍</label><textarea id="edm-book-intro" rows="3">${escapeHtml(row.book_introduction || '')}</textarea></div>
      </div>
      <p style="font-size:12px;color:var(--gray-400);margin-top:6px">提示：佣金可填整数（如 25 表示 25%）或小数（如 0.25 表示 25%），系统会自动识别。</p>
    `;
    openModal('编辑图书需求', body, `
      <button class="btn btn-outline" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveMerchantDemandEdit('${refId}','book')">保 存</button>
    `);
  } else {
    const body = `
      <div class="form-grid-2">
        <div class="form-group"><label>课程名称 *</label><input id="edm-course-name" value="${escapeHtml(row.course_name || '')}"></div>
        <div class="form-group"><label>课程价格(元)</label><input type="number" step="0.01" id="edm-unit-price" value="${row.unit_price || 0}"></div>
        <div class="form-group"><label>学段</label><input id="edm-grade-level" value="${escapeHtml(row.grade_level || '')}"></div>
        <div class="form-group"><label>学科</label><input id="edm-subject" value="${escapeHtml(row.subject || '')}"></div>
        <div class="form-group"><label>纯佣金(%)</label><input type="number" step="0.01" id="edm-course-pure-commission" value="${row.pure_commission || row.course_pure_commission || 0}"></div>
        <div class="form-group"><label>投流佣金(%)</label><input type="number" step="0.01" id="edm-course-ad-commission" value="${row.ad_commission || row.course_ad_commission || 0}"></div>
        <div class="form-group"><label>课程图片URL</label><input id="edm-course-image" value="${escapeHtml(row.course_image || '')}"></div>
        <div class="form-group"><label>课程链接</label><input id="edm-course-link" value="${escapeHtml(row.course_link || '')}"></div>
        <div class="form-group" style="grid-column:1/-1"><label>课程介绍</label><textarea id="edm-course-intro" rows="3">${escapeHtml(row.course_introduction || '')}</textarea></div>
      </div>
    `;
    openModal('编辑课程需求', body, `
      <button class="btn btn-outline" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="saveMerchantDemandEdit('${refId}','course')">保 存</button>
    `);
  }
}

async function saveMerchantDemandEdit(refId, demandType) {
  let payload = {};
  if (demandType === 'book') {
    payload = {
      book_name: document.getElementById('edm-book-name').value.trim(),
      book_merchant: document.getElementById('edm-book-merchant').value.trim(),
      target_audience: document.getElementById('edm-target-audience').value.trim(),
      book_category: document.getElementById('edm-book-category').value.trim(),
      specification: document.getElementById('edm-specification').value.trim(),
      selling_price: document.getElementById('edm-selling-price').value,
      pure_commission: document.getElementById('edm-pure-commission').value,
      ad_commission: document.getElementById('edm-ad-commission').value,
      logistics: document.getElementById('edm-logistics').value.trim(),
      stock: document.getElementById('edm-stock').value,
      book_image: document.getElementById('edm-book-image').value.trim(),
      product_image: document.getElementById('edm-product-image').value.trim(),
      wechat_shop_link: document.getElementById('edm-wechat-shop-link').value.trim(),
      book_introduction: document.getElementById('edm-book-intro').value.trim()
    };
    if (!payload.book_name) { showToast('图书名称必填', 'error'); return; }
  } else {
    payload = {
      course_name: document.getElementById('edm-course-name').value.trim(),
      unit_price: document.getElementById('edm-unit-price').value,
      grade_level: document.getElementById('edm-grade-level').value.trim(),
      subject: document.getElementById('edm-subject').value.trim(),
      pure_commission: document.getElementById('edm-course-pure-commission')?.value || 0,
      ad_commission: document.getElementById('edm-course-ad-commission')?.value || 0,
      course_image: document.getElementById('edm-course-image').value.trim(),
      course_link: document.getElementById('edm-course-link').value.trim(),
      course_introduction: document.getElementById('edm-course-intro').value.trim()
    };
    if (!payload.course_name) { showToast('课程名称必填', 'error'); return; }
  }
  const res = await fetchAPI(`/demands/${demandType}/${refId}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (res.success) { showToast('需求信息已更新'); closeModal(); renderMerchantDemands(); }
  else { showToast(res.error || '更新失败', 'error'); }
}

// HTML 转义，防止输入框XSS/语法破坏
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// 达人发起带货申请
async function applyCooperation(demandId, merchantId) {
  const msg = prompt('请输入带货申请留言（可选）：', '我想带货这个商品');
  if (msg === null) return;
  const res = await fetchAPI('/cooperation/apply', {
    method: 'POST',
    body: JSON.stringify({ influencer_id: currentUser.id, merchant_id: merchantId, demand_id: demandId, demand_type: 'apply', message: msg })
  });
  if (res.success) { showToast('带货申请已发送！商家将在个人中心收到通知'); }
  else { showToast(res.error || '申请失败', 'error'); }
}

// ============ 达人需求大厅 V2 ============
let idFilters = {
  demand_category: '', book_category: '', subject_category: '',
  level: '', status: '', fans_min: '', fans_max: '',
  price_min: '', price_max: '', keyword: ''
};
let idFilterPanelOpen = false;
let idViewMode = 'list';        // 默认列表
let idSortField = 'created_at'; // 默认按创建时间倒序
let idSortOrder = 'desc';

const ID_BOOK_CATEGORIES = ['少儿科普', '绘本', '教辅', '文学', '家庭教育', '童书', '人文社科', '其他'];
const ID_SUBJECT_CATEGORIES = ['语文', '数学', '英语', '科学', '艺术', '编程', '通用'];
const ID_LEVELS = ['S级', 'A级', 'B级', 'C级', 'D级'];

async function renderInfluencerDemands(page = 1, pageSize = 20) {
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';

  let url = `/demands/influencer-demands?page=${page}&pageSize=${pageSize}`;
  if (currentUser.role === 'influencer') url += `&influencer_id=${currentUser.id}`;
  if (idFilters.demand_category) url += `&demand_category=${encodeURIComponent(idFilters.demand_category)}`;
  if (idFilters.book_category) url += `&book_category=${encodeURIComponent(idFilters.book_category)}`;
  if (idFilters.subject_category) url += `&subject_category=${encodeURIComponent(idFilters.subject_category)}`;
  if (idFilters.level) url += `&level=${encodeURIComponent(idFilters.level)}`;
  if (idFilters.status) url += `&status=${encodeURIComponent(idFilters.status)}`;
  if (idFilters.fans_min) url += `&fans_min=${encodeURIComponent(idFilters.fans_min)}`;
  if (idFilters.fans_max) url += `&fans_max=${encodeURIComponent(idFilters.fans_max)}`;
  if (idFilters.price_min) url += `&price_min=${encodeURIComponent(idFilters.price_min)}`;
  if (idFilters.price_max) url += `&price_max=${encodeURIComponent(idFilters.price_max)}`;
  if (idFilters.keyword) url += `&keyword=${encodeURIComponent(idFilters.keyword)}`;
  url += getOperatorFilter();

  const res = await fetchAPI(url);
  if (!res.success) { container.innerHTML = '<p>加载失败</p>'; return; }

  // 列表视图本地排序（接口未做 ORDER BY 这套字段）
  let rows = res.data;
  if (idViewMode === 'list') {
    rows = sortInfluencerDemandRows(rows, idSortField, idSortOrder);
  }

  const isMerchant = currentUser.role === 'merchant';
  const isInfluencer = currentUser.role === 'influencer';
  const title = isInfluencer ? '我的达人需求' : '达人需求';
  const activeCount = getIdActiveFilterCount();

  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header">
      <h2>${title}</h2>
      <div class="page-header-actions">
        ${currentUser.role !== 'merchant' ? '<button class="btn btn-sm btn-danger" onclick="clearAllInfluencerDemands()">一键清空</button>' : ''}
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="md-toolbar">
      <div class="md-toolbar-left">
        <button class="btn btn-sm ${idFilterPanelOpen?'btn-primary':'btn-outline'}" onclick="toggleIdFilter()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          筛选${activeCount > 0 ? ' ('+activeCount+')' : ''}
        </button>
        ${activeCount>0?'<button class="btn btn-sm btn-outline" onclick="resetIdFilter()">清空筛选</button>':''}
        <span style="color:#94a3b8;font-size:13px;margin-left:8px;">共 ${res.pagination?.total || 0} 条</span>
      </div>
      <div class="md-toolbar-right">
        <button class="btn btn-sm ${idViewMode==='list'?'btn-primary':'btn-outline'}" onclick="switchIdView('list')" title="列表视图">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> 列表
        </button>
        <button class="btn btn-sm ${idViewMode==='card'?'btn-primary':'btn-outline'}" onclick="switchIdView('card')" title="卡片视图">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> 卡片
        </button>
      </div>
    </div>

    <!-- 筛选面板 -->
    <div class="filter-panel" id="id-filter-panel" style="display:${idFilterPanelOpen?'block':'none'}">
      <div class="filter-row">
        <div class="filter-item">
          <label>需求类型</label>
          <select onchange="onIdFilterChange('demand_category', this.value); applyIdFilter()">
            <option value="">全部</option>
            <option value="图书需求" ${idFilters.demand_category==='图书需求'?'selected':''}>图书需求</option>
            <option value="课程需求" ${idFilters.demand_category==='课程需求'?'selected':''}>课程需求</option>
          </select>
        </div>
        <div class="filter-item">
          <label>状态</label>
          <select onchange="onIdFilterChange('status', this.value); applyIdFilter()">
            <option value="">全部</option>
            <option value="published" ${idFilters.status==='published'?'selected':''}>已发布</option>
            <option value="closed" ${idFilters.status==='closed'?'selected':''}>已关闭</option>
          </select>
        </div>
        ${(idFilters.demand_category === '图书需求' || idFilters.demand_category === '') ? `
        <div class="filter-item">
          <label>图书分类</label>
          <select onchange="onIdFilterChange('book_category', this.value); applyIdFilter()">
            <option value="">全部</option>
            ${ID_BOOK_CATEGORIES.map(c => `<option value="${c}" ${idFilters.book_category===c?'selected':''}>${c}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="filter-item">
          <label>学科</label>
          <select onchange="onIdFilterChange('subject_category', this.value); applyIdFilter()">
            <option value="">全部</option>
            ${ID_SUBJECT_CATEGORIES.map(s => `<option value="${s}" ${idFilters.subject_category===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="filter-item">
          <label>达人等级</label>
          <select onchange="onIdFilterChange('level', this.value); applyIdFilter()">
            <option value="">全部</option>
            ${ID_LEVELS.map(l => `<option value="${l}" ${idFilters.level===l?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- 第二行：粉丝量 + 客单价 -->
      <div class="filter-row" style="margin-top:10px;">
        <div class="filter-item" style="flex:0 0 auto;">
          <label>粉丝量</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="number" placeholder="最低" value="${idFilters.fans_min || ''}" style="width:90px"
              onchange="onIdFilterChange('fans_min', this.value); applyIdFilter()">
            <span style="color:#94a3b8">-</span>
            <input type="number" placeholder="最高" value="${idFilters.fans_max || ''}" style="width:90px"
              onchange="onIdFilterChange('fans_max', this.value); applyIdFilter()">
          </div>
        </div>
        <div class="filter-item" style="flex:0 0 auto;">
          <label>可接受客单价 (¥)</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="number" placeholder="最低" value="${idFilters.price_min || ''}" style="width:80px"
              onchange="onIdFilterChange('price_min', this.value); applyIdFilter()">
            <span style="color:#94a3b8">-</span>
            <input type="number" placeholder="最高" value="${idFilters.price_max || ''}" style="width:80px"
              onchange="onIdFilterChange('price_max', this.value); applyIdFilter()">
          </div>
        </div>
      </div>

      <!-- 第三行：搜索 -->
      <div class="filter-row" style="margin-top:10px;">
        <div class="filter-item" style="flex:1">
          <input type="text" id="id-filter-keyword" placeholder="搜索达人账号 / 图书名 / 描述..." value="${idFilters.keyword || ''}"
            onkeypress="if(event.key==='Enter'){ onIdFilterChange('keyword', this.value); applyIdFilter(); }">
        </div>
        <button class="btn btn-primary btn-sm" onclick="onIdFilterChange('keyword', document.getElementById('id-filter-keyword').value); applyIdFilter()">搜索</button>
        ${activeCount>0 ? '<button class="btn btn-sm btn-outline" onclick="resetIdFilter()">重置</button>' : ''}
      </div>
    </div>

    <div class="${idViewMode==='card' ? 'demand-grid' : 'id-list'}" id="inf-demand-list">
      ${rows.length === 0
        ? '<div class="empty-state"><div class="icon">-</div><p>暂无达人需求</p>'+(activeCount>0?'<button class="btn btn-sm btn-primary" onclick="resetIdFilter()" style="margin-top:12px">清除筛选条件</button>':'')+'</div>'
        : idViewMode === 'card'
          ? rows.map(d => renderInfluencerDemandCardV2(d, isMerchant)).join('')
          : renderIdTableHeader() + rows.map(d => renderInfluencerDemandRow(d, isMerchant)).join('')}
    </div>
    ${renderPagination(res.pagination, 'pageInfluencerDemands')}`;
}

function renderInfluencerDemandCardV2(d, isMerchant) {
  const isBook = d.demand_category === '图书需求';
  const typeColor = isBook ? '#3b82f6' : '#8b5cf6';
  const typeLabel = d.demand_category || '需求';
  const accountName = d.video_account_name || d.inf_video_account_name || '未知达人';
  const fansCount = d.fans_count || d.inf_fans_count || 0;
  const statusBadge = (typeof getStatusBadge === 'function') ? getStatusBadge(d.status) : '';
  const levelBadge = d.level
    ? `<span class="level-badge" style="background:${getLevelColor(d.level)}">${d.level}</span>`
    : '';

  const priceRangeBook = (d.book_price_max > 0)
    ? `¥${d.book_price_min || 0} - ${d.book_price_max}`
    : '-';
  const priceRangeCourse = (d.course_price_max > 0)
    ? `¥${d.course_price_min || 0} - ${d.course_price_max}`
    : '-';

  return `
    <div class="demand-card-v2">
      <div class="demand-header">
        <input type="checkbox" class="inf-demand-checkbox" value="${d.id}">
        <span class="type-badge" style="background:${typeColor}15;color:${typeColor}">${typeLabel}</span>
        ${levelBadge}
        <span class="demand-title">${accountName}</span>
        ${statusBadge}
      </div>

      <div class="demand-body">
        <div class="demand-info-grid">
          <div class="info-item"><span class="info-label">粉丝量</span><span class="info-value">${formatNumber(fansCount)}</span></div>
          ${d.subject_category ? `<div class="info-item"><span class="info-label">擅长学科</span><span class="info-value">${d.subject_category}</span></div>` : ''}
          ${d.video_category_track ? `<div class="info-item"><span class="info-label">内容赛道</span><span class="info-value" title="${d.video_category_track}">${(d.video_category_track || '').slice(0, 16)}${(d.video_category_track || '').length > 16 ? '…' : ''}</span></div>` : ''}
          ${d.inf_region ? `<div class="info-item"><span class="info-label">所在地</span><span class="info-value">${(d.inf_region || '').split(',')[0] || '-'}</span></div>` : ''}
        </div>

        ${isBook ? `
        <div class="demand-info-grid">
          ${d.book_name ? `<div class="info-item"><span class="info-label">期望图书</span><span class="info-value">${d.book_name}</span></div>` : ''}
          ${d.book_category ? `<div class="info-item"><span class="info-label">图书分类</span><span class="info-value">${d.book_category}</span></div>` : ''}
          <div class="info-item highlight"><span class="info-label">可接受售价</span><span class="info-value price-text">${priceRangeBook}</span></div>
        </div>` : `
        <div class="demand-info-grid">
          <div class="info-item highlight"><span class="info-label">可接受课程价</span><span class="info-value price-text">${priceRangeCourse}</span></div>
        </div>`}

        ${d.description ? `<div class="demand-desc">${d.description.length > 120 ? d.description.slice(0, 120) + '…' : d.description}</div>` : ''}
      </div>

      <div class="demand-footer">
        <span class="demand-meta">${formatDate(d.created_at)}</span>
        <div class="demand-actions">
          ${isMerchant ? `<button class="btn btn-sm btn-primary" onclick="inviteInfluencer('${d.influencer_id}','${d.id}')">邀请合作</button>` : ''}
          ${(currentUser.role === 'admin' || currentUser.role === 'influencer') ? `<button class="btn btn-sm btn-outline" onclick="editInfluencerDemand('${d.id}')">编辑</button>` : ''}
          ${(currentUser.role === 'admin' || currentUser.role === 'influencer') ? `<button class="btn btn-sm btn-danger-outline" onclick="deleteInfluencerDemand('${d.id}')">删除</button>` : ''}
        </div>
      </div>
    </div>`;
}

// ============ 达人需求 列表视图 ============
function renderIdTableHeader() {
  const sortTh = (label, field, align = 'left') => {
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    const icon = `<span class="sort-icon">${getIdSortIcon(field)}</span>`;
    return `<div class="demand-th ${cls}" onclick="switchIdSort('${field}')">${label}${icon}</div>`;
  };
  const plainTh = (label, align = 'left') => {
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    return `<div class="demand-th no-hover ${cls}">${label}</div>`;
  };
  return `
    <div class="id-row-header">
      ${plainTh('', 'center')}
      ${sortTh('类型', 'type', 'center')}
      ${plainTh('达人账号', 'left')}
      ${sortTh('粉丝量', 'fans', 'right')}
      ${sortTh('等级', 'level', 'center')}
      ${plainTh('期望/价格', 'left')}
      ${sortTh('状态', 'status', 'center')}
      ${sortTh('创建时间', 'created_at', 'right')}
      ${plainTh('操作', 'right')}
    </div>`;
}

function renderInfluencerDemandRow(d, isMerchant) {
  const isBook = d.demand_category === '图书需求';
  const typeLabel = isBook ? '图书' : '课程';
  const typeColor = isBook ? '#3b82f6' : '#8b5cf6';
  const accountName = d.video_account_name || d.inf_video_account_name || '未知达人';
  const fansCount = d.fans_count || d.inf_fans_count || 0;
  const subParts = [];
  if (d.subject_category) subParts.push(d.subject_category);
  if (d.video_category_track) subParts.push((d.video_category_track || '').slice(0, 12));
  if (d.inf_region) subParts.push((d.inf_region || '').split(',')[0]);

  // 期望与价格摘要
  let demandBrief = '';
  if (isBook) {
    const parts = [];
    if (d.book_name) parts.push(d.book_name);
    if (d.book_category) parts.push(`【${d.book_category}】`);
    const priceRange = d.book_price_max > 0 ? `¥${d.book_price_min||0}-${d.book_price_max}` : '';
    if (priceRange) parts.push(priceRange);
    demandBrief = parts.join(' ') || '-';
  } else {
    const priceRange = d.course_price_max > 0 ? `¥${d.course_price_min||0}-${d.course_price_max}` : '';
    demandBrief = priceRange || '-';
  }

  const levelTag = d.level
    ? `<span class="level-badge" style="background:${getLevelColor(d.level)}">${d.level}</span>`
    : '<span style="color:#cbd5e1">-</span>';

  return `
    <div class="id-row" data-id="${d.id}">
      <input type="checkbox" class="inf-demand-checkbox" value="${d.id}">
      <span class="type-badge-sm" style="background:${typeColor}15;color:${typeColor}">${typeLabel}</span>
      <div class="id-row-main">
        <div class="id-row-title">${accountName}</div>
        <div class="id-row-sub">${subParts.join(' · ') || '-'}</div>
      </div>
      <span class="id-row-fans">${formatNumber(fansCount)}</span>
      <span class="id-row-level">${levelTag}</span>
      <div class="id-row-brief" title="${(d.description || '').replace(/"/g,'&quot;')}">${demandBrief}</div>
      <span class="id-row-status">${getStatusBadge(d.status)}</span>
      <span class="id-row-date">${formatDate(d.created_at)}</span>
      <div class="id-row-actions">
        ${isMerchant ? `<button class="btn btn-xs btn-primary" onclick="inviteInfluencer('${d.influencer_id}','${d.id}')">邀请</button>` : ''}
        ${(currentUser.role === 'admin' || currentUser.role === 'influencer') ? `<button class="btn btn-xs btn-outline" onclick="editInfluencerDemand('${d.id}')">编辑</button>` : ''}
        ${(currentUser.role === 'admin' || currentUser.role === 'influencer') ? `<button class="btn btn-xs btn-danger-outline" onclick="deleteInfluencerDemand('${d.id}')">删除</button>` : ''}
      </div>
    </div>`;
}

function getIdSortIcon(field) {
  if (idSortField !== field) return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 4 18 9"/><polyline points="6 15 12 20 18 15"/></svg>';
  return idSortOrder === 'asc'
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 14 12 8 18 14"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 10 12 16 18 10"/></svg>';
}

function switchIdSort(field) {
  if (idSortField === field) {
    idSortOrder = idSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    idSortField = field;
    idSortOrder = 'asc';
  }
  renderInfluencerDemands();
}

// 列表视图客户端排序（避免后端无对应 ORDER BY 字段）
function sortInfluencerDemandRows(rows, field, order) {
  const dir = order === 'asc' ? 1 : -1;
  const levelRank = { 'S级':5, 'A级':4, 'B级':3, 'C级':2, 'D级':1 };
  const arr = rows.slice();
  arr.sort((a, b) => {
    let va, vb;
    switch(field) {
      case 'type':
        va = a.demand_category || ''; vb = b.demand_category || ''; break;
      case 'fans':
        va = a.fans_count || a.inf_fans_count || 0; vb = b.fans_count || b.inf_fans_count || 0; break;
      case 'level':
        va = levelRank[a.level] || 0; vb = levelRank[b.level] || 0; break;
      case 'status':
        va = a.status || ''; vb = b.status || ''; break;
      case 'created_at':
      default:
        va = a.created_at || ''; vb = b.created_at || ''; break;
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  return arr;
}

function switchIdView(mode) { idViewMode = mode; renderInfluencerDemands(); }
function toggleIdFilter() { idFilterPanelOpen = !idFilterPanelOpen; renderInfluencerDemands(); }
function onIdFilterChange(key, value) { idFilters[key] = value; }
function applyIdFilter() { renderInfluencerDemands(1, 20); }
function resetIdFilter() {
  idFilters = { demand_category:'', book_category:'', subject_category:'', level:'', status:'', fans_min:'', fans_max:'', price_min:'', price_max:'', keyword:'' };
  renderInfluencerDemands(1, 20);
}
function getIdActiveFilterCount() {
  return Object.values(idFilters).filter(v => v !== '' && v != null).length;
}

function searchInfluencerDemands() {
  idFilters.keyword = document.getElementById('id-filter-keyword')?.value?.trim() || '';
  renderInfluencerDemands(1, 20);
}
function pageInfluencerDemands(page, pageSize) { renderInfluencerDemands(page, pageSize || 20); }
async function deleteInfluencerDemand(id) { if (!confirm('确定删除？')) return; await fetchAPI(`/demands/influencer-demands/${id}`, { method: 'DELETE' }); showToast('删除成功'); renderInfluencerDemands(); }
async function clearAllInfluencerDemands() {
  if (!confirm('确定清空所有达人需求？')) return;
  let url = '/demands/influencer-demands/all/clear';
  if (currentUser.role === 'influencer') url += `?influencer_id=${currentUser.id}`;
  await fetchAPI(url, { method: 'DELETE' });
  showToast('已清空'); renderInfluencerDemands();
}

// ============ 编辑达人需求 ============
async function editInfluencerDemand(id) {
  // 拉取全量后定位（当前没有单条接口，借助列表）
  const res = await fetchAPI(`/demands/influencer-demands?page=1&pageSize=500`);
  if (!res.success) { showToast('加载失败', 'error'); return; }
  const d = res.data.find(x => x.id === id);
  if (!d) { showToast('未找到该需求', 'error'); return; }

  const body = `
    <div class="form-grid-2">
      <div class="form-group"><label>达人账号名</label><input id="eid-video-account" value="${escapeHtml(d.video_account_name || '')}"></div>
      <div class="form-group"><label>需求类型</label>
        <select id="eid-demand-category">
          <option ${d.demand_category === '图书需求' ? 'selected' : ''}>图书需求</option>
          <option ${d.demand_category === '课程需求' ? 'selected' : ''}>课程需求</option>
          <option ${d.demand_category === '其他' ? 'selected' : ''}>其他</option>
        </select>
      </div>
      <div class="form-group"><label>粉丝数</label><input type="number" id="eid-fans-count" value="${d.fans_count || 0}"></div>
      <div class="form-group"><label>图书名称</label><input id="eid-book-name" value="${escapeHtml(d.book_name || '')}"></div>
      <div class="form-group"><label>图书分类</label><input id="eid-book-category" value="${escapeHtml(d.book_category || '')}"></div>
      <div class="form-group"><label>学科分类</label><input id="eid-subject-category" value="${escapeHtml(d.subject_category || '')}"></div>
      <div class="form-group"><label>图书售价下限</label><input type="number" step="0.01" id="eid-book-price-min" value="${d.book_price_min || 0}"></div>
      <div class="form-group"><label>图书售价上限</label><input type="number" step="0.01" id="eid-book-price-max" value="${d.book_price_max || 0}"></div>
      <div class="form-group"><label>课程价格下限</label><input type="number" step="0.01" id="eid-course-price-min" value="${d.course_price_min || 0}"></div>
      <div class="form-group"><label>课程价格上限</label><input type="number" step="0.01" id="eid-course-price-max" value="${d.course_price_max || 0}"></div>
      <div class="form-group" style="grid-column:1/-1"><label>需求描述</label><textarea id="eid-description" rows="3">${escapeHtml(d.description || '')}</textarea></div>
    </div>
  `;
  openModal('编辑达人需求', body, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="saveInfluencerDemandEdit('${id}')">保 存</button>
  `);
}

async function saveInfluencerDemandEdit(id) {
  const payload = {
    video_account_name: document.getElementById('eid-video-account').value.trim(),
    demand_category: document.getElementById('eid-demand-category').value,
    fans_count: document.getElementById('eid-fans-count').value,
    book_name: document.getElementById('eid-book-name').value.trim(),
    book_category: document.getElementById('eid-book-category').value.trim(),
    subject_category: document.getElementById('eid-subject-category').value.trim(),
    book_price_min: document.getElementById('eid-book-price-min').value,
    book_price_max: document.getElementById('eid-book-price-max').value,
    course_price_min: document.getElementById('eid-course-price-min').value,
    course_price_max: document.getElementById('eid-course-price-max').value,
    description: document.getElementById('eid-description').value.trim()
  };
  const res = await fetchAPI(`/demands/influencer-demands/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (res.success) { showToast('达人需求已更新'); closeModal(); renderInfluencerDemands(); }
  else { showToast(res.error || '更新失败', 'error'); }
}

// ============ 商家需求（招募）大厅 V2 ============
let mrFilters = {
  recruitment_type: '', status: '', level: '',
  fans_min: '', fans_max: '', target_province: '', keyword: ''
};
let mrFilterPanelOpen = false;
let mrViewMode = 'list';
let mrSortField = 'created_at';
let mrSortOrder = 'desc';

const MR_TYPES = ['图书推广', '课程推广', '综合招募', '专场直播'];
const MR_LEVELS = ['S级', 'A级', 'B级', 'C级', 'D级'];
const MR_COOPERATION_MODES = ['纯佣', '投流', '寄样', '视频专场', '直播带货', '混合'];

async function renderMerchantRecruitments(page = 1, pageSize = 20) {
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';

  const isMerchant = currentUser.role === 'merchant';
  const isInfluencer = currentUser.role === 'influencer';
  const isAdmin = currentUser.role === 'admin';

  let url = `/recruitments?page=${page}&pageSize=${pageSize}`;
  if (isMerchant) url += `&merchant_id=${currentUser.id}`;
  if (mrFilters.recruitment_type) url += `&recruitment_type=${encodeURIComponent(mrFilters.recruitment_type)}`;
  if (mrFilters.status) url += `&status=${encodeURIComponent(mrFilters.status)}`;
  if (mrFilters.level) url += `&level=${encodeURIComponent(mrFilters.level)}`;
  if (mrFilters.fans_min) url += `&fans_min=${encodeURIComponent(mrFilters.fans_min)}`;
  if (mrFilters.fans_max) url += `&fans_max=${encodeURIComponent(mrFilters.fans_max)}`;
  if (mrFilters.target_province) url += `&target_province=${encodeURIComponent(mrFilters.target_province)}`;
  if (mrFilters.keyword) url += `&keyword=${encodeURIComponent(mrFilters.keyword)}`;
  url += getOperatorFilter();

  const res = await fetchAPI(url);
  if (!res.success) { container.innerHTML = '<p>加载失败</p>'; return; }

  let rows = res.data;
  if (mrViewMode === 'list') rows = sortMrRows(rows, mrSortField, mrSortOrder);

  const title = isMerchant ? '我的招募' : '商家需求';
  const subtitle = isInfluencer
    ? '商家正在招募的达人合作机会'
    : (isMerchant ? '我发布的招募需求' : '所有商家的招募需求');
  const activeCount = getMrActiveFilterCount();

  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header">
      <h2>${title}</h2>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">${subtitle}</div>
      <div class="page-header-actions">
        ${currentUser.role !== 'influencer' ? '<button class="btn btn-sm btn-danger-outline" onclick="clearAllMerchantRecruitments()">清空</button>' : ''}
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="md-toolbar">
      <div class="md-toolbar-left">
        ${currentUser.role !== 'influencer' ? `<button class="btn btn-sm btn-success" onclick="showPublishRecruitmentModal()">+ 发布招募</button>` : ''}
        <button class="btn btn-sm ${mrFilterPanelOpen?'btn-primary':'btn-outline'}" onclick="toggleMrFilter()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
          筛选${activeCount > 0 ? ' ('+activeCount+')' : ''}
        </button>
        ${activeCount>0?'<button class="btn btn-sm btn-outline" onclick="resetMrFilter()">清空筛选</button>':''}
        <span style="color:#94a3b8;font-size:13px;margin-left:8px;">共 ${res.pagination?.total || 0} 条</span>
      </div>
      <div class="md-toolbar-right">
        <button class="btn btn-sm ${mrViewMode==='list'?'btn-primary':'btn-outline'}" onclick="switchMrView('list')" title="列表视图">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> 列表
        </button>
        <button class="btn btn-sm ${mrViewMode==='card'?'btn-primary':'btn-outline'}" onclick="switchMrView('card')" title="卡片视图">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> 卡片
        </button>
      </div>
    </div>

    <div class="filter-panel" style="display:${mrFilterPanelOpen?'block':'none'}">
      <div class="filter-row">
        <div class="filter-item">
          <label>招募类型</label>
          <select onchange="onMrFilterChange('recruitment_type', this.value); applyMrFilter()">
            <option value="">全部</option>
            ${MR_TYPES.map(t => `<option value="${t}" ${mrFilters.recruitment_type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="filter-item">
          <label>状态</label>
          <select onchange="onMrFilterChange('status', this.value); applyMrFilter()">
            <option value="">全部</option>
            <option value="recruiting" ${mrFilters.status==='recruiting'?'selected':''}>招募中</option>
            <option value="paused" ${mrFilters.status==='paused'?'selected':''}>已暂停</option>
            <option value="completed" ${mrFilters.status==='completed'?'selected':''}>已完成</option>
            <option value="closed" ${mrFilters.status==='closed'?'selected':''}>已关闭</option>
          </select>
        </div>
        <div class="filter-item">
          <label>目标达人等级</label>
          <select onchange="onMrFilterChange('level', this.value); applyMrFilter()">
            <option value="">全部</option>
            ${MR_LEVELS.map(l => `<option value="${l}" ${mrFilters.level===l?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="filter-item">
          <label>目标地域</label>
          <input type="text" placeholder="如：广东" value="${mrFilters.target_province || ''}"
            onchange="onMrFilterChange('target_province', this.value); applyMrFilter()">
        </div>
      </div>
      <div class="filter-row" style="margin-top:10px;">
        <div class="filter-item" style="flex:0 0 auto;">
          <label>目标粉丝量</label>
          <div style="display:flex;gap:6px;align-items:center;">
            <input type="number" placeholder="最低" value="${mrFilters.fans_min || ''}" style="width:90px"
              onchange="onMrFilterChange('fans_min', this.value); applyMrFilter()">
            <span style="color:#94a3b8">-</span>
            <input type="number" placeholder="最高" value="${mrFilters.fans_max || ''}" style="width:90px"
              onchange="onMrFilterChange('fans_max', this.value); applyMrFilter()">
          </div>
        </div>
        <div class="filter-item" style="flex:1">
          <input type="text" id="mr-filter-keyword" placeholder="搜索招募标题 / 商家名 / 描述..." value="${mrFilters.keyword || ''}"
            onkeypress="if(event.key==='Enter'){ onMrFilterChange('keyword', this.value); applyMrFilter(); }">
        </div>
        <button class="btn btn-primary btn-sm" onclick="onMrFilterChange('keyword', document.getElementById('mr-filter-keyword').value); applyMrFilter()">搜索</button>
        ${activeCount>0?'<button class="btn btn-sm btn-outline" onclick="resetMrFilter()">重置</button>':''}
      </div>
    </div>

    <div class="${mrViewMode==='card' ? 'demand-grid' : 'mr-list'}">
      ${rows.length === 0
        ? '<div class="empty-state"><div class="icon">-</div><p>暂无招募需求</p>'+(activeCount>0?'<button class="btn btn-sm btn-primary" onclick="resetMrFilter()" style="margin-top:12px">清除筛选条件</button>':'')+'</div>'
        : mrViewMode === 'card'
          ? rows.map(r => renderMrCardV2(r, isInfluencer, isMerchant, isAdmin)).join('')
          : renderMrTableHeader() + rows.map(r => renderMrRow(r, isInfluencer, isMerchant, isAdmin)).join('')
      }
    </div>
    ${renderPagination(res.pagination, 'pageMerchantRecruitments')}`;
}

function renderMrCardV2(r, isInfluencer, isMerchant, isAdmin) {
  const typeColor = r.recruitment_type === '图书推广' ? '#3b82f6'
                  : r.recruitment_type === '课程推广' ? '#8b5cf6'
                  : r.recruitment_type === '专场直播' ? '#ec4899'
                  : '#16a34a';
  const statusBadge = getRecruitmentStatusBadge(r.status);
  const fansRange = (r.target_fans_min || r.target_fans_max)
    ? `${formatNumber(r.target_fans_min || 0)} - ${r.target_fans_max ? formatNumber(r.target_fans_max) : '不限'}`
    : '不限';
  const levels = (r.target_levels || '').split(',').filter(Boolean);
  const merchantName = r.merchant_company || r.merchant_name || '-';

  return `
    <div class="demand-card-v2">
      <div class="demand-header">
        <span class="type-badge" style="background:${typeColor}15;color:${typeColor}">${r.recruitment_type || '招募'}</span>
        <span class="demand-title">${r.title}</span>
        ${statusBadge}
      </div>
      <div class="demand-body">
        <div class="demand-info-grid">
          <div class="info-item"><span class="info-label">发布商家</span><span class="info-value">${merchantName}</span></div>
          <div class="info-item"><span class="info-label">目标粉丝量</span><span class="info-value">${fansRange}</span></div>
          ${levels.length>0 ? `<div class="info-item"><span class="info-label">目标等级</span><span class="info-value">${levels.join('/')}</span></div>` : ''}
          ${r.target_provinces ? `<div class="info-item"><span class="info-label">目标地域</span><span class="info-value">${r.target_provinces}</span></div>` : ''}
          ${r.target_categories ? `<div class="info-item"><span class="info-label">目标赛道</span><span class="info-value" title="${r.target_categories}">${(r.target_categories||'').slice(0,16)}${(r.target_categories||'').length>16?'…':''}</span></div>` : ''}
          ${r.target_audience ? `<div class="info-item"><span class="info-label">目标受众</span><span class="info-value">${r.target_audience}</span></div>` : ''}
        </div>
        <div class="demand-info-grid">
          ${r.cooperation_mode ? `<div class="info-item"><span class="info-label">合作方式</span><span class="info-value">${r.cooperation_mode}</span></div>` : ''}
          ${r.commission_offer ? `<div class="info-item highlight"><span class="info-label">佣金条件</span><span class="info-value price-text">${r.commission_offer}</span></div>` : ''}
          ${(r.budget_min || r.budget_max) ? `<div class="info-item"><span class="info-label">预算</span><span class="info-value">¥${r.budget_min||0}${r.budget_max?'-'+r.budget_max:''}</span></div>` : ''}
          ${r.deadline ? `<div class="info-item"><span class="info-label">截止时间</span><span class="info-value">${formatDate(r.deadline)}</span></div>` : ''}
        </div>
        ${r.description ? `<div class="demand-desc">${r.description.length>120 ? r.description.slice(0,120)+'…' : r.description}</div>` : ''}
      </div>
      <div class="demand-footer">
        <span class="demand-meta">${formatDate(r.created_at)}</span>
        <div class="demand-actions">
          ${isInfluencer && r.status === 'recruiting' ? `<button class="btn btn-sm btn-primary" onclick="applyForRecruitment('${r.id}','${r.merchant_id}')">我要应聘</button>` : ''}
          ${isAdmin ? `<button class="btn btn-sm btn-primary" onclick="recommendInfluencerForRecruitment('${r.id}')">推荐达人</button>` : ''}
          ${(isMerchant || isAdmin) ? `<button class="btn btn-sm btn-outline" onclick="editMerchantRecruitment('${r.id}')">编辑</button>` : ''}
          ${(isMerchant || isAdmin) ? `<button class="btn btn-sm btn-danger-outline" onclick="deleteMerchantRecruitment('${r.id}')">删除</button>` : ''}
        </div>
      </div>
    </div>`;
}

function renderMrTableHeader() {
  const sortTh = (label, field, align='left') => {
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    const icon = `<span class="sort-icon">${getMrSortIcon(field)}</span>`;
    return `<div class="demand-th ${cls}" onclick="switchMrSort('${field}')">${label}${icon}</div>`;
  };
  const plainTh = (label, align='left') => {
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    return `<div class="demand-th no-hover ${cls}">${label}</div>`;
  };
  return `
    <div class="mr-row-header">
      ${sortTh('类型', 'type', 'center')}
      ${plainTh('招募信息', 'left')}
      ${sortTh('粉丝量要求', 'fans', 'center')}
      ${plainTh('等级', 'center')}
      ${plainTh('佣金条件', 'left')}
      ${sortTh('状态', 'status', 'center')}
      ${sortTh('创建时间', 'created_at', 'right')}
      ${plainTh('操作', 'right')}
    </div>`;
}

function renderMrRow(r, isInfluencer, isMerchant, isAdmin) {
  const typeColor = r.recruitment_type === '图书推广' ? '#3b82f6'
                  : r.recruitment_type === '课程推广' ? '#8b5cf6'
                  : r.recruitment_type === '专场直播' ? '#ec4899'
                  : '#16a34a';
  const merchantName = r.merchant_company || r.merchant_name || '-';
  const subParts = [merchantName];
  if (r.target_provinces) subParts.push(r.target_provinces);
  if (r.cooperation_mode) subParts.push(r.cooperation_mode);
  const fansRange = (r.target_fans_min || r.target_fans_max)
    ? `${formatNumber(r.target_fans_min || 0)}-${r.target_fans_max ? formatNumber(r.target_fans_max) : '不限'}`
    : '不限';
  const levels = (r.target_levels || '').split(',').filter(Boolean).join('/') || '不限';

  return `
    <div class="mr-row" data-id="${r.id}">
      <span class="type-badge-sm" style="background:${typeColor}15;color:${typeColor}">${(r.recruitment_type||'').slice(0,2)}</span>
      <div class="mr-row-main">
        <div class="mr-row-title">${r.title}</div>
        <div class="mr-row-sub">${subParts.join(' · ')}</div>
      </div>
      <span class="mr-row-fans">${fansRange}</span>
      <span class="mr-row-level">${levels}</span>
      <span class="mr-row-commission">${r.commission_offer || '-'}</span>
      <span class="mr-row-status">${getRecruitmentStatusBadge(r.status)}</span>
      <span class="mr-row-date">${formatDate(r.created_at)}</span>
      <div class="mr-row-actions">
        ${isInfluencer && r.status === 'recruiting' ? `<button class="btn btn-xs btn-primary" onclick="applyForRecruitment('${r.id}','${r.merchant_id}')">应聘</button>` : ''}
        ${isAdmin ? `<button class="btn btn-xs btn-primary" onclick="recommendInfluencerForRecruitment('${r.id}')">推荐</button>` : ''}
        ${(isMerchant || isAdmin) ? `<button class="btn btn-xs btn-outline" onclick="editMerchantRecruitment('${r.id}')">编辑</button>` : ''}
        ${(isMerchant || isAdmin) ? `<button class="btn btn-xs btn-danger-outline" onclick="deleteMerchantRecruitment('${r.id}')">删除</button>` : ''}
      </div>
    </div>`;
}

function getRecruitmentStatusBadge(status) {
  const map = {
    recruiting: { color: '#16a34a', bg: '#dcfce7', label: '招募中' },
    paused:     { color: '#f59e0b', bg: '#fef3c7', label: '已暂停' },
    completed:  { color: '#3b82f6', bg: '#dbeafe', label: '已完成' },
    closed:     { color: '#94a3b8', bg: '#f1f5f9', label: '已关闭' },
  };
  const s = map[status] || map.recruiting;
  return `<span style="background:${s.bg};color:${s.color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap">${s.label}</span>`;
}

function getMrSortIcon(field) {
  if (mrSortField !== field) return '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 4 18 9"/><polyline points="6 15 12 20 18 15"/></svg>';
  return mrSortOrder === 'asc'
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 14 12 8 18 14"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 10 12 16 18 10"/></svg>';
}

function switchMrSort(field) {
  if (mrSortField === field) {
    mrSortOrder = mrSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    mrSortField = field;
    mrSortOrder = 'asc';
  }
  renderMerchantRecruitments();
}

function sortMrRows(rows, field, order) {
  const dir = order === 'asc' ? 1 : -1;
  const arr = rows.slice();
  arr.sort((a, b) => {
    let va, vb;
    switch(field) {
      case 'type': va = a.recruitment_type || ''; vb = b.recruitment_type || ''; break;
      case 'fans': va = a.target_fans_min || 0; vb = b.target_fans_min || 0; break;
      case 'status': va = a.status || ''; vb = b.status || ''; break;
      case 'created_at':
      default: va = a.created_at || ''; vb = b.created_at || ''; break;
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  return arr;
}

function switchMrView(mode) { mrViewMode = mode; renderMerchantRecruitments(); }
function toggleMrFilter() { mrFilterPanelOpen = !mrFilterPanelOpen; renderMerchantRecruitments(); }
function onMrFilterChange(key, value) { mrFilters[key] = value; }
function applyMrFilter() { renderMerchantRecruitments(1, 20); }
function resetMrFilter() {
  mrFilters = { recruitment_type: '', status: '', level: '', fans_min: '', fans_max: '', target_province: '', keyword: '' };
  renderMerchantRecruitments(1, 20);
}
function getMrActiveFilterCount() {
  return Object.values(mrFilters).filter(v => v !== '' && v != null).length;
}
function pageMerchantRecruitments(page, pageSize) { renderMerchantRecruitments(page, pageSize || 20); }

async function deleteMerchantRecruitment(id) {
  if (!confirm('确定删除此招募需求？')) return;
  await fetchAPI(`/recruitments/${id}`, { method: 'DELETE' });
  showToast('删除成功'); renderMerchantRecruitments();
}
async function clearAllMerchantRecruitments() {
  if (!confirm('确定清空所有招募需求？')) return;
  let url = '/recruitments/all/clear';
  if (currentUser.role === 'merchant') url += `?merchant_id=${currentUser.id}`;
  await fetchAPI(url, { method: 'DELETE' });
  showToast('已清空'); renderMerchantRecruitments();
}

async function applyForRecruitment(recruitmentId, merchantId) {
  const msg = prompt('请输入应聘留言（可选）：', '我希望参与这次招募');
  if (msg === null) return;
  const res = await fetchAPI('/cooperation/apply', {
    method: 'POST',
    body: JSON.stringify({
      influencer_id: currentUser.id,
      merchant_id: merchantId,
      demand_id: recruitmentId,
      demand_type: 'recruitment_apply',
      message: msg
    })
  });
  if (res.success) showToast('已发起应聘，商家将收到通知');
  else showToast(res.error || '应聘失败', 'error');
}

async function recommendInfluencerForRecruitment(recruitmentId) {
  // 简单实现：跳转到达人广场让管理员手动选择并发起合作
  showToast('请前往达人广场筛选合适达人后发起邀请合作');
  navigateTo('influencer-plaza');
}

async function editMerchantRecruitment(id) {
  const res = await fetchAPI(`/recruitments/${id}`);
  if (!res.success) { showToast('加载失败', 'error'); return; }
  const r = res.data;
  const body = `
    <div class="form-grid-2">
      <div class="form-group" style="grid-column:1/-1"><label>招募标题 *</label><input id="emr-title" value="${escapeHtml(r.title || '')}"></div>
      <div class="form-group"><label>招募类型</label>
        <select id="emr-type">
          ${MR_TYPES.map(t => `<option value="${t}" ${r.recruitment_type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>状态</label>
        <select id="emr-status">
          <option value="recruiting" ${r.status==='recruiting'?'selected':''}>招募中</option>
          <option value="paused" ${r.status==='paused'?'selected':''}>已暂停</option>
          <option value="completed" ${r.status==='completed'?'selected':''}>已完成</option>
          <option value="closed" ${r.status==='closed'?'selected':''}>已关闭</option>
        </select>
      </div>
      <div class="form-group"><label>目标等级（多选）</label>
        <input id="emr-levels" value="${escapeHtml(r.target_levels || '')}" placeholder="如：S级,A级">
      </div>
      <div class="form-group"><label>目标地域</label><input id="emr-provinces" value="${escapeHtml(r.target_provinces || '')}" placeholder="如：广东,北京"></div>
      <div class="form-group"><label>目标粉丝量（最低）</label><input type="number" id="emr-fans-min" min="0" value="${r.target_fans_min || 0}"></div>
      <div class="form-group"><label>目标粉丝量（最高）</label><input type="number" id="emr-fans-max" min="0" value="${r.target_fans_max || 0}"></div>
      <div class="form-group"><label>目标赛道</label><input id="emr-categories" value="${escapeHtml(r.target_categories || '')}" placeholder="如：亲子教育,图书"></div>
      <div class="form-group"><label>目标受众</label><input id="emr-audience" value="${escapeHtml(r.target_audience || '')}"></div>
      <div class="form-group"><label>合作方式</label>
        <select id="emr-mode">
          <option value="">不限</option>
          ${MR_COOPERATION_MODES.map(m => `<option value="${m}" ${r.cooperation_mode===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>佣金条件</label><input id="emr-commission" value="${escapeHtml(r.commission_offer || '')}" placeholder="如：纯佣 25%"></div>
      <div class="form-group"><label>预算（最低）</label><input type="number" id="emr-budget-min" min="0" step="0.01" value="${r.budget_min || 0}"></div>
      <div class="form-group"><label>预算（最高）</label><input type="number" id="emr-budget-max" min="0" step="0.01" value="${r.budget_max || 0}"></div>
      <div class="form-group"><label>截止时间</label><input type="date" id="emr-deadline" value="${(r.deadline||'').slice(0,10)}"></div>
      <div class="form-group" style="grid-column:1/-1"><label>招募描述</label><textarea id="emr-desc" rows="3">${escapeHtml(r.description || '')}</textarea></div>
    </div>
  `;
  openModal('编辑招募需求', body, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="saveMerchantRecruitmentEdit('${id}')">保存</button>
  `);
}

async function saveMerchantRecruitmentEdit(id) {
  const payload = {
    title: document.getElementById('emr-title').value.trim(),
    recruitment_type: document.getElementById('emr-type').value,
    status: document.getElementById('emr-status').value,
    target_levels: document.getElementById('emr-levels').value.trim(),
    target_provinces: document.getElementById('emr-provinces').value.trim(),
    target_fans_min: document.getElementById('emr-fans-min').value || 0,
    target_fans_max: document.getElementById('emr-fans-max').value || 0,
    target_categories: document.getElementById('emr-categories').value.trim(),
    target_audience: document.getElementById('emr-audience').value.trim(),
    cooperation_mode: document.getElementById('emr-mode').value,
    commission_offer: document.getElementById('emr-commission').value.trim(),
    budget_min: document.getElementById('emr-budget-min').value || 0,
    budget_max: document.getElementById('emr-budget-max').value || 0,
    deadline: document.getElementById('emr-deadline').value || null,
    description: document.getElementById('emr-desc').value.trim()
  };
  if (!payload.title) { showToast('招募标题必填', 'error'); return; }
  const res = await fetchAPI(`/recruitments/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (res.success) { showToast('已更新'); closeModal(); renderMerchantRecruitments(); }
  else { showToast(res.error || '更新失败', 'error'); }
}

// 商家邀请达人合作
async function inviteInfluencer(influencerId, demandId) {
  const msg = prompt('请输入邀请合作留言（可选）：', '诚邀您合作推广');
  if (msg === null) return;
  const res = await fetchAPI('/cooperation/invite', {
    method: 'POST',
    body: JSON.stringify({ merchant_id: currentUser.id, influencer_id: influencerId, demand_id: demandId, demand_type: 'invite', message: msg })
  });
  if (res.success) { showToast('邀请已发送！达人将在个人中心收到通知'); }
  else { showToast(res.error || '邀请失败', 'error'); }
}

// ============ 达人广场 ============
let infFilters = {
  keyword: '',
  level: [],            // 多选数组
  fans_min: '',
  fans_max: '',
  region_province: '',
  video_category: '',
  book_category: '',
  course_category: '',
  has_mcn: '',
  mutual_select: '',
  cooperation_type: '',
  filter_sales_id: ''
};
let infViewMode = 'list';   // card | list（默认列表）
let infSortField = 'fans_count';
let infSortOrder = 'desc';
let infFilterPanelOpen = false;

// 粉丝段预设
const FANS_BUCKETS = [
  { label: '全部', min: '', max: '' },
  { label: '1万以下', min: '0', max: '9999' },
  { label: '1-10万', min: '10000', max: '99999' },
  { label: '10-50万', min: '100000', max: '499999' },
  { label: '50-100万', min: '500000', max: '999999' },
  { label: '100万+', min: '1000000', max: '' },
];

function getInfActiveFilterCount() {
  let c = 0;
  if (infFilters.level && infFilters.level.length) c++;
  if (infFilters.fans_min || infFilters.fans_max) c++;
  ['region_province','video_category','book_category','course_category',
   'has_mcn','mutual_select','cooperation_type','filter_sales_id','keyword'].forEach(k => {
    if (infFilters[k]) c++;
  });
  return c;
}

async function renderInfluencerPlaza(page = 1, pageSize = 20) {
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';
  
  const isMerchant = currentUser.role === 'merchant';
  const isInfluencer = currentUser.role === 'influencer';
  const isAdmin = currentUser.role === 'admin';
  const isSuperAdmin = isAdmin && currentUser.is_super === true;

  // 拼接 URL 参数
  const opFilter = getOperatorFilter();
  const params = new URLSearchParams();
  params.append('page', page);
  params.append('pageSize', pageSize);
  if (infFilters.keyword) params.append('keyword', infFilters.keyword);
  if (infFilters.level && infFilters.level.length) params.append('level', infFilters.level.join(','));
  if (infFilters.fans_min) params.append('fans_min', infFilters.fans_min);
  if (infFilters.fans_max) params.append('fans_max', infFilters.fans_max);
  if (infFilters.region_province) params.append('region_province', infFilters.region_province);
  if (infFilters.video_category) params.append('category', infFilters.video_category);
  if (infFilters.book_category) params.append('book_category', infFilters.book_category);
  if (infFilters.course_category) params.append('course_category', infFilters.course_category);
  if (infFilters.has_mcn) params.append('has_mcn', infFilters.has_mcn);
  if (infFilters.mutual_select) params.append('mutual_select', infFilters.mutual_select);
  if (infFilters.cooperation_type) params.append('cooperation_type', infFilters.cooperation_type);
  if (infFilters.filter_sales_id) params.append('filter_sales_id', infFilters.filter_sales_id);
  params.append('sortField', infSortField);
  params.append('sortOrder', infSortOrder);
  let qs = '?' + params.toString();
  if (opFilter) qs += opFilter;

  const [heroRes, infRes, optsRes] = await Promise.all([
    fetchAPI('/influencers/hero-stats' + (opFilter ? '?' + opFilter.substring(1) : '')),
    fetchAPI('/influencers' + qs),
    fetchAPI('/influencers/filter-options'),
  ]);

  if (!infRes.success) {
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#ef4444">加载失败：' + (infRes.error || '') + '</p>';
    return;
  }

  const hero = heroRes.success ? heroRes.data : { total: 0, levels: [], mcnCount: 0, mutualCount: 0, newCount: 0, highSales: 0 };
  const opts = optsRes.success ? optsRes.data : { levels: [], videoCategories: [], bookCategories: [], courseCategories: [], provinces: [], cooperationTypes: [], salesList: [] };

  // 用于卡片销售徽章兜底匹配
  window.__salesNameSet = new Set((opts.salesList || []).map(s => s.name).filter(Boolean));

  container.innerHTML = `
    ${renderBackButton()}
    <div class="inf-plaza-page">
      <!-- 顶部 Hero 数据条 -->
      <div class="inf-hero">
        <div class="inf-hero-title">
          <h2>达人广场</h2>
          <p>视频号优质达人资源库</p>
        </div>
        <div class="inf-hero-stats">
          <div class="inf-stat-card inf-stat-primary">
            <div class="inf-stat-value">${formatBigNumber(hero.total)}</div>
            <div class="inf-stat-label">达人总数</div>
          </div>
          ${hero.levels.map(l => `
            <div class="inf-stat-card">
              <div class="inf-stat-value">
                <span class="level-badge-mini ${getLevelClass(l.level)}">${l.level}</span>
                ${l.c}
              </div>
              <div class="inf-stat-label">${l.level}达人</div>
            </div>
          `).join('')}
          <div class="inf-stat-card">
            <div class="inf-stat-value" style="color:#16a34a">${hero.mutualCount}</div>
            <div class="inf-stat-label">已入互选</div>
          </div>
          <div class="inf-stat-card">
            <div class="inf-stat-value" style="color:#f59e0b">${hero.mcnCount}</div>
            <div class="inf-stat-label">MCN达人</div>
          </div>
          <div class="inf-stat-card">
            <div class="inf-stat-value" style="color:#dc2626">${hero.highSales}</div>
            <div class="inf-stat-label">高月销(10万+)</div>
          </div>
        </div>
      </div>

      <!-- 筛选面板 -->
      <div class="filter-panel" id="inf-filter-panel" style="display:${infFilterPanelOpen ? 'block' : 'none'}">
        <div class="filter-row">
          <div class="filter-item" style="flex:1.5">
            <label>等级（多选）</label>
            <div class="chip-group">
              ${opts.levels.map(l => `
                <span class="chip ${(infFilters.level||[]).includes(l.level) ? 'chip-active' : ''}" 
                      onclick="toggleInfLevel('${l.level}')">${l.level} (${l.count})</span>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="filter-row" style="margin-top:10px;">
          <div class="filter-item">
            <label>粉丝量段</label>
            <select onchange="onInfFansBucketChange(this.value)">
              ${FANS_BUCKETS.map((b, i) => {
                const selected = (infFilters.fans_min === b.min && infFilters.fans_max === b.max) ? 'selected' : '';
                return `<option value="${i}" ${selected}>${b.label}</option>`;
              }).join('')}
            </select>
          </div>
          <div class="filter-item">
            <label>地区（省份）</label>
            <select onchange="onInfFilterChange('region_province', this.value); applyInfFilter()">
              <option value="">全部</option>
              ${opts.provinces.map(p => `<option value="${p}" ${infFilters.region_province===p?'selected':''}>${p}</option>`).join('')}
            </select>
          </div>
          <div class="filter-item">
            <label>视频品类</label>
            <select onchange="onInfFilterChange('video_category', this.value); applyInfFilter()">
              <option value="">全部</option>
              ${opts.videoCategories.map(c => `<option value="${c}" ${infFilters.video_category===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="filter-item">
            <label>图书品类</label>
            <select onchange="onInfFilterChange('book_category', this.value); applyInfFilter()">
              <option value="">全部</option>
              ${opts.bookCategories.map(c => `<option value="${c}" ${infFilters.book_category===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="filter-item">
            <label>课程品类</label>
            <select onchange="onInfFilterChange('course_category', this.value); applyInfFilter()">
              <option value="">全部</option>
              ${opts.courseCategories.map(c => `<option value="${c}" ${infFilters.course_category===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="filter-row" style="margin-top:10px;">
          <div class="filter-item">
            <label>合作类型</label>
            <select onchange="onInfFilterChange('cooperation_type', this.value); applyInfFilter()">
              <option value="">全部</option>
              ${opts.cooperationTypes.map(c => `<option value="${c}" ${infFilters.cooperation_type===c?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="filter-item">
            <label>是否MCN</label>
            <select onchange="onInfFilterChange('has_mcn', this.value); applyInfFilter()">
              <option value="">全部</option>
              <option value="是" ${infFilters.has_mcn==='是'?'selected':''}>是</option>
              <option value="否" ${infFilters.has_mcn==='否'?'selected':''}>否</option>
            </select>
          </div>
          <div class="filter-item">
            <label>是否互选</label>
            <select onchange="onInfFilterChange('mutual_select', this.value); applyInfFilter()">
              <option value="">全部</option>
              <option value="是" ${infFilters.mutual_select==='是'?'selected':''}>是</option>
              <option value="否" ${infFilters.mutual_select==='否'?'selected':''}>否</option>
            </select>
          </div>
          ${isSuperAdmin ? `
          <div class="filter-item">
            <label>归属销售</label>
            <select onchange="onInfFilterChange('filter_sales_id', this.value); applyInfFilter()">
              <option value="">全部</option>
              ${opts.salesList.map(s => `<option value="${s.id}" ${infFilters.filter_sales_id===s.id?'selected':''}>${s.name}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>
        <div class="filter-row" style="margin-top:10px;">
          <div class="filter-item" style="flex:1">
            <input type="text" id="inf-filter-keyword" placeholder="搜索达人名 / 品类 / 地区 / MCN / 销售..." value="${infFilters.keyword || ''}"
              onkeypress="if(event.key==='Enter'){ onInfFilterChange('keyword', this.value); applyInfFilter(); }">
          </div>
          <button class="btn btn-primary btn-sm" onclick="onInfFilterChange('keyword', document.getElementById('inf-filter-keyword').value); applyInfFilter()">搜索</button>
          ${getInfActiveFilterCount() > 0 ? '<button class="btn btn-sm btn-outline" onclick="resetInfFilter()">重置</button>' : ''}
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="md-toolbar">
        <div class="md-toolbar-left">
          <button class="btn btn-sm ${infFilterPanelOpen?'btn-primary':'btn-outline'}" onclick="toggleInfFilter()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            筛选${getInfActiveFilterCount() > 0 ? ' ('+getInfActiveFilterCount()+')' : ''}
          </button>
          <span style="font-size:12px;color:#94a3b8;margin-left:8px;">共 <strong style="color:#2563eb">${infRes.pagination.total}</strong> 位达人</span>
          <select class="sort-select" onchange="onInfSortChange(this.value)" title="排序">
            <option value="fans_count:desc" ${infSortField==='fans_count'&&infSortOrder==='desc'?'selected':''}>粉丝量↓</option>
            <option value="fans_count:asc" ${infSortField==='fans_count'&&infSortOrder==='asc'?'selected':''}>粉丝量↑</option>
            <option value="total_sales:desc" ${infSortField==='total_sales'&&infSortOrder==='desc'?'selected':''}>月销总额↓</option>
            <option value="total_sales:asc" ${infSortField==='total_sales'&&infSortOrder==='asc'?'selected':''}>月销总额↑</option>
            <option value="level:asc" ${infSortField==='level'&&infSortOrder==='asc'?'selected':''}>等级 A→D</option>
            <option value="created_at:desc" ${infSortField==='created_at'&&infSortOrder==='desc'?'selected':''}>最新加入</option>
          </select>
        </div>
        <div class="md-toolbar-right">
          <button class="btn btn-sm ${infViewMode==='list'?'btn-primary':'btn-outline'}" onclick="switchInfView('list')" title="列表视图">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg> 列表
          </button>
          <button class="btn btn-sm ${infViewMode==='card'?'btn-primary':'btn-outline'}" onclick="switchInfView('card')" title="卡片视图">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> 卡片
          </button>
        </div>
      </div>

      <!-- 达人列表 -->
      <div class="${infViewMode==='card' ? 'inf-grid' : 'inf-list'}" id="influencer-list">
        ${infRes.data.length === 0 
          ? '<div class="empty-state"><div class="icon">-</div><p>暂无符合条件的达人</p>' + (getInfActiveFilterCount() > 0 ? '<button class="btn btn-sm btn-primary" style="margin-top:12px" onclick="resetInfFilter()">清除筛选条件</button>' : '') + '</div>'
          : infViewMode === 'card'
            ? infRes.data.map(inf => renderInfCardV2(inf, isMerchant, isSuperAdmin)).join('')
            : renderInfListHeader(isSuperAdmin) + infRes.data.map(inf => renderInfRow(inf, isMerchant, isSuperAdmin)).join('')
        }
      </div>
      ${renderPagination(infRes.pagination, 'pageInfluencerPlaza')}
    </div>`;
}

function getLevelClass(level) {
  const map = { 'S级': 'lv-S', 'A级': 'lv-A', 'B级': 'lv-B', 'C级': 'lv-C', 'D级': 'lv-D', 'S':'lv-S','A':'lv-A','B':'lv-B','C':'lv-C','D':'lv-D' };
  return map[level] || 'lv-D';
}

function formatSalesAmount(n) {
  if (!n || n <= 0) return '-';
  if (n >= 10000) return '¥' + (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + '万';
  return '¥' + n;
}

// 卡片视图（V2 - 巨量星图风格）
function renderInfCardV2(inf, isMerchant, isSuperAdmin) {
  const totalSales = (inf.monthly_short_video_sales || 0) + (inf.monthly_live_sales || 0);
  const region = (inf.region || '').replace(/,/, '·').replace(/，/, '·');
  const showSales = isSuperAdmin;
  // 销售徽章兜底（id关联优先；否则文本匹配）
  const salesNameSet = window.__salesNameSet || new Set();
  const textMatched = inf.sales_owner && salesNameSet.has(String(inf.sales_owner).trim());
  const displayName = inf.sales_owner_name || (textMatched ? inf.sales_owner : '');
  return `
    <div class="inf-card-v2" data-id="${inf.id}">
      <div class="inf-card-head">
        <input type="checkbox" class="inf-checkbox" value="${inf.id}">
        <span class="level-badge-mini ${getLevelClass(inf.level)}">${inf.level || '-'}</span>
        <div class="inf-card-name" title="${inf.video_account_name}">${inf.video_account_name}</div>
        ${inf.has_joined_mutual_select === '是' ? '<span class="inf-mutual-tag">互选</span>' : ''}
      </div>
      <div class="inf-card-meta">
        ${inf.video_category_track ? `<span class="inf-tag inf-tag-cat">${(inf.video_category_track||'').split(/[,，、]/)[0]}</span>` : ''}
        ${region ? `<span class="inf-tag inf-tag-region">📍 ${region}</span>` : ''}
        ${inf.has_mcn === '是' ? `<span class="inf-tag inf-tag-mcn">MCN: ${inf.mcn_name||'-'}</span>` : ''}
      </div>
      <div class="inf-card-stats">
        <div class="inf-stat">
          <div class="inf-stat-num" style="color:#2563eb">${formatBigNumber(inf.fans_count)}</div>
          <div class="inf-stat-key">粉丝量</div>
        </div>
        <div class="inf-stat">
          <div class="inf-stat-num" style="color:#dc2626">${formatSalesAmount(totalSales)}</div>
          <div class="inf-stat-key">月销总额</div>
        </div>
        <div class="inf-stat">
          <div class="inf-stat-num" style="color:#10b981;font-size:13px">${inf.short_video_frequency || '-'}</div>
          <div class="inf-stat-key">短视频</div>
        </div>
        <div class="inf-stat">
          <div class="inf-stat-num" style="color:#f59e0b;font-size:13px">${inf.live_frequency || '-'}</div>
          <div class="inf-stat-key">直播</div>
        </div>
      </div>
      ${(inf.book_willingness || inf.course_willingness) ? `
      <div class="inf-card-tracks">
        ${inf.book_willingness ? `<div class="inf-track-line"><span class="inf-track-label">📚 图书</span><span class="inf-track-val">${inf.book_willingness}</span></div>` : ''}
        ${inf.course_willingness ? `<div class="inf-track-line"><span class="inf-track-label">🎓 课程</span><span class="inf-track-val">${inf.course_willingness}</span></div>` : ''}
      </div>` : ''}
      ${showSales ? `<div class="inf-card-sales">归属销售: ${displayName ? `<span style="color:#16a34a;font-weight:600">${displayName}</span>` : '<span style="color:#cbd5e1">未分配</span>'}</div>` : ''}
      <div class="inf-card-foot">
        ${isMerchant ? `<button class="btn btn-sm btn-primary" onclick="inviteInfluencer('${inf.id}','')">邀请合作</button>` : ''}
        <button class="btn btn-sm btn-outline" onclick="showInfDetailModal('${inf.id}')">详情</button>
        ${currentUser.role === 'admin' ? `<button class="btn btn-sm btn-outline" onclick="editInfluencer('${inf.id}')">编辑</button>` : ''}
      </div>
    </div>`;
}

// 列表视图表头
function renderInfListHeader(isSuperAdmin) {
  const sortable = (label, field, align = 'left') => {
    const active = infSortField === field;
    const arrow = active ? (infSortOrder === 'asc' ? '↑' : '↓') : '↕';
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    return `<div class="inf-th sortable ${cls}" onclick="onInfSortClick('${field}')">${label} <span class="sort-arrow ${active?'active':''}">${arrow}</span></div>`;
  };
  const plain = (label, align = 'left') => {
    const cls = align === 'right' ? 'th-right' : (align === 'center' ? 'th-center' : '');
    return `<div class="inf-th ${cls}">${label}</div>`;
  };
  return `
    <div class="inf-row inf-row-header ${isSuperAdmin?'has-sales':''}">
      ${plain('', 'center')}
      ${sortable('等级', 'level', 'center')}
      ${plain('达人账号')}
      ${plain('视频品类')}
      ${sortable('粉丝量', 'fans_count', 'right')}
      ${sortable('月销总额', 'total_sales', 'right')}
      ${plain('更新频率', 'right')}
      ${plain('地区')}
      ${plain('MCN')}
      ${isSuperAdmin ? plain('归属销售', 'center') : ''}
      ${plain('操作', 'right')}
    </div>`;
}

// 列表视图行
function renderInfRow(inf, isMerchant, isSuperAdmin) {
  const totalSales = (inf.monthly_short_video_sales || 0) + (inf.monthly_live_sales || 0);
  const region = (inf.region || '').replace(/,/, '·').replace(/，/, '·');
  const salesNameSet = window.__salesNameSet || new Set();
  const textMatched = inf.sales_owner && salesNameSet.has(String(inf.sales_owner).trim());
  const displayName = inf.sales_owner_name || (textMatched ? inf.sales_owner : '');
  const mainCategory = (inf.video_category_track || '').split(/[,，、]/)[0] || '-';
  return `
    <div class="inf-row ${isSuperAdmin?'has-sales':''}" data-id="${inf.id}">
      <input type="checkbox" class="inf-checkbox">
      <span class="level-badge-mini ${getLevelClass(inf.level)}">${inf.level || '-'}</span>
      <div class="inf-row-name">
        <span class="inf-row-account">${inf.video_account_name}</span>
        ${inf.has_joined_mutual_select === '是' ? '<span class="inf-mutual-tag-sm">互选</span>' : ''}
      </div>
      <div class="inf-row-cat" title="${inf.video_category_track||''}">${mainCategory}</div>
      <div class="inf-row-num" style="color:#2563eb;font-weight:600">${formatBigNumber(inf.fans_count)}</div>
      <div class="inf-row-num" style="color:#dc2626;font-weight:600">${formatSalesAmount(totalSales)}</div>
      <div class="inf-row-freq">
        <div style="font-size:11px">${inf.short_video_frequency || '-'}</div>
        <div style="font-size:11px;color:#94a3b8">${inf.live_frequency || '-'}</div>
      </div>
      <div class="inf-row-region">${region || '-'}</div>
      <div class="inf-row-mcn">${inf.has_mcn === '是' ? (inf.mcn_name || 'MCN') : '-'}</div>
      ${isSuperAdmin ? `<div class="inf-row-sales">${displayName ? `<span style="color:#16a34a;font-weight:600">${displayName}</span>` : '<span style="color:#cbd5e1">-</span>'}</div>` : ''}
      <div class="inf-row-actions">
        ${isMerchant ? `<button class="btn btn-xs btn-primary" onclick="inviteInfluencer('${inf.id}','')">邀请</button>` : ''}
        <button class="btn btn-xs btn-outline" onclick="showInfDetailModal('${inf.id}')">详情</button>
        ${currentUser.role === 'admin' ? `<button class="btn btn-xs btn-outline" onclick="editInfluencer('${inf.id}')">编辑</button>` : ''}
      </div>
    </div>`;
}

// ============ 达人广场交互函数 ============
function toggleInfFilter() {
  infFilterPanelOpen = !infFilterPanelOpen;
  renderInfluencerPlaza();
}
function onInfFilterChange(key, value) { infFilters[key] = value; }
function applyInfFilter() { renderInfluencerPlaza(1, 20); }
function resetInfFilter() {
  infFilters = { keyword: '', level: [], fans_min: '', fans_max: '', region_province: '', video_category: '', book_category: '', course_category: '', has_mcn: '', mutual_select: '', cooperation_type: '', filter_sales_id: '' };
  renderInfluencerPlaza(1, 20);
}
function toggleInfLevel(level) {
  if (!Array.isArray(infFilters.level)) infFilters.level = [];
  const i = infFilters.level.indexOf(level);
  if (i >= 0) infFilters.level.splice(i, 1);
  else infFilters.level.push(level);
  applyInfFilter();
}
function onInfFansBucketChange(idx) {
  const b = FANS_BUCKETS[parseInt(idx)] || FANS_BUCKETS[0];
  infFilters.fans_min = b.min;
  infFilters.fans_max = b.max;
  applyInfFilter();
}
function switchInfView(mode) {
  infViewMode = mode;
  renderInfluencerPlaza();
}
function onInfSortChange(value) {
  const [f, o] = value.split(':');
  infSortField = f;
  infSortOrder = o;
  renderInfluencerPlaza(1, 20);
}
function onInfSortClick(field) {
  if (infSortField === field) {
    infSortOrder = infSortOrder === 'asc' ? 'desc' : 'asc';
  } else {
    infSortField = field;
    infSortOrder = 'desc';
  }
  renderInfluencerPlaza(1, 20);
}

// 达人详情弹窗
async function showInfDetailModal(id) {
  const res = await fetchAPI('/influencers/' + id);
  if (!res.success) { showToast('获取详情失败', 'error'); return; }
  const inf = res.data;
  const totalSales = (inf.monthly_short_video_sales || 0) + (inf.monthly_live_sales || 0);
  const region = (inf.region || '').replace(/,/, '·').replace(/，/, '·');
  const isSuperAdmin = currentUser.role === 'admin' && currentUser.is_super === true;
  const body = `
    <div class="inf-detail">
      <div class="inf-detail-head">
        <span class="level-badge-mini ${getLevelClass(inf.level)}" style="font-size:13px;padding:4px 10px;">${inf.level || '-'}</span>
        <div>
          <div style="font-size:18px;font-weight:600;color:#1e293b">${inf.video_account_name}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">${region || '-'} ${inf.has_mcn === '是' ? '· MCN: ' + (inf.mcn_name || '-') : '· 独立达人'}</div>
        </div>
        ${inf.has_joined_mutual_select === '是' ? '<span class="inf-mutual-tag" style="margin-left:auto">已入互选</span>' : ''}
      </div>
      <div class="inf-detail-stats">
        <div class="inf-detail-stat"><div class="dl">粉丝量</div><div class="dv" style="color:#2563eb">${formatBigNumber(inf.fans_count)}</div></div>
        <div class="inf-detail-stat"><div class="dl">月销总额</div><div class="dv" style="color:#dc2626">${formatSalesAmount(totalSales)}</div></div>
        <div class="inf-detail-stat"><div class="dl">短视频月销</div><div class="dv">${formatSalesAmount(inf.monthly_short_video_sales)}</div></div>
        <div class="inf-detail-stat"><div class="dl">直播月销</div><div class="dv">${formatSalesAmount(inf.monthly_live_sales)}</div></div>
      </div>
      <div class="inf-detail-grid">
        <div><span class="dl">视频品类赛道</span><div class="dv">${inf.video_category_track || '-'}</div></div>
        <div><span class="dl">图书品类</span><div class="dv">${inf.book_willingness || '-'}</div></div>
        <div><span class="dl">课程品类</span><div class="dv">${inf.course_willingness || '-'}</div></div>
        <div><span class="dl">合作类型</span><div class="dv" style="font-size:12px;">${inf.cooperation_type || '-'}</div></div>
        <div><span class="dl">短视频频率</span><div class="dv">${inf.short_video_frequency || '-'}</div></div>
        <div><span class="dl">直播频率</span><div class="dv">${inf.live_frequency || '-'}</div></div>
        ${isSuperAdmin ? `<div><span class="dl">归属销售</span><div class="dv">${inf.sales_owner_name || inf.sales_owner || '<span style="color:#cbd5e1">未分配</span>'}</div></div>` : ''}
        ${inf.official_account_name ? `<div><span class="dl">公众号</span><div class="dv">${inf.official_account_name}</div></div>` : ''}
      </div>
    </div>`;
  const footer = `
    <button class="btn btn-outline" onclick="closeModal()">关闭</button>
    ${currentUser.role === 'merchant' ? `<button class="btn btn-primary" onclick="closeModal();inviteInfluencer('${inf.id}','')">邀请合作</button>` : ''}
  `;
  openModal('达人详情', body, footer);
}

function searchInfluencerPlaza() {
  infFilters.keyword = document.getElementById('inf-filter-keyword')?.value || '';
  renderInfluencerPlaza(1, 20);
}
function pageInfluencerPlaza(page, pageSize) { renderInfluencerPlaza(page, pageSize || 20); }
async function clearAllInfluencers() {
  if (!confirm('确定清空所有达人数据？')) return;
  await fetchAPI('/influencers/all/clear', { method: 'DELETE' });
  showToast('已清空'); renderInfluencerPlaza();
}

// ============ 编辑达人信息（管理员）============
async function editInfluencer(id) {
  const [infRes, salesRes] = await Promise.all([
    fetchAPI(`/influencers?page=1&pageSize=1000`),
    fetchAPI('/admins/sales-list')
  ]);
  if (!infRes.success) { showToast('加载失败', 'error'); return; }
  const inf = infRes.data.find(x => x.id === id);
  if (!inf) { showToast('未找到该达人', 'error'); return; }
  const salesList = salesRes.success ? salesRes.data : [];

  const levelOpts = ['S','A','B','C','D'].map(l => `<option ${inf.level === l ? 'selected' : ''}>${l}</option>`).join('');
  const willOpts = (v) => ['高','中','低','无'].map(x => `<option ${v === x ? 'selected' : ''}>${x}</option>`).join('');
  const yesNo = (v) => ['是','否'].map(x => `<option ${v === x ? 'selected' : ''}>${x}</option>`).join('');
  const salesOpts = `<option value="">-- 未分配 --</option>` + salesList.map(s =>
    `<option value="${s.id}" ${inf.sales_owner_id === s.id ? 'selected' : ''}>${s.name}（${s.username}）</option>`
  ).join('');

  const body = `
    <div class="form-grid-2">
      <div class="form-group"><label>达人账号名 *</label><input id="ei-video-account" value="${escapeHtml(inf.video_account_name || '')}"></div>
      <div class="form-group"><label>等级</label><select id="ei-level"><option value="">-</option>${levelOpts}</select></div>
      <div class="form-group"><label>带货品类</label><input id="ei-video-category" value="${escapeHtml(inf.video_category_track || '')}"></div>
      <div class="form-group"><label>粉丝数</label><input type="number" id="ei-fans-count" value="${inf.fans_count || 0}"></div>
      <div class="form-group"><label>短视频月销售额(万)</label><input type="number" step="0.1" id="ei-short-sales" value="${inf.monthly_short_video_sales || 0}"></div>
      <div class="form-group"><label>直播月销售额(万)</label><input type="number" step="0.1" id="ei-live-sales" value="${inf.monthly_live_sales || 0}"></div>
      <div class="form-group"><label>图书意愿</label><select id="ei-book-will"><option value="">-</option>${willOpts(inf.book_willingness)}</select></div>
      <div class="form-group"><label>课程意愿</label><select id="ei-course-will"><option value="">-</option>${willOpts(inf.course_willingness)}</select></div>
      <div class="form-group"><label>合作类型</label><input id="ei-cooperation-type" value="${escapeHtml(inf.cooperation_type || '')}"></div>
      <div class="form-group"><label>短视频频次</label><input id="ei-short-freq" value="${escapeHtml(inf.short_video_frequency || '')}"></div>
      <div class="form-group"><label>直播频次</label><input id="ei-live-freq" value="${escapeHtml(inf.live_frequency || '')}"></div>
      <div class="form-group"><label>地区</label><input id="ei-region" value="${escapeHtml(inf.region || '')}"></div>
      <div class="form-group"><label>是否有MCN</label><select id="ei-has-mcn"><option value="">-</option>${yesNo(inf.has_mcn)}</select></div>
      <div class="form-group"><label>MCN名称</label><input id="ei-mcn-name" value="${escapeHtml(inf.mcn_name || '')}"></div>
      <div class="form-group"><label>是否加入互选</label><select id="ei-mutual"><option value="">-</option>${yesNo(inf.has_joined_mutual_select)}</select></div>
      <div class="form-group"><label>公众号名称</label><input id="ei-official-account" value="${escapeHtml(inf.official_account_name || '')}"></div>
      <div class="form-group" style="grid-column:1/-1">
        <label>归属销售（系统关联，非必填）</label>
        <select id="ei-sales-owner-id">${salesOpts}</select>
        <p style="font-size:11px;color:var(--gray-400);margin-top:4px">选择销售后，对应销售登录可看到该达人信息</p>
      </div>
    </div>
  `;
  openModal('编辑达人信息', body, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="saveInfluencerEdit('${id}')">保 存</button>
  `);
}

async function saveInfluencerEdit(id) {
  const payload = {
    video_account_name: document.getElementById('ei-video-account').value.trim(),
    level: document.getElementById('ei-level').value,
    video_category_track: document.getElementById('ei-video-category').value.trim(),
    fans_count: parseInt(document.getElementById('ei-fans-count').value) || 0,
    monthly_short_video_sales: parseFloat(document.getElementById('ei-short-sales').value) || 0,
    monthly_live_sales: parseFloat(document.getElementById('ei-live-sales').value) || 0,
    book_willingness: document.getElementById('ei-book-will').value,
    course_willingness: document.getElementById('ei-course-will').value,
    cooperation_type: document.getElementById('ei-cooperation-type').value.trim(),
    short_video_frequency: document.getElementById('ei-short-freq').value.trim(),
    live_frequency: document.getElementById('ei-live-freq').value.trim(),
    region: document.getElementById('ei-region').value.trim(),
    has_mcn: document.getElementById('ei-has-mcn').value,
    mcn_name: document.getElementById('ei-mcn-name').value.trim(),
    has_joined_mutual_select: document.getElementById('ei-mutual').value,
    official_account_name: document.getElementById('ei-official-account').value.trim(),
    sales_owner_id: document.getElementById('ei-sales-owner-id').value || null
  };
  if (!payload.video_account_name) { showToast('达人账号名必填', 'error'); return; }
  const res = await fetchAPI(`/influencers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (res.success) { showToast('达人信息已更新'); closeModal(); renderInfluencerPlaza(); }
  else { showToast(res.error || '更新失败', 'error'); }
}

// 显示/隐藏达人批量上传区域
function showInfluencerExcelUpload() {
  const area = document.getElementById('influencer-upload-area');
  if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
}

// 达人Excel批量上传
async function handleInfluencerExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const resultDiv = document.getElementById('influencer-import-result');
  resultDiv.innerHTML = '<p> 正在导入达人数据...</p>';
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch('/api/influencers/excel/import', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      resultDiv.innerHTML = `<div class="import-result-box success">
        V ${data.message}
        ${data.data.errors && data.data.errors.length> 0 ? `<div class="result-errors">${data.data.errors.slice(0, 5).join('<br>')}</div>` : ''}
      </div>`;
      showToast(`达人导入成功！成功${data.data.success}条`);
      // 根据当前所在模块决定刷新哪个页面
      const currentModule = document.getElementById('page-container')?.getAttribute('data-module');
      setTimeout(() => {
        if (currentModule === 'influencer-manage') renderInfluencerManage();
        else renderInfluencerPlaza();
      }, 1500);
    } else {
      resultDiv.innerHTML = `<div class="import-result-box error">导入失败：${data.error}</div>`;
      showToast(data.error || '导入失败', 'error');
    }
  } catch (err) {
    resultDiv.innerHTML = `<div class="import-result-box error">上传失败：${err.message}</div>`;
    showToast('上传失败: ' + err.message, 'error');
  }
  e.target.value = '';
}

// 显示添加单个达人的弹窗
async function showAddInfluencerModal() {
  // 获取销售列表
  const salesRes = await fetchAPI('/admins/sales-list');
  const salesList = salesRes.data || [];
  const isSalesAdmin = currentUser.role === 'admin' && !currentUser.is_super && currentUser.admin_role === '销售';

  const modal = document.getElementById('modal-overlay');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>邀请达人</h3><button class="modal-close" onclick="closeModal()">×</button></div>
      <div class="modal-body">
        <form onsubmit="submitAddInfluencer(event)">
          <div class="form-row">
            <div class="form-group"><label>达人等级</label><select id="add-inf-level"><option value="S">S</option><option value="A">A</option><option value="B" selected>B</option><option value="C">C</option></select></div>
            <div class="form-group"><label>视频号账号名称 *</label><input id="add-inf-name" required placeholder="达人视频号名称"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>带货品类赛道</label><input id="add-inf-track" placeholder="如：图书,课程"></div>
            <div class="form-group"><label>粉丝数量</label><input type="number" id="add-inf-fans" placeholder="500000"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>短视频销售额(月/万)</label><input type="number" id="add-inf-short-sales" step="0.1" placeholder="15.5"></div>
            <div class="form-group"><label>直播销售额(月/万)</label><input type="number" id="add-inf-live-sales" step="0.1" placeholder="8.2"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>可接受合作类型</label><input id="add-inf-coop-type" placeholder="如：纯佣,投流"></div>
            <div class="form-group"><label>图书带货意愿</label><select id="add-inf-book-will"><option value="高">高</option><option value="中">中</option><option value="低">低</option></select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>课程带货意愿</label><select id="add-inf-course-will"><option value="高">高</option><option value="中">中</option><option value="低">低</option></select></div>
            <div class="form-group"><label>地区</label><input id="add-inf-region" placeholder="如：北京"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>短视频更新频率</label><input id="add-inf-short-freq" placeholder="如：每周3-5条"></div>
            <div class="form-group"><label>直播频率</label><input id="add-inf-live-freq" placeholder="如：每周1-2场"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>是否有MCN</label><select id="add-inf-mcn"><option value="否">否</option><option value="是">是</option></select></div>
            <div class="form-group"><label>MCN名称</label><input id="add-inf-mcn-name" placeholder="MCN机构名称"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>是否入驻互选</label><select id="add-inf-mutual"><option value="是">是</option><option value="否">否</option></select></div>
            <div class="form-group"><label>公众号账号名称</label><input id="add-inf-official" placeholder="公众号名称"></div>
          </div>
          ${isSalesAdmin ? `
            <div class="info-box" style="padding:10px 12px;background:#ecfdf5;border-radius:6px;font-size:12px;color:#15803d;margin-bottom:10px">
               邀请后将自动归属到你（${currentUser.name}）名下
            </div>
          ` : `
            <div class="form-group">
              <label>归属销售（系统关联，非必填）</label>
              <select id="add-inf-sales-owner-id">
                <option value="">-- 不设置 --</option>
                ${salesList.map(s => `<option value="${s.id}">${s.name} (@${s.username})</option>`).join('')}
              </select>
              <p style="font-size:11px;color:var(--gray-400);margin-top:4px">设置后，对应销售登录可看到此达人信息</p>
            </div>
          `}
          <div class="info-box" style="padding:10px 12px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;margin-bottom:10px">
            邀请后系统会生成专属邀请链接，将链接发给达人，对方打开链接设置密码即可激活账号
          </div>
          <button type="submit" class="btn btn-primary btn-block">确认邀请</button>
        </form>
      </div>
    </div>`;
  modal.classList.add('active');
}

// 提交添加单个达人
async function submitAddInfluencer(e) {
  e.preventDefault();
  const isSalesAdmin = currentUser.role === 'admin' && !currentUser.is_super && currentUser.admin_role === '销售';
  const data = {
    level: document.getElementById('add-inf-level').value,
    video_account_name: document.getElementById('add-inf-name').value,
    video_category_track: document.getElementById('add-inf-track').value,
    fans_count: parseInt(document.getElementById('add-inf-fans').value) || 0,
    monthly_short_video_sales: parseFloat(document.getElementById('add-inf-short-sales').value) || 0,
    monthly_live_sales: parseFloat(document.getElementById('add-inf-live-sales').value) || 0,
    cooperation_type: document.getElementById('add-inf-coop-type').value,
    book_willingness: document.getElementById('add-inf-book-will').value,
    course_willingness: document.getElementById('add-inf-course-will').value,
    region: document.getElementById('add-inf-region').value,
    short_video_frequency: document.getElementById('add-inf-short-freq').value,
    live_frequency: document.getElementById('add-inf-live-freq').value,
    has_mcn: document.getElementById('add-inf-mcn').value,
    mcn_name: document.getElementById('add-inf-mcn-name').value,
    has_joined_mutual_select: document.getElementById('add-inf-mutual').value,
    official_account_name: document.getElementById('add-inf-official').value,
    // 销售普管 → 自动归属自己；超管 → 允许选择
    sales_owner_id: isSalesAdmin ? currentUser.id : (document.getElementById('add-inf-sales-owner-id')?.value || ''),
    invite_mode: 1,
    invited_by: currentUser.id
  };
  if (currentUser.role === 'admin') data.operator_id = currentUser.id;

  const res = await fetchAPI('/influencers/add', { method: 'POST', body: JSON.stringify(data) });
  if (res.success) {
    closeModal();
    const currentModule = document.getElementById('page-container')?.getAttribute('data-module');
    if (currentModule === 'influencer-manage') renderInfluencerManage();
    else renderInfluencerPlaza();
    // 显示邀请链接弹窗
    if (res.invite_code) {
      showInviteLinkModal(res.invite_code, data.video_account_name);
    } else {
      showToast('达人已添加');
    }
  } else {
    showToast(res.error || '添加失败', 'error');
  }
}

// ============ 发布需求 ============
// 发布表单下拉枚举（与列表筛选保持一致）
const PUB_BOOK_CATEGORIES = ['少儿科普', '绘本', '教辅', '文学', '家庭教育', '童书', '人文社科', '其他'];
const PUB_GRADE_LEVELS = ['学龄前', '小学', '初中', '高中', '成人', '通用'];
const PUB_SUBJECTS = ['语文', '数学', '英语', '科学', '艺术', '编程', '通用', '其他'];
const PUB_AUDIENCES = ['学龄前儿童', '小学生', '初中生', '高中生', '大学生', '家长', '老师', '成人', '银发族'];
const PUB_INF_CATEGORIES = ['图书需求', '课程需求', '其他'];

let pubActiveTab = 'book';
let pubInfluencerOptions = []; // 管理员代发达人需求时缓存的达人列表

function renderPublish() {
  const container = document.getElementById('page-container');
  const isInfluencer = currentUser.role === 'influencer';

  let tabs = '';
  if (isInfluencer) {
    tabs = `<button class="tab-btn active" data-tab="influencer-demand" onclick="showPublishTab('influencer-demand')">达人需求发布</button>`;
  } else {
    tabs = `
      <button class="tab-btn ${pubActiveTab==='book'?'active':''}" data-tab="book" onclick="showPublishTab('book')">图书需求</button>
      <button class="tab-btn ${pubActiveTab==='course'?'active':''}" data-tab="course" onclick="showPublishTab('course')">课程需求</button>
      <button class="tab-btn ${pubActiveTab==='recruitment'?'active':''}" data-tab="recruitment" onclick="showPublishTab('recruitment')">商家招募</button>
      ${currentUser.role === 'admin' ? `<button class="tab-btn ${pubActiveTab==='influencer-demand'?'active':''}" data-tab="influencer-demand" onclick="showPublishTab('influencer-demand')">达人需求</button>` : ''}
      <button class="tab-btn ${pubActiveTab==='excel'?'active':''}" data-tab="excel" onclick="showPublishTab('excel')">Excel导入</button>
    `;
  }

  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header"><h2>发布需求</h2></div>
    <div class="publish-tabs">${tabs}</div>
    <div id="publish-content"></div>`;

  showPublishTab(isInfluencer ? 'influencer-demand' : pubActiveTab);
}

function showPublishTab(tab) {
  pubActiveTab = tab;
  // 显式按 data-tab 设置高亮，不依赖 event
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  const content = document.getElementById('publish-content');
  if (!content) return;

  if (tab === 'book') {
    content.innerHTML = renderBookForm();
  } else if (tab === 'course') {
    content.innerHTML = renderCourseForm();
  } else if (tab === 'recruitment') {
    content.innerHTML = renderRecruitmentForm();
    // 商家发布时拉取自己的货盘列表（便于关联）
    if (currentUser.role === 'merchant' || currentUser.role === 'admin') loadPubLinkableDemands();
  } else if (tab === 'influencer-demand') {
    content.innerHTML = renderInfluencerDemandForm();
    // 管理员代发：异步加载达人候选
    if (currentUser.role === 'admin') loadPubInfluencerOptions();
  } else if (tab === 'excel') {
    content.innerHTML = renderExcelImport();
  }
}

function renderPublisherInfoBar(scope) {
  // 商家发布时显示发布者信息条
  if (currentUser.role !== 'merchant') return '';
  const company = currentUser.company || currentUser.name || '';
  const scopeLabel = scope === 'book' ? '图书需求' : (scope === 'course' ? '课程需求' : '需求');
  return `
    <div class="publisher-info-bar">
      <span class="publisher-info-label">发布者</span>
      <span class="publisher-info-value">${company}</span>
      <span class="publisher-info-tip">${scopeLabel}发布后将显示在「商家货盘 - 我的需求」</span>
    </div>`;
}

function renderBookForm() {
  const merchantId = currentUser.role === 'merchant' ? currentUser.id : '';
  return `
    <div class="card"><div class="card-header"><h3>发布图书需求</h3></div><div class="card-body">
      ${renderPublisherInfoBar('book')}
      <form onsubmit="submitBookDemand(event)">
        <div class="form-row">
          <div class="form-group"><label>图书名称 *</label><input id="pub-book-name" required placeholder="图书名称"></div>
          <div class="form-group"><label>图书分类 *</label>
            <select id="pub-book-category" required>
              <option value="">请选择</option>
              ${PUB_BOOK_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>图书商家 *</label><input id="pub-book-merchant" required placeholder="出版社/图书商家名称"></div>
          <div class="form-group"><label>目标人群</label>
            <select id="pub-book-audience">
              <option value="">请选择</option>
              ${PUB_AUDIENCES.map(a => `<option value="${a}">${a}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>规格</label><select id="pub-book-spec"><option value="单本">单本</option><option value="套组">套组</option></select></div>
          <div class="form-group"><label>售价（元）</label><input type="number" id="pub-book-price" min="0" step="0.01" placeholder="39.9"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>纯佣金 (%)</label><input type="number" id="pub-book-commission" min="0" max="100" step="0.01" placeholder="25"></div>
          <div class="form-group"><label>投流佣金 (%)</label><input type="number" id="pub-book-ad-commission" min="0" max="100" step="0.01" placeholder="35"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>物流</label><input id="pub-book-logistics" placeholder="如：中通快递"></div>
          <div class="form-group"><label>库存</label><input type="number" id="pub-book-stock" min="0" step="1" placeholder="5000"></div>
        </div>
        <div class="form-group"><label>图书介绍</label><textarea id="pub-book-intro" rows="3" placeholder="简单介绍图书内容"></textarea></div>
        <div class="form-group"><label>微信小店商品链接</label><input id="pub-book-link" placeholder="https://"></div>
        <div class="form-group"><label>图书图片URL</label><input id="pub-book-image" placeholder="图片链接（可选）"></div>
        <input type="hidden" id="pub-book-merchant-id" value="${merchantId}">
        <button type="submit" class="btn btn-primary btn-block">发布图书需求</button>
      </form>
    </div></div>`;
}

function renderCourseForm() {
  const merchantId = currentUser.role === 'merchant' ? currentUser.id : '';
  return `
    <div class="card"><div class="card-header"><h3>发布课程需求</h3></div><div class="card-body">
      ${renderPublisherInfoBar('course')}
      <form onsubmit="submitCourseDemand(event)">
        <div class="form-row">
          <div class="form-group"><label>课程名称 *</label><input id="pub-course-name" required placeholder="课程名称"></div>
          <div class="form-group"><label>课程价格（元）</label><input type="number" id="pub-course-price" min="0" step="0.01" placeholder="1999"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>学段</label>
            <select id="pub-course-grade">
              <option value="">请选择</option>
              ${PUB_GRADE_LEVELS.map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>学科</label>
            <select id="pub-course-subject">
              <option value="">请选择</option>
              ${PUB_SUBJECTS.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>纯佣金 (%)</label><input type="number" id="pub-course-commission" min="0" max="100" step="0.01" placeholder="如 30"></div>
          <div class="form-group"><label>投流佣金 (%)</label><input type="number" id="pub-course-ad-commission" min="0" max="100" step="0.01" placeholder="如 40"></div>
        </div>
        <div class="form-group"><label>课程介绍</label><textarea id="pub-course-intro" rows="3" placeholder="课程内容介绍"></textarea></div>
        <div class="form-group"><label>课程链接</label><input id="pub-course-link" placeholder="https://"></div>
        <div class="form-group"><label>课程图片URL</label><input id="pub-course-image" placeholder="图片链接（可选）"></div>
        <input type="hidden" id="pub-course-merchant-id" value="${merchantId}">
        <button type="submit" class="btn btn-primary btn-block">发布课程需求</button>
      </form>
    </div></div>`;
}

// ========== 商家招募需求 发布表单 ==========
let pubLinkableDemands = []; // 商家自己已发布的货盘（用于关联）

function renderRecruitmentForm() {
  if (currentUser.role === 'influencer') {
    return `<div class="card"><div class="card-body"><div class="empty-state"><p>达人无法发布招募需求</p></div></div></div>`;
  }
  const merchantId = currentUser.role === 'merchant' ? currentUser.id : '';
  const isAdmin = currentUser.role === 'admin';
  return `
    <div class="card"><div class="card-header"><h3>发布商家招募需求</h3></div><div class="card-body">
      ${renderPublisherInfoBar('recruitment')}
      <form onsubmit="submitRecruitment(event)">
        ${isAdmin ? `
        <div class="form-row">
          <div class="form-group" style="grid-column:1/-1"><label>代发商家 * <span style="color:#94a3b8;font-weight:400;font-size:12px">（管理员代发，必选）</span></label>
            <select id="pub-mr-merchant-id" required>
              <option value="">请选择商家...</option>
              ${pubMerchantOptions.map(m => `<option value="${m.id}">${escapeHtml(m.company || m.name)}</option>`).join('')}
            </select>
          </div>
        </div>` : `<input type="hidden" id="pub-mr-merchant-id" value="${merchantId}">`}
        <div class="form-row">
          <div class="form-group" style="grid-column:1/-1"><label>招募标题 *</label><input id="pub-mr-title" required placeholder="如：寻找30万+亲子赛道达人推广《小学数学思维训练》"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>招募类型 *</label>
            <select id="pub-mr-type" required>
              ${MR_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>关联货盘（可选）</label>
            <select id="pub-mr-linked">
              <option value="">不关联</option>
            </select>
            <span style="font-size:11px;color:#94a3b8">可关联到具体的图书/课程货盘，便于达人了解推广商品</span>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>目标达人等级（可多选，用 , 分隔）</label>
            <input id="pub-mr-levels" placeholder="如：S级,A级">
          </div>
          <div class="form-group"><label>目标地域（可多省，用 , 分隔）</label>
            <input id="pub-mr-provinces" placeholder="如：广东,北京,上海">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>目标粉丝量（最低）</label><input type="number" id="pub-mr-fans-min" min="0" step="1" placeholder="如 100000"></div>
          <div class="form-group"><label>目标粉丝量（最高）</label><input type="number" id="pub-mr-fans-max" min="0" step="1" placeholder="如 1000000，留空表示不限"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>目标赛道</label><input id="pub-mr-categories" placeholder="如：亲子教育,图书,少儿"></div>
          <div class="form-group"><label>目标受众</label><input id="pub-mr-audience" placeholder="如：家长,学生"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>合作方式</label>
            <select id="pub-mr-mode">
              <option value="">请选择</option>
              ${MR_COOPERATION_MODES.map(m => `<option value="${m}">${m}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>佣金条件</label><input id="pub-mr-commission" placeholder="如：纯佣 25%、CPS 30%"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>预算（最低，元）</label><input type="number" id="pub-mr-budget-min" min="0" step="0.01" placeholder="0"></div>
          <div class="form-group"><label>预算（最高，元）</label><input type="number" id="pub-mr-budget-max" min="0" step="0.01" placeholder="0 表示不限"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>截止时间</label><input type="date" id="pub-mr-deadline"></div>
          <div class="form-group"></div>
        </div>
        <div class="form-group"><label>招募描述</label><textarea id="pub-mr-desc" rows="4" placeholder="详细描述你想找什么样的达人、合作内容、要求等"></textarea></div>
        <button type="submit" class="btn btn-primary btn-block">发布招募需求</button>
      </form>
    </div></div>`;
}

let pubMerchantOptions = []; // 管理员代发招募时缓存的商家列表

async function loadPubLinkableDemands() {
  // 拉取当前商家的货盘列表（管理员则拉所有）
  const isMerchant = currentUser.role === 'merchant';
  const isAdmin = currentUser.role === 'admin';
  let url = '/demands?page=1&pageSize=200';
  if (isMerchant) url += `&merchant_id=${currentUser.id}`;
  try {
    const res = await fetchAPI(url);
    if (res && res.success) {
      pubLinkableDemands = res.data || [];
      const select = document.getElementById('pub-mr-linked');
      if (select) {
        select.innerHTML = '<option value="">不关联</option>' +
          pubLinkableDemands.map(d => {
            const label = `[${d.demand_type==='book'?'图书':'课程'}] ${d.title || d.book_name || d.course_name || '未命名'}`;
            return `<option value="${d.id}">${escapeHtml(label)}</option>`;
          }).join('');
      }
    }
    // 管理员还需要加载商家列表
    if (isAdmin) {
      const mres = await fetchAPI('/merchants?page=1&pageSize=500');
      if (mres && mres.success) {
        pubMerchantOptions = mres.data || [];
        const select = document.getElementById('pub-mr-merchant-id');
        if (select) {
          select.innerHTML = '<option value="">请选择商家...</option>' +
            pubMerchantOptions.map(m => `<option value="${m.id}">${escapeHtml(m.company || m.name)}</option>`).join('');
        }
      }
    }
  } catch (e) { /* ignore */ }
}

// 发布成功后的统一处理：在 modal 内显示成功提示 + 继续添加/完成 按钮
function onPublishSuccess(form, refreshFn, label) {
  // 静默刷新背后的列表
  if (typeof refreshFn === 'function') {
    try { refreshFn(); } catch (e) { /* ignore */ }
  }
  showToast(`${label}发布成功`);
  // 替换 modal body 为成功提示 + 操作按钮
  const modalBody = document.querySelector('#modal-overlay .modal-body');
  const modalFooter = document.querySelector('#modal-overlay .modal-footer');
  if (modalBody) {
    modalBody.innerHTML = `
      <div style="text-align:center;padding:32px 16px">
        <div style="font-size:48px;color:#16a34a;line-height:1">✓</div>
        <div style="font-size:18px;font-weight:600;color:#1e293b;margin-top:12px">${label}发布成功</div>
        <div style="font-size:13px;color:#94a3b8;margin-top:6px">已自动加入到列表，可继续添加或关闭</div>
      </div>`;
  }
  if (modalFooter) {
    modalFooter.innerHTML = `
      <button class="btn btn-outline" onclick="closeModal()">完成</button>
      <button class="btn btn-primary" onclick="onPublishContinue()">继续添加</button>`;
  }
}

// 重新打开同一种发布弹窗（"继续添加"按钮）
function onPublishContinue() {
  const opener = window._currentPublishOpener;
  closeModal();
  if (typeof opener === 'function') {
    setTimeout(() => opener(), 100);
  }
}

// 工具：把 render*Form 返回的整页 HTML 提取为 modal-friendly 的 form 内容
// - 去掉外层 card 包装
// - 去掉表单底部的 submit button
function extractFormForModal(fullHtml) {
  const wrap = document.createElement('div');
  wrap.innerHTML = fullHtml;
  // 找到 form 元素
  const form = wrap.querySelector('form');
  if (!form) return fullHtml;
  // 移除 form 内的 type=submit / btn-block 按钮
  form.querySelectorAll('button[type="submit"], .btn-block').forEach(b => b.remove());
  // 同时移除 publisher-info-bar（modal 标题已经体现"为谁发布"）
  form.querySelectorAll('.publisher-info-bar').forEach(b => b.remove());
  return form.outerHTML;
}

// ========== 商家货盘 - 发布货品 modal（图书/课程双 tab） ==========
let _publishGoodsType = 'book'; // 'book' | 'course'

function showPublishGoodsModal(type) {
  if (currentUser.role === 'influencer') return;
  _publishGoodsType = type || _publishGoodsType || 'book';

  // 缓存"重新打开"回调（用于 继续添加）
  window._currentPublishOpener = () => showPublishGoodsModal(_publishGoodsType);

  const subtitle = currentUser.role === 'merchant'
    ? `<span style="color:#94a3b8;font-size:12px">发布到「${currentUser.company || currentUser.name}」的货盘</span>`
    : (currentUser.role === 'admin' ? `<span style="color:#94a3b8;font-size:12px">管理员代发</span>` : '');

  // 顶部 tab 切换 + 表单内容
  const formHtml = _publishGoodsType === 'book'
    ? extractFormForModal(renderBookForm())
    : extractFormForModal(renderCourseForm());

  const body = `
    <div style="margin-bottom:14px">${subtitle}</div>
    <div class="publish-tabs" style="margin-bottom:14px">
      <button class="tab-btn ${_publishGoodsType==='book'?'active':''}" onclick="switchPublishGoodsTab('book')">图书货品</button>
      <button class="tab-btn ${_publishGoodsType==='course'?'active':''}" onclick="switchPublishGoodsTab('course')">课程货品</button>
    </div>
    <div id="publish-goods-form-content">${formHtml}</div>
  `;
  const footer = `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="submitPublishGoodsFromModal()">发布</button>
  `;
  openModal(_publishGoodsType === 'book' ? '发布图书货品' : '发布课程货品', body, footer);
}

function switchPublishGoodsTab(type) {
  _publishGoodsType = type;
  // 重渲染表单内容（保留外层 modal）
  const content = document.getElementById('publish-goods-form-content');
  if (!content) return;
  content.innerHTML = type === 'book'
    ? extractFormForModal(renderBookForm())
    : extractFormForModal(renderCourseForm());
  // 切换 tab 高亮
  document.querySelectorAll('#modal-overlay .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#modal-overlay .tab-btn').forEach(b => {
    if (b.textContent.includes(type === 'book' ? '图书' : '课程')) b.classList.add('active');
  });
  // 标题
  const title = document.getElementById('modal-title');
  if (title) title.textContent = type === 'book' ? '发布图书货品' : '发布课程货品';
}

function submitPublishGoodsFromModal() {
  const form = document.querySelector('#modal-overlay form');
  if (!form) return;
  // 触发 form 的 submit 事件（form 上已绑定 onsubmit="submitBookDemand(event)" 或 submitCourseDemand）
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

// ========== 商家货盘 - Excel 导入 modal ==========
function showImportGoodsModal() {
  if (currentUser.role !== 'admin') return;
  window._currentPublishOpener = () => showImportGoodsModal();
  const body = `
    <div style="margin-bottom:14px;font-size:13px;color:#475569">
      支持图书需求 / 课程需求 / 达人信息 三种类型批量导入
    </div>
    ${renderExcelImport()}
  `;
  const footer = `<button class="btn btn-outline" onclick="closeModal()">关闭</button>`;
  openModal('Excel 批量导入', body, footer);
}

// ========== 商家需求 - 发布招募 modal ==========
function showPublishRecruitmentModal() {
  if (currentUser.role === 'influencer') {
    showToast('达人无法发布招募需求', 'error'); return;
  }
  window._currentPublishOpener = () => showPublishRecruitmentModal();

  const subtitle = currentUser.role === 'merchant'
    ? `<span style="color:#94a3b8;font-size:12px">为「${currentUser.company || currentUser.name}」发布招募</span>`
    : `<span style="color:#94a3b8;font-size:12px">管理员代发招募</span>`;

  const body = `
    <div style="margin-bottom:14px">${subtitle}</div>
    ${extractFormForModal(renderRecruitmentForm())}
  `;
  const footer = `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="submitFromModal()">发布招募</button>
  `;
  openModal('发布商家招募需求', body, footer);

  // 异步加载关联数据（货盘 + 商家选项）
  if (currentUser.role === 'merchant' || currentUser.role === 'admin') {
    setTimeout(() => loadPubLinkableDemands(), 50);
  }
}

// ========== 达人需求 - 发布需求 modal ==========
function showPublishInfluencerDemandModal() {
  if (currentUser.role === 'merchant') {
    showToast('商家无法发布达人需求', 'error'); return;
  }
  window._currentPublishOpener = () => showPublishInfluencerDemandModal();

  const subtitle = currentUser.role === 'influencer'
    ? `<span style="color:#94a3b8;font-size:12px">发布我的需求</span>`
    : `<span style="color:#94a3b8;font-size:12px">管理员代发达人需求</span>`;

  const body = `
    <div style="margin-bottom:14px">${subtitle}</div>
    ${extractFormForModal(renderInfluencerDemandForm())}
  `;
  const footer = `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="submitFromModal()">发布</button>
  `;
  openModal('发布达人需求', body, footer);

  // 管理员代发：异步加载达人候选
  if (currentUser.role === 'admin') {
    setTimeout(() => loadPubInfluencerOptions(), 50);
  }
}

// 通用：触发 modal 内 form 的 submit 事件
function submitFromModal() {
  const form = document.querySelector('#modal-overlay form');
  if (!form) return;
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
}

async function submitRecruitment(e) {
  e.preventDefault();
  const merchantId = document.getElementById('pub-mr-merchant-id').value;
  if (!merchantId) { showToast('请选择商家或重新登录', 'error'); return; }
  const title = document.getElementById('pub-mr-title').value.trim();
  if (!title) { showToast('招募标题必填', 'error'); return; }
  const data = {
    merchant_id: merchantId,
    title,
    recruitment_type: document.getElementById('pub-mr-type').value,
    linked_demand_id: document.getElementById('pub-mr-linked').value || null,
    target_levels: document.getElementById('pub-mr-levels').value.trim(),
    target_provinces: document.getElementById('pub-mr-provinces').value.trim(),
    target_fans_min: document.getElementById('pub-mr-fans-min').value || 0,
    target_fans_max: document.getElementById('pub-mr-fans-max').value || 0,
    target_categories: document.getElementById('pub-mr-categories').value.trim(),
    target_audience: document.getElementById('pub-mr-audience').value.trim(),
    cooperation_mode: document.getElementById('pub-mr-mode').value,
    commission_offer: document.getElementById('pub-mr-commission').value.trim(),
    budget_min: document.getElementById('pub-mr-budget-min').value || 0,
    budget_max: document.getElementById('pub-mr-budget-max').value || 0,
    deadline: document.getElementById('pub-mr-deadline').value || null,
    description: document.getElementById('pub-mr-desc').value.trim()
  };
  if (currentUser.role === 'admin') data.operator_id = currentUser.id;
  const res = await fetchAPI('/recruitments', { method: 'POST', body: JSON.stringify(data) });
  if (res.success) {
    onPublishSuccess(e.target, () => {
      const m = document.getElementById('page-container')?.getAttribute('data-module');
      if (m === 'merchant-recruitments') renderMerchantRecruitments();
    }, '招募需求');
  } else {
    showToast(res.error || '发布失败', 'error');
  }
}

function renderInfluencerDemandForm() {
  const isAdmin = currentUser.role === 'admin';
  const isInfluencer = currentUser.role === 'influencer';
  return `
    <div class="card"><div class="card-header"><h3>发布达人需求</h3></div><div class="card-body">
      <form onsubmit="submitInfluencerDemand(event)">
        ${isAdmin ? `
        <div class="form-row">
          <div class="form-group"><label>代发达人 * <span style="color:#94a3b8;font-weight:400;font-size:12px">（管理员代发，必选）</span></label>
            <select id="pub-inf-id" required onchange="onPubInfluencerChange()">
              <option value="">${pubInfluencerOptions.length===0?'加载中...':'请选择达人...'}</option>
              ${pubInfluencerOptions.map(i => `<option value="${i.id}" data-name="${escapeHtml(i.name)}" data-fans="${i.fans}">${escapeHtml(i.name)} (${formatNumber(i.fans)} 粉丝${i.level?' · '+i.level:''})</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>视频号账号</label><input id="pub-inf-account" readonly placeholder="选择达人后自动填充" style="background:#f8fafc"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>需求类型 *</label>
            <select id="pub-inf-category" required>
              ${PUB_INF_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>粉丝数量</label><input type="number" id="pub-inf-fans" min="0" step="1" readonly placeholder="选择达人后自动填充" style="background:#f8fafc"></div>
        </div>` : `
        <div class="form-row">
          <div class="form-group"><label>视频号账号名称</label><input id="pub-inf-account" value="${isInfluencer ? escapeHtml(currentUser.name || '') : ''}" placeholder="达人视频号名称" ${isInfluencer ? 'readonly style="background:#f8fafc"' : ''}></div>
          <div class="form-group"><label>需求类型 *</label>
            <select id="pub-inf-category" required>
              ${PUB_INF_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group"><label>粉丝数量</label><input type="number" id="pub-inf-fans" min="0" step="1" placeholder="500000" value="${currentUser.fans_count || ''}"></div>`}
        <div class="form-row">
          <div class="form-group"><label>图书分类</label>
            <select id="pub-inf-book-cat">
              <option value="">请选择（图书需求时）</option>
              ${PUB_BOOK_CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>学科分类</label>
            <select id="pub-inf-subject">
              <option value="">请选择</option>
              ${PUB_SUBJECTS.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group"><label>期望图书</label><input id="pub-inf-book-name" placeholder="如：少儿科普百科 / DK系列（图书需求时填写）"></div>
        <div class="form-row">
          <div class="form-group"><label>图书可接受售价（最低，元）</label><input type="number" id="pub-inf-book-min" min="0" step="0.01" placeholder="0"></div>
          <div class="form-group"><label>图书可接受售价（最高，元）</label><input type="number" id="pub-inf-book-max" min="0" step="0.01" placeholder="100"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>课程可接受价（最低，元）</label><input type="number" id="pub-inf-course-min" min="0" step="0.01" placeholder="0"></div>
          <div class="form-group"><label>课程可接受价（最高，元）</label><input type="number" id="pub-inf-course-max" min="0" step="0.01" placeholder="3000"></div>
        </div>
        <div class="form-group"><label>需求描述</label><textarea id="pub-inf-desc" rows="3" placeholder="描述您的需求（如：选品偏好、佣金期望、合作方式等）"></textarea></div>
        <button type="submit" class="btn btn-primary btn-block">发布达人需求</button>
      </form>
    </div></div>`;
}

async function loadPubInfluencerOptions() {
  if (pubInfluencerOptions.length > 0) {
    // 已加载过则直接刷一次 select（防止 dom 重渲染丢失）
    refreshPubInfluencerSelect();
    return;
  }
  try {
    const res = await fetchAPI('/cooperation/matchmaking/suggest/influencers?limit=300');
    if (res && res.success) {
      pubInfluencerOptions = (res.data || []).filter(x => x.id);
      refreshPubInfluencerSelect();
    }
  } catch (e) { /* ignore */ }
}

function refreshPubInfluencerSelect() {
  const select = document.getElementById('pub-inf-id');
  if (!select) return;
  select.innerHTML = '<option value="">请选择达人...</option>' +
    pubInfluencerOptions.map(i => `<option value="${i.id}" data-name="${escapeHtml(i.name)}" data-fans="${i.fans}">${escapeHtml(i.name)} (${formatNumber(i.fans)} 粉丝${i.level?' · '+i.level:''})</option>`).join('');
}

function onPubInfluencerChange() {
  const sel = document.getElementById('pub-inf-id');
  if (!sel) return;
  const opt = sel.options[sel.selectedIndex];
  const acct = document.getElementById('pub-inf-account');
  const fans = document.getElementById('pub-inf-fans');
  if (acct) acct.value = opt?.getAttribute('data-name') || '';
  if (fans) fans.value = opt?.getAttribute('data-fans') || '';
}

function renderExcelImport() {
  return `
    <div class="card"><div class="card-header"><h3> Excel批量导入需求</h3></div><div class="card-body">
      <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="/api/excel/template/book" class="btn btn-outline btn-sm">下载图书需求模板</a>
        <a href="/api/excel/template/course" class="btn btn-outline btn-sm"> 下载课程需求模板</a>
        <a href="/api/influencers/excel/template" class="btn btn-outline btn-sm"> 下载达人模板</a>
      </div>
      <div class="form-group">
        <label>选择导入类型 *</label>
        <select id="excel-import-type">
          <option value="book">图书需求</option>
          <option value="course">课程需求</option>
          <option value="influencer">达人信息</option>
        </select>
      </div>
      <div class="upload-area" onclick="document.getElementById('excel-file-input').click()">
        <div class="upload-icon"></div>
        <div class="upload-text">点击上传Excel文件</div>
        <div class="upload-hint">支持.xlsx格式，请先选择导入类型再上传对应模板数据</div>
      </div>
      <input type="file" id="excel-file-input" accept=".xlsx,.xls" style="display:none" onchange="handleExcelUpload(event)">
      <div id="excel-import-result" style="margin-top:16px"></div>
    </div></div>`;
}

async function submitBookDemand(e) {
  e.preventDefault();
  const merchantId = document.getElementById('pub-book-merchant-id').value || currentUser.id;
  if (!merchantId) { showToast('未识别商家身份，请重新登录', 'error'); return; }
  const data = {
    merchant_id: merchantId,
    book_merchant: document.getElementById('pub-book-merchant').value,
    book_name: document.getElementById('pub-book-name').value,
    target_audience: document.getElementById('pub-book-audience').value,
    book_category: document.getElementById('pub-book-category').value,
    specification: document.getElementById('pub-book-spec').value,
    selling_price: document.getElementById('pub-book-price').value,
    pure_commission: document.getElementById('pub-book-commission').value,
    ad_commission: document.getElementById('pub-book-ad-commission').value,
    logistics: document.getElementById('pub-book-logistics').value,
    stock: document.getElementById('pub-book-stock').value,
    book_introduction: document.getElementById('pub-book-intro').value,
    wechat_shop_link: document.getElementById('pub-book-link').value,
    book_image: document.getElementById('pub-book-image').value,
  };
  if (currentUser.role === 'admin') data.operator_id = currentUser.id;
  const res = await fetchAPI('/demands/book', { method: 'POST', body: JSON.stringify(data) });
  if (res.success) {
    onPublishSuccess(e.target, () => {
      const m = document.getElementById('page-container')?.getAttribute('data-module');
      if (m === 'merchant-demands') renderMerchantDemands();
    }, '图书货品');
  } else {
    showToast(res.error || '发布失败', 'error');
  }
}

async function submitCourseDemand(e) {
  e.preventDefault();
  const merchantId = document.getElementById('pub-course-merchant-id').value || currentUser.id;
  if (!merchantId) { showToast('未识别商家身份，请重新登录', 'error'); return; }
  const data = {
    merchant_id: merchantId,
    course_name: document.getElementById('pub-course-name').value,
    unit_price: document.getElementById('pub-course-price').value,
    grade_level: document.getElementById('pub-course-grade').value,
    subject: document.getElementById('pub-course-subject').value,
    pure_commission: document.getElementById('pub-course-commission').value,
    ad_commission: document.getElementById('pub-course-ad-commission').value,
    course_introduction: document.getElementById('pub-course-intro').value,
    course_link: document.getElementById('pub-course-link').value,
    course_image: document.getElementById('pub-course-image').value,
  };
  if (currentUser.role === 'admin') data.operator_id = currentUser.id;
  const res = await fetchAPI('/demands/course', { method: 'POST', body: JSON.stringify(data) });
  if (res.success) {
    onPublishSuccess(e.target, () => {
      const m = document.getElementById('page-container')?.getAttribute('data-module');
      if (m === 'merchant-demands') renderMerchantDemands();
    }, '课程货品');
  } else {
    showToast(res.error || '发布失败', 'error');
  }
}

async function submitInfluencerDemand(e) {
  e.preventDefault();
  let influencerId, accountName;
  if (currentUser.role === 'admin') {
    influencerId = document.getElementById('pub-inf-id').value;
    if (!influencerId) { showToast('请先选择代发达人', 'error'); return; }
    accountName = document.getElementById('pub-inf-account').value;
  } else if (currentUser.role === 'influencer') {
    influencerId = currentUser.id;
    accountName = document.getElementById('pub-inf-account').value || currentUser.name;
  } else {
    showToast('当前角色无权发布达人需求', 'error');
    return;
  }
  const data = {
    influencer_id: influencerId,
    video_account_name: accountName,
    demand_category: document.getElementById('pub-inf-category').value,
    book_name: document.getElementById('pub-inf-book-name')?.value || '',
    book_category: document.getElementById('pub-inf-book-cat').value,
    subject_category: document.getElementById('pub-inf-subject').value,
    book_price_min: document.getElementById('pub-inf-book-min').value || 0,
    book_price_max: document.getElementById('pub-inf-book-max').value || 0,
    course_price_min: document.getElementById('pub-inf-course-min').value || 0,
    course_price_max: document.getElementById('pub-inf-course-max').value || 0,
    fans_count: document.getElementById('pub-inf-fans').value || 0,
    description: document.getElementById('pub-inf-desc').value,
  };
  if (currentUser.role === 'admin') data.operator_id = currentUser.id;
  const res = await fetchAPI('/demands/influencer-demands', { method: 'POST', body: JSON.stringify(data) });
  if (res.success) {
    onPublishSuccess(e.target, () => {
      const m = document.getElementById('page-container')?.getAttribute('data-module');
      if (m === 'influencer-demands') renderInfluencerDemands();
    }, '达人需求');
  } else {
    showToast(res.error || '发布失败', 'error');
  }
}

async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const resultDiv = document.getElementById('excel-import-result');
  resultDiv.innerHTML = '<p> 正在导入...</p>';
  
  const importType = document.getElementById('excel-import-type').value;
  const formData = new FormData();
  formData.append('file', file);
  
  // 对于图书和课程需求，需要附带商家ID（管理员传'admin'让后端按Excel的商家名称匹配）
  let apiUrl = '';
  const merchantIdParam = currentUser.role === 'admin' ? 'admin' : (currentUser.id || 'admin');
  if (importType === 'book') {
    formData.append('merchant_id', merchantIdParam);
    apiUrl = '/api/excel/import/book';
  } else if (importType === 'course') {
    formData.append('merchant_id', merchantIdParam);
    apiUrl = '/api/excel/import/course';
  } else if (importType === 'influencer') {
    apiUrl = '/api/influencers/excel/import';
  }
  
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      const count = data.data?.success || data.data?.count || 0;
      const failed = data.data?.failed || 0;
      let html = `<div class="import-result-box success">V ${data.message || '导入成功！共导入 ' + count + ' 条记录'}</div>`;
      if (data.data?.errors && data.data.errors.length> 0) {
        html += `<div class="result-errors" style="margin-top:8px;font-size:12px;color:#991b1b">${data.data.errors.slice(0, 5).join('<br>')}</div>`;
      }
      resultDiv.innerHTML = html;
      showToast(`导入成功！成功${count}条${failed> 0 ? '，失败' + failed + '条' : ''}`);
    } else {
      resultDiv.innerHTML = `<div class="import-result-box error">导入失败：${data.error}</div>`;
      showToast(data.error || '导入失败', 'error');
    }
  } catch (err) {
    resultDiv.innerHTML = `<div class="import-result-box error">上传失败：${err.message}</div>`;
    showToast('上传失败: ' + err.message, 'error');
  }
  e.target.value = '';
}

// ============ 合作管理（管理员） ============
let mmSourceType = ''; // '' / '手动创建' / '邀约转化' / '申请转化'
let mmOnlyUpgrade = false; // 仅看升级佣金高于原佣金的撮合

async function renderMatchmaking(page = 1, pageSize = 20, stage = '', keyword = '') {
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';

  const baseQuery = getOperatorFilter();
  const stTail = mmSourceType ? `&source_type=${encodeURIComponent(mmSourceType)}` : '';
  const upTail = mmOnlyUpgrade ? '&only_upgrade=1' : '';
  // 拼 stats query
  const statsQs = [];
  if (baseQuery) statsQs.push(baseQuery.substring(1));
  if (stTail) statsQs.push(stTail.substring(1));
  if (upTail) statsQs.push(upTail.substring(1));
  const statsUrl = '/cooperation/matchmaking/stats' + (statsQs.length ? '?' + statsQs.join('&') : '');

  const [statsRes, listRes] = await Promise.all([
    fetchAPI(statsUrl),
    fetchAPI(`/cooperation/matchmaking?page=${page}&pageSize=${pageSize}${stage ? '&stage=' + encodeURIComponent(stage) : ''}${keyword ? '&keyword=' + encodeURIComponent(keyword) : ''}${stTail}${upTail}${baseQuery}`)
  ]);

  const stages = ['需求发布', '合作匹配', '样品寄送', '开始合作'];
  const stageStats = statsRes.success ? statsRes.data.stages : [];
  const getStageCount = (s) => { const found = stageStats.find(x => x.stage === s); return found ? found.count : 0; };
  const totalCount = statsRes.success ? statsRes.data.total : 0;
  const totalGmv = statsRes.success ? (statsRes.data.totalGmv || 0) : 0;
  const dealCount = statsRes.success ? (statsRes.data.dealCount || 0) : 0;
  const sourceTypeStats = statsRes.success ? (statsRes.data.sourceTypes || []) : [];
  const stCount = (t) => { const f = sourceTypeStats.find(x => x.source_type === t); return f ? f.count : 0; };

  // 按环节分组数据
  const groupedData = {};
  stages.forEach(s => { groupedData[s] = []; });
  if (listRes.success && listRes.data) {
    listRes.data.forEach(mm => {
      if (groupedData[mm.stage]) groupedData[mm.stage].push(mm);
      else groupedData['需求发布'].push(mm);
    });
  }

  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header">
      <h2>撮合管理</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:13px;color:var(--gray-500)">共 ${totalCount} 条</span>
        <button class="btn btn-primary" onclick="showCreateMatchmaking()">+ 新建撮合</button>
      </div>
    </div>
    <div class="mm-summary">
      <div class="mm-summary-item">
        <div class="mm-summary-label">累计成交 GMV</div>
        <div class="mm-summary-value mm-summary-gmv">¥${formatNumber(totalGmv)}</div>
        <div class="mm-summary-sub">来自 ${dealCount} 单「开始合作」</div>
      </div>
      <div class="mm-summary-item">
        <div class="mm-summary-label">合作匹配（待跟进）</div>
        <div class="mm-summary-value" style="color:#f59e0b">${getStageCount('合作匹配')}</div>
        <div class="mm-summary-sub">需运营尽快推进</div>
      </div>
      <div class="mm-summary-item">
        <div class="mm-summary-label">样品寄送中</div>
        <div class="mm-summary-value" style="color:#6366f1">${getStageCount('样品寄送')}</div>
        <div class="mm-summary-sub">寄出待确认</div>
      </div>
      <div class="mm-summary-item">
        <div class="mm-summary-label">开始合作</div>
        <div class="mm-summary-value" style="color:#10b981">${getStageCount('开始合作')}</div>
        <div class="mm-summary-sub">已落地</div>
      </div>
    </div>
    <div class="search-filter-bar">
      <input type="text" id="mm-search" placeholder="搜索：商家/达人/需求/商品名..." value="${keyword}" onkeypress="if(event.key==='Enter')searchMatchmaking()">
      <button class="btn btn-primary btn-sm" onclick="searchMatchmaking()">搜索</button>
      ${stage ? `<button class="btn btn-outline btn-sm" onclick="filterMatchmakingByStage('')">查看全部环节</button>` : ''}
      <span class="mm-chip-group">
        <span class="mm-chip-label">来源：</span>
        <button class="mm-chip ${mmSourceType === '' ? 'active' : ''}" onclick="filterMatchmakingBySourceType('')">全部 ${totalCount}</button>
        <button class="mm-chip mm-chip-manual ${mmSourceType === '手动创建' ? 'active' : ''}" onclick="filterMatchmakingBySourceType('手动创建')">手动 ${stCount('手动创建')}</button>
        <button class="mm-chip mm-chip-invite ${mmSourceType === '邀约转化' ? 'active' : ''}" onclick="filterMatchmakingBySourceType('邀约转化')">邀约转化 ${stCount('邀约转化')}</button>
        <button class="mm-chip mm-chip-apply ${mmSourceType === '申请转化' ? 'active' : ''}" onclick="filterMatchmakingBySourceType('申请转化')">申请转化 ${stCount('申请转化')}</button>
      </span>
      <span class="mm-chip-group">
        <button class="mm-chip mm-chip-upgrade ${mmOnlyUpgrade ? 'active' : ''}" onclick="toggleMatchmakingUpgradeOnly()" title="仅看升级佣金>原佣金的高佣金合作">
          ⬆ 仅看升级佣金${mmOnlyUpgrade ? ' ✓' : ''}
        </button>
      </span>
    </div>
    ${stage || mmSourceType ? '' : '<div class="mm-tip"> 点击环节标题可单独查看该环节</div>'}
    <div class="matchmaking-kanban">
      ${stages.map((s, idx) => {
        const stageItems = stage ? (s === stage ? groupedData[s] : []) : groupedData[s];
        const isFiltered = stage && s !== stage;
        const isActive = stage && s === stage;
        const stageIcon = ['', '~', 'D', '^'][idx];
        const stageColor = ['#3b82f6', '#f59e0b', '#6366f1', '#10b981'][idx];
        const stageBgLight = ['#eff6ff', '#fffbeb', '#eef2ff', '#ecfdf5'][idx];

        return `
          <div class="kanban-column ${isFiltered ? 'kanban-column-dim' : ''} ${isActive ? 'kanban-column-active' : ''}" data-stage="${s}">
            <div class="kanban-column-header" style="background:linear-gradient(135deg, ${stageColor}, ${stageColor}dd);" onclick="filterMatchmakingByStage('${isActive ? '' : s}')">
              <div class="kanban-col-title">
                <span class="kanban-col-icon">${stageIcon}</span>
                <span class="kanban-col-name">${s}</span>
              </div>
              <span class="kanban-col-count">${getStageCount(s)}</span>
            </div>
            <div class="kanban-column-body" style="background:${stageBgLight}">
              ${stageItems.length === 0 ?
                `<div class="kanban-empty">
                  <div class="kanban-empty-icon">${stageIcon}</div>
                  <div class="kanban-empty-text">暂无「${s}」记录</div>
                </div>` :
                stageItems.map(mm => renderKanbanMatchmakingCard(mm, stageColor)).join('')
              }
            </div>
          </div>`;
      }).join('')}
    </div>
    ${listRes.success ? renderPagination(listRes.pagination, 'pageMatchmaking') : ''}`;
}

// 看板列中的紧凑卡片
// 来源类型徽标：邀约转化(蓝)/申请转化(紫)/手动创建(灰)
function renderSourceTypeBadge(sourceType, sourceLabel) {
  const t = sourceType || '手动创建';
  const label = sourceLabel || t;
  let cls = 'kanban-source kanban-source-manual';
  if (t === '邀约转化') cls = 'kanban-source kanban-source-invite';
  else if (t === '申请转化') cls = 'kanban-source kanban-source-apply';
  return `<span class="${cls}" title="撮合来源：${label}">${label}</span>`;
}

// 升级佣金"⬆ 升级"胶囊（hover 显示自定义 tooltip）
function renderUpgradeBadge(commissionRate, upgradeRate) {
  const cr = commissionRate != null && commissionRate !== '' ? parseFloat(commissionRate) : null;
  const ucr = upgradeRate != null && upgradeRate !== '' ? parseFloat(upgradeRate) : null;
  if (cr == null || ucr == null || isNaN(cr) || isNaN(ucr) || ucr <= cr) return '';
  const diff = +(ucr - cr).toFixed(2);
  // 用内联 onmouseenter/onmouseleave 直接控制，不走事件代理，最稳
  return `<span class="upgrade-star" onmouseenter="showUpgradeTip(this)" onmouseleave="hideUpgradeTip(this)">⬆ 升级<span class="upgrade-tip">达人佣金已升级<br>原 ${formatPercent(cr)} → 升级 ${formatPercent(ucr)}（+${diff}%）<br>结算请按升级佣金率核算</span></span>`;
}

function showUpgradeTip(star) {
  // 关键：tooltip 必须挂在 document.body 顶层，彻底脱离任何祖先 transform/overflow:hidden 的束缚
  // （父级 .kanban-column :hover 有 transform，会让 fixed 元素相对它定位；overflow:hidden 还会裁切）
  let tip = star.__tipEl;
  if (!tip) {
    // 第一次：从 star 内部把 tip 摘出来挂到 body
    tip = star.querySelector('.upgrade-tip');
    if (!tip) return;
    document.body.appendChild(tip);
    star.__tipEl = tip;
  }
  const rect = star.getBoundingClientRect();
  tip.style.left = (rect.left + rect.width / 2) + 'px';
  tip.style.top = (rect.top - 8) + 'px';
  tip.classList.add('is-visible');
}
function hideUpgradeTip(star) {
  if (star.__tipEl) star.__tipEl.classList.remove('is-visible');
}

function renderKanbanMatchmakingCard(mm, stageColor) {
  const upgradeBadge = renderUpgradeBadge(mm.commission_rate, mm.upgrade_commission_rate);
  const hasUpgrade = !!upgradeBadge;
  
  return `
    <div class="kanban-card" data-id="${mm.id}" style="border-top:3px solid ${stageColor}">
      <div class="kanban-card-header">
        <div class="kanban-card-parties">
          ${upgradeBadge}
          <div class="kanban-party kanban-merchant" title="${mm.merchant_company || mm.merchant_name || ''}">${mm.merchant_company || mm.merchant_name || '未知商家'}</div>
          <div class="kanban-arrow-down">⬇</div>
          <div class="kanban-party kanban-influencer" title="${mm.video_account_name || ''}">I ${mm.video_account_name || '未知达人'}</div>
        </div>
      </div>
      ${(mm.product_name || mm.demand_title) ? `
      <div class="kanban-card-product">
        ${mm.demand_kind ? `<span class="kanban-demand-kind">${mm.demand_kind}</span>` : ''}
        <div class="kanban-product-name" title="${mm.product_name || mm.demand_title}">${mm.product_name || mm.demand_title}</div>
        ${mm.stage === '开始合作' && mm.order_count != null && mm.order_count !== '' ? `
        <div class="kanban-product-meta">
          <span>D ${mm.order_count}单</span>
        </div>` : ''}
      </div>` : (mm.stage === '开始合作' && mm.order_count != null && mm.order_count !== '' ? `
      <div class="kanban-card-product">
        <div class="kanban-product-meta">
          <span>D ${mm.order_count}单</span>
        </div>
      </div>` : '')}
      ${(mm.commission_rate != null || mm.upgrade_commission_rate != null || mm.cooperation_mode) ? `
      <div class="kanban-card-commission">
        ${mm.cooperation_mode ? `<span class="kanban-tag">${mm.cooperation_mode}</span>` : ''}
        ${mm.commission_rate != null && mm.commission_rate !== '' ? `<span class="kanban-tag kanban-tag-rate">佣金 ${formatPercent(mm.commission_rate)}</span>` : ''}
        ${mm.upgrade_commission_rate != null && mm.upgrade_commission_rate !== '' ? `<span class="kanban-tag ${hasUpgrade ? 'kanban-tag-upgrade' : 'kanban-tag-rate'}">${hasUpgrade ? '⬆ ' : ''}升级 ${formatPercent(mm.upgrade_commission_rate)}</span>` : ''}
      </div>` : ''}
      <div class="kanban-card-footer">
        <span class="kanban-date">${formatDate(mm.matchmaking_time || mm.created_at)}</span>
        ${renderSourceTypeBadge(mm.source_type, mm.source)}
      </div>
      <div class="kanban-card-actions">
        <button class="btn-tiny btn-tiny-view" onclick="viewMatchmakingDetail('${mm.id}')">详情</button>
        <button class="btn-tiny btn-tiny-edit" onclick="editMatchmakingDetail('${mm.id}')">编辑</button>
        <button class="btn-tiny btn-tiny-move" onclick="editMatchmakingStage('${mm.id}','${mm.stage}')">流转</button>
        ${currentUser.role === 'admin' ? `<button class="btn-tiny btn-tiny-del" onclick="deleteMatchmaking('${mm.id}')">删除</button>` : ''}
      </div>
    </div>`;
}

function renderVerticalMatchmakingCard(mm, stageColor) {
  const stages = ['需求发布', '合作匹配', '样品寄送', '开始合作'];
  const currentIdx = stages.indexOf(mm.stage);
  const upgradeBadge = renderUpgradeBadge(mm.commission_rate, mm.upgrade_commission_rate);
  const hasUpgrade = !!upgradeBadge;
  
  return `
    <div class="matchmaking-vcard" data-id="${mm.id}">
      <div class="matchmaking-vcard-left" style="background:${stageColor}15;border-left:3px solid ${stageColor}">
        <div class="vcard-progress">
          ${stages.map((s, i) => `<div class="vcard-dot ${i <= currentIdx ? 'active' : ''}" style="${i <= currentIdx ? 'background:' + stageColor : ''}" title="${s}"></div>`).join('<div class="vcard-line"></div>')}
        </div>
      </div>
      <div class="matchmaking-vcard-content">
        <div class="vcard-header">
          <div class="vcard-parties">
            ${upgradeBadge}
            <span class="vcard-merchant">${mm.merchant_company || mm.merchant_name || '未知商家'}</span>
            <span class="vcard-arrow">⟷</span>
            <span class="vcard-influencer">I ${mm.video_account_name || '未知达人'}</span>
          </div>
          <div class="vcard-meta">
            <span class="vcard-date">${formatDate(mm.created_at)}</span>
            ${getStageBadge(mm.stage)}
          </div>
        </div>
        <div class="vcard-details">
          <div class="vcard-detail-item"><span class="detail-label">关联需求</span><span class="detail-value">${mm.demand_title || '无'}</span></div>
          <div class="vcard-detail-item"><span class="detail-label">来源</span><span class="detail-value">${mm.source || '-'}</span></div>
          ${mm.product_name ? `<div class="vcard-detail-item"><span class="detail-label"> 商品名称</span><span class="detail-value">${mm.product_name}</span></div>` : ''}
          ${mm.influencer_account ? `<div class="vcard-detail-item"><span class="detail-label">达人账号</span><span class="detail-value">${mm.influencer_account}</span></div>` : ''}
          ${mm.product_price != null && mm.product_price !== '' ? `<div class="vcard-detail-item"><span class="detail-label">$ 商品价格</span><span class="detail-value">¥${mm.product_price}</span></div>` : ''}
          ${mm.order_count != null && mm.order_count !== '' ? `<div class="vcard-detail-item"><span class="detail-label">D 订单量</span><span class="detail-value">${mm.order_count}</span></div>` : ''}
          ${mm.cooperation_mode ? `<div class="vcard-detail-item"><span class="detail-label">~ 合作模式</span><span class="detail-value">${mm.cooperation_mode}</span></div>` : ''}
          ${mm.commission_rate != null && mm.commission_rate !== '' ? `<div class="vcard-detail-item"><span class="detail-label"> 佣金率</span><span class="detail-value">${formatPercent(mm.commission_rate)}</span></div>` : ''}
          ${mm.upgrade_commission_rate != null && mm.upgrade_commission_rate !== '' ? `<div class="vcard-detail-item"><span class="detail-label">${hasUpgrade ? '⬆ 升级佣金' : '升级佣金'}</span><span class="detail-value" style="${hasUpgrade ? 'color:#dc2626;font-weight:700' : ''}">${formatPercent(mm.upgrade_commission_rate)}</span></div>` : ''}
          ${mm.gmv != null && mm.gmv !== '' ? `<div class="vcard-detail-item"><span class="detail-label">% GMV</span><span class="detail-value">¥${mm.gmv}</span></div>` : ''}
          ${mm.matchmaking_time ? `<div class="vcard-detail-item"><span class="detail-label">⏰ 撮合时间</span><span class="detail-value">${formatDate(mm.matchmaking_time)}</span></div>` : ''}
          <div class="vcard-detail-item"><span class="detail-label">备注</span><span class="detail-value">${mm.notes || '-'}</span></div>
          ${mm.sample_info ? `<div class="vcard-detail-item"><span class="detail-label">样品信息</span><span class="detail-value">${mm.sample_info}</span></div>` : ''}
          ${mm.cooperation_details ? `<div class="vcard-detail-item"><span class="detail-label">合作详情</span><span class="detail-value">${mm.cooperation_details}</span></div>` : ''}
        </div>
        <div class="vcard-actions">
          <button class="btn btn-sm btn-outline" onclick="viewMatchmakingDetail('${mm.id}')"> 详情</button>
          <button class="btn btn-sm btn-primary" onclick="editMatchmakingDetail('${mm.id}')">编辑</button>
          <button class="btn btn-sm btn-warning" onclick="editMatchmakingStage('${mm.id}','${mm.stage}')">⏭ 流转</button>
          <button class="btn btn-sm btn-danger" onclick="deleteMatchmaking('${mm.id}')"></button>
        </div>
      </div>
    </div>`;
}

function filterMatchmakingByStage(stage) { renderMatchmaking(1, 20, stage, ''); }
function searchMatchmaking() { renderMatchmaking(1, 20, '', document.getElementById('mm-search').value); }
function pageMatchmaking(page, pageSize) { renderMatchmaking(page, pageSize || 20); }
function filterMatchmakingBySourceType(t) { mmSourceType = t; renderMatchmaking(1, 20, '', ''); }
function toggleMatchmakingUpgradeOnly() { mmOnlyUpgrade = !mmOnlyUpgrade; renderMatchmaking(1, 20, '', ''); }

async function viewMatchmakingDetail(id) {
  const res = await fetchAPI(`/cooperation/matchmaking/${id}`);
  if (!res.success) { showToast('获取详情失败', 'error'); return; }
  const mm = res.data;
  const stages = ['需求发布', '合作匹配', '样品寄送', '开始合作'];
  const upgradeBadge = renderUpgradeBadge(mm.commission_rate, mm.upgrade_commission_rate);
  const hasUpgrade = !!upgradeBadge;
  
  openModal('撮合详情', `
    <div style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        ${upgradeBadge}
        ${getStageBadge(mm.stage)}
        ${renderSourceTypeBadge(mm.source_type, mm.source)}
        <strong>${mm.merchant_company || mm.merchant_name || ''}</strong> ⟷ <strong style="color:var(--primary-600)">${mm.video_account_name || ''}</strong>
      </div>
      ${mm.cooperation ? `
      <div style="margin-bottom:12px;padding:10px 12px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;font-size:12px">
        <div style="font-weight:600;color:#92400e;margin-bottom:4px">原始${mm.cooperation.initiative === 'merchant' ? '商家邀约' : '达人申请'}（${formatDate(mm.cooperation.created_at)}）</div>
        <div style="color:#78350f">${mm.cooperation.message ? `留言："${mm.cooperation.message}"` : '无留言'} · 状态：${mm.cooperation.status === 'confirmed' ? '已确认' : mm.cooperation.status}</div>
      </div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;background:var(--primary-light);padding:12px;border-radius:8px">
        <div><span style="color:var(--gray-400)">需求：</span>${mm.demand_title ? `${mm.demand_kind ? `<span class="kanban-demand-kind" style="margin-right:6px">${mm.demand_kind}</span>` : ''}${mm.demand_title}` : '-'}</div>
        <div><span style="color:var(--gray-400)">来源：</span>${mm.source || '-'}</div>
        <div><span style="color:var(--gray-400)">商家归属销售：</span>${mm.merchant_sales_owner_name ? `<span style="color:var(--primary-700);font-weight:600">${mm.merchant_sales_owner_name}</span><span style="display:inline-block;margin-left:6px;padding:1px 6px;background:#dcfce7;color:#166534;border-radius:10px;font-size:11px">销售</span>` : '<span style="color:var(--gray-400)">未分配</span>'}</div>
        <div><span style="color:var(--gray-400)">I 达人归属销售：</span>${mm.influencer_sales_owner_name ? `<span style="color:var(--primary-700);font-weight:600">${mm.influencer_sales_owner_name}</span><span style="display:inline-block;margin-left:6px;padding:1px 6px;background:#dcfce7;color:#166534;border-radius:10px;font-size:11px">销售</span>` : (mm.inf_sales_owner_text ? mm.inf_sales_owner_text : '<span style="color:var(--gray-400)">未分配</span>')}</div>
        <div><span style="color:var(--gray-400)">达人等级：</span>${mm.inf_level || '-'}</div>
        <div><span style="color:var(--gray-400)">达人粉丝：</span>${formatNumber(mm.inf_fans)}</div>
        <div><span style="color:var(--gray-400)"> 商品名称：</span>${mm.product_name || '-'}</div>
        <div><span style="color:var(--gray-400)">达人账号：</span>${mm.influencer_account || '-'}</div>
        <div><span style="color:var(--gray-400)">$ 商品价格：</span>${mm.product_price != null && mm.product_price !== '' ? '¥' + mm.product_price : '-'}</div>
        <div><span style="color:var(--gray-400)">D 订单量：</span>${mm.order_count != null && mm.order_count !== '' ? mm.order_count : '-'}</div>
        <div><span style="color:var(--gray-400)">~ 合作模式：</span>${mm.cooperation_mode || '-'}</div>
        <div><span style="color:var(--gray-400)"> 佣金率：</span>${mm.commission_rate != null && mm.commission_rate !== '' ? formatPercent(mm.commission_rate) : '-'}</div>
        <div><span style="color:var(--gray-400)">${hasUpgrade ? '⬆ 升级佣金' : '升级佣金'}：</span><span style="${hasUpgrade ? 'color:#dc2626;font-weight:700' : ''}">${mm.upgrade_commission_rate != null && mm.upgrade_commission_rate !== '' ? formatPercent(mm.upgrade_commission_rate) : '-'}</span></div>
        <div><span style="color:var(--gray-400)">% GMV：</span>${mm.gmv != null && mm.gmv !== '' ? '¥' + mm.gmv : '-'}<span style="color:var(--gray-400);font-size:11px;margin-left:6px">（价格×订单量自动计算）</span></div>
        <div><span style="color:var(--gray-400)">⏰ 撮合时间：</span>${mm.matchmaking_time ? formatDate(mm.matchmaking_time) : '-'}</div>
        <div><span style="color:var(--gray-400)">备注：</span>${mm.notes || '-'}</div>
        <div><span style="color:var(--gray-400)">样品信息：</span>${mm.sample_info || '-'}</div>
        <div style="grid-column:span 2"><span style="color:var(--gray-400)">合作详情：</span>${mm.cooperation_details || '-'}</div>
      </div>
    </div>
    <h4 style="font-size:14px;color:var(--primary-700);margin-bottom:10px">流转历史</h4>
    <div style="border-left:3px solid var(--primary-300);padding-left:16px">
      ${(mm.history || []).map(h => `
        <div style="margin-bottom:12px;position:relative">
          <div style="position:absolute;left:-22px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--primary-500)"></div>
          <div style="font-size:12px;color:var(--gray-400)">${formatDate(h.created_at)} · ${h.operator || '系统'}</div>
          <div style="font-size:13px;font-weight:600;color:var(--gray-700)">${h.stage}</div>
          <div style="font-size:12px;color:var(--gray-500)">${h.notes || ''}</div>
        </div>
      `).join('')}
    </div>
  `, '<button class="btn btn-outline" onclick="closeModal()">关闭</button>');
}

// 编辑撮合详情
async function editMatchmakingDetail(id) {
  const res = await fetchAPI(`/cooperation/matchmaking/${id}`);
  if (!res.success) { showToast('获取详情失败', 'error'); return; }
  const mm = res.data;
  const stages = ['需求发布', '合作匹配', '样品寄送', '开始合作'];
  
  openModal('编辑撮合详情', `
    <div class="form-group">
      <label>当前环节</label>
      <select id="edit-mm-stage">
        ${stages.map(s => `<option value="${s}" ${mm.stage === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>来源</label>
      <select id="edit-mm-source">
        <option value="手动创建" ${mm.source === '手动创建' ? 'selected' : ''}>手动创建</option>
        <option value="系统推荐" ${mm.source === '系统推荐' ? 'selected' : ''}>系统推荐</option>
        <option value="商家邀请" ${mm.source === '商家邀请' ? 'selected' : ''}>商家邀请</option>
        <option value="达人接单" ${mm.source === '达人接单' ? 'selected' : ''}>达人接单</option>
      </select>
    </div>
    <h4 style="font-size:13px;color:var(--primary-700);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px dashed var(--primary-200)"> 商品信息</h4>
    <div class="form-grid-2">
      ${renderSuggestInput({ id:'edit-mm-product-name', label:'商品名称', value: mm.product_name || '', placeholder:'如：小学数学思维训练', type:'product' })}
      ${renderSuggestInput({ id:'edit-mm-influencer-account', label:'达人账号', value: mm.influencer_account || '', placeholder:'如：@小雨老师', type:'influencer' })}
      <div class="form-group"><label>商品价格(元)</label><input type="number" step="0.01" id="edit-mm-product-price" value="${mm.product_price != null ? mm.product_price : ''}" placeholder="如：99.80" oninput="recalcGmv('edit-mm')"></div>
      <div class="form-group"><label>D 订单量</label><input type="number" step="1" min="0" id="edit-mm-order-count" value="${mm.order_count != null ? mm.order_count : ''}" placeholder="如：120" oninput="recalcGmv('edit-mm')"></div>
      <div class="form-group"><label>合作模式</label>
        <select id="edit-mm-cooperation-mode">
          <option value="">-- 请选择 --</option>
          ${['纯佣','投流+分佣','互选','原生二次推广'].map(x => `<option ${mm.cooperation_mode === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>佣金率(%)</label><input type="number" step="0.01" id="edit-mm-commission-rate" value="${mm.commission_rate != null ? mm.commission_rate : ''}" placeholder="如：25 表示 25%" oninput="checkUpgradeStar('edit-mm')"></div>
      <div class="form-group"><label>⬆ 升级佣金(%) <span style="color:var(--gray-400);font-weight:normal;font-size:12px">大于原佣金时自动标记升级</span></label><input type="number" step="0.01" id="edit-mm-upgrade-commission-rate" value="${mm.upgrade_commission_rate != null ? mm.upgrade_commission_rate : ''}" placeholder="如：30 表示升级后30%" oninput="checkUpgradeStar('edit-mm')"></div>
      <div class="form-group"><label>GMV(元) <span style="color:var(--primary-600);font-weight:normal;font-size:12px">自动计算 = 价格 × 订单量</span></label><input type="number" step="0.01" id="edit-mm-gmv" value="${mm.gmv != null ? mm.gmv : ''}" placeholder="自动计算或手动输入" style="background:#f8fafc"></div>
      <div class="form-group" style="grid-column:1/-1">
        <label>撮合时间</label>
        <input type="datetime-local" id="edit-mm-matchmaking-time" value="${mm.matchmaking_time ? formatDateTimeLocal(mm.matchmaking_time) : ''}">
      </div>
      <div id="edit-mm-upgrade-preview" class="upgrade-preview" style="grid-column:1/-1;display:${(mm.upgrade_commission_rate != null && mm.commission_rate != null && parseFloat(mm.upgrade_commission_rate)> parseFloat(mm.commission_rate)) ? 'flex' : 'none'}">
        <span class="upgrade-star">⬆ 升级</span>
        <span>升级佣金高于原佣金，该撮合将显示红色升级标签</span>
      </div>
    </div>
    <h4 style="font-size:13px;color:var(--primary-700);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px dashed var(--primary-200)">其他信息</h4>
    <div class="form-group">
      <label>备注说明</label>
      <textarea id="edit-mm-notes" rows="2" placeholder="撮合备注...">${mm.notes || ''}</textarea>
    </div>
    <div class="form-group">
      <label>D 样品信息（快递单号、收货地址等）</label>
      <textarea id="edit-mm-sample" rows="2" placeholder="如：顺丰SF1234567890，寄送地址xxx">${mm.sample_info || ''}</textarea>
    </div>
    <div class="form-group">
      <label>~ 合作详情（合作方式、佣金比例、合作周期等）</label>
      <textarea id="edit-mm-cooperation" rows="3" placeholder="如：纯佣合作，佣金25%，合作周期1个月">${mm.cooperation_details || ''}</textarea>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="confirmEditMatchmaking('${id}')">保存修改</button>
  `);
}

// 将后端 datetime 字符串转为 datetime-local 输入控件格式
function formatDateTimeLocal(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ===================== 撮合联想下拉组件 =====================
// 渲染一个可输入 + 模糊搜索 + 下拉选择的字段，用于商品名称 / 达人账号
// opts:
//   id: input 元素 id
//   label: 字段名
//   value: 初始值
//   placeholder: 占位符
//   type: 'product' | 'influencer'
//   onPick: function(item) 选中候选后回调（可选）
function renderSuggestInput({ id, label, value = '', placeholder = '', type = 'product', extra = '' }) {
  return `
    <div class="form-group suggest-wrap" style="position:relative">
      <label>${label} <span style="color:var(--gray-400);font-weight:normal;font-size:12px">（支持模糊搜索，下拉可选）</span></label>
      <input id="${id}" value="${(value || '').replace(/"/g, '&quot;')}" placeholder="${placeholder}"
             autocomplete="off"
             oninput="openSuggestDropdown('${id}','${type}')"
             onfocus="openSuggestDropdown('${id}','${type}')"
             onblur="setTimeout(()=>closeSuggestDropdown('${id}'), 200)">
      <div id="${id}-dd" class="suggest-dropdown" style="display:none"></div>
      ${extra}
    </div>`;
}

// 候选缓存（同一会话内复用，避免重复请求）
const __suggestCache = { product: null, influencer: null, productTs: 0, influencerTs: 0 };

async function loadSuggestData(type) {
  const now = Date.now();
  const cacheKey = type;
  const tsKey = type + 'Ts';
  // 30秒内复用缓存
  if (__suggestCache[cacheKey] && (now - __suggestCache[tsKey] < 30000)) {
    return __suggestCache[cacheKey];
  }
  const path = type === 'product'
    ? '/cooperation/matchmaking/suggest/products?limit=200'
    : '/cooperation/matchmaking/suggest/influencers?limit=300';
  const res = await fetchAPI(path);
  const data = (res && res.success) ? (res.data || []) : [];
  __suggestCache[cacheKey] = data;
  __suggestCache[tsKey] = now;
  return data;
}

async function openSuggestDropdown(inputId, type) {
  const input = document.getElementById(inputId);
  const dd = document.getElementById(inputId + '-dd');
  if (!input || !dd) return;
  const kw = (input.value || '').trim().toLowerCase();
  const list = await loadSuggestData(type);
  // 本地模糊过滤
  const filtered = kw
    ? list.filter(x => {
        const name = (x.name || '').toLowerCase();
        const official = (x.official || '').toLowerCase();
        return name.includes(kw) || official.includes(kw);
      })
    : list;
  const top = filtered.slice(0, 50);
  if (top.length === 0) {
    dd.innerHTML = `<div class="suggest-empty">暂无匹配结果，可直接输入新值</div>`;
  } else {
    dd.innerHTML = top.map(item => {
      const badgeColor = item.source === '历史撮合' ? '#f59e0b'
        : item.source === '达人广场' ? '#10b981'
        : item.source === '达人货盘' ? '#8b5cf6'
        : item.source === '图书需求' ? '#2563eb'
        : item.source === '课程需求' ? '#ec4899' : '#6b7280';
      const meta = type === 'influencer'
        ? `<span class="suggest-meta">${item.level ? '⭐' + item.level + ' · ' : ''}${item.fans ? 'N' + (item.fans>= 10000 ? (item.fans/10000).toFixed(1) + 'w' : item.fans) : ''}${item.region ? ' · ' + item.region : ''}</span>`
        : '';
      const safeName = (item.name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return `<div class="suggest-item" onmousedown="pickSuggest('${inputId}','${safeName}')">
        <span class="suggest-name">${item.name}</span>
        ${meta}
        <span class="suggest-badge" style="background:${badgeColor}15;color:${badgeColor};border:1px solid ${badgeColor}40">${item.source || ''}</span>
      </div>`;
    }).join('');
  }
  dd.style.display = 'block';
}

function closeSuggestDropdown(inputId) {
  const dd = document.getElementById(inputId + '-dd');
  if (dd) dd.style.display = 'none';
}

function pickSuggest(inputId, value) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  closeSuggestDropdown(inputId);
}
// =============================================================

async function confirmEditMatchmaking(id) {
  const stage = document.getElementById('edit-mm-stage').value;
  const source = document.getElementById('edit-mm-source').value;
  const notes = document.getElementById('edit-mm-notes').value;
  const sample_info = document.getElementById('edit-mm-sample').value;
  const cooperation_details = document.getElementById('edit-mm-cooperation').value;
  const product_name = document.getElementById('edit-mm-product-name').value.trim();
  const influencer_account = document.getElementById('edit-mm-influencer-account').value.trim();
  const product_price = document.getElementById('edit-mm-product-price').value;
  const order_count = document.getElementById('edit-mm-order-count').value;
  const cooperation_mode = document.getElementById('edit-mm-cooperation-mode').value;
  const commission_rate = document.getElementById('edit-mm-commission-rate').value;
  const upgrade_commission_rate = document.getElementById('edit-mm-upgrade-commission-rate').value;
  const gmv = document.getElementById('edit-mm-gmv').value;
  const mtLocal = document.getElementById('edit-mm-matchmaking-time').value;
  // datetime-local 形如 2026-04-30T14:30，转换为 SQL datetime 格式
  const matchmaking_time = mtLocal ? mtLocal.replace('T', ' ') + ':00' : '';

  const res = await fetchAPI(`/cooperation/matchmaking/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      stage, source, notes, sample_info, cooperation_details,
      product_name, influencer_account, product_price, order_count,
      cooperation_mode, commission_rate, upgrade_commission_rate, gmv, matchmaking_time
    })
  });
  if (res.success) {
    showToast('撮合详情已更新');
    closeModal();
    renderMatchmaking();
  } else {
    showToast(res.error || '更新失败', 'error');
  }
}

// GMV 自动计算
function recalcGmv(prefix) {
  const priceEl = document.getElementById(`${prefix}-product-price`);
  const orderEl = document.getElementById(`${prefix}-order-count`);
  const gmvEl = document.getElementById(`${prefix}-gmv`);
  if (!priceEl || !orderEl || !gmvEl) return;
  const price = parseFloat(priceEl.value);
  const order = parseInt(orderEl.value);
  if (!isNaN(price) && !isNaN(order)) {
    gmvEl.value = (price * order).toFixed(2);
  }
}

// 升级佣金> 佣金时，实时提示红星
function checkUpgradeStar(prefix) {
  const crEl = document.getElementById(`${prefix}-commission-rate`);
  const ucrEl = document.getElementById(`${prefix}-upgrade-commission-rate`);
  const preview = document.getElementById(`${prefix}-upgrade-preview`);
  if (!crEl || !ucrEl || !preview) return;
  const cr = parseFloat(crEl.value);
  const ucr = parseFloat(ucrEl.value);
  if (!isNaN(cr) && !isNaN(ucr) && ucr> cr) {
    preview.style.display = 'flex';
  } else {
    preview.style.display = 'none';
  }
}

async function editMatchmakingStage(id, currentStage) {
  const stages = ['需求发布', '合作匹配', '样品寄送', '开始合作'];
  const currentIdx = stages.indexOf(currentStage);
  const nextStage = stages[Math.min(currentIdx + 1, stages.length - 1)];
  
  openModal('⏭ 流转环节', `
    <div class="form-group">
      <label>选择目标环节</label>
      <select id="mm-target-stage">
        ${stages.map(s => `<option value="${s}" ${s === nextStage ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>备注说明</label>
      <textarea id="mm-stage-notes" rows="3" placeholder="填写流转说明..."></textarea>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="confirmStageChange('${id}')">确认流转</button>
  `);
}

async function confirmStageChange(id) {
  const stage = document.getElementById('mm-target-stage').value;
  const notes = document.getElementById('mm-stage-notes').value;
  const res = await fetchAPI(`/cooperation/matchmaking/${id}/stage`, {
    method: 'PUT', body: JSON.stringify({ stage, notes })
  });
  if (res.success) { showToast(res.message); closeModal(); renderMatchmaking(); }
  else { showToast(res.error || '操作失败', 'error'); }
}

async function deleteMatchmaking(id) {
  if (!confirm('确定删除此撮合记录？')) return;
  await fetchAPI(`/cooperation/matchmaking/${id}`, { method: 'DELETE' });
  showToast('删除成功'); renderMatchmaking();
}

async function showCreateMatchmaking() {
  // 获取商家和达人列表（已删除商家由后端默认过滤）
  const [merchantRes, infRes] = await Promise.all([
    fetchAPI('/merchants?pageSize=9999'),
    fetchAPI('/influencers?pageSize=9999')
  ]);
  const merchants = (merchantRes && merchantRes.data) || [];
  const influencers = (infRes && infRes.data) || [];
  if (merchants.length === 0 || influencers.length === 0) {
    showToast('商家或达人数据加载失败，请刷新重试', 'error');
    return;
  }

  openModal('新建撮合', `
    <div class="form-group">
      <label>选择商家 *</label>
      <select id="mm-merchant">
        <option value="">请选择</option>
        ${merchants.map(m => `<option value="${m.id}">${m.name || ''}${m.company ? ' (' + m.company + ')' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>选择达人 *</label>
      <select id="mm-influencer">
        <option value="">请选择</option>
        ${influencers.map(i => `<option value="${i.id}">${i.video_account_name || i.official_account_name || i.id}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>来源</label>
      <select id="mm-source">
        <option value="手动创建">手动创建</option>
        <option value="系统推荐">系统推荐</option>
        <option value="商家邀请">商家邀请</option>
        <option value="达人接单">达人接单</option>
      </select>
    </div>
    <div class="form-group">
      <label>当前环节</label>
      <select id="mm-stage">
        <option value="需求发布">需求发布</option>
        <option value="合作匹配">合作匹配</option>
        <option value="样品寄送">样品寄送</option>
        <option value="开始合作">开始合作</option>
      </select>
    </div>
    <h4 style="font-size:13px;color:var(--primary-700);margin:14px 0 8px;padding-bottom:6px;border-bottom:1px dashed var(--primary-200)"> 商品信息（选填）</h4>
    <div class="form-grid-2">
      ${renderSuggestInput({ id:'mm-product-name', label:'商品名称', value:'', placeholder:'如：小学数学思维训练', type:'product' })}
      ${renderSuggestInput({ id:'mm-influencer-account', label:'达人账号', value:'', placeholder:'如：@小雨老师', type:'influencer' })}
      <div class="form-group"><label>商品价格(元)</label><input type="number" step="0.01" id="mm-product-price" placeholder="如：99.80" oninput="recalcGmv('mm')"></div>
      <div class="form-group"><label>D 订单量</label><input type="number" step="1" min="0" id="mm-order-count" placeholder="如：120" oninput="recalcGmv('mm')"></div>
      <div class="form-group"><label>合作模式</label>
        <select id="mm-cooperation-mode">
          <option value="">-- 请选择 --</option>
          ${['纯佣','投流+分佣','互选','原生二次推广'].map(x => `<option>${x}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>佣金率(%)</label><input type="number" step="0.01" id="mm-commission-rate" placeholder="如：25" oninput="checkUpgradeStar('mm')"></div>
      <div class="form-group"><label>⬆ 升级佣金(%) <span style="color:var(--gray-400);font-weight:normal;font-size:12px">大于原佣金时自动标记升级</span></label><input type="number" step="0.01" id="mm-upgrade-commission-rate" placeholder="如：30" oninput="checkUpgradeStar('mm')"></div>
      <div class="form-group"><label>GMV(元) <span style="color:var(--primary-600);font-weight:normal;font-size:12px">自动计算 = 价格 × 订单量</span></label><input type="number" step="0.01" id="mm-gmv" placeholder="自动计算或手动输入" style="background:#f8fafc"></div>
      <div class="form-group" style="grid-column:1/-1">
        <label>撮合时间</label>
        <input type="datetime-local" id="mm-matchmaking-time">
      </div>
      <div id="mm-upgrade-preview" class="upgrade-preview" style="grid-column:1/-1;display:none">
        <span class="upgrade-star">⬆ 升级</span>
        <span>升级佣金高于原佣金，该撮合将显示红色升级标签</span>
      </div>
    </div>
    <div class="form-group">
      <label>备注</label>
      <textarea id="mm-notes" rows="2" placeholder="备注说明"></textarea>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="confirmCreateMatchmaking()">创建</button>
  `);
}

async function confirmCreateMatchmaking() {
  const merchant_id = document.getElementById('mm-merchant').value;
  const influencer_id = document.getElementById('mm-influencer').value;
  if (!merchant_id || !influencer_id) { showToast('请选择商家和达人', 'error'); return; }
  const mtLocal = document.getElementById('mm-matchmaking-time').value;
  const matchmaking_time = mtLocal ? mtLocal.replace('T', ' ') + ':00' : '';
  
  const res = await fetchAPI('/cooperation/matchmaking', {
    method: 'POST',
    body: JSON.stringify({
      merchant_id, influencer_id,
      source: document.getElementById('mm-source').value,
      stage: document.getElementById('mm-stage').value,
      notes: document.getElementById('mm-notes').value,
      product_name: document.getElementById('mm-product-name').value.trim(),
      influencer_account: document.getElementById('mm-influencer-account').value.trim(),
      product_price: document.getElementById('mm-product-price').value,
      order_count: document.getElementById('mm-order-count').value,
      cooperation_mode: document.getElementById('mm-cooperation-mode').value,
      commission_rate: document.getElementById('mm-commission-rate').value,
      upgrade_commission_rate: document.getElementById('mm-upgrade-commission-rate').value,
      gmv: document.getElementById('mm-gmv').value,
      matchmaking_time,
      operator_id: currentUser.role === 'admin' ? currentUser.id : undefined
    })
  });
  if (res.success) { showToast('撮合记录创建成功'); closeModal(); renderMatchmaking(); }
  else { showToast(res.error || '创建失败', 'error'); }
}

// ============ 个人中心 ============
async function renderProfile() {
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';
  
  if (currentUser.role === 'merchant') {
    await renderMerchantProfile();
  } else if (currentUser.role === 'influencer') {
    await renderInfluencerProfile();
  }
}

async function renderMerchantProfile() {
  const container = document.getElementById('page-container');
  const [sentRes, receivedRes] = await Promise.all([
    fetchAPI(`/cooperation/merchant/${currentUser.id}?type=sent`),
    fetchAPI(`/cooperation/merchant/${currentUser.id}?type=received`)
  ]);
  
  const sentList = sentRes.success ? sentRes.data : [];
  const receivedList = receivedRes.success ? receivedRes.data : [];
  const pendingReceived = receivedList.filter(c => c.status === 'pending');
  const confirmedList = [...sentList, ...receivedList].filter(c => c.status === 'confirmed');
  
  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header"><h2> 个人中心</h2></div>
    <div class="profile-card">
      <div class="profile-header">
        <div class="profile-avatar"><div>
        <div class="profile-info">
          <h3>${currentUser.name}</h3>
          <p>${currentUser.company || ''} · 商家</p>
        </div>
      </div>
      <div class="profile-stats">
        <div class="profile-stat-item"><div class="profile-stat-value">${sentList.length}</div><div class="profile-stat-label">发起邀约</div></div>
        <div class="profile-stat-item"><div class="profile-stat-value">${pendingReceived.length}</div><div class="profile-stat-label">待处理申请</div></div>
        <div class="profile-stat-item"><div class="profile-stat-value">${confirmedList.length}</div><div class="profile-stat-label">已确认合作</div></div>
      </div>
    </div>
    
    ${pendingReceived.length> 0 ? `
      <div class="section-title">收到的带货申请 <span class="count-badge">${pendingReceived.length}</span></div>
      ${pendingReceived.map(c => `
        <div class="coop-card">
          <div class="coop-card-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="level-badge" style="background:${getLevelColor(c.level)}">${c.level || '-'}</span>
              <strong>${c.video_account_name || '未知达人'}</strong>
            </div>
            ${getStatusBadge(c.status)}
          </div>
          <div class="coop-card-body">
            <p> 留言：${c.message || '无'}</p>
            <p> 品类：${c.video_category_track || '-'} · 粉丝：${formatNumber(c.fans_count)}</p>
            <p> 时间：${formatDate(c.created_at)}</p>
          </div>
          <div class="coop-card-footer">
            <button class="btn btn-sm btn-outline" onclick="viewInfluencerDetail('${c.influencer_id}')">查看详情</button>
            <button class="btn btn-sm btn-success" onclick="confirmCooperation('${c.id}')">V 同意合作</button>
            <button class="btn btn-sm btn-danger" onclick="rejectCooperation('${c.id}')">拒绝</button>
          </div>
        </div>
      `).join('')}
    ` : ''}
    
    <div class="section-title" style="margin-top:20px"> 发起的邀约 <span class="count-badge">${sentList.length}</span></div>
    ${sentList.length === 0 ? '<p style="color:var(--gray-400);font-size:13px;padding:12px">暂无发起的邀约</p>' :
      sentList.map(c => `
        <div class="coop-card">
          <div class="coop-card-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="level-badge" style="background:${getLevelColor(c.level)}">${c.level || '-'}</span>
              <strong>${c.video_account_name || '未知达人'}</strong>
            </div>
            ${getStatusBadge(c.status)}
          </div>
          <div class="coop-card-body">
            <p> ${c.message || '无留言'} · ${formatDate(c.created_at)}</p>
          </div>
        </div>
      `).join('')}
    
    <div class="section-title" style="margin-top:20px">V 已确认合作 <span class="count-badge">${confirmedList.length}</span></div>
    ${confirmedList.length === 0 ? '<p style="color:var(--gray-400);font-size:13px;padding:12px">暂无确认的合作</p>' :
      confirmedList.map(c => `
        <div class="coop-card" style="border-left:3px solid var(--success)">
          <div class="coop-card-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="level-badge" style="background:${getLevelColor(c.level)}">${c.level || '-'}</span>
              <strong>${c.video_account_name || '未知达人'}</strong>
            </div>
            <span class="badge badge-confirmed">已合作</span>
          </div>
          <div class="coop-card-body">
            <p> ${c.message || ''} · ${formatDate(c.updated_at)}</p>
          </div>
        </div>
      `).join('')}
  `;
}

async function renderInfluencerProfile() {
  const container = document.getElementById('page-container');
  const [sentRes, receivedRes] = await Promise.all([
    fetchAPI(`/cooperation/influencer/${currentUser.id}?type=sent`),
    fetchAPI(`/cooperation/influencer/${currentUser.id}?type=received`)
  ]);
  
  const sentList = sentRes.success ? sentRes.data : [];
  const receivedList = receivedRes.success ? receivedRes.data : [];
  const pendingReceived = receivedList.filter(c => c.status === 'pending');
  const confirmedList = [...sentList, ...receivedList].filter(c => c.status === 'confirmed');
  
  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header"><h2> 个人中心</h2></div>
    <div class="profile-card">
      <div class="profile-header">
        <div class="profile-avatar">⭐</div>
        <div class="profile-info">
          <h3>${currentUser.name}</h3>
          <p>达人 · ${currentUser.video_category_track || ''}</p>
        </div>
      </div>
      <div class="profile-stats">
        <div class="profile-stat-item"><div class="profile-stat-value">${sentList.length}</div><div class="profile-stat-label">发起的带货申请</div></div>
        <div class="profile-stat-item"><div class="profile-stat-value">${pendingReceived.length}</div><div class="profile-stat-label">待处理邀约</div></div>
        <div class="profile-stat-item"><div class="profile-stat-value">${confirmedList.length}</div><div class="profile-stat-label">已确认合作</div></div>
      </div>
    </div>
    
    ${pendingReceived.length> 0 ? `
      <div class="section-title">收到的邀请合作 <span class="count-badge">${pendingReceived.length}</span></div>
      ${pendingReceived.map(c => `
        <div class="coop-card">
          <div class="coop-card-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span><span>
              <strong>${c.merchant_company || c.merchant_name || '未知商家'}</strong>
            </div>
            ${getStatusBadge(c.status)}
          </div>
          <div class="coop-card-body">
            <p> 留言：${c.message || '无'}</p>
            ${c.demand_title ? `<p>D 需求：${c.demand_title}</p>` : ''}
            <p> 时间：${formatDate(c.created_at)}</p>
          </div>
          <div class="coop-card-footer">
            ${c.demand_id ? `<button class="btn btn-sm btn-outline" onclick="viewDemandDetail('${c.demand_id}')">查看需求</button>` : ''}
            <button class="btn btn-sm btn-success" onclick="confirmCooperation('${c.id}')">V 确认合作</button>
            <button class="btn btn-sm btn-danger" onclick="rejectCooperation('${c.id}')">拒绝</button>
          </div>
        </div>
      `).join('')}
    ` : ''}
    
    <div class="section-title" style="margin-top:20px"> 发起的带货申请 <span class="count-badge">${sentList.length}</span></div>
    ${sentList.length === 0 ? '<p style="color:var(--gray-400);font-size:13px;padding:12px">暂无发起的申请</p>' :
      sentList.map(c => `
        <div class="coop-card">
          <div class="coop-card-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span><span>
              <strong>${c.merchant_company || c.merchant_name || '未知商家'}</strong>
            </div>
            ${getStatusBadge(c.status)}
          </div>
          <div class="coop-card-body">
            <p> ${c.message || '无留言'} · ${formatDate(c.created_at)}</p>
          </div>
        </div>
      `).join('')}
    
    <div class="section-title" style="margin-top:20px">V 已确认合作 <span class="count-badge">${confirmedList.length}</span></div>
    ${confirmedList.length === 0 ? '<p style="color:var(--gray-400);font-size:13px;padding:12px">暂无确认的合作</p>' :
      confirmedList.map(c => `
        <div class="coop-card" style="border-left:3px solid var(--success)">
          <div class="coop-card-header">
            <div style="display:flex;align-items:center;gap:8px">
              <span><span>
              <strong>${c.merchant_company || c.merchant_name || '未知商家'}</strong>
            </div>
            <span class="badge badge-confirmed">已合作</span>
          </div>
          <div class="coop-card-body">
            <p> ${c.message || ''} · ${formatDate(c.updated_at)}</p>
          </div>
        </div>
      `).join('')}
  `;
}

// 确认/拒绝合作
async function confirmCooperation(id) {
  if (!confirm('确认同意合作？\n\n确认后，运营会自动收到一条「合作匹配」阶段的撮合工单进行后续跟进。')) return;
  const res = await fetchAPI(`/cooperation/confirm/${id}`, { method: 'PUT' });
  if (res.success) {
    showToast(res.message || '已确认合作！');
    renderProfile();
    checkNotifications();
  } else { showToast(res.error || '操作失败', 'error'); }
}

async function rejectCooperation(id) {
  if (!confirm('确定拒绝？')) return;
  const res = await fetchAPI(`/cooperation/reject/${id}`, { method: 'PUT' });
  if (res.success) { showToast('已拒绝'); renderProfile(); checkNotifications(); }
  else { showToast(res.error || '操作失败', 'error'); }
}

// 查看达人详情
async function viewInfluencerDetail(influencerId) {
  const res = await fetchAPI(`/influencers/${influencerId}`);
  if (!res.success) { showToast('获取详情失败', 'error'); return; }
  const inf = res.data;
  
  openModal('达人详情', `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <span class="level-badge" style="background:${getLevelColor(inf.level)};width:32px;height:32px;line-height:32px;font-size:14px">${inf.level || '-'}</span>
      <div>
        <h4 style="font-size:16px">${inf.video_account_name}</h4>
        <p style="font-size:12px;color:var(--gray-500)">${inf.video_category_track || ''} · ${inf.region || ''}</p>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;background:var(--primary-light);padding:14px;border-radius:8px">
      <div><span style="color:var(--gray-400)">粉丝数</span><br><strong>${formatNumber(inf.fans_count)}</strong></div>
      <div><span style="color:var(--gray-400)">短视频销售额(月)</span><br><strong>${inf.monthly_short_video_sales || 0}万</strong></div>
      <div><span style="color:var(--gray-400)">直播销售额(月)</span><br><strong>${inf.monthly_live_sales || 0}万</strong></div>
      <div><span style="color:var(--gray-400)">合作类型</span><br>${inf.cooperation_type || '-'}</div>
      <div><span style="color:var(--gray-400)">图书带货意愿</span><br><span class="willingness ${inf.book_willingness}">${inf.book_willingness || '-'}</span></div>
      <div><span style="color:var(--gray-400)">课程带货意愿</span><br><span class="willingness ${inf.course_willingness}">${inf.course_willingness || '-'}</span></div>
      <div><span style="color:var(--gray-400)">短视频频率</span><br>${inf.short_video_frequency || '-'}</div>
      <div><span style="color:var(--gray-400)">直播频率</span><br>${inf.live_frequency || '-'}</div>
      <div><span style="color:var(--gray-400)">MCN</span><br>${inf.has_mcn === '是' ? inf.mcn_name : '无'}</div>
      <div><span style="color:var(--gray-400)">互选平台</span><br>${inf.has_joined_mutual_select || '-'}</div>
    </div>
  `, '<button class="btn btn-outline" onclick="closeModal()">关闭</button>');
}

// 查看需求详情
async function viewDemandDetail(demandId) {
  const res = await fetchAPI(`/demands/${demandId}`);
  if (!res.success) { showToast('获取需求详情失败', 'error'); return; }
  const d = res.data;
  
  let detailContent = '';
  if (d.detail) {
    if (d.demand_type === 'book') {
      detailContent = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
          <div><span style="color:var(--gray-400)">图书名称</span><br><strong>${d.detail.book_name || '-'}</strong></div>
          <div><span style="color:var(--gray-400)">图书商家</span><br>${d.detail.book_merchant || '-'}</div>
          <div><span style="color:var(--gray-400)">售价</span><br><span class="price-text">¥${d.detail.selling_price || 0}</span></div>
          <div><span style="color:var(--gray-400)">纯佣金</span><br>${formatPercent(d.detail.pure_commission)}</div>
          <div><span style="color:var(--gray-400)">目标人群</span><br>${d.detail.target_audience || '-'}</div>
          <div><span style="color:var(--gray-400)">分类</span><br>${d.detail.book_category || '-'}</div>
        </div>`;
    } else {
      detailContent = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
          <div><span style="color:var(--gray-400)">课程名称</span><br><strong>${d.detail.course_name || '-'}</strong></div>
          <div><span style="color:var(--gray-400)">课程价格</span><br><span class="price-text">¥${d.detail.unit_price || 0}</span></div>
          <div><span style="color:var(--gray-400)">学段</span><br>${d.detail.grade_level || '-'}</div>
          <div><span style="color:var(--gray-400)">学科</span><br>${d.detail.subject || '-'}</div>
        </div>`;
    }
  }
  
  openModal('需求详情', `
    <div style="margin-bottom:12px">
      <h4>${d.title || '未命名需求'}</h4>
      <p style="font-size:12px;color:var(--gray-500)">${d.demand_type === 'book' ? '图书需求' : '课程需求'} · ${formatDate(d.created_at)}</p>
    </div>
    <div style="background:var(--primary-light);padding:14px;border-radius:8px;margin-bottom:12px">
      ${detailContent || `<p style="font-size:13px;color:var(--gray-600)">${d.description || '暂无详情'}</p>`}
    </div>
    <p style="font-size:12px;color:var(--gray-400)">商家：${d.merchant_company || d.merchant_name || '-'}</p>
  `, '<button class="btn btn-outline" onclick="closeModal()">关闭</button>');
}

// ============ 达人管理（仅超级管理员可见） ============
let imFilters = { keyword: '', level: '', has_mcn: '' };
let imPage = 1;
const im_PAGE_SIZE = 30;

async function renderInfluencerManage() {
  // 管理员（超管 + 销售普管）可访问
  if (currentUser.role !== 'admin') {
    document.getElementById('page-container').innerHTML = `
      <div class="empty-state">
        <div class="icon">-</div>
        <p>权限不足，仅管理员可访问"达人管理"模块</p>
        <button class="btn btn-sm btn-primary" style="margin-top:12px" onclick="navigateTo('influencer-plaza')">前往达人广场</button>
      </div>`;
    return;
  }
  const isSuper = currentUser.is_super;

  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';

  // 拉取数据：列表 + Hero 统计
  let url = `/influencers?page=${imPage}&pageSize=${im_PAGE_SIZE}`;
  if (imFilters.keyword) url += `&keyword=${encodeURIComponent(imFilters.keyword)}`;
  if (imFilters.level) url += `&level=${encodeURIComponent(imFilters.level)}`;
  if (imFilters.has_mcn) url += `&has_mcn=${encodeURIComponent(imFilters.has_mcn)}`;
  // 销售普管只看归属自己的达人
  if (!isSuper) url += `&sales_owner_id=${encodeURIComponent(currentUser.id)}`;

  const [listRes, heroRes] = await Promise.all([
    fetchAPI(url),
    fetchAPI('/influencers/hero-stats' + (isSuper ? '' : `?sales_owner_id=${encodeURIComponent(currentUser.id)}`))
  ]);
  if (!listRes.success) { container.innerHTML = '<p>加载失败</p>'; return; }

  const hero = heroRes.success ? heroRes.data : { total: 0, levels: [], mcnCount: 0, mutualCount: 0, newCount: 0, highSales: 0 };
  const levelCount = {};
  (hero.levels || []).forEach(x => { levelCount[x.level] = x.c; });

  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header">
      <h2>达人管理</h2>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">达人资源的批量增改删与导入导出${isSuper ? '' : '（你只看到归属自己的达人）'}</div>
    </div>

    <!-- Hero 统计 -->
    <div class="im-hero">
      ${renderImHeroCard('达人总数', hero.total, '#3b82f6')}
      ${renderImHeroCard('S级', levelCount['S级'] || 0, '#dc2626')}
      ${renderImHeroCard('A级', levelCount['A级'] || 0, '#ea580c')}
      ${renderImHeroCard('B级', levelCount['B级'] || 0, '#16a34a')}
      ${renderImHeroCard('C级', levelCount['C级'] || 0, '#0ea5e9')}
      ${renderImHeroCard('D级', levelCount['D级'] || 0, '#94a3b8')}
      ${renderImHeroCard('已签 MCN', hero.mcnCount, '#8b5cf6')}
      ${renderImHeroCard('近 30 天新增', hero.newCount, '#ec4899')}
    </div>

    <!-- 工具栏 -->
    <div class="md-toolbar">
      <div class="md-toolbar-left">
        <button class="btn btn-sm btn-success" onclick="showAddInfluencerModal()">+ 邀请达人</button>
        <button class="btn btn-sm btn-primary" onclick="showImBatchUpload()">批量上传</button>
        <button class="btn btn-sm btn-outline" onclick="exportInfluencers()">导出CSV</button>
        <button class="btn btn-sm btn-danger-outline" onclick="clearAllInfluencersFromManage()" style="margin-left:auto">清空所有达人</button>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-panel" style="display:block;margin-top:12px">
      <div class="filter-row">
        <div class="filter-item" style="flex:1">
          <input type="text" id="im-keyword" placeholder="搜索：达人账号 / 所在地 / 内容赛道..."
            value="${escapeHtml(imFilters.keyword || '')}"
            onkeypress="if(event.key==='Enter') applyImFilter()">
        </div>
        <div class="filter-item">
          <label>等级</label>
          <select onchange="onImFilterChange('level', this.value); applyImFilter()">
            <option value="">全部</option>
            ${['S级','A级','B级','C级','D级'].map(l => `<option value="${l}" ${imFilters.level===l?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="filter-item">
          <label>MCN</label>
          <select onchange="onImFilterChange('has_mcn', this.value); applyImFilter()">
            <option value="">全部</option>
            <option value="是" ${imFilters.has_mcn==='是'?'selected':''}>已签 MCN</option>
            <option value="否" ${imFilters.has_mcn==='否'?'selected':''}>未签 MCN</option>
          </select>
        </div>
        <button class="btn btn-primary btn-sm" onclick="applyImFilter()">搜索</button>
        ${(imFilters.keyword || imFilters.level || imFilters.has_mcn) ? '<button class="btn btn-sm btn-outline" onclick="resetImFilter()">重置</button>' : ''}
      </div>
    </div>

    <!-- 批量上传区（隐藏） -->
    <div id="im-upload-area" style="display:none;margin-top:12px">
      <div class="card"><div class="card-header"><h3>批量上传达人</h3></div><div class="card-body">
        <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a href="/api/influencers/excel/template" class="btn btn-outline btn-sm">下载导入模板</a>
          <span style="font-size:12px;color:#94a3b8">支持"X万"格式（如 50万），同名达人自动更新</span>
        </div>
        <div class="upload-area" onclick="document.getElementById('im-excel-input').click()">
          <div class="upload-icon">+</div>
          <div class="upload-text">点击上传达人 Excel 文件</div>
          <div class="upload-hint">支持 .xlsx / .xls 格式</div>
        </div>
        <input type="file" id="im-excel-input" accept=".xlsx,.xls" style="display:none" onchange="handleInfluencerExcelUpload(event)">
        <div id="influencer-import-result" style="margin-top:12px"></div>
      </div></div>
    </div>

    <!-- 列表 -->
    <div class="im-list" style="margin-top:16px">
      ${renderImTableHeader()}
      ${listRes.data.length === 0
        ? '<div class="empty-state" style="padding:40px"><p>暂无符合条件的达人</p></div>'
        : listRes.data.map(inf => renderImRow(inf)).join('')}
    </div>
    ${renderPagination(listRes.pagination, 'pageInfluencerManage')}
  `;
}

function renderImHeroCard(label, val, color) {
  return `
    <div class="im-hero-card">
      <div class="im-hero-val" style="color:${color}">${formatNumber(val || 0)}</div>
      <div class="im-hero-label">${label}</div>
    </div>`;
}

function renderImTableHeader() {
  return `
    <div class="im-row im-row-header">
      <div class="im-th">等级</div>
      <div class="im-th">达人账号</div>
      <div class="im-th th-right">粉丝量</div>
      <div class="im-th">内容赛道</div>
      <div class="im-th">所在地</div>
      <div class="im-th">MCN</div>
      <div class="im-th">归属销售</div>
      <div class="im-th th-right">月销总额</div>
      <div class="im-th">状态</div>
      <div class="im-th th-right">操作</div>
    </div>`;
}

function renderImRow(inf) {
  const levelColor = getLevelColor(inf.level);
  const totalSales = (inf.monthly_short_video_sales || 0) + (inf.monthly_live_sales || 0);
  const region = (inf.region || '').split(',')[0] || '-';
  const salesName = inf.sales_owner_name || inf.sales_owner || '<span style="color:#cbd5e1">-</span>';

  // 邀请状态徽标
  let statusBadge;
  if (inf.invite_status === 'pending') {
    statusBadge = '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">待激活</span>';
  } else if (inf.invite_status === 'disabled') {
    statusBadge = '<span style="background:#e5e7eb;color:#6b7280;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">已停用</span>';
  } else {
    statusBadge = '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">已激活</span>';
  }

  // 操作按钮（按 invite_status 分）
  let actions = '';
  if (inf.invite_status === 'pending') {
    actions = `
      <button class="btn btn-xs btn-primary" onclick="copyInfluencerInviteLink('${inf.id}')">复制邀请链接</button>
      <button class="btn btn-xs btn-outline" onclick="editInfluencer('${inf.id}')">编辑</button>
      <button class="btn btn-xs btn-danger-outline" onclick="deleteInfluencerFromManage('${inf.id}','${escapeHtml(inf.video_account_name || '').replace(/'/g, '&apos;')}')">删除</button>
    `;
  } else if (inf.invite_status === 'disabled') {
    actions = `
      <button class="btn btn-xs btn-success" onclick="toggleInfluencerEnabled('${inf.id}', 'active')">启用</button>
      <button class="btn btn-xs btn-outline" onclick="editInfluencer('${inf.id}')">编辑</button>
      <button class="btn btn-xs btn-danger-outline" onclick="deleteInfluencerFromManage('${inf.id}','${escapeHtml(inf.video_account_name || '').replace(/'/g, '&apos;')}')">删除</button>
    `;
  } else {
    actions = `
      <button class="btn btn-xs btn-outline" onclick="showInfDetailModal('${inf.id}')">详情</button>
      <button class="btn btn-xs btn-outline" onclick="editInfluencer('${inf.id}')">编辑</button>
      <button class="btn btn-xs btn-outline" onclick="resetInfluencerPassword('${inf.id}','${escapeHtml(inf.video_account_name || '').replace(/'/g, '&apos;')}')">重置密码</button>
      <button class="btn btn-xs btn-outline" onclick="toggleInfluencerEnabled('${inf.id}', 'disabled')">停用</button>
      <button class="btn btn-xs btn-danger-outline" onclick="deleteInfluencerFromManage('${inf.id}','${escapeHtml(inf.video_account_name || '').replace(/'/g, '&apos;')}')">删除</button>
    `;
  }

  return `
    <div class="im-row">
      <div class="im-cell"><span class="level-badge" style="background:${levelColor}">${inf.level || '-'}</span></div>
      <div class="im-cell im-cell-name">
        <div class="im-name-main">${escapeHtml(inf.video_account_name || '-')}</div>
        ${inf.official_account_name ? `<div class="im-name-sub">${escapeHtml(inf.official_account_name)}</div>` : ''}
      </div>
      <div class="im-cell th-right">${formatNumber(inf.fans_count || 0)}</div>
      <div class="im-cell" title="${escapeHtml(inf.video_category_track || '')}">${(inf.video_category_track || '-').slice(0, 16)}${(inf.video_category_track || '').length > 16 ? '…' : ''}</div>
      <div class="im-cell">${region}</div>
      <div class="im-cell">${inf.has_mcn === '是' ? `<span style="color:#8b5cf6">${escapeHtml(inf.mcn_name || 'MCN')}</span>` : '<span style="color:#cbd5e1">-</span>'}</div>
      <div class="im-cell" style="color:#16a34a;font-weight:600">${salesName}</div>
      <div class="im-cell th-right">¥${formatNumber(totalSales)}</div>
      <div class="im-cell">${statusBadge}</div>
      <div class="im-cell th-right im-actions">${actions}</div>
    </div>`;
}

// 复制达人邀请链接
async function copyInfluencerInviteLink(id) {
  const res = await fetchAPI(`/influencers/${id}/invite-code`);
  if (!res.success) { showToast(res.error || '获取邀请链接失败', 'error'); return; }
  showInviteLinkModal(res.data.code, res.data.video_account_name);
}

// 启用/停用达人账号
async function toggleInfluencerEnabled(id, targetStatus) {
  const tip = targetStatus === 'active' ? '启用' : '停用';
  if (!confirm(`确定${tip}该达人账号？${targetStatus === 'disabled' ? '\n停用后该达人将无法登录' : ''}`)) return;
  const res = await fetchAPI(`/influencers/${id}/invite-status`, {
    method: 'PUT',
    body: JSON.stringify({ invite_status: targetStatus })
  });
  if (res.success) { showToast(res.message || '操作成功'); renderInfluencerManage(); }
  else { showToast(res.error || '操作失败', 'error'); }
}

// 重置达人密码
async function resetInfluencerPassword(id, name) {
  if (!confirm(`确定将达人「${name}」的密码重置为 123456？`)) return;
  const res = await fetchAPI(`/influencers/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({}) });
  if (res.success) { showToast(res.message || '密码已重置'); }
  else { showToast(res.error || '重置失败', 'error'); }
}

function onImFilterChange(key, value) { imFilters[key] = value; }
function applyImFilter() {
  const kw = document.getElementById('im-keyword');
  if (kw) imFilters.keyword = kw.value.trim();
  imPage = 1;
  renderInfluencerManage();
}
function resetImFilter() {
  imFilters = { keyword: '', level: '', has_mcn: '' };
  imPage = 1;
  renderInfluencerManage();
}
function pageInfluencerManage(page) {
  imPage = page;
  renderInfluencerManage();
}
function showImBatchUpload() {
  const area = document.getElementById('im-upload-area');
  if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
}
function exportInfluencers() {
  const params = new URLSearchParams();
  if (imFilters.keyword) params.set('keyword', imFilters.keyword);
  if (imFilters.level) params.set('level', imFilters.level);
  if (imFilters.has_mcn) params.set('has_mcn', imFilters.has_mcn);
  const url = '/api/influencers/export' + (params.toString() ? '?' + params.toString() : '');
  // 直接通过浏览器下载
  window.open(url, '_blank');
  showToast('正在下载，请稍候...');
}
async function clearAllInfluencersFromManage() {
  if (!confirm('⚠ 危险操作：将清空全部达人数据，且不可恢复。确定继续？')) return;
  if (!confirm('请再次确认：你即将永久删除所有达人记录！')) return;
  await fetchAPI('/influencers/all/clear', { method: 'DELETE' });
  showToast('已清空');
  renderInfluencerManage();
}
async function deleteInfluencerFromManage(id, name) {
  if (!confirm(`确定删除达人「${name}」？此操作不可恢复。`)) return;
  const res = await fetchAPI(`/influencers/${id}`, { method: 'DELETE' });
  if (res.success) { showToast('已删除'); renderInfluencerManage(); }
  else { showToast(res.error || '删除失败', 'error'); }
}

// ============ 商家管理（管理员可见，仿达人管理样式） ============
let mmFilters = { keyword: '', industry: '', has_sales: '', status: 'active' };
let mmPage = 1;
const MM_PAGE_SIZE = 30;
const MM_INDUSTRIES = ['图书出版', '在线教育', '教辅出版', '数字内容', '课程平台', 'MCN代理', '其他'];

async function renderMerchantManage() {
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';

  // 销售管理员只看归属自己的+无归属的
  const isSalesAdmin = currentUser.role === 'admin' && !currentUser.is_super && currentUser.admin_role === '销售';
  const isSuper = currentUser.role === 'admin' && currentUser.is_super;

  let listUrl = `/merchants?page=${mmPage}&pageSize=${MM_PAGE_SIZE}`;
  let statsUrl = '/merchants/manage-stats';
  if (isSalesAdmin) {
    listUrl += `&sales_owner_id=${currentUser.id}`;
    statsUrl += `?sales_owner_id=${currentUser.id}`;
  }
  if (mmFilters.keyword) listUrl += `&keyword=${encodeURIComponent(mmFilters.keyword)}`;
  if (mmFilters.industry) listUrl += `&industry=${encodeURIComponent(mmFilters.industry)}`;
  if (mmFilters.has_sales) listUrl += `&has_sales=${encodeURIComponent(mmFilters.has_sales)}`;
  if (mmFilters.status) listUrl += `&status=${encodeURIComponent(mmFilters.status)}`;

  const [listRes, statsRes, salesRes] = await Promise.all([
    fetchAPI(listUrl),
    fetchAPI(statsUrl),
    fetchAPI('/admins/sales-list')
  ]);
  if (!listRes.success) { container.innerHTML = '<div class="empty-state"><p>加载失败</p></div>'; return; }

  const merchants = listRes.data || [];
  const stats = statsRes.success ? statsRes.data : { total: 0, withSales: 0, newCount: 0, activeCount: 0, industries: [] };
  window._salesList = salesRes.data || [];

  // 计算各行业分布的前 3
  const industryMap = {};
  (stats.industries || []).forEach(x => { if (x.industry) industryMap[x.industry] = x.c; });

  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header">
      <h2>商家管理</h2>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">商家档案的增改删与归属销售管理${isSalesAdmin ? '（你只看到归属自己的商家）' : ''}</div>
    </div>

    <!-- Hero 4 卡 -->
    <div class="im-hero">
      ${renderImHeroCard('商家总数', stats.total || 0, '#3b82f6')}
      ${renderImHeroCard('有归属销售', stats.withSales || 0, '#16a34a')}
      ${renderImHeroCard('近 30 天新增', stats.newCount || 0, '#ec4899')}
      ${renderImHeroCard('近 30 天活跃', stats.activeCount || 0, '#f59e0b')}
    </div>

    <!-- 工具栏 -->
    <div class="md-toolbar">
      <div class="md-toolbar-left">
        <button class="btn btn-sm btn-success" onclick="showAddMerchant()">+ 邀请商家</button>
        <button class="btn btn-sm btn-primary" onclick="showMmBatchUpload()">批量导入</button>
        <button class="btn btn-sm btn-outline" onclick="exportMerchants()">导出CSV</button>
        ${isSuper ? `<button class="btn btn-sm ${mmFilters.status==='deleted'?'btn-primary':'btn-outline'}" onclick="toggleMmDeletedView()">${mmFilters.status==='deleted'?'返回正常列表':'查看已删除'}</button>` : ''}
      </div>
    </div>

    <!-- 批量导入区（默认隐藏）-->
    <div id="mm-upload-area" style="display:none;margin-top:12px">
      <div class="card"><div class="card-header"><h3>批量导入商家</h3></div><div class="card-body">
        <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <a href="/api/merchants/excel/template" class="btn btn-outline btn-sm">下载导入模板</a>
          <span style="font-size:12px;color:#94a3b8">导入的商家将自动走邀请制，可在列表中逐个复制邀请链接发送</span>
        </div>
        <div class="upload-area" onclick="document.getElementById('mm-excel-input').click()">
          <div class="upload-icon">+</div>
          <div class="upload-text">点击上传商家 Excel 文件</div>
          <div class="upload-hint">支持 .xlsx / .xls 格式，必填字段：公司名称 / 联系人 / 手机号</div>
        </div>
        <input type="file" id="mm-excel-input" accept=".xlsx,.xls" style="display:none" onchange="handleMerchantExcelUpload(event)">
        <div id="mm-import-result" style="margin-top:12px"></div>
      </div></div>
    </div>

    <!-- 筛选 -->
    <div class="filter-panel" style="display:block;margin-top:12px">
      <div class="filter-row">
        <div class="filter-item" style="flex:1">
          <input type="text" id="mm-keyword" placeholder="搜索：联系人 / 公司名 / 手机号 / 邮箱..."
            value="${escapeHtml(mmFilters.keyword || '')}"
            onkeypress="if(event.key==='Enter') applyMmFilter()">
        </div>
        <div class="filter-item">
          <label>行业</label>
          <select onchange="onMmFilterChange('industry', this.value); applyMmFilter()">
            <option value="">全部</option>
            ${MM_INDUSTRIES.map(i => `<option value="${i}" ${mmFilters.industry===i?'selected':''}>${i}${industryMap[i]?` (${industryMap[i]})`:''}</option>`).join('')}
          </select>
        </div>
        <div class="filter-item">
          <label>归属销售</label>
          <select onchange="onMmFilterChange('has_sales', this.value); applyMmFilter()">
            <option value="">全部</option>
            <option value="yes" ${mmFilters.has_sales==='yes'?'selected':''}>已分配</option>
            <option value="no" ${mmFilters.has_sales==='no'?'selected':''}>未分配</option>
          </select>
        </div>
        <button class="btn btn-primary btn-sm" onclick="applyMmFilter()">搜索</button>
        ${(mmFilters.keyword || mmFilters.industry || mmFilters.has_sales) ? '<button class="btn btn-sm btn-outline" onclick="resetMmFilter()">重置</button>' : ''}
      </div>
    </div>

    <!-- 列表 -->
    <div class="im-list" style="margin-top:16px">
      ${renderMmTableHeader(isSuper)}
      ${merchants.length === 0
        ? '<div class="empty-state" style="padding:40px"><p>暂无符合条件的商家</p></div>'
        : merchants.map(m => renderMmRow(m, isSuper)).join('')}
    </div>
    ${renderPagination(listRes.pagination, 'pageMerchantManage')}
  `;
}

function renderMmTableHeader(isSuper) {
  return `
    <div class="im-row im-row-header mm-row">
      <div class="im-th">公司名称</div>
      <div class="im-th">联系人</div>
      <div class="im-th">行业</div>
      <div class="im-th">手机号</div>
      <div class="im-th">归属销售</div>
      <div class="im-th th-right">货盘数</div>
      <div class="im-th">状态</div>
      <div class="im-th">创建时间</div>
      <div class="im-th th-right">操作</div>
    </div>`;
}

function renderMmRow(m, isSuper) {
  const isDeleted = m.status === 'deleted';
  const sales = m.sales_owner_name
    ? `<span style="color:#16a34a;font-weight:600">${escapeHtml(m.sales_owner_name)}</span>`
    : '<span style="color:#cbd5e1">未分配</span>';
  // 邀请状态徽标
  let statusBadge;
  if (isDeleted) {
    statusBadge = '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">已删除</span>';
  } else if (m.invite_status === 'pending') {
    statusBadge = '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">待激活</span>';
  } else if (m.invite_status === 'disabled') {
    statusBadge = '<span style="background:#e5e7eb;color:#6b7280;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">已停用</span>';
  } else {
    statusBadge = '<span style="background:#dcfce7;color:#16a34a;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">已激活</span>';
  }
  const industryTag = m.industry
    ? `<span style="background:#e0f2fe;color:#0284c7;padding:2px 8px;border-radius:4px;font-size:11px">${escapeHtml(m.industry)}</span>`
    : '<span style="color:#cbd5e1">未分类</span>';

  // 操作按钮（按 invite_status 分情况）
  let actions = '';
  if (isDeleted) {
    actions = isSuper ? `<button class="btn btn-xs btn-success" onclick="restoreMerchant('${m.id}')">恢复</button>` : '';
  } else if (m.invite_status === 'pending') {
    actions = `
      <button class="btn btn-xs btn-primary" onclick="copyMerchantInviteLink('${m.id}')">复制邀请链接</button>
      <button class="btn btn-xs btn-outline" onclick="editMerchant('${m.id}')">编辑</button>
      <button class="btn btn-xs btn-danger-outline" onclick="deleteMerchant('${m.id}','${escapeHtml(m.company || m.name || '').replace(/'/g, '&apos;')}')">删除</button>
    `;
  } else if (m.invite_status === 'disabled') {
    actions = `
      <button class="btn btn-xs btn-success" onclick="toggleMerchantEnabled('${m.id}', 'active')">启用</button>
      <button class="btn btn-xs btn-outline" onclick="editMerchant('${m.id}')">编辑</button>
      <button class="btn btn-xs btn-danger-outline" onclick="deleteMerchant('${m.id}','${escapeHtml(m.company || m.name || '').replace(/'/g, '&apos;')}')">删除</button>
    `;
  } else {
    // active
    actions = `
      <button class="btn btn-xs btn-outline" onclick="editMerchant('${m.id}')">编辑</button>
      <button class="btn btn-xs btn-outline" onclick="resetMerchantPassword('${m.id}','${escapeHtml(m.company || '').replace(/'/g, '&apos;')}')">重置密码</button>
      <button class="btn btn-xs btn-outline" onclick="toggleMerchantEnabled('${m.id}', 'disabled')">停用</button>
      <button class="btn btn-xs btn-danger-outline" onclick="deleteMerchant('${m.id}','${escapeHtml(m.company || m.name || '').replace(/'/g, '&apos;')}')">删除</button>
    `;
  }

  return `
    <div class="im-row mm-row${isDeleted ? ' mm-row-deleted' : ''}">
      <div class="im-cell im-cell-name">
        <div class="im-name-main">${escapeHtml(m.company || '-')}</div>
        ${m.email ? `<div class="im-name-sub">${escapeHtml(m.email)}</div>` : ''}
      </div>
      <div class="im-cell">${escapeHtml(m.name || '-')}</div>
      <div class="im-cell">${industryTag}</div>
      <div class="im-cell">${escapeHtml(m.phone || '-')}</div>
      <div class="im-cell">${sales}</div>
      <div class="im-cell th-right" style="font-weight:600">${m.demand_count || 0}</div>
      <div class="im-cell">${statusBadge}</div>
      <div class="im-cell" style="font-size:12px;color:#94a3b8">${formatDate(m.created_at)}</div>
      <div class="im-cell th-right im-actions">${actions}</div>
    </div>`;
}

function onMmFilterChange(key, value) { mmFilters[key] = value; }
function applyMmFilter() {
  const kw = document.getElementById('mm-keyword');
  if (kw) mmFilters.keyword = kw.value.trim();
  mmPage = 1;
  renderMerchantManage();
}
function resetMmFilter() {
  mmFilters = { keyword: '', industry: '', has_sales: '', status: mmFilters.status };
  mmPage = 1;
  renderMerchantManage();
}
function pageMerchantManage(page) {
  mmPage = page;
  renderMerchantManage();
}
function toggleMmDeletedView() {
  mmFilters.status = mmFilters.status === 'deleted' ? 'active' : 'deleted';
  mmPage = 1;
  renderMerchantManage();
}
function exportMerchants() {
  const params = new URLSearchParams();
  if (mmFilters.keyword) params.set('keyword', mmFilters.keyword);
  if (mmFilters.industry) params.set('industry', mmFilters.industry);
  if (mmFilters.has_sales) params.set('has_sales', mmFilters.has_sales);
  const url = '/api/merchants/export' + (params.toString() ? '?' + params.toString() : '');
  window.open(url, '_blank');
  showToast('正在下载，请稍候...');
}

// 批量导入商家：切换上传区显示
function showMmBatchUpload() {
  const area = document.getElementById('mm-upload-area');
  if (!area) return;
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
}

// 商家 Excel 批量上传处理
async function handleMerchantExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('invited_by', currentUser.id);
  // 销售普管：默认归属自己
  const isSalesAdmin = currentUser.role === 'admin' && !currentUser.is_super && currentUser.admin_role === '销售';
  if (isSalesAdmin) formData.append('default_sales_owner_id', currentUser.id);

  const resultEl = document.getElementById('mm-import-result');
  resultEl.innerHTML = '<div style="padding:10px;color:#64748b;font-size:13px">正在上传并解析，请稍候...</div>';

  try {
    const res = await fetch('/api/merchants/excel/import', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!data.success) {
      resultEl.innerHTML = `<div style="padding:12px;background:#fee2e2;color:#b91c1c;border-radius:6px;font-size:13px">${data.error || '导入失败'}</div>`;
      return;
    }
    const r = data.data;
    const errList = (r.errors || []).slice(0, 20);
    resultEl.innerHTML = `
      <div style="padding:12px 14px;background:#ecfdf5;border-radius:8px;border-left:3px solid #10b981;font-size:13px;color:#15803d;margin-bottom:10px">
        <strong>导入完成</strong><br>
        共 ${r.total} 条｜成功 <strong style="color:#059669">${r.inserted}</strong>｜跳过 ${r.skipped}｜失败 ${r.failed}
      </div>
      ${errList.length > 0 ? `
        <div style="padding:10px 12px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;max-height:180px;overflow-y:auto">
          <strong>异常明细（前 ${errList.length} 条）：</strong>
          <ul style="margin:6px 0 0 16px;padding:0">${errList.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${r.inserted > 0 ? `
        <div style="margin-top:10px;padding:10px 12px;background:#eff6ff;border-radius:6px;font-size:12px;color:#1e40af;line-height:1.6">
          <strong>下一步：</strong>在下方列表中找到「待激活」的商家，点"复制邀请链接"发送给对方。<br>
          批量场景建议用"筛选 → 状态=待激活"快速定位。
        </div>
      ` : ''}
    `;
    // 清空 file input（方便再次上传同文件）
    e.target.value = '';
    // 刷新列表
    renderMerchantManage();
  } catch (err) {
    resultEl.innerHTML = `<div style="padding:12px;background:#fee2e2;color:#b91c1c;border-radius:6px;font-size:13px">网络错误：${err.message}</div>`;
  }
}

async function showAddMerchant() {
  const salesList = window._salesList || [];
  const isSalesAdmin = currentUser.role === 'admin' && !currentUser.is_super && currentUser.admin_role === '销售';
  openModal('邀请商家', `
    <div class="form-group"><label>公司名称 *</label><input type="text" id="m-company" placeholder="如：知行图书出版社" required></div>
    <div class="form-group"><label>联系人姓名 *</label><input type="text" id="m-name" placeholder="如：张经理" required></div>
    <div class="form-group"><label>手机号 *</label><input type="text" id="m-phone" placeholder="手机号码" required></div>
    <div class="form-group"><label>邮箱</label><input type="email" id="m-email" placeholder="选填"></div>
    <div class="form-group"><label>行业</label>
      <select id="m-industry">
        <option value="">请选择</option>
        ${MM_INDUSTRIES.map(i => `<option value="${i}">${i}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>描述</label><textarea id="m-desc" rows="2" placeholder="商家简介"></textarea></div>
    ${isSalesAdmin ? `
      <div class="info-box" style="padding:10px 12px;background:#ecfdf5;border-radius:6px;font-size:12px;color:#15803d">
         邀请后将自动归属到你（${currentUser.name}）名下
      </div>
    ` : `
    <div class="form-group">
      <label>归属销售（非必填）</label>
      <select id="m-sales-owner">
        <option value="">-- 不设置 --</option>
        ${salesList.map(s => `<option value="${s.id}">${s.name} (@${s.username})</option>`).join('')}
      </select>
      <p style="font-size:11px;color:var(--gray-400);margin-top:4px">设置后，对应销售登录可看到此商家信息</p>
    </div>
    `}
    <div class="info-box" style="padding:10px 12px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;margin-top:8px">
      添加后系统会生成专属邀请链接，将链接发给商家，对方打开链接设置密码即可激活账号
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="confirmAddMerchant()">确认邀请</button>
  `);
}

async function confirmAddMerchant() {
  const isSalesAdmin = currentUser.role === 'admin' && !currentUser.is_super && currentUser.admin_role === '销售';
  const data = {
    name: document.getElementById('m-name').value.trim(),
    company: document.getElementById('m-company').value.trim(),
    phone: document.getElementById('m-phone').value.trim(),
    email: document.getElementById('m-email').value.trim(),
    industry: document.getElementById('m-industry').value,
    description: document.getElementById('m-desc').value.trim(),
    // 销售普管 → 自动归属自己；超管 → 允许选择
    sales_owner_id: isSalesAdmin ? currentUser.id : (document.getElementById('m-sales-owner') ? document.getElementById('m-sales-owner').value : ''),
    invite_mode: 1,
    invited_by: currentUser.id
  };
  if (!data.name || !data.company || !data.phone) {
    showToast('联系人、公司名称、手机号为必填', 'error'); return;
  }
  const res = await fetchAPI('/merchants', { method: 'POST', body: JSON.stringify(data) });
  if (res.success) {
    closeModal();
    renderMerchantManage();
    // 显示邀请链接弹窗
    if (res.invite_code) {
      const loginHint = `登录账号是手机号 <strong>${data.phone}</strong>，密码由对方激活时自己设置`;
      showInviteLinkModal(res.invite_code, data.company, loginHint);
    } else {
      showToast('商家已添加');
    }
  } else {
    showToast(res.error || '邀请失败', 'error');
  }
}

// 通用：显示邀请链接模态框 + 一键复制
// 可选参数 loginHint：登录提示（如"登录账号是手机号 138xxxx8888"）
function showInviteLinkModal(code, targetName, loginHint) {
  const link = window.location.origin + '/?activate=' + code;
  openModal('邀请链接已生成', `
    <div style="padding:12px 14px;background:#ecfdf5;border-radius:8px;border-left:3px solid #10b981;margin-bottom:14px;font-size:13px;color:#15803d">
       已为 <strong>${escapeHtml(targetName || '')}</strong> 生成专属邀请链接，复制并发送给对方即可
    </div>
    <div style="background:#f1f5f9;padding:12px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:12px;color:#0f172a;user-select:all;cursor:text" id="invite-link-text">${link}</div>
    ${loginHint ? `
    <div style="margin-top:10px;padding:10px 12px;background:#eff6ff;border-radius:8px;border-left:3px solid #3b82f6;font-size:12px;color:#1e40af">
      <strong>告诉对方：</strong>${loginHint}
    </div>` : ''}
    <div style="margin-top:12px;font-size:12px;color:#64748b;line-height:1.6">
      <strong>使用说明：</strong><br>
      1. 点击下方"复制链接"按钮将链接拷贝到剪贴板<br>
      2. 通过微信/邮件/短信发送给被邀请人<br>
      3. 对方打开链接，确认身份后设置密码即可完成激活
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">关闭</button>
    <button class="btn btn-primary" onclick="copyToClipboard('${link.replace(/'/g, '&apos;')}');closeModal();">复制链接</button>
  `);
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(
      () => showToast('邀请链接已复制到剪贴板'),
      () => fallbackCopy(text)
    );
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('邀请链接已复制到剪贴板');
  } catch (e) {
    showToast('复制失败，请手动选择链接复制', 'error');
  }
  document.body.removeChild(ta);
}

// 复制指定商家的邀请链接
async function copyMerchantInviteLink(id) {
  const res = await fetchAPI(`/merchants/${id}/invite-code`);
  if (!res.success) { showToast(res.error || '获取邀请链接失败', 'error'); return; }
  const loginHint = res.data.phone ? `登录账号是手机号 <strong>${res.data.phone}</strong>，密码由对方激活时自己设置` : '';
  showInviteLinkModal(res.data.code, res.data.company, loginHint);
}

// 启用/停用商家账号
async function toggleMerchantEnabled(id, targetStatus) {
  const tip = targetStatus === 'active' ? '启用' : '停用';
  if (!confirm(`确定${tip}该商家账号？${targetStatus === 'disabled' ? '\n停用后该商家将无法登录' : ''}`)) return;
  const res = await fetchAPI(`/merchants/${id}/invite-status`, {
    method: 'PUT',
    body: JSON.stringify({ invite_status: targetStatus })
  });
  if (res.success) { showToast(res.message || '操作成功'); renderMerchantManage(); }
  else { showToast(res.error || '操作失败', 'error'); }
}

async function editMerchant(id) {
  const res = await fetchAPI(`/merchants/${id}`);
  if (!res.success) { showToast('获取商家信息失败', 'error'); return; }
  const m = res.data;
  const salesList = window._salesList || [];
  openModal('编辑商家', `
    <div class="form-group"><label>公司名称 *</label><input type="text" id="em-company" value="${escapeHtml(m.company || '')}" required></div>
    <div class="form-group"><label>联系人姓名 *</label><input type="text" id="em-name" value="${escapeHtml(m.name || '')}" required></div>
    <div class="form-group"><label>手机号 *</label><input type="text" id="em-phone" value="${escapeHtml(m.phone || '')}" required></div>
    <div class="form-group"><label>邮箱</label><input type="email" id="em-email" value="${escapeHtml(m.email || '')}"></div>
    <div class="form-group"><label>行业</label>
      <select id="em-industry">
        <option value="">请选择</option>
        ${MM_INDUSTRIES.map(i => `<option value="${i}" ${m.industry===i?'selected':''}>${i}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>描述</label><textarea id="em-desc" rows="2">${escapeHtml(m.description || '')}</textarea></div>
    <div class="form-group">
      <label>归属销售</label>
      <select id="em-sales-owner">
        <option value="">-- 不设置 --</option>
        ${salesList.map(s => `<option value="${s.id}" ${m.sales_owner_id === s.id ? 'selected' : ''}>${s.name} (@${s.username})</option>`).join('')}
      </select>
    </div>
    <div style="background:#f8fafc;padding:8px 12px;border-radius:6px;margin-top:8px;font-size:11px;color:#94a3b8">
      货盘数 ${m.demand_count || 0} 条 · 招募数 ${m.recruitment_count || 0} 条 · 撮合数 ${m.matchmaking_count || 0} 条<br>
      创建时间 ${formatDate(m.created_at)}　最后更新 ${formatDate(m.updated_at)}
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="confirmEditMerchant('${id}')">保存</button>
  `);
}

async function confirmEditMerchant(id) {
  const data = {
    name: document.getElementById('em-name').value.trim(),
    company: document.getElementById('em-company').value.trim(),
    phone: document.getElementById('em-phone').value.trim(),
    email: document.getElementById('em-email').value.trim(),
    industry: document.getElementById('em-industry').value,
    description: document.getElementById('em-desc').value.trim(),
    sales_owner_id: document.getElementById('em-sales-owner').value
  };
  if (!data.name || !data.company || !data.phone) {
    showToast('联系人、公司名称、手机号为必填', 'error'); return;
  }
  const res = await fetchAPI(`/merchants/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  if (res.success) { showToast('商家信息已更新'); closeModal(); renderMerchantManage(); }
  else { showToast(res.error || '更新失败', 'error'); }
}

async function deleteMerchant(id, name) {
  if (!confirm(`确定删除商家「${name}」？\n\n（软删除：将标记为已删除状态，可在"查看已删除"中恢复）`)) return;
  const res = await fetchAPI(`/merchants/${id}`, { method: 'DELETE' });
  if (res.success) { showToast(res.message || '已删除'); renderMerchantManage(); return; }
  // 关联数据预检失败 → 询问是否强制删除
  if (res.data && res.data.requireForce) {
    if (confirm(`${res.error}\n\n是否强制删除？关联数据将变为孤儿数据。`)) {
      const force = await fetchAPI(`/merchants/${id}?force=1`, { method: 'DELETE' });
      if (force.success) { showToast('已强制删除'); renderMerchantManage(); }
      else { showToast(force.error || '删除失败', 'error'); }
    }
  } else {
    showToast(res.error || '删除失败', 'error');
  }
}

async function restoreMerchant(id) {
  if (!confirm('确定恢复此商家？')) return;
  const res = await fetchAPI(`/merchants/${id}/restore`, { method: 'PUT' });
  if (res.success) { showToast('已恢复'); renderMerchantManage(); }
  else { showToast(res.error || '恢复失败', 'error'); }
}

async function resetMerchantPassword(id, name) {
  if (!confirm(`确定将商家「${name}」的密码重置为 123456？`)) return;
  const res = await fetchAPI(`/merchants/${id}/reset-password`, { method: 'PUT', body: JSON.stringify({ password: '123456' }) });
  if (res.success) showToast(res.message || '密码已重置');
  else showToast(res.error || '重置失败', 'error');
}

// ============ 管理员管理（仅超管可见） ============
async function renderAdminManage() {
  if (!currentUser.is_super) {
    document.getElementById('page-container').innerHTML = '<div class="empty-state"><div class="icon">-</div><p>权限不足，仅超级管理员可访问此模块</p></div>';
    return;
  }
  const container = document.getElementById('page-container');
  container.innerHTML = '<div class="empty-state"><div class="icon"></div><p>加载中...</p></div>';
  
  const res = await fetchAPI('/admins');
  if (!res.success) { container.innerHTML = '<div class="empty-state"><p>加载失败</p></div>'; return; }
  const admins = res.data;
  
  container.innerHTML = `
    ${renderBackButton()}
    <div class="page-header">
      <h2>管理员管理</h2>
      <button class="btn btn-primary" onclick="showAddAdmin()">+ 添加管理员</button>
    </div>
    <div class="info-box" style="margin-bottom:20px;padding:12px 16px;background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:10px;border-left:4px solid var(--primary-500)">
      <p style="font-size:13px;color:var(--gray-600);margin:0"> <strong>权限说明：</strong>超级管理员可查看所有数据和管理管理员；普通管理员角色为"销售"时，仅可查看归属自己及无归属的商家/达人/需求/撮合数据；角色为"运营"或"其他"时，仅可查看自己操作的数据。</p>
    </div>
    <div class="admin-list">
      ${admins.map(a => `
        <div class="admin-card ${a.is_super ? 'super' : ''}">
          <div class="admin-card-header">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="admin-avatar ${a.is_super ? 'super' : ''}">${a.is_super ? '' : ''}</div>
              <div>
                <div class="admin-name">${a.name}</div>
                <div class="admin-username">@${a.username}</div>
              </div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${!a.is_super && a.admin_role ? `<span class="badge" style="background:${a.admin_role === '销售' ? '#dcfce7;color:#16a34a' : a.admin_role === '运营' ? '#fef3c7;color:#d97706' : '#f1f5f9;color:#64748b'}">${a.admin_role}</span>` : ''}
              <span class="badge ${a.is_super ? 'badge-super' : 'badge-normal'}">${a.is_super ? '超级管理员' : '普通管理员'}</span>
            </div>
          </div>
          <div class="admin-card-body">
            ${!a.is_super ? `<div class="admin-info-item"><span class="info-label">角色</span><span>${a.admin_role || '其他'}</span></div>` : ''}
            <div class="admin-info-item"><span class="info-label">手机</span><span>${a.phone || '-'}</span></div>
            <div class="admin-info-item"><span class="info-label">邮箱</span><span>${a.email || '-'}</span></div>
            <div class="admin-info-item"><span class="info-label">说明</span><span>${a.description || '-'}</span></div>
            <div class="admin-info-item"><span class="info-label">创建时间</span><span>${formatDate(a.created_at)}</span></div>
          </div>
          <div class="admin-card-actions">
            <button class="btn btn-sm btn-outline" onclick="editAdmin('${a.id}')">编辑</button>
            <button class="btn btn-sm btn-warning" onclick="resetAdminPassword('${a.id}','${a.name}')">重置密码</button>
            ${!a.is_super ? `<button class="btn btn-sm btn-danger" onclick="deleteAdmin('${a.id}','${a.name}')">删除</button>` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
}

function showAddAdmin() {
  openModal('添加管理员', `
    <div class="form-group">
      <label>用户名 *（用于登录）</label>
      <input type="text" id="admin-username" placeholder="请输入登录用户名" required>
    </div>
    <div class="form-group">
      <label>姓名 *</label>
      <input type="text" id="admin-name" placeholder="请输入姓名">
    </div>
    <div class="form-group">
      <label>密码</label>
      <input type="text" id="admin-password" placeholder="默认：123456" value="123456">
    </div>
    <div class="form-group">
      <label>权限级别</label>
      <select id="admin-is-super" onchange="onAdminSuperChange()">
        <option value="0">普通管理员（仅查看自己操作的数据）</option>
        <option value="1">超级管理员（查看所有数据 + 管理员管理）</option>
      </select>
    </div>
    <div class="form-group" id="admin-role-group">
      <label>角色分类 *</label>
      <select id="admin-role">
        <option value="销售">销售（按归属关系查看商家/达人数据）</option>
        <option value="运营">运营</option>
        <option value="其他">其他</option>
      </select>
      <p style="font-size:11px;color:var(--gray-400);margin-top:4px">销售角色登录后只能查看归属自己的商家及达人信息</p>
    </div>
    <div class="form-group">
      <label>手机号</label>
      <input type="text" id="admin-phone" placeholder="选填">
    </div>
    <div class="form-group">
      <label>邮箱</label>
      <input type="text" id="admin-email" placeholder="选填">
    </div>
    <div class="form-group">
      <label>职责描述</label>
      <textarea id="admin-desc" rows="2" placeholder="如：负责图书品类运营"></textarea>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="confirmAddAdmin()">V 确认添加</button>
  `);
}

function onAdminSuperChange() {
  const isSuper = document.getElementById('admin-is-super').value === '1';
  const roleGroup = document.getElementById('admin-role-group');
  if (roleGroup) roleGroup.style.display = isSuper ? 'none' : 'block';
}

async function confirmAddAdmin() {
  const username = document.getElementById('admin-username').value.trim();
  const name = document.getElementById('admin-name').value.trim();
  const password = document.getElementById('admin-password').value || '123456';
  const is_super = parseInt(document.getElementById('admin-is-super').value);
  const admin_role = is_super ? '其他' : (document.getElementById('admin-role').value || '其他');
  const phone = document.getElementById('admin-phone').value.trim();
  const email = document.getElementById('admin-email').value.trim();
  const description = document.getElementById('admin-desc').value.trim();
  
  if (!username || !name) { showToast('用户名和姓名为必填', 'error'); return; }
  
  const res = await fetchAPI('/admins', {
    method: 'POST',
    body: JSON.stringify({ username, name, password, is_super, admin_role, phone, email, description })
  });
  if (res.success) { showToast('管理员创建成功'); closeModal(); renderAdminManage(); }
  else { showToast(res.error || '创建失败', 'error'); }
}

async function editAdmin(id) {
  const listRes = await fetchAPI('/admins');
  if (!listRes.success) return;
  const admin = listRes.data.find(a => a.id === id);
  if (!admin) { showToast('未找到管理员', 'error'); return; }
  
  openModal('编辑管理员', `
    <div class="form-group">
      <label>用户名（登录用）</label>
      <input type="text" id="edit-admin-username" value="${admin.username}" ${admin.is_super ? 'readonly style="opacity:0.6"' : ''}>
    </div>
    <div class="form-group">
      <label>姓名</label>
      <input type="text" id="edit-admin-name" value="${admin.name}">
    </div>
    <div class="form-group">
      <label>权限级别</label>
      <select id="edit-admin-is-super" ${admin.is_super ? 'disabled' : ''} onchange="onEditAdminSuperChange()">
        <option value="0" ${!admin.is_super ? 'selected' : ''}>普通管理员</option>
        <option value="1" ${admin.is_super ? 'selected' : ''}>超级管理员</option>
      </select>
      ${admin.is_super ? '<p style="font-size:11px;color:var(--gray-400);margin-top:4px">超级管理员权限不可降级</p>' : ''}
    </div>
    <div class="form-group" id="edit-admin-role-group" style="${admin.is_super ? 'display:none' : ''}">
      <label>角色分类</label>
      <select id="edit-admin-role">
        <option value="销售" ${admin.admin_role === '销售' ? 'selected' : ''}>销售</option>
        <option value="运营" ${admin.admin_role === '运营' ? 'selected' : ''}>运营</option>
        <option value="其他" ${admin.admin_role === '其他' || !admin.admin_role ? 'selected' : ''}>其他</option>
      </select>
    </div>
    <div class="form-group">
      <label>手机号</label>
      <input type="text" id="edit-admin-phone" value="${admin.phone || ''}">
    </div>
    <div class="form-group">
      <label>邮箱</label>
      <input type="text" id="edit-admin-email" value="${admin.email || ''}">
    </div>
    <div class="form-group">
      <label>职责描述</label>
      <textarea id="edit-admin-desc" rows="2">${admin.description || ''}</textarea>
    </div>
  `, `
    <button class="btn btn-outline" onclick="closeModal()">取消</button>
    <button class="btn btn-primary" onclick="confirmEditAdmin('${id}')">保存</button>
  `);
}

function onEditAdminSuperChange() {
  const isSuper = document.getElementById('edit-admin-is-super').value === '1';
  const roleGroup = document.getElementById('edit-admin-role-group');
  if (roleGroup) roleGroup.style.display = isSuper ? 'none' : 'block';
}

async function confirmEditAdmin(id) {
  const username = document.getElementById('edit-admin-username').value.trim();
  const name = document.getElementById('edit-admin-name').value.trim();
  const is_super = parseInt(document.getElementById('edit-admin-is-super').value);
  const admin_role = is_super ? undefined : (document.getElementById('edit-admin-role')?.value || '其他');
  const phone = document.getElementById('edit-admin-phone').value.trim();
  const email = document.getElementById('edit-admin-email').value.trim();
  const description = document.getElementById('edit-admin-desc').value.trim();
  
  const body = { username, name, is_super, phone, email, description };
  if (admin_role !== undefined) body.admin_role = admin_role;
  
  const res = await fetchAPI(`/admins/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  });
  if (res.success) { showToast('管理员信息已更新'); closeModal(); renderAdminManage(); }
  else { showToast(res.error || '更新失败', 'error'); }
}

async function resetAdminPassword(id, name) {
  const newPwd = prompt(`为「${name}」设置新密码：`, '123456');
  if (!newPwd) return;
  const res = await fetchAPI(`/admins/${id}/reset-password`, {
    method: 'POST', body: JSON.stringify({ password: newPwd })
  });
  if (res.success) { showToast(`「${name}」密码已重置`); }
  else { showToast(res.error || '重置失败', 'error'); }
}

async function deleteAdmin(id, name) {
  if (!confirm(`确定删除管理员「${name}」？删除后该管理员将无法登录系统。`)) return;
  const res = await fetchAPI(`/admins/${id}`, { method: 'DELETE' });
  if (res.success) { showToast('管理员已删除'); renderAdminManage(); }
  else { showToast(res.error || '删除失败', 'error'); }
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  window.addEventListener('resize', () => { if (!isMobile()) closeSidebar(); });
});
