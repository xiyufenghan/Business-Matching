/**
 * 入口：路由控制、用户信息加载、认证守卫
 */
import { renderDashboard } from './dashboard.js';
import { renderProducts }  from './products.js';
import { renderTalents }   from './talents.js';
import { renderMatching }  from './matching.js';
import { toast } from './utils.js';
import { initData } from './data.js';
import { getUser, getRole, isAdmin, isLoggedIn, doLogout, requireLogin } from './auth.js';

const routes = {
  dashboard: { name:'数据看板', render: renderDashboard },
  matching:  { name:'撮合管理', render: renderMatching },
  products:  { name:'商品货盘', render: renderProducts },
  talents:   { name:'达人管理', render: renderTalents },
};

const main = document.getElementById('appMain');
const nav  = document.getElementById('mainNav');

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'dashboard';
  return routes[h] ? h : 'dashboard';
}

function render() {
  const key = parseHash();
  // 更新导航激活态
  nav.querySelectorAll('[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === key);
  });
  const route = routes[key];
  document.title = `${route.name} · 教育行业商达撮合平台`;
  route.render(main);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

nav.querySelectorAll('[data-route]').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '#/' + a.dataset.route;
  });
});

// 先启动认证检查，再初始化数据
async function bootstrap() {
  // 展示加载状态
  main.innerHTML = `
    <div class="flex items-center justify-center py-24">
      <div class="text-slate-500 text-sm">
        <svg viewBox="0 0 24 24" class="w-8 h-8 mx-auto mb-3 animate-spin text-brand-500" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 11-6.22-8.56"/>
        </svg>
        正在加载商达撮合数据…
      </div>
    </div>`;
  
  // 1️⃣ 认证守卫：未登录跳转登录页
  if (!requireLogin()) return; // 会跳转，不继续执行
  
  // 2️⃣ 初始化业务数据
  try {
    await initData();
  } catch (e) {
    console.warn('initData unexpected error, continue with empty state', e);
  }
  
  // 3️⃣ 渲染页面 + 更新用户信息显示
  window.addEventListener('hashchange', render);
  render();
  updateUserInfo();
}
bootstrap();

/* ========== 用户信息（基于 Auth 系统） ========== */
function updateUserInfo() {
  const avatar = document.getElementById('userAvatar');
  const name = document.getElementById('userName');
  const dept = document.getElementById('userDept');
  const user = getUser();
  
  if (!user) { doLogout(); return; }
  
  // 显示用户名和角色
  name.textContent = user.name || user.username;
  const roleLabels = { admin: '管理员', operator: '运营' };
  dept.textContent = roleLabels[user.role] || user.role;
  
  // 文字头像（取姓名首字）
  if (avatar && avatar.parentNode) {
    avatar.style.display = 'none';
    let fb = avatar.parentNode.querySelector('.text-avatar-fallback');
    if (!fb) {
      fb = document.createElement('div');
      fb.className = 'text-avatar-fallback w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-pink-500 text-white grid place-items-center text-sm font-semibold';
      avatar.parentNode.insertBefore(fb, avatar);
    }
    fb.textContent = (user.name || user.username || '管').slice(0, 1);
  }
}

// 登出按钮事件绑定
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    // 在 header 区域添加登出按钮（如果有 userInfo 容器）
    const userInfo = document.getElementById('userInfo');
    if (userInfo) {
      const logoutBtn = document.createElement('button');
      logoutBtn.className = 'inline-flex items-center gap-1 px-3 h-9 rounded-lg hover:bg-red-50 text-slate-500 text-sm transition cursor-pointer border-none bg-transparent';
      logoutBtn.innerHTML = `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 002-2h4M16 17v-4M7 9l5 5"/></svg>退出`;
      logoutBtn.title = '退出登录';
      logoutBtn.onclick = () => {
        if (confirm('确定要退出登录吗？')) doLogout();
      };
      userInfo.appendChild(logoutBtn);
    }
  }, 100);
});

/* ========== 全局搜索（快捷键） ========== */
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    document.getElementById('globalSearch')?.focus();
  }
});
document.getElementById('globalSearch')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    // 简单跳转到撮合列表并搜索
    location.hash = '#/matching';
    setTimeout(() => {
      const inp = document.querySelector('#kwInp');
      if (inp) {
        inp.value = q;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 100);
  }
});