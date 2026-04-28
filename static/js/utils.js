/**
 * 工具函数：Excel导入导出、弹窗、Toast、通用渲染片段
 */

/* ========== Toast ========== */
export function toast(msg, type = 'info', duration = 2200) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const iconMap = {
    success: `<svg viewBox="0 0 24 24" class="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6L9 17l-5-5"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" class="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
    info:    `<svg viewBox="0 0 24 24" class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`
  };
  el.innerHTML = `${iconMap[type] || iconMap.info}<div class="text-slate-700">${msg}</div>`;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

/* ========== Modal ========== */
/**
 * @param {Object} options
 * @param {string} options.title 标题
 * @param {string} options.bodyHtml 主体html
 * @param {string} [options.footerHtml] 底部html
 * @param {string} [options.width] 最大宽度
 * @param {Function} [options.onMount] 挂载回调 (wrapEl, close) => void
 * @param {Function} [options.onBack] 若传入，则显示"返回"按钮，点击后调用此函数（用于返回上一层级）
 */
export function openModal({ title, bodyHtml, footerHtml = '', width = '640px', onMount, onBack }) {
  const root = document.getElementById('modalRoot');
  const wrap = document.createElement('div');
  wrap.className = 'modal-mask';
  const backBtnHtml = onBack ? `
    <button class="back-btn inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-700 px-2 py-1 rounded hover:bg-slate-100 mr-2" title="返回上一层">
      <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      返回
    </button>` : '';
  wrap.innerHTML = `
    <div class="modal-card" style="max-width:${width}">
      <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div class="flex items-center min-w-0">
          ${backBtnHtml}
          <div class="text-base font-semibold text-slate-800 truncate">${title}</div>
        </div>
        <button class="close-btn w-8 h-8 grid place-items-center rounded-md hover:bg-slate-100 text-slate-400 shrink-0">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="px-6 py-5 overflow-y-auto flex-1">${bodyHtml}</div>
      ${footerHtml ? `<div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">${footerHtml}</div>` : ''}
    </div>
  `;
  root.appendChild(wrap);

  const close = () => {
    wrap.style.transition = 'opacity .15s';
    wrap.style.opacity = '0';
    setTimeout(() => wrap.remove(), 150);
  };
  wrap.querySelector('.close-btn').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  const backEl = wrap.querySelector('.back-btn');
  if (backEl && onBack) {
    backEl.addEventListener('click', () => { close(); onBack(); });
  }

  if (onMount) onMount(wrap, close);

  return { el: wrap, close };
}

export function confirmDialog({ title = '确认操作', content, okText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const footer = `
      <button class="btn btn-ghost" data-act="cancel">取消</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${okText}</button>
    `;
    const { el, close } = openModal({
      title, width: '420px',
      bodyHtml: `<div class="text-sm text-slate-600 leading-relaxed">${content}</div>`,
      footerHtml: footer,
      onMount(root) {
        root.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); resolve(false); });
        root.querySelector('[data-act="ok"]').addEventListener('click', () => { close(); resolve(true); });
      }
    });
  });
}

/* ========== Excel 导入/导出 ========== */
export function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        resolve(json);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function exportExcel(rows, filename = 'export.xlsx', sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

export function downloadTemplate(headers, filename) {
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '模板');
  XLSX.writeFile(wb, filename);
}

/* ========== 通用片段 ========== */
export function emptyState(text = '暂无数据') {
  return `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M3 7h18M3 12h18M3 17h18"/>
    </svg>
    <div>${text}</div>
  </div>`;
}

export function formatNumber(n) {
  if (n == null || n === '') return '-';
  n = Number(n);
  if (isNaN(n)) return '-';
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return n.toLocaleString();
}

export function formatMoney(n) {
  if (n == null || n === '' || Number(n) === 0) return '¥ 0';
  n = Number(n);
  if (n >= 10000) return '¥ ' + (n / 10000).toFixed(2) + 'w';
  return '¥ ' + n.toLocaleString();
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 获取URL参数 */
export function debounce(fn, ms = 200) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ========== 通用分页 ========== */
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/**
 * 对列表进行分页切片
 * @param {Array} list 原列表
 * @param {number} page 当前页（1-based）
 * @param {number} pageSize 每页条数
 * @returns {{ pageList: Array, page: number, pageSize: number, total: number, totalPages: number }}
 */
export function paginate(list, page = 1, pageSize = 20) {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (p - 1) * pageSize;
  const pageList = list.slice(start, start + pageSize);
  return { pageList, page: p, pageSize, total, totalPages };
}

/**
 * 渲染分页器 HTML
 * @param {{ page:number, pageSize:number, total:number, totalPages:number }} info
 */
export function renderPagination(info) {
  const { page, pageSize, total, totalPages } = info;
  if (total === 0) return '';
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  // 生成页码按钮（含省略号）
  const pages = [];
  const pushPage = (n) => pages.push(
    `<button class="pg-btn ${n === page ? 'pg-active' : ''}" data-pg-go="${n}">${n}</button>`
  );
  const pushGap = () => pages.push('<span class="pg-gap">…</span>');

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pushPage(i);
  } else {
    pushPage(1);
    if (page > 4) pushGap();
    const s = Math.max(2, page - 2);
    const e = Math.min(totalPages - 1, page + 2);
    for (let i = s; i <= e; i++) pushPage(i);
    if (page < totalPages - 3) pushGap();
    pushPage(totalPages);
  }

  return `
    <div class="pg-wrap flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-sm">
      <div class="text-slate-500">
        共 <b class="text-slate-700">${total}</b> 条 · 当前 <b class="text-slate-700">${start}-${end}</b>
      </div>
      <div class="flex items-center gap-1">
        <button class="pg-btn" data-pg-prev ${page <= 1 ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        ${pages.join('')}
        <button class="pg-btn" data-pg-next ${page >= totalPages ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>
      <div class="flex items-center gap-2 text-slate-500">
        <span>每页</span>
        <select class="pg-size inp" style="height:30px;padding:0 26px 0 10px;font-size:13px;width:auto">
          ${PAGE_SIZE_OPTIONS.map(n => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        <span>条</span>
      </div>
    </div>
  `;
}

/**
 * 为分页器元素绑定事件
 * @param {HTMLElement} rootEl 分页器所在的父元素（通常就是 main）
 * @param {{ page:number, pageSize:number, totalPages:number }} info
 * @param {(next:{page:number, pageSize:number}) => void} onChange 回调
 */
export function bindPagination(rootEl, info, onChange) {
  const wrap = rootEl.querySelector('.pg-wrap');
  if (!wrap) return;
  const { page, pageSize, totalPages } = info;

  wrap.querySelectorAll('[data-pg-go]').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.pgGo);
      if (n && n !== page) onChange({ page: n, pageSize });
    });
  });
  const prev = wrap.querySelector('[data-pg-prev]');
  if (prev) prev.addEventListener('click', () => { if (page > 1) onChange({ page: page - 1, pageSize }); });
  const next = wrap.querySelector('[data-pg-next]');
  if (next) next.addEventListener('click', () => { if (page < totalPages) onChange({ page: page + 1, pageSize }); });
  const sel = wrap.querySelector('.pg-size');
  if (sel) sel.addEventListener('change', e => {
    onChange({ page: 1, pageSize: Number(e.target.value) || 20 });
  });
}

/* ========== 通用下拉联想搜索选择器 ==========
 * 统一"撮合管理 / 商品货盘 / 达人管理"等模块的搜索框交互：
 * 输入时显示候选面板，支持上下键导航、Enter 选中、Esc 关闭。
 *
 * @param {Object} opt
 * @param {HTMLInputElement} opt.input   输入框元素
 * @param {HTMLElement}      opt.suggest 候选面板容器（需已存在于 DOM，类名建议 .search-suggest.hidden）
 * @param {HTMLInputElement} [opt.hidden]  可选：隐藏字段元素（存储已选 item.id）
 * @param {() => Array}      opt.source  数据源函数（实时调用，保证拿到最新列表）
 * @param {(item, kw) => boolean} opt.matchFn   过滤函数，kw 已转小写
 * @param {(item) => string}      opt.renderItem 候选项 HTML 渲染
 * @param {(item) => string}      [opt.formatSelected] 选中后回填到输入框的展示文本（默认 item.name || item.id）
 * @param {(item) => void}        [opt.onSelect] 选中某项时触发（常用于"应用筛选"/"跳转详情"）
 * @param {(kw: string) => void}  [opt.onInput]  每次输入同步（常用于把 kw 写入 state 并刷新列表）
 * @param {number} [opt.max=20] 最多展示候选项
 * @param {boolean} [opt.clearOnInput=true] 用户重新输入时是否清空 hidden（picker 场景 true；搜索框场景通常可关闭）
 */
export function bindSuggestPicker(opt) {
  const inp = opt.input;
  const sug = opt.suggest;
  const hid = opt.hidden || null;
  if (!inp || !sug) return;

  const max = opt.max || 20;
  const clearOnInput = opt.clearOnInput !== false;
  let activeIdx = -1;
  let currentList = [];

  const fmtSel = opt.formatSelected || (x => x.name || x.id || '');

  const render = (kw) => {
    const src = opt.source() || [];
    const k = (kw || '').trim().toLowerCase();
    currentList = k
      ? src.filter(x => opt.matchFn(x, k)).slice(0, max)
      : src.slice(0, max);
    if (!currentList.length) {
      sug.innerHTML = `<div class="search-suggest-empty">无匹配结果</div>`;
    } else {
      sug.innerHTML = currentList.map((x, i) => `
        <div class="search-suggest-item ${i===activeIdx?'active':''}" data-idx="${i}">
          ${opt.renderItem(x)}
        </div>
      `).join('');
    }
    sug.classList.remove('hidden');
    sug.querySelectorAll('.search-suggest-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        const i = Number(el.dataset.idx);
        const x = currentList[i];
        if (x) pick(x);
      });
    });
  };

  const pick = (x) => {
    if (hid) hid.value = x.id || '';
    inp.value = fmtSel(x);
    sug.classList.add('hidden');
    if (opt.onSelect) opt.onSelect(x);
  };

  // ====== IME 中文输入法适配 ======
  // 中文输入法在候选词组合期间会连续触发 input 事件，此时若立即调用 onInput 引发外部
  // DOM 重绘（draw），会销毁当前 input 元素，导致输入法失去焦点、已输入的拼音被清空，
  // 表现为"搜索框只能输入英文"。通过 compositionstart/compositionend 标记组合态，
  // 组合中仅本地渲染候选面板、不触发 onInput 外部回调；组合结束后再统一触发一次。
  let composing = false;
  inp.addEventListener('compositionstart', () => { composing = true; });
  inp.addEventListener('compositionend', () => {
    composing = false;
    if (clearOnInput && hid) hid.value = '';
    activeIdx = -1;
    render(inp.value);
    if (opt.onInput) opt.onInput(inp.value);
  });

  inp.addEventListener('focus', () => { activeIdx = -1; render(inp.value); });
  inp.addEventListener('input', () => {
    if (clearOnInput && hid) hid.value = '';
    activeIdx = -1;
    // 组合输入期间只在本地渲染候选，不触发外部 onInput（避免外部 draw 打断 IME）
    if (composing) {
      render(inp.value);
      return;
    }
    render(inp.value);
    if (opt.onInput) opt.onInput(inp.value);
  });
  inp.addEventListener('blur', () => {
    // 延迟隐藏以便 mousedown 能先触发
    setTimeout(() => sug.classList.add('hidden'), 150);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { sug.classList.add('hidden'); return; }
    // 中文输入法正在组合候选时，键盘导航/Enter 应交给输入法处理，不拦截
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (!currentList.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(currentList.length - 1, activeIdx + 1);
      render(inp.value);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      render(inp.value);
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && currentList[activeIdx]) {
        e.preventDefault();
        pick(currentList[activeIdx]);
      }
    }
  });

  // 若绑定时该输入框即为当前活动元素（通常因为外部 onInput 触发了 DOM 重绘），
  // 自动触发一次渲染以保持候选面板可见，用户可继续连贯输入与浏览。
  if (document.activeElement === inp) {
    activeIdx = -1;
    render(inp.value);
  }

  return { render, pick };
}