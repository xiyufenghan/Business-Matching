/**
 * 商品货盘管理
 *  - 图书货盘字段：供应链名称(supplier)、目标人群(targetAudience)、书名(name)、图书分类(category)、
 *    产品图片(image)、图书介绍(intro)、微信小店商品链接(shopLink)、规格(spec)、
 *    带货售价-控价(salePrice)、纯佣金%(commissionPolicy)、投流佣金%(adCommissionPolicy)、
 *    物流快递(logistics)、库存(stock)
 *  - 课程货盘字段：课程图片(image)、课程名称(name)、客单价(price)、货品类型(courseType)、
 *    学段(stage)、学科(subject)、课程介绍(intro)、课程链接(courseLink)
 *  - 支持：新增/编辑、批量上传(本地Excel)、批量编辑、批量删除、导出
 *  - 图片上传：仅限 png/jpg，≤200KB，显示为 Data URL
 *  - 列内编辑：表格中任意可编辑字段（editable）点击进入就地编辑
 */
import {
  getProducts, upsertProduct, deleteProducts, batchUpsertProducts, nextId,
  deleteAllProducts, deleteProductsByType,
  sortBySortWeight, updateSortWeight,
  CATEGORIES, COURSE_TYPES, COURSE_STAGES, COURSE_SUBJECTS, PRODUCT_TYPES
} from './data.js';
import {
  toast, openModal, confirmDialog,
  parseExcel, exportExcel, downloadTemplate,
  formatMoney, formatNumber, escapeHtml,
  paginate, renderPagination, bindPagination,
  bindSuggestPicker
} from './utils.js';

const TARGET_AUDIENCE_OPTIONS = ['学生家长', '少儿', '青年读者', '中老年读者', '教师', '泛兴趣人群', '行业从业者'];
const LOGISTICS_OPTIONS = ['中通', '顺丰', '圆通', '京东物流', '邮政', '极兔', 'EMS', '自发'];

/* ========== 目标人群多值工具（支持字符串/数组双格式兼容） ========== */
// 支持以下分隔符：中英文逗号、顿号、分号、斜杠、竖线、空格
const AUDIENCE_SPLIT_RE = /[,，、;；/|｜]+|\s{2,}/g;
function normalizeAudiences(val) {
  if (val == null) return [];
  if (Array.isArray(val)) {
    return [...new Set(val.map(s => String(s).trim()).filter(Boolean))];
  }
  const s = String(val).trim();
  if (!s) return [];
  return [...new Set(s.split(AUDIENCE_SPLIT_RE).map(x => x.trim()).filter(Boolean))];
}
function formatAudiences(val) {
  // 用于导出/兼容旧单字符串展示：以中文顿号连接
  return normalizeAudiences(val).join('、');
}
function renderAudienceBadges(val) {
  const list = normalizeAudiences(val);
  if (!list.length) return '<span class="text-slate-300">-</span>';
  return list.map(x => `<span class="badge badge-cyan">${escapeHtml(x)}</span>`).join('');
}
/**
 * 通用多值 badge 渲染（与 renderAudienceBadges 同逻辑，但可自定义 badge 样式）
 * 用于课程货盘的 courseType / stage / subject 多值字段，以及其他多值场景
 */
function renderMultiBadges(val, badgeCls = 'badge-slate') {
  const list = normalizeAudiences(val);
  if (!list.length) return '<span class="text-slate-300">-</span>';
  return list.map(x => `<span class="badge ${badgeCls}">${escapeHtml(x)}</span>`).join('');
}

const state = {
  tab: 'book',
  keyword: '',
  category: '',
  selected: new Set(),
  page: 1,
  pageSize: 20,
};

export function renderProducts(main) {
  state.selected.clear();
  draw(main);
}

/* ========== 图片上传工具：png/jpg，<=200KB，返回 Data URL ========== */
function readImageAsDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('未选择文件'));
    const type = (file.type || '').toLowerCase();
    const ok = ['image/png', 'image/jpeg', 'image/jpg'].includes(type) ||
               /\.(png|jpe?g)$/i.test(file.name);
    if (!ok) return reject(new Error('仅支持 PNG / JPG 格式'));
    if (file.size > 200 * 1024) return reject(new Error('图片不能超过 200KB'));
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('读取失败'));
    r.readAsDataURL(file);
  });
}

function bindImageUpload(rootEl, previewId, inputName, hiddenInputSelector) {
  const btn = rootEl.querySelector(`[data-upload-for="${previewId}"]`);
  const preview = rootEl.querySelector(`#${previewId}`);
  const hidden = rootEl.querySelector(hiddenInputSelector);
  if (!btn || !preview || !hidden) return;
  btn.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const dataUrl = await readImageAsDataURL(f);
        hidden.value = dataUrl;
        preview.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover"/>`;
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    inp.click();
  });
}

function draw(main) {
  const all = getProducts();
  const typed = all.filter(p => (p.type || 'book') === state.tab);
  const list = sortBySortWeight(filter(typed));
  const pgInfo = paginate(list, state.page, state.pageSize);
  state.page = pgInfo.page;
  const pageList = pgInfo.pageList;
  const selectedCount = state.selected.size;
  const bookCount = all.filter(p => (p.type || 'book') === 'book').length;
  const courseCount = all.filter(p => p.type === 'course').length;
  const avgCommission = all.length
    ? (all.reduce((s, p) => {
        const v = (p.commissionPolicy != null && p.commissionPolicy !== '')
          ? Number(p.commissionPolicy)
          : Number(p.commissionRate);
        return s + (Number.isFinite(v) ? v : 0);
      }, 0) / all.length).toFixed(1)
    : 0;

  main.innerHTML = `
    <div class="fade-in">
      <div class="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <a href="#/dashboard" class="hover:text-brand-700">首页</a>
            <span>›</span>
            <span class="text-slate-600">商品货盘</span>
          </div>
          <h1 class="text-2xl font-bold text-slate-900">商品货盘管理</h1>
          <p class="text-sm text-slate-500 mt-1">货盘总量 <b class="text-brand-700">${all.length}</b> 件 · 图书 <b class="text-slate-700">${bookCount}</b> 册 · 课程 <b class="text-slate-700">${courseCount}</b> 门 · 字段支持列内编辑，修改后动态更新</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button class="btn btn-ghost" id="exportBtn">导出</button>
          <div class="relative inline-block" id="prodDangerWrap">
            <button class="btn btn-ghost" id="prodDangerBtn" title="批量清空操作">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/></svg>
              一键删除
              <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div id="prodDangerMenu" class="absolute right-0 top-full mt-1 w-56 rounded-lg bg-white border border-slate-200 shadow-lg py-1 z-20 hidden">
              <button data-prod-danger="all" class="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2 ${all.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}" ${all.length === 0 ? 'disabled' : ''}>
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                删除全部商品货盘 <span class="text-xs text-slate-400 ml-auto">${all.length}</span>
              </button>
              <div class="border-t border-slate-100 my-1"></div>
              <button data-prod-danger="book" class="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-600 flex items-center gap-2 ${bookCount === 0 ? 'opacity-40 cursor-not-allowed' : ''}" ${bookCount === 0 ? 'disabled' : ''}>
                <span class="w-5 h-5 rounded bg-violet-500 text-white text-[11px] font-bold grid place-items-center shrink-0">书</span>
                删除所有图书货盘 <span class="text-xs text-slate-400 ml-auto">${bookCount}</span>
              </button>
              <button data-prod-danger="course" class="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-600 flex items-center gap-2 ${courseCount === 0 ? 'opacity-40 cursor-not-allowed' : ''}" ${courseCount === 0 ? 'disabled' : ''}>
                <span class="w-5 h-5 rounded bg-cyan-500 text-white text-[11px] font-bold grid place-items-center shrink-0">课</span>
                删除所有课程货盘 <span class="text-xs text-slate-400 ml-auto">${courseCount}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 货盘总量统计卡片 -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="card p-4 flex items-center gap-3 hover-lift bg-gradient-to-br from-brand-50 to-pink-50 border-brand-200">
          <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-pink-500 grid place-items-center text-white">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7L12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>
          </div>
          <div>
            <div class="text-xs text-slate-500">货盘总量</div>
            <div class="text-2xl font-bold text-slate-900">${all.length} <span class="text-sm font-normal text-slate-400">件</span></div>
          </div>
        </div>
        <div class="card p-4 flex items-center gap-3 hover-lift">
          <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 grid place-items-center text-white">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
          </div>
          <div>
            <div class="text-xs text-slate-500">图书货盘</div>
            <div class="text-2xl font-bold text-slate-900">${bookCount} <span class="text-sm font-normal text-slate-400">册</span></div>
          </div>
        </div>
        <div class="card p-4 flex items-center gap-3 hover-lift">
          <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 grid place-items-center text-white">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          </div>
          <div>
            <div class="text-xs text-slate-500">课程货盘</div>
            <div class="text-2xl font-bold text-slate-900">${courseCount} <span class="text-sm font-normal text-slate-400">门</span></div>
          </div>
        </div>
        <div class="card p-4 flex items-center gap-3 hover-lift">
          <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 grid place-items-center text-white">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
          </div>
          <div>
            <div class="text-xs text-slate-500">平均纯佣金率</div>
            <div class="text-2xl font-bold text-slate-900">${avgCommission}<span class="text-sm font-normal text-slate-400">%</span></div>
          </div>
        </div>
      </div>

      <!-- 类型 Tab 切换 -->
      <div class="card p-2 mb-4 inline-flex items-center gap-1">
        ${PRODUCT_TYPES.map(pt => `
          <button data-tab="${pt.key}" class="tab-btn px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition
            ${state.tab === pt.key ? 'bg-gradient-to-r from-brand-500 to-pink-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}">
            ${pt.key === 'book'
              ? `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>`
              : `<svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`}
            ${pt.name}
            <span class="text-xs ${state.tab === pt.key ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'} px-1.5 rounded">${pt.key === 'book' ? bookCount : courseCount}</span>
          </button>
        `).join('')}
      </div>

      <!-- 筛选 -->
      <div class="card p-4 mb-4">
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex-1 min-w-[240px] relative" id="kwWrap">
            <input id="kwInp" class="inp" placeholder="${state.tab === 'book' ? '搜索书名 / 供应链 / 编号' : '搜索课程名称 / 学科 / 编号'}" value="${escapeHtml(state.keyword)}" autocomplete="off"/>
            <div class="search-suggest hidden" id="kwSuggest"></div>
          </div>
          <select id="catSel" class="inp" style="width:160px">
            <option value="">${state.tab === 'book' ? '全部分类' : '全部学段'}</option>
            ${(state.tab === 'book' ? CATEGORIES : COURSE_STAGES).map(c => `<option value="${c}" ${state.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" id="resetBtn">重置</button>
          ${selectedCount > 0 ? `
            <div class="ml-auto flex items-center gap-2">
              <span class="text-sm text-slate-500">已选 <b class="text-brand-700">${selectedCount}</b> 项</span>
              <button class="btn btn-ghost btn-sm" id="batchEditBtn">批量编辑</button>
              <button class="btn btn-danger btn-sm" id="batchDelBtn">批量删除</button>
            </div>
          ` : ''}
          ${list.length > 0 ? `
            <button class="btn btn-danger btn-sm ${selectedCount === 0 ? 'ml-auto' : ''}" id="delFilterBtn" title="删除当前筛选匹配的全部${state.tab === 'book' ? '图书' : '课程'}">
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 11v6M14 11v6M4 7h16M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13M9 7V4h6v3"/></svg>
              删除筛选结果 (${list.length})
            </button>
          ` : ''}
        </div>
      </div>

      <!-- 主列表 -->
      <div class="card overflow-hidden">
        ${state.tab === 'book' ? renderBookTable(pageList) : renderCourseTable(pageList)}
        ${renderPagination(pgInfo)}
      </div>
    </div>
  `;

  // Tab 切换
  main.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    if (state.tab === b.dataset.tab) return;
    state.tab = b.dataset.tab;
    state.keyword = '';
    state.category = '';
    state.selected.clear();
    state.page = 1;
    draw(main);
  }));

  // 统一交互的搜索联想下拉（与撮合管理"新建撮合"中的搜索器一致）
  // 注意：不在这里直接绑定 input 事件重绘，交给 bindSuggestPicker 的 onInput 统一处理，
  // 以便支持中文输入法（IME composition）期间不重绘 DOM，避免输入法失去锚点。
  const kwInp     = main.querySelector('#kwInp');
  const kwSuggest = main.querySelector('#kwSuggest');
  if (kwInp && kwSuggest) {
    bindSuggestPicker({
      input: kwInp,
      suggest: kwSuggest,
      max: 20,
      source: () => getProducts().filter(p => (p.type || 'book') === state.tab),
      matchFn: (p, kw) => {
        const audStr = Array.isArray(p.targetAudience) ? p.targetAudience.join(' ') : (p.targetAudience || '');
        const subj = Array.isArray(p.subject) ? p.subject.join(' ') : (p.subject || '');
        const stg = Array.isArray(p.stage) ? p.stage.join(' ') : (p.stage || '');
        const ct = Array.isArray(p.courseType) ? p.courseType.join(' ') : (p.courseType || '');
        const str = [p.id, p.name, p.category, p.supplier, p.publisher, p.merchant, subj, stg, ct, audStr]
          .filter(Boolean).join(' ').toLowerCase();
        return str.includes(kw);
      },
      renderItem: (p) => `
        <div class="flex items-center gap-2">
          <span class="badge ${(p.type||'book')==='book'?'badge-purple':'badge-cyan'} text-[10px]">${(p.type||'book')==='book'?'图书':'课程'}</span>
          <span class="flex-1 truncate text-sm text-slate-800">${escapeHtml(p.name)}</span>
          <span class="text-xs text-slate-400 font-mono">${p.id}</span>
          <span class="text-xs text-emerald-600">¥${p.salePrice != null && p.salePrice !== '' ? p.salePrice : (p.price||0)}</span>
        </div>`,
      formatSelected: (p) => p.name,
      onSelect: (p) => {
        state.keyword = p.name || '';
        state.page = 1;
        draw(main);
      },
      onInput: (kw) => {
        state.keyword = kw;
        state.page = 1;
        draw(main);
        // 重绘后恢复焦点，保证连贯输入
        const newInp = main.querySelector('#kwInp');
        if (newInp && document.activeElement !== newInp) newInp.focus();
      }
    });
  }
  main.querySelector('#catSel').addEventListener('change', e => { state.category = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#resetBtn').addEventListener('click', () => {
    state.keyword = ''; state.category = ''; state.selected.clear(); state.page = 1; draw(main);
  });

  main.querySelector('#exportBtn').addEventListener('click', () => exportCurrent(list));

  // 一键删除下拉菜单
  const prodDangerBtn = main.querySelector('#prodDangerBtn');
  const prodDangerMenu = main.querySelector('#prodDangerMenu');
  if (prodDangerBtn && prodDangerMenu) {
    const closeDanger = () => prodDangerMenu.classList.add('hidden');
    prodDangerBtn.addEventListener('click', e => {
      e.stopPropagation();
      prodDangerMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', e => {
      if (!main.querySelector('#prodDangerWrap')?.contains(e.target)) closeDanger();
    });
    prodDangerMenu.querySelectorAll('[data-prod-danger]').forEach(btn => {
      btn.addEventListener('click', async () => {
        closeDanger();
        const act = btn.dataset.prodDanger;
        if (act === 'all') {
          if (!all.length) return toast('暂无商品可删除', 'info');
          const ok = await confirmDialog({
            title: '删除全部商品货盘', danger: true, okText: `删除 ${all.length} 件`,
            content: `将<b class="text-rose-600">永久删除全部 ${all.length} 件商品</b>（含图书 ${bookCount} 册 / 课程 ${courseCount} 门），相关撮合关联将失效，此操作不可恢复。`
          });
          if (ok) { await deleteAllProducts(); state.selected.clear(); state.page = 1; toast(`已清空全部商品货盘（${all.length} 件）`, 'success'); draw(main); }
        } else if (act === 'book') {
          if (!bookCount) return toast('暂无图书可删除', 'info');
          const ok = await confirmDialog({
            title: '删除所有图书货盘', danger: true, okText: `删除 ${bookCount} 册`,
            content: `将<b class="text-rose-600">永久删除全部 ${bookCount} 册图书货盘</b>，此操作不可恢复。`
          });
          if (ok) { await deleteProductsByType('book'); state.selected.clear(); state.page = 1; toast(`已删除图书 ${bookCount} 册`, 'success'); draw(main); }
        } else if (act === 'course') {
          if (!courseCount) return toast('暂无课程可删除', 'info');
          const ok = await confirmDialog({
            title: '删除所有课程货盘', danger: true, okText: `删除 ${courseCount} 门`,
            content: `将<b class="text-rose-600">永久删除全部 ${courseCount} 门课程货盘</b>，此操作不可恢复。`
          });
          if (ok) { await deleteProductsByType('course'); state.selected.clear(); state.page = 1; toast(`已删除课程 ${courseCount} 门`, 'success'); draw(main); }
        }
      });
    });
  }

  const be = main.querySelector('#batchEditBtn');
  if (be) be.addEventListener('click', () => openBatchEdit(main));
  const bd = main.querySelector('#batchDelBtn');
  if (bd) bd.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '批量删除', danger: true, okText: '确认删除',
      content: `确定要删除选中的 <b>${state.selected.size}</b> 项吗？此操作不可撤销。`
    });
    if (ok) { await deleteProducts([...state.selected]); state.selected.clear(); toast('已删除', 'success'); draw(main); }
  });

  const delFilter = main.querySelector('#delFilterBtn');
  if (delFilter) delFilter.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: '删除筛选结果', danger: true, okText: `删除 ${list.length} 项`,
      content: `将删除与当前筛选匹配的全部 <b>${list.length}</b> 项${state.tab === 'book' ? '图书' : '课程'}，此操作不可撤销。`
    });
    if (ok) { await deleteProducts(list.map(p => p.id)); state.selected.clear(); toast(`已删除 ${list.length} 项`, 'success'); draw(main); }
  });

  bindGridEvents(main, pageList);
  bindInlineEditors(main);

  bindPagination(main, pgInfo, ({ page, pageSize }) => {
    state.page = page;
    state.pageSize = pageSize;
    draw(main);
  });
}

function filter(list) {
  const kw = state.keyword.trim().toLowerCase();
  return list.filter(p => {
    if (state.category) {
      if (state.tab === 'book' && p.category !== state.category) return false;
      if (state.tab === 'course') {
        // stage 可能是数组（多值）或字符串（旧）
        const stages = normalizeAudiences(p.stage);
        if (!stages.includes(state.category)) return false;
      }
    }
    if (kw) {
      const audStr = Array.isArray(p.targetAudience) ? p.targetAudience.join(' ') : (p.targetAudience || '');
      const fields = state.tab === 'book'
        ? [p.name, p.supplier, p.merchant, p.publisher, p.id, p.category, audStr]
        : [p.name, p.subject, p.id, p.courseType, p.stage];
      if (!fields.filter(Boolean).some(f => String(f).toLowerCase().includes(kw))) return false;
    }
    return true;
  });
}

/* ========== 图书表格视图 ========== */
function renderBookTable(products) {
  if (!products.length) return `<div class="empty">暂无数据，点击右上角"录入图书"或"批量上传"开始</div>`;
  return `
    <div class="overflow-x-auto">
      <table class="tbl products-tbl book-tbl">
        <colgroup>
          <col class="col-chk" />
          <col class="col-seq" />
          <col class="col-supplier" />
          <col class="col-audience" />
          <col class="col-name" />
          <col class="col-cat" />
          <col class="col-img" />
          <col class="col-link" />
          <col class="col-spec" />
          <col class="col-price" />
          <col class="col-comm" />
          <col class="col-adcomm" />
          <col class="col-logi" />
          <col class="col-stock" />
          <col class="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th><input id="chkAll" type="checkbox" class="chk"/></th>
            <th title="序号越大越靠前">序号</th>
            <th>供应链名称</th>
            <th>目标人群</th>
            <th>书名</th>
            <th>图书分类</th>
            <th>产品图片</th>
            <th>微信小店商品链接</th>
            <th>规格</th>
            <th class="text-right">带货售价（控价）</th>
            <th class="text-right">纯佣金</th>
            <th class="text-right">投流佣金（%）</th>
            <th>物流快递</th>
            <th class="text-right">库存</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${products.map((p, idx) => {
            const seq = idx + 1 + (state.page - 1) * state.pageSize;
            const sortWeight = Number(p.sortWeight) || 0;
            // 显示值：若已设置 sortWeight（>=1）则显示该值；否则用自然序号作为占位展示
            const displaySeq = sortWeight >= 1 ? sortWeight : seq;
            return `
            <tr data-id="${p.id}" class="${state.selected.has(p.id) ? 'selected' : ''}">
              <td class="nowrap"><input type="checkbox" class="chk" ${state.selected.has(p.id) ? 'checked' : ''}/></td>
              <td class="seq-cell nowrap">
                <span class="seq-badge" data-seq-id="${p.id}" data-seq-kind="product" data-seq-current="${displaySeq}" title="点击修改序号：数字越大越靠前（最小值 1）">${displaySeq}</span>
              </td>
              <td class="editable clamp-2 text-slate-600" data-field="supplier" data-type="text" title="${escapeHtml(p.supplier || p.publisher || p.merchant || '')}">${escapeHtml(p.supplier || p.publisher || p.merchant || '-')}</td>
              <td class="editable clamp-2" data-field="targetAudience" data-type="tags" data-options="${escapeHtml(TARGET_AUDIENCE_OPTIONS.join('|'))}" title="${escapeHtml(formatAudiences(p.targetAudience))}">
                <div class="tag-list clamp-2-inner">${renderAudienceBadges(p.targetAudience)}</div>
              </td>
              <td class="editable" data-field="name" data-type="text" title="${escapeHtml(p.name)}">
                <div class="prod-name">${escapeHtml(p.name)}</div>
                <div class="prod-id clamp-1">${p.id}</div>
              </td>
              <td class="editable nowrap" data-field="category" data-type="select" data-options="${escapeHtml(CATEGORIES.join('|'))}">
                <span class="badge badge-purple">${escapeHtml(p.category || '-')}</span>
              </td>
              <td class="nowrap">
                ${p.image
                  ? `<img src="${escapeHtml(p.image)}" data-zoom="${escapeHtml(p.image)}" data-zoom-title="${escapeHtml(p.name || '')}" onerror="this.style.display='none'" class="w-10 h-10 object-cover rounded border border-slate-200 img-zoomable" alt="${escapeHtml(p.name || '')}" title="点击查看大图"/>`
                  : `<div class="w-10 h-10 rounded border border-slate-200 bg-slate-50 grid place-items-center text-[10px] text-slate-300">无图</div>`}
              </td>
              <td class="link-col">
                ${p.shopLink
                  ? `<a href="${escapeHtml(p.shopLink)}" target="_blank" class="text-brand-600 hover:underline" title="${escapeHtml(p.shopLink)}">${escapeHtml(p.shopLink)}</a>`
                  : '<span class="text-slate-300">-</span>'}
              </td>
              <td class="editable clamp-2 text-slate-600" data-field="spec" data-type="text" title="${escapeHtml(p.spec || '')}">${escapeHtml(p.spec || '-')}</td>
              <td class="editable text-right font-semibold num-col" data-field="salePrice" data-type="number">¥${p.salePrice != null && p.salePrice !== '' ? p.salePrice : (p.price || 0)}</td>
              <td class="editable text-right num-col" data-field="commissionPolicy" data-type="number">${(p.commissionPolicy != null && p.commissionPolicy !== '') ? `<b class="text-brand-700">${p.commissionPolicy}%</b>` : ((p.commissionRate != null && p.commissionRate !== '' && Number(p.commissionRate) > 0) ? `<b class="text-brand-700">${p.commissionRate}%</b>` : '<span class="text-slate-300">-</span>')}</td>
              <td class="editable text-right num-col" data-field="adCommissionPolicy" data-type="number">${(p.adCommissionPolicy != null && p.adCommissionPolicy !== '') ? `<b class="text-brand-700">${p.adCommissionPolicy}%</b>` : '<span class="text-slate-300">-</span>'}</td>
              <td class="editable nowrap" data-field="logistics" data-type="select" data-options="${escapeHtml(LOGISTICS_OPTIONS.join('|'))}">
                ${p.logistics ? `<span class="badge badge-slate">${escapeHtml(p.logistics)}</span>` : '<span class="text-slate-300">-</span>'}
              </td>
              <td class="editable text-right text-slate-600 num-col" data-field="stock" data-type="number">${formatNumber(p.stock || 0)}</td>
              <td class="actions-col nowrap">
                <button class="text-brand-600 hover:underline" data-act="view">详情</button>
                <button class="text-brand-600 hover:underline" data-act="edit">编辑</button>
                <button class="text-rose-500 hover:underline" data-act="del">删除</button>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ========== 课程列表视图（表格形式，支持 inline 编辑） ========== */
function renderCourseTable(products) {
  if (!products.length) return `<div class="empty">暂无课程，点击右上角"录入课程"或"批量上传"开始</div>`;
  return `
    <div class="overflow-x-auto">
      <table class="tbl products-tbl course-tbl">
        <colgroup>
          <col class="col-chk" />
          <col class="col-seq" />
          <col class="col-img" />
          <col class="col-name" />
          <col class="col-price" />
          <col class="col-type" />
          <col class="col-stage" />
          <col class="col-subject" />
          <col class="col-intro" />
          <col class="col-link" />
          <col class="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th><input id="chkAll" type="checkbox" class="chk"/></th>
            <th title="序号越大越靠前">序号</th>
            <th>课程图片</th>
            <th>课程名称</th>
            <th class="text-right">客单价</th>
            <th>货品类型</th>
            <th>学段</th>
            <th>学科</th>
            <th>课程介绍</th>
            <th>课程链接</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${products.map((p, idx) => {
            const seq = idx + 1 + (state.page - 1) * state.pageSize;
            const sortWeight = Number(p.sortWeight) || 0;
            const displaySeq = sortWeight >= 1 ? sortWeight : seq;
            return `
            <tr data-id="${p.id}" class="${state.selected.has(p.id) ? 'selected' : ''}">
              <td class="nowrap"><input type="checkbox" class="chk" ${state.selected.has(p.id) ? 'checked' : ''}/></td>
              <td class="seq-cell nowrap">
                <span class="seq-badge" data-seq-id="${p.id}" data-seq-kind="product" data-seq-current="${displaySeq}" title="点击修改序号：数字越大越靠前（最小值 1）">${displaySeq}</span>
              </td>
              <td class="nowrap">
                ${p.image
                  ? `<img src="${escapeHtml(p.image)}" data-zoom="${escapeHtml(p.image)}" data-zoom-title="${escapeHtml(p.name || '')}" onerror="this.style.display='none'" class="w-12 h-12 object-cover rounded border border-slate-200 img-zoomable" alt="${escapeHtml(p.name || '')}" title="点击查看大图"/>`
                  : `<div class="w-12 h-12 rounded border border-slate-200 bg-slate-50 grid place-items-center text-[10px] text-slate-300">无图</div>`}
              </td>
              <td class="editable" data-field="name" data-type="text" title="${escapeHtml(p.name)}">
                <div class="prod-name">${escapeHtml(p.name)}</div>
                <div class="prod-id clamp-1">${p.id}</div>
              </td>
              <td class="editable text-right font-semibold num-col" data-field="price" data-type="number">¥${p.price || 0}</td>
              <td class="editable clamp-2" data-field="courseType" data-type="tags" data-options="${escapeHtml(COURSE_TYPES.join('|'))}" title="${escapeHtml(formatAudiences(p.courseType))}">
                <div class="tag-list clamp-2-inner">${renderMultiBadges(p.courseType, 'badge-purple')}</div>
              </td>
              <td class="editable clamp-2" data-field="stage" data-type="tags" data-options="${escapeHtml(COURSE_STAGES.join('|'))}" title="${escapeHtml(formatAudiences(p.stage))}">
                <div class="tag-list clamp-2-inner">${renderMultiBadges(p.stage, 'badge-blue')}</div>
              </td>
              <td class="editable clamp-2" data-field="subject" data-type="tags" data-options="${escapeHtml(COURSE_SUBJECTS.join('|'))}" title="${escapeHtml(formatAudiences(p.subject))}">
                <div class="tag-list clamp-2-inner">${renderMultiBadges(p.subject, 'badge-cyan')}</div>
              </td>
              <td class="editable clamp-2 text-slate-500" data-field="intro" data-type="text" title="${escapeHtml(p.intro || '')}">${escapeHtml(p.intro || '-')}</td>
              <td class="link-col">
                ${p.courseLink
                  ? `<a href="${escapeHtml(p.courseLink)}" target="_blank" class="text-brand-600 hover:underline" title="${escapeHtml(p.courseLink)}">${escapeHtml(p.courseLink)}</a>`
                  : '<span class="text-slate-300">-</span>'}
              </td>
              <td class="actions-col nowrap">
                <button class="text-brand-600 hover:underline" data-act="view">详情</button>
                <button class="text-brand-600 hover:underline" data-act="edit">编辑</button>
                <button class="text-rose-500 hover:underline" data-act="del">删除</button>
              </td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ========== 事件绑定：选择 / 详情 / 编辑 / 删除 ========== */
function bindGridEvents(main, list) {
  const allChk = main.querySelector('#chkAll');
  if (allChk) allChk.addEventListener('change', e => {
    if (e.target.checked) list.forEach(p => state.selected.add(p.id));
    else list.forEach(p => state.selected.delete(p.id));
    draw(main);
  });

  main.querySelectorAll('tbody tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelectorAll('input.chk').forEach(chk => {
      if (chk.id === 'chkAll') return;
      chk.addEventListener('change', e => {
        e.stopPropagation();
        if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
        draw(main);
      });
    });
    row.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === 'view') openProductDetail(main, id);
      if (act === 'edit') openProductForm(main, id);
      if (act === 'del') {
        confirmDialog({
          title: '删除商品', danger: true, okText: '删除',
          content: `确认删除「${escapeHtml(getProducts().find(p => p.id === id)?.name || '')}」？`
        }).then(async ok => {
          if (ok) { await deleteProducts([id]); toast('已删除', 'success'); draw(main); }
        });
      }
    }));
  });

  // 序号编辑：点击徽章 → 进入输入框；失焦/回车保存（下限为 1，数字越大越靠前）
  main.querySelectorAll('.seq-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      if (badge.classList.contains('editing')) return;
      const id = badge.dataset.seqId;
      const kind = badge.dataset.seqKind || 'product';
      const cur = Number(badge.dataset.seqCurrent) || 1;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '1';
      inp.step = '1';
      inp.value = String(cur);
      inp.className = 'seq-weight-inp';
      inp.title = '数字越大越靠前，最小值 1';
      badge.classList.add('editing');
      badge.style.display = 'none';
      badge.parentNode.appendChild(inp);
      inp.focus();
      inp.select();
      let committed = false;
      const commit = async () => {
        if (committed) return;
        committed = true;
        let v = parseInt(inp.value, 10);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (v === cur) {
          // 无变化，恢复显示
          inp.remove();
          badge.style.display = '';
          badge.classList.remove('editing');
          return;
        }
        await updateSortWeight(kind, id, v);
        toast('已更新序号', 'success', 1000);
        draw(main);
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter') { e2.preventDefault(); inp.blur(); }
        else if (e2.key === 'Escape') {
          e2.preventDefault();
          committed = true;
          inp.remove();
          badge.style.display = '';
          badge.classList.remove('editing');
        }
      });
      inp.addEventListener('click', e2 => e2.stopPropagation());
    });
  });

  // 图片点击放大（lightbox）
  main.querySelectorAll('img[data-zoom]').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openImageLightbox(img.dataset.zoom, img.dataset.zoomTitle || '');
    });
  });

  // 折叠单元格点击切换展开/收起（尤其适用于手机端查看被省略的全文）
  main.querySelectorAll('tbody td.clamp-2').forEach(td => {
    td.addEventListener('click', (e) => {
      // 如果是点击可编辑 td，进入编辑态由 bindInlineEditors 接管，这里不处理
      if (td.classList.contains('editing')) return;
      // 点击按钮/输入框等交互元素时不处理
      if (e.target.closest('a, button, input, select, [data-act]')) return;
      // 双重行为：先阻止 editable 的 click 冒泡由 bindInlineEditors 进入编辑
      // 这里通过监听捕获阶段，在 editable 之前执行：改为 toggle 展开/收起
      // 但 bindInlineEditors 也绑在同一 td 上，因此使用 dblclick 再编辑的策略：
      // 单击：展开/收起；若已展开则再次单击收起；要进入编辑，请双击或使用编辑按钮
      if (td.classList.contains('editable')) {
        // 对 editable 单元格：第一次点击展开，第二次点击进入编辑
        if (!td.classList.contains('clamp-expanded')) {
          e.stopImmediatePropagation();
          td.classList.add('clamp-expanded');
          return;
        }
        // 已展开态：允许 editable 的 click 继续（进入编辑）；并自动收起样式
        td.classList.remove('clamp-expanded');
        return;
      }
      td.classList.toggle('clamp-expanded');
    }, true); // 使用捕获，先于 editable 的冒泡 click
  });
}

/* ========== 图片预览 Lightbox ========== */
function openImageLightbox(src, title) {
  if (!src) return;
  const lb = document.createElement('div');
  lb.className = 'img-lightbox';
  lb.innerHTML = `
    <div class="lightbox-close" title="关闭">
      <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </div>
    <img src="${src}" alt="${escapeHtml(title || '')}" />
    ${title ? `<div style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(15,23,42,.6);color:#fff;padding:6px 14px;border-radius:18px;font-size:13px;max-width:80vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(title)}</div>` : ''}
  `;
  const close = () => {
    lb.style.transition = 'opacity .15s';
    lb.style.opacity = '0';
    setTimeout(() => lb.remove(), 160);
    document.removeEventListener('keydown', keyHandler);
  };
  const keyHandler = (e) => { if (e.key === 'Escape') close(); };
  lb.addEventListener('click', () => close());
  // 避免点击图片本身触发关闭（让用户可欣赏）
  lb.querySelector('img').addEventListener('click', e => e.stopPropagation());
  lb.querySelector('.lightbox-close').addEventListener('click', e => { e.stopPropagation(); close(); });
  document.addEventListener('keydown', keyHandler);
  document.body.appendChild(lb);
}

/* ========== 列内编辑绑定 ========== */
function bindInlineEditors(main) {
  main.querySelectorAll('td.editable').forEach(td => {
    td.addEventListener('click', (e) => {
      if (td.classList.contains('editing')) return;
      if (e.target.closest('[data-act]')) return;
      startInlineEdit(main, td);
    });
  });
}

function startInlineEdit(main, td) {
  const row = td.closest('tr[data-id]');
  if (!row) return;
  const id = row.dataset.id;
  const product = getProducts().find(p => p.id === id);
  if (!product) return;

  const field = td.dataset.field;
  const type = td.dataset.type || 'text';
  const oldHtml = td.innerHTML;
  const curValue = product[field] != null ? product[field] : '';

  td.classList.add('editing');
  // 多值标签编辑器（目标人群等场景）
  if (type === 'tags') {
    const opts = (td.dataset.options || '').split('|').filter(Boolean);
    const selected = normalizeAudiences(curValue);
    const wrap = document.createElement('div');
    wrap.className = 'tag-edit-wrap';
    wrap.innerHTML = `
      <div class="tag-edit-selected"></div>
      <div class="tag-edit-input-row">
        <input type="text" class="tag-edit-input" placeholder="勾选或输入后回车添加"/>
      </div>
      <div class="tag-edit-options">
        ${opts.map(o => `<label class="tag-opt"><input type="checkbox" value="${escapeHtml(o)}" ${selected.includes(o) ? 'checked' : ''}/><span>${escapeHtml(o)}</span></label>`).join('')}
      </div>
      <div class="tag-edit-actions">
        <button type="button" class="tag-btn tag-btn-ok" data-act="save">保存</button>
        <button type="button" class="tag-btn" data-act="cancel">取消</button>
      </div>
    `;
    td.innerHTML = '';
    td.appendChild(wrap);

    const selBox = wrap.querySelector('.tag-edit-selected');
    const inp = wrap.querySelector('.tag-edit-input');
    let current = [...selected];
    const renderSel = () => {
      selBox.innerHTML = current.length
        ? current.map((x, i) => `<span class="tag-chip">${escapeHtml(x)}<button type="button" class="tag-chip-x" data-i="${i}" title="移除">×</button></span>`).join('')
        : '<span class="text-xs text-slate-400">暂无已选，请在下方勾选或在输入框中输入新类型</span>';
      selBox.querySelectorAll('.tag-chip-x').forEach(b => b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const i = Number(b.dataset.i);
        current.splice(i, 1);
        // 若是预设项，同步取消勾选
        wrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
          if (!current.includes(c.value)) c.checked = false;
        });
        renderSel();
      }));
    };
    renderSel();

    wrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
      c.addEventListener('change', () => {
        const v = c.value;
        if (c.checked) { if (!current.includes(v)) current.push(v); }
        else { current = current.filter(x => x !== v); }
        renderSel();
      });
    });

    const addFromInput = () => {
      const parts = normalizeAudiences(inp.value);
      parts.forEach(v => { if (!current.includes(v)) current.push(v); });
      inp.value = '';
      // 同步勾选预设项
      wrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
        if (current.includes(c.value)) c.checked = true;
      });
      renderSel();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === ',' || e.key === '，' || e.key === '、') {
        e.preventDefault(); addFromInput();
      }
    });

    const cancel = () => { td.classList.remove('editing'); td.innerHTML = oldHtml; };
    const commit = async () => {
      // 把未提交的输入也纳入
      if (inp.value.trim()) addFromInput();
      const arr = [...new Set(current.map(s => String(s).trim()).filter(Boolean))];
      // 与原值比较（规范化）
      const origArr = normalizeAudiences(curValue);
      if (arr.join('|') === origArr.join('|')) { cancel(); return; }
      const patch = { ...product, [field]: arr };
      await upsertProduct(patch);
      toast('已更新目标人群', 'success', 1200);
      draw(main);
    };
    wrap.querySelector('[data-act="save"]').addEventListener('click', commit);
    wrap.querySelector('[data-act="cancel"]').addEventListener('click', cancel);
    // 编辑器内点击不传播，避免 editable 的 click 再次进入编辑
    wrap.addEventListener('click', e => e.stopPropagation());
    setTimeout(() => inp.focus(), 0);
    return;
  }

  let inputEl;
  if (type === 'select') {
    const opts = (td.dataset.options || '').split('|').filter(Boolean);
    inputEl = document.createElement('select');
    inputEl.innerHTML = `<option value=""></option>` + opts.map(o => `<option value="${escapeHtml(o)}" ${String(curValue) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
  } else {
    inputEl = document.createElement('input');
    inputEl.type = type === 'number' ? 'number' : 'text';
    inputEl.value = curValue;
  }
  td.innerHTML = '';
  td.appendChild(inputEl);
  inputEl.focus();
  if (inputEl.select) inputEl.select();

  const cancel = () => { td.classList.remove('editing'); td.innerHTML = oldHtml; };
  const commit = async () => {
    let newVal = type === 'number' ? (inputEl.value === '' ? '' : Number(inputEl.value)) : inputEl.value.trim();
    // 佣金百分比字段：限定 0-100
    if (type === 'number' && (field === 'commissionPolicy' || field === 'adCommissionPolicy')) {
      if (newVal !== '') newVal = Math.min(100, Math.max(0, Number(newVal) || 0));
    }
    if (String(newVal) === String(curValue)) { cancel(); return; }
    const patch = { ...product, [field]: newVal };
    // salePrice 变更同步 price（兼容旧计算）
    if (field === 'salePrice') patch.price = Number(newVal) || 0;
    if (field === 'price') patch.salePrice = Number(newVal) || 0;
    // 纯佣金 commissionPolicy 同步到 commissionRate 兼容字段（空值不强制写 0，保持与输入一致）
    if (field === 'commissionPolicy') {
      patch.commissionRate = (newVal === '' || newVal == null) ? '' : Number(newVal) || 0;
    }
    await upsertProduct(patch);
    toast('已更新', 'success', 1200);
    draw(main);
  };
  inputEl.addEventListener('blur', commit);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}

/* ========== 商品详情 ========== */
function openProductDetail(main, id) {
  const p = getProducts().find(x => x.id === id); if (!p) return;
  const isBook = (p.type || 'book') === 'book';
  const body = isBook ? `
    <div class="grid grid-cols-3 gap-5">
      <div class="col-span-1">
        <img src="${p.image || ''}" onerror="this.parentElement.innerHTML='<div class=&quot;w-full h-48 bg-slate-100 rounded-lg grid place-items-center text-slate-400 text-sm&quot;>暂无图片</div>'" class="w-full rounded-lg object-cover border border-slate-200 aspect-square"/>
      </div>
      <div class="col-span-2 space-y-3">
        <div>
          <div class="text-xs text-slate-400 font-mono mb-1">${p.id}</div>
          <h3 class="text-xl font-bold text-slate-900">${escapeHtml(p.name)}</h3>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <div class="text-2xl font-bold text-brand-700">¥${p.salePrice != null && p.salePrice !== '' ? p.salePrice : (p.price || 0)}</div>
          <span class="badge badge-purple">${escapeHtml(p.category || '-')}</span>
          ${p.targetAudience ? renderAudienceBadges(p.targetAudience) : ''}
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm text-slate-600">
          <div><span class="text-slate-400">供应链名称：</span>${escapeHtml(p.supplier || p.publisher || p.merchant || '-')}</div>
          <div><span class="text-slate-400">规格：</span>${escapeHtml(p.spec || '-')}</div>
          <div><span class="text-slate-400">纯佣金：</span>${(p.commissionPolicy != null && p.commissionPolicy !== '') ? `<b class="text-brand-700">${p.commissionPolicy}%</b>` : ((p.commissionRate != null && p.commissionRate !== '') ? `<b class="text-brand-700">${p.commissionRate}%</b>` : '<span class="text-slate-300">-</span>')}</div>
          <div><span class="text-slate-400">投流佣金：</span>${(p.adCommissionPolicy != null && p.adCommissionPolicy !== '') ? `<b class="text-brand-700">${p.adCommissionPolicy}%</b>` : '<span class="text-slate-300">-</span>'}</div>
          <div><span class="text-slate-400">物流快递：</span>${escapeHtml(p.logistics || '-')}</div>
          <div><span class="text-slate-400">库存：</span>${formatNumber(p.stock || 0)}</div>
          <div class="col-span-2"><span class="text-slate-400">微信小店商品链接：</span>${p.shopLink ? `<a href="${escapeHtml(p.shopLink)}" target="_blank" class="text-brand-600 hover:underline break-all">${escapeHtml(p.shopLink)}</a>` : '-'}</div>
        </div>
        <div>
          <div class="text-xs text-slate-400 mb-1">图书介绍</div>
          <div class="text-sm text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg">${escapeHtml(p.intro || '暂无介绍')}</div>
        </div>
      </div>
    </div>
  ` : `
    <div class="grid grid-cols-3 gap-5">
      <div class="col-span-1">
        <img src="${p.image || ''}" onerror="this.parentElement.innerHTML='<div class=&quot;w-full h-48 bg-slate-100 rounded-lg grid place-items-center text-slate-400 text-sm&quot;>暂无图片</div>'" class="w-full rounded-lg object-cover border border-slate-200 aspect-square"/>
      </div>
      <div class="col-span-2 space-y-3">
        <div>
          <div class="text-xs text-slate-400 font-mono mb-1">${p.id}</div>
          <h3 class="text-xl font-bold text-slate-900">${escapeHtml(p.name)}</h3>
        </div>
        <div class="flex items-center gap-3 flex-wrap">
          <div class="text-2xl font-bold text-brand-700">¥${p.price || 0}</div>
          ${renderMultiBadges(p.courseType, 'badge-purple')}
          ${renderMultiBadges(p.stage, 'badge-blue')}
          ${renderMultiBadges(p.subject, 'badge-cyan')}
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm text-slate-600">
          <div class="col-span-2"><span class="text-slate-400">课程链接：</span>${p.courseLink ? `<a href="${escapeHtml(p.courseLink)}" target="_blank" class="text-brand-600 hover:underline break-all">${escapeHtml(p.courseLink)}</a>` : '-'}</div>
        </div>
        <div>
          <div class="text-xs text-slate-400 mb-1">课程介绍</div>
          <div class="text-sm text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg">${escapeHtml(p.intro || '暂无介绍')}</div>
        </div>
      </div>
    </div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">关闭</button>
    <button class="btn btn-primary" data-act="edit">编辑此${isBook ? '图书' : '课程'}</button>
  `;
  openModal({
    title: `${isBook ? '图书' : '课程'}详情`, bodyHtml: body, footerHtml: footer, width: '780px',
    onBack: () => { },
    onMount(root, close) {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="edit"]').addEventListener('click', () => {
        close();
        openProductForm(main, id, () => openProductDetail(main, id));
      });
    }
  });
}

/* ========== 新增/编辑表单 ========== */
function openProductForm(main, id, onBackToDetail) {
  const editing = id ? getProducts().find(p => p.id === id) : null;
  const isBook = editing ? (editing.type || 'book') === 'book' : state.tab === 'book';

  const p = editing || (isBook ? {
    id: nextId('P'), type: 'book', name: '', category: CATEGORIES[0],
    supplier: '', targetAudience: TARGET_AUDIENCE_OPTIONS[0],
    image: '', intro: '', shopLink: '', spec: '',
    salePrice: '', price: '', commissionPolicy: '', adCommissionPolicy: '',
    logistics: LOGISTICS_OPTIONS[0], stock: 0, commissionRate: 0,
    createdAt: new Date().toISOString().slice(0, 10)
  } : {
    id: nextId('P'), type: 'course', name: '', courseType: COURSE_TYPES[0],
    stage: COURSE_STAGES[1], subject: COURSE_SUBJECTS[0],
    price: '', intro: '', image: '', courseLink: '', commissionRate: 30,
    createdAt: new Date().toISOString().slice(0, 10)
  });

  const imgPreview = (src) => src
    ? `<img src="${escapeHtml(src)}" class="w-full h-full object-cover"/>`
    : `<div class="w-full h-full grid place-items-center text-xs text-slate-400">暂无图片</div>`;

  const bookBody = `
    <div class="grid grid-cols-2 gap-4">
      <div class="col-span-2">
        <label class="form-label">书名 <span class="req">*</span></label>
        <input name="name" class="inp" value="${escapeHtml(p.name)}" placeholder="例如：《米小圈上学记》全套"/>
      </div>
      <div>
        <label class="form-label">商品编号</label>
        <input name="id" class="inp" value="${escapeHtml(p.id)}" readonly title="由系统自动生成"/>
      </div>
      <div>
        <label class="form-label">图书分类 <span class="req">*</span></label>
        <select name="category" class="inp">
          ${CATEGORIES.map(c => `<option ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="col-span-2">
        <label class="form-label">目标人群 <span class="text-xs text-slate-400 font-normal">（可多选，点击候选或在输入框中回车添加）</span></label>
        <div class="tag-edit-wrap" id="audienceEditor" data-field-name="targetAudience">
          <div class="tag-edit-selected"></div>
          <div class="tag-edit-input-row">
            <input type="text" class="tag-edit-input inp" placeholder="如：学生家长、教师（回车/逗号分隔添加）"/>
          </div>
          <div class="tag-edit-options">
            ${TARGET_AUDIENCE_OPTIONS.map(o => `<label class="tag-opt"><input type="checkbox" value="${escapeHtml(o)}"/><span>${escapeHtml(o)}</span></label>`).join('')}
          </div>
        </div>
        <input type="hidden" name="targetAudience" value="${escapeHtml(formatAudiences(p.targetAudience))}"/>
      </div>
      <div>
        <label class="form-label">供应链名称 <span class="req">*</span></label>
        <input name="supplier" class="inp" value="${escapeHtml(p.supplier || p.publisher || p.merchant || '')}" placeholder="如：中信出版社 · 中信书旗旗舰店"/>
      </div>
      <div>
        <label class="form-label">规格</label>
        <input name="spec" class="inp" value="${escapeHtml(p.spec || '')}" placeholder="如：平装 / 全套 / 精装"/>
      </div>
      <div>
        <label class="form-label">带货售价（控价，元） <span class="req">*</span></label>
        <input name="salePrice" type="number" step="0.01" class="inp" value="${p.salePrice != null && p.salePrice !== '' ? p.salePrice : (p.price || '')}"/>
      </div>
      <div>
        <label class="form-label">库存</label>
        <input name="stock" type="number" class="inp" value="${p.stock || 0}"/>
      </div>
      <div>
        <label class="form-label">纯佣金 <span class="text-xs text-slate-400 font-normal">（单位：%）</span></label>
        <div class="relative">
          <input name="commissionPolicy" type="number" step="0.01" min="0" max="100" class="inp pr-8" value="${(p.commissionPolicy != null && p.commissionPolicy !== '') ? p.commissionPolicy : (p.commissionRate != null ? p.commissionRate : '')}" placeholder="如 25 表示 25%"/>
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
        </div>
      </div>
      <div>
        <label class="form-label">投流佣金 <span class="text-xs text-slate-400 font-normal">（单位：%）</span></label>
        <div class="relative">
          <input name="adCommissionPolicy" type="number" step="0.01" min="0" max="100" class="inp pr-8" value="${(p.adCommissionPolicy != null && p.adCommissionPolicy !== '') ? p.adCommissionPolicy : ''}" placeholder="如 10 表示 10%"/>
          <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
        </div>
      </div>
      <div>
        <label class="form-label">物流快递</label>
        <input name="logistics" class="inp" list="logList" value="${escapeHtml(p.logistics || '')}" placeholder="如：中通 / 顺丰"/>
        <datalist id="logList">${LOGISTICS_OPTIONS.map(x => `<option>${x}</option>`).join('')}</datalist>
      </div>
      <div class="col-span-2">
        <label class="form-label">微信小店商品链接</label>
        <input name="shopLink" class="inp" value="${escapeHtml(p.shopLink || '')}" placeholder="https://channels.weixin.qq.com/shop/product/..."/>
      </div>
      <div class="col-span-2">
        <label class="form-label">产品图片 <span class="text-xs text-slate-400 font-normal">（仅支持 PNG/JPG，建议正方形，大小 ≤ 200KB）</span></label>
        <div class="flex items-center gap-3">
          <div id="imgPreviewBook" class="w-24 h-24 rounded-lg border border-slate-200 overflow-hidden bg-slate-50">${imgPreview(p.image)}</div>
          <div class="flex-1 space-y-2">
            <div class="flex gap-2">
              <button type="button" class="btn btn-ghost btn-sm" data-upload-for="imgPreviewBook">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                上传图片
              </button>
              <button type="button" class="btn btn-ghost btn-sm" id="clearImgBook">清除</button>
            </div>
            <input name="image" type="text" class="inp" value="${escapeHtml(p.image || '')}" placeholder="或直接粘贴图片 URL / Data URL"/>
          </div>
        </div>
      </div>
      <div class="col-span-2">
        <label class="form-label">图书介绍</label>
        <textarea name="intro" class="inp" rows="3" placeholder="一句话介绍这本书的亮点、作者、适读人群等">${escapeHtml(p.intro || '')}</textarea>
      </div>
    </div>
  `;

  const courseBody = `
    <div class="grid grid-cols-2 gap-4">
      <div class="col-span-2">
        <label class="form-label">课程名称 <span class="req">*</span></label>
        <input name="name" class="inp" value="${escapeHtml(p.name)}" placeholder="例如：小学数学思维训练营"/>
      </div>
      <div>
        <label class="form-label">商品编号</label>
        <input name="id" class="inp" value="${escapeHtml(p.id)}" readonly title="由系统自动生成"/>
      </div>
      <div>
        <label class="form-label">客单价 (元) <span class="req">*</span></label>
        <input name="price" type="number" class="inp" value="${p.price}"/>
      </div>
      <div>
        <label class="form-label">货品类型 <span class="req">*</span><span class="text-xs text-slate-400 font-normal">（可多选）</span></label>
        <div class="tag-edit-wrap course-multi-editor" data-field-name="courseType" data-options="${escapeHtml(COURSE_TYPES.join('|'))}">
          <div class="tag-edit-selected"></div>
          <div class="tag-edit-input-row">
            <input type="text" class="tag-edit-input inp" placeholder="回车/逗号分隔添加自定义类型"/>
          </div>
          <div class="tag-edit-options">
            ${COURSE_TYPES.map(o => `<label class="tag-opt"><input type="checkbox" value="${escapeHtml(o)}"/><span>${escapeHtml(o)}</span></label>`).join('')}
          </div>
        </div>
        <input type="hidden" name="courseType" value="${escapeHtml(formatAudiences(p.courseType))}"/>
      </div>
      <div>
        <label class="form-label">学段 <span class="req">*</span><span class="text-xs text-slate-400 font-normal">（可多选）</span></label>
        <div class="tag-edit-wrap course-multi-editor" data-field-name="stage" data-options="${escapeHtml(COURSE_STAGES.join('|'))}">
          <div class="tag-edit-selected"></div>
          <div class="tag-edit-input-row">
            <input type="text" class="tag-edit-input inp" placeholder="回车/逗号分隔添加自定义学段"/>
          </div>
          <div class="tag-edit-options">
            ${COURSE_STAGES.map(o => `<label class="tag-opt"><input type="checkbox" value="${escapeHtml(o)}"/><span>${escapeHtml(o)}</span></label>`).join('')}
          </div>
        </div>
        <input type="hidden" name="stage" value="${escapeHtml(formatAudiences(p.stage))}"/>
      </div>
      <div>
        <label class="form-label">学科 <span class="req">*</span><span class="text-xs text-slate-400 font-normal">（可多选）</span></label>
        <div class="tag-edit-wrap course-multi-editor" data-field-name="subject" data-options="${escapeHtml(COURSE_SUBJECTS.join('|'))}">
          <div class="tag-edit-selected"></div>
          <div class="tag-edit-input-row">
            <input type="text" class="tag-edit-input inp" placeholder="回车/逗号分隔添加自定义学科"/>
          </div>
          <div class="tag-edit-options">
            ${COURSE_SUBJECTS.map(o => `<label class="tag-opt"><input type="checkbox" value="${escapeHtml(o)}"/><span>${escapeHtml(o)}</span></label>`).join('')}
          </div>
        </div>
        <input type="hidden" name="subject" value="${escapeHtml(formatAudiences(p.subject))}"/>
      </div>
      <div class="col-span-2">
        <label class="form-label">课程图片 <span class="text-xs text-slate-400 font-normal">（仅支持 PNG/JPG，建议正方形，大小 ≤ 200KB）</span></label>
        <div class="flex items-center gap-3">
          <div id="imgPreviewCourse" class="w-24 h-24 rounded-lg border border-slate-200 overflow-hidden bg-slate-50">${imgPreview(p.image)}</div>
          <div class="flex-1 space-y-2">
            <div class="flex gap-2">
              <button type="button" class="btn btn-ghost btn-sm" data-upload-for="imgPreviewCourse">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                上传图片
              </button>
              <button type="button" class="btn btn-ghost btn-sm" id="clearImgCourse">清除</button>
            </div>
            <input name="image" type="text" class="inp" value="${escapeHtml(p.image || '')}" placeholder="或直接粘贴图片 URL / Data URL"/>
          </div>
        </div>
      </div>
      <div class="col-span-2">
        <label class="form-label">课程链接</label>
        <input name="courseLink" class="inp" value="${escapeHtml(p.courseLink || '')}" placeholder="https://course.example.com/..."/>
      </div>
      <div class="col-span-2">
        <label class="form-label">课程介绍</label>
        <textarea name="intro" class="inp" rows="3" placeholder="课程亮点、适合学员、授课形式等">${escapeHtml(p.intro || '')}</textarea>
      </div>
    </div>
  `;

  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="save">${editing ? '保存修改' : '确认录入'}</button>
  `;
  openModal({
    title: `${editing ? '编辑' : '录入'}${isBook ? '图书' : '课程'}`,
    bodyHtml: isBook ? bookBody : courseBody,
    footerHtml: footer, width: '780px',
    onBack: onBackToDetail || (() => { }),
    onMount(root, close) {
      if (isBook) {
        bindImageUpload(root, 'imgPreviewBook', 'image', '[name="image"]');
        const clr = root.querySelector('#clearImgBook');
        if (clr) clr.addEventListener('click', () => {
          root.querySelector('[name="image"]').value = '';
          root.querySelector('#imgPreviewBook').innerHTML = imgPreview('');
        });

        // 目标人群多值编辑器
        const audWrap = root.querySelector('#audienceEditor');
        if (audWrap) {
          const hidden = root.querySelector('input[type="hidden"][name="targetAudience"]');
          const selBox = audWrap.querySelector('.tag-edit-selected');
          const inp = audWrap.querySelector('.tag-edit-input');
          let current = normalizeAudiences(p.targetAudience);
          const syncHidden = () => { hidden.value = current.join('、'); };
          const renderSel = () => {
            selBox.innerHTML = current.length
              ? current.map((x, i) => `<span class="tag-chip">${escapeHtml(x)}<button type="button" class="tag-chip-x" data-i="${i}" title="移除">×</button></span>`).join('')
              : '<span class="text-xs text-slate-400">未选择，可勾选下方候选或在输入框中输入后回车添加</span>';
            selBox.querySelectorAll('.tag-chip-x').forEach(b => b.addEventListener('click', (e) => {
              e.preventDefault(); e.stopPropagation();
              const i = Number(b.dataset.i);
              const removed = current[i];
              current.splice(i, 1);
              audWrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
                if (c.value === removed) c.checked = false;
              });
              syncHidden(); renderSel();
            }));
          };
          // 初始勾选预设项
          audWrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
            c.checked = current.includes(c.value);
            c.addEventListener('change', () => {
              const v = c.value;
              if (c.checked) { if (!current.includes(v)) current.push(v); }
              else { current = current.filter(x => x !== v); }
              syncHidden(); renderSel();
            });
          });
          const addFromInput = () => {
            const parts = normalizeAudiences(inp.value);
            parts.forEach(v => { if (!current.includes(v)) current.push(v); });
            inp.value = '';
            audWrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
              if (current.includes(c.value)) c.checked = true;
            });
            syncHidden(); renderSel();
          };
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
            else if (e.key === ',' || e.key === '，' || e.key === '、') {
              e.preventDefault(); addFromInput();
            }
          });
          inp.addEventListener('blur', () => { if (inp.value.trim()) addFromInput(); });
          syncHidden(); renderSel();
        }
      } else {
        bindImageUpload(root, 'imgPreviewCourse', 'image', '[name="image"]');
        const clr = root.querySelector('#clearImgCourse');
        if (clr) clr.addEventListener('click', () => {
          root.querySelector('[name="image"]').value = '';
          root.querySelector('#imgPreviewCourse').innerHTML = imgPreview('');
        });

        // 课程多值字段（货品类型 / 学段 / 学科）多选编辑器
        root.querySelectorAll('.course-multi-editor').forEach(wrap => {
          const fieldName = wrap.dataset.fieldName;
          const hidden = root.querySelector(`input[type="hidden"][name="${fieldName}"]`);
          if (!hidden) return;
          const selBox = wrap.querySelector('.tag-edit-selected');
          const inp = wrap.querySelector('.tag-edit-input');
          let current = normalizeAudiences(p[fieldName]);
          const syncHidden = () => { hidden.value = current.join('、'); };
          const renderSel = () => {
            selBox.innerHTML = current.length
              ? current.map((x, i) => `<span class="tag-chip">${escapeHtml(x)}<button type="button" class="tag-chip-x" data-i="${i}" title="移除">×</button></span>`).join('')
              : '<span class="text-xs text-slate-400">未选择，可勾选下方候选或在输入框中输入后回车添加</span>';
            selBox.querySelectorAll('.tag-chip-x').forEach(b => b.addEventListener('click', (e) => {
              e.preventDefault(); e.stopPropagation();
              const i = Number(b.dataset.i);
              const removed = current[i];
              current.splice(i, 1);
              wrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
                if (c.value === removed) c.checked = false;
              });
              syncHidden(); renderSel();
            }));
          };
          wrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
            c.checked = current.includes(c.value);
            c.addEventListener('change', () => {
              const v = c.value;
              if (c.checked) { if (!current.includes(v)) current.push(v); }
              else { current = current.filter(x => x !== v); }
              syncHidden(); renderSel();
            });
          });
          const addFromInput = () => {
            const parts = normalizeAudiences(inp.value);
            parts.forEach(v => { if (!current.includes(v)) current.push(v); });
            inp.value = '';
            wrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
              if (current.includes(c.value)) c.checked = true;
            });
            syncHidden(); renderSel();
          };
          inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addFromInput(); }
            else if (e.key === ',' || e.key === '，' || e.key === '、') {
              e.preventDefault(); addFromInput();
            }
          });
          inp.addEventListener('blur', () => { if (inp.value.trim()) addFromInput(); });
          syncHidden(); renderSel();
        });
      }

      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const data = { type: isBook ? 'book' : 'course' };
        root.querySelectorAll('[name]').forEach(el => data[el.name] = el.value.trim());
        if (!data.name) return toast('请填写名称', 'error');
        if (isBook) {
          if (!data.salePrice) return toast('请填写带货售价', 'error');
          data.salePrice = Number(data.salePrice);
          data.price = data.salePrice;
          data.stock = Number(data.stock) || 0;
          // 纯佣金 / 投流佣金：数值化，单位 %，范围 0-100
          data.commissionPolicy = data.commissionPolicy === '' ? '' : Math.min(100, Math.max(0, Number(data.commissionPolicy) || 0));
          data.adCommissionPolicy = data.adCommissionPolicy === '' ? '' : Math.min(100, Math.max(0, Number(data.adCommissionPolicy) || 0));
          // 兼容字段：commissionRate 同步为纯佣金值，供数据看板/智能匹配/撮合模块等旧逻辑复用
          data.commissionRate = data.commissionPolicy === '' ? 0 : data.commissionPolicy;
          if (!data.supplier) return toast('请填写供应链名称', 'error');
          // 目标人群：隐藏输入为"、"分隔的字符串，转为数组存储
          data.targetAudience = normalizeAudiences(data.targetAudience);
        } else {
          if (!data.price) return toast('请填写客单价', 'error');
          data.price = Number(data.price);
          // 课程多值字段：hidden 是顿号分隔字符串，转为数组
          data.courseType = normalizeAudiences(data.courseType);
          data.stage = normalizeAudiences(data.stage);
          data.subject = normalizeAudiences(data.subject);
          // 课程保留已有 commissionRate（若 mock 中有），不再在表单中采集
          if (editing && editing.commissionRate != null) data.commissionRate = editing.commissionRate;
        }
        data.createdAt = p.createdAt || new Date().toISOString().slice(0, 10);
        await upsertProduct(data);
        toast(editing ? '已保存' : '录入成功', 'success');
        close(); draw(main);
      });
    }
  });
}

/* ========== 批量编辑 ========== */
function openBatchEdit(main) {
  const ids = [...state.selected];
  const isBook = state.tab === 'book';
  const body = `
    <div class="mb-4 text-sm text-slate-500">将对选中的 <b class="text-brand-700">${ids.length}</b> 个${isBook ? '图书' : '课程'}进行批量修改，留空字段不会被修改。</div>
    <div class="grid grid-cols-2 gap-4">
      ${isBook ? `
        <div>
          <label class="form-label">图书分类</label>
          <select name="category" class="inp">
            <option value="">不修改</option>
            ${CATEGORIES.map(c => `<option>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">供应链名称</label>
          <input name="supplier" class="inp" placeholder="不修改请留空"/>
        </div>
        <div>
          <label class="form-label">目标人群 <span class="text-xs text-slate-400 font-normal">(多个用 、/,/; 分隔)</span></label>
          <input name="targetAudience" class="inp" placeholder="如：学生家长、教师，留空不修改"/>
        </div>
        <div>
          <label class="form-label">物流快递</label>
          <select name="logistics" class="inp">
            <option value="">不修改</option>
            ${LOGISTICS_OPTIONS.map(c => `<option>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">纯佣金 <span class="text-xs text-slate-400 font-normal">（单位：%）</span></label>
          <div class="relative">
            <input name="commissionPolicy" type="number" step="0.01" min="0" max="100" class="inp pr-8" placeholder="不修改请留空"/>
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
          </div>
        </div>
        <div>
          <label class="form-label">投流佣金 <span class="text-xs text-slate-400 font-normal">（单位：%）</span></label>
          <div class="relative">
            <input name="adCommissionPolicy" type="number" step="0.01" min="0" max="100" class="inp pr-8" placeholder="不修改请留空"/>
            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
          </div>
        </div>
      ` : `
        <div>
          <label class="form-label">货品类型</label>
          <select name="courseType" class="inp">
            <option value="">不修改</option>
            ${COURSE_TYPES.map(c => `<option>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">学段</label>
          <select name="stage" class="inp">
            <option value="">不修改</option>
            ${COURSE_STAGES.map(c => `<option>${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">学科</label>
          <select name="subject" class="inp">
            <option value="">不修改</option>
            ${COURSE_SUBJECTS.map(c => `<option>${c}</option>`).join('')}
          </select>
        </div>
      `}
    </div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="save">应用到 ${ids.length} 项</button>
  `;
  openModal({
    title: `批量编辑${isBook ? '图书' : '课程'}`, bodyHtml: body, footerHtml: footer,
    onBack: () => { },
    onMount(root, close) {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const d = {};
        root.querySelectorAll('[name]').forEach(el => d[el.name] = el.value.trim());
        const list = getProducts().filter(p => ids.includes(p.id)).map(p => {
          const u = { ...p };
          if (d.category) u.category = d.category;
          if (d.courseType) u.courseType = normalizeAudiences(d.courseType);
          if (d.stage) u.stage = normalizeAudiences(d.stage);
          if (d.subject) u.subject = normalizeAudiences(d.subject);
          if (d.supplier) u.supplier = d.supplier;
          if (d.targetAudience) u.targetAudience = normalizeAudiences(d.targetAudience);
          if (d.logistics) u.logistics = d.logistics;
          if (d.commissionPolicy !== '' && d.commissionPolicy != null) {
            const cp = Number(d.commissionPolicy);
            if (!Number.isNaN(cp)) {
              u.commissionPolicy = Math.min(100, Math.max(0, cp));
              // 同步兼容字段 commissionRate
              u.commissionRate = u.commissionPolicy;
            }
          }
          if (d.adCommissionPolicy !== '' && d.adCommissionPolicy != null) {
            const acp = Number(d.adCommissionPolicy);
            if (!Number.isNaN(acp)) u.adCommissionPolicy = Math.min(100, Math.max(0, acp));
          }
          return u;
        });
        await batchUpsertProducts(list);
        toast(`已更新 ${list.length} 项`, 'success');
        state.selected.clear();
        close(); draw(main);
      });
    }
  });
}

/* ========== 模板下载 & 导出 ========== */
function bookTemplate() {
  return [
    '供应链名称', '目标人群', '书名', '图书分类', '产品图片URL', '图书介绍',
    '微信小店商品链接', '规格', '带货售价（控价）',
    '纯佣金', '投流佣金（%）',
    '物流快递', '库存'
  ];
}
function courseTemplate() {
  return ['课程图片URL', '课程名称', '客单价', '货品类型', '学段', '学科', '课程介绍', '课程链接'];
}
function downloadCurrentTemplate() {
  if (state.tab === 'book') {
    downloadTemplate(bookTemplate(), '图书货盘导入模板.xlsx');
  } else {
    downloadTemplate(courseTemplate(), '课程货盘导入模板.xlsx');
  }
  toast('模板已下载', 'success');
}
function exportCurrent(list) {
  const rows = list.map(p => {
    if ((p.type || 'book') === 'book') {
      return {
        '商品编号': p.id,
        '供应链名称': p.supplier || p.publisher || p.merchant || '',
        '目标人群': formatAudiences(p.targetAudience),
        '书名': p.name,
        '图书分类': p.category || '',
        '产品图片URL': p.image || '',
        '图书介绍': p.intro || '',
        '微信小店商品链接': p.shopLink || '',
        '规格': p.spec || '',
        '带货售价（控价）': p.salePrice != null && p.salePrice !== '' ? p.salePrice : (p.price || 0),
        '纯佣金': (p.commissionPolicy != null && p.commissionPolicy !== '') ? p.commissionPolicy : (p.commissionRate != null && p.commissionRate !== '' ? p.commissionRate : ''),
        '投流佣金（%）': (p.adCommissionPolicy != null && p.adCommissionPolicy !== '') ? p.adCommissionPolicy : '',
        '物流快递': p.logistics || '',
        '库存': p.stock || 0,
        '创建时间': p.createdAt || ''
      };
    }
    return {
      '商品编号': p.id,
      '课程图片URL': p.image || '',
      '课程名称': p.name,
      '客单价': p.price,
      '货品类型': formatAudiences(p.courseType),
      '学段': formatAudiences(p.stage),
      '学科': formatAudiences(p.subject),
      '课程介绍': p.intro || '',
      '课程链接': p.courseLink || '',
      '创建时间': p.createdAt || ''
    };
  });
  exportExcel(rows, `${state.tab === 'book' ? '图书' : '课程'}货盘_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('已导出 ' + rows.length + ' 条', 'success');
}

/* ========== 批量上传：本地 Excel（已移除腾讯文档通道） ========== */

function mapRowToProduct(r, isBook) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
    }
    return '';
  };
  if (isBook) {
    const supplier = String(pick('供应链名称', '图书商家', '图书商家名称', '商家名称', '出版社')).trim();
    const salePrice = Number(pick('带货售价（控价）', '带货售价', '图书价格', '定价', '价格')) || 0;
    // 纯佣金 / 投流佣金：数值化（单位 %）；兼容旧版"直接带货佣金政策" / "投流佣金政策（商家投流）"文本。
    // 注意：若 Excel 中未填该列（pick 返回 ''），应保留为空字符串，避免误写入 0 覆盖现有值。
    const rawCommission = pick('纯佣金', '纯佣金(%)', '纯佣金（%）', '纯佣金%', '直接带货佣金政策', '佣金政策', '佣金率(%)', '佣金率%', '佣金率');
    const rawAdCommission = pick('投流佣金（%）', '投流佣金(%)', '投流佣金%', '投流佣金', '投流佣金政策（商家投流）', '投流佣金政策');
    const parsePct = (raw) => {
      if (raw === '' || raw == null) return '';
      // 支持 "20%" / "20 " / "20.5" / "百分之20" 等格式，提取数字部分
      const s = String(raw).replace(/[^\d.]/g, '');
      if (s === '' || s === '.') return '';
      const n = Number(s);
      if (!Number.isFinite(n)) return '';
      return Math.min(100, Math.max(0, n));
    };
    const commissionPolicy = parsePct(rawCommission);
    const adCommissionPolicy = parsePct(rawAdCommission);
    return {
      id: '', type: 'book',
      supplier,
      publisher: supplier, merchant: supplier,
      targetAudience: normalizeAudiences(pick('目标人群')),
      name: String(pick('书名', '图书名称', '商品名称')).trim(),
      category: String(pick('图书分类', '分类') || CATEGORIES[0]).trim(),
      image: String(pick('产品图片URL', '图书图片URL', '图书图片', '封面', '产品图片')).trim(),
      intro: String(pick('图书介绍', '介绍')).trim(),
      shopLink: String(pick('微信小店商品链接', '微信小店链接', '商品链接')).trim(),
      spec: String(pick('规格')).trim(),
      salePrice, price: salePrice,
      commissionPolicy,
      adCommissionPolicy,
      logistics: String(pick('物流快递', '快递', '物流')).trim(),
      stock: Number(pick('库存')) || 0,
      // 兼容字段：commissionRate 同步纯佣金数值（空值保持 0 供旧逻辑兜底）
      commissionRate: commissionPolicy === '' ? 0 : commissionPolicy,
      createdAt: new Date().toISOString().slice(0, 10)
    };
  }
  return {
    id: '', type: 'course',
    name: String(pick('课程名称', '商品名称')).trim(),
    courseType: normalizeAudiences(pick('货品类型', '课程类型')),
    stage: normalizeAudiences(pick('学段')),
    subject: normalizeAudiences(pick('学科')),
    price: Number(pick('客单价', '价格')) || 0,
    intro: String(pick('课程介绍', '介绍')).trim(),
    image: String(pick('课程图片URL', '课程图片')).trim(),
    courseLink: String(pick('课程链接')).trim(),
    createdAt: new Date().toISOString().slice(0, 10)
  };
}

function openImport(main) {
  const isBook = state.tab === 'book';
  const body = `
    <div id="panelLocal">
      <div class="text-sm text-slate-600 mb-3">
        当前上传类型：<span class="badge ${isBook ? 'badge-purple' : 'badge-cyan'}">${isBook ? '图书货盘' : '课程货盘'}</span>
        · 支持 <b>.xlsx / .xls</b>，商品编号由系统自动生成，无需填写。
      </div>
      <div class="drop-zone" id="dropZone">
        <div class="flex flex-col items-center gap-2 text-slate-500">
          <svg viewBox="0 0 24 24" class="w-10 h-10 text-brand-400" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 10l5-5 5 5M12 5v12M5 19h14"/></svg>
          <div class="font-medium text-slate-700">点击或拖拽 Excel 文件到此处</div>
          <div class="text-xs">或 <button class="text-brand-600 underline" id="dlTplBtn">下载${isBook ? '图书' : '课程'}模板</button></div>
        </div>
        <input type="file" id="fileInp" accept=".xlsx,.xls" style="display:none"/>
      </div>
    </div>

    <div id="previewArea" class="mt-4"></div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="import" disabled>导入</button>
  `;
  openModal({
    title: `批量上传${isBook ? '图书' : '课程'}`, bodyHtml: body, footerHtml: footer, width: '760px',
    onBack: () => { },
    onMount(root, close) {
      const dz = root.querySelector('#dropZone');
      const fi = root.querySelector('#fileInp');
      const preview = root.querySelector('#previewArea');
      const importBtn = root.querySelector('[data-act="import"]');
      let parsed = null;

      root.querySelector('#dlTplBtn').addEventListener('click', e => { e.stopPropagation(); downloadCurrentTemplate(); });
      dz.addEventListener('click', () => fi.click());
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
      dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
      fi.addEventListener('change', () => { const f = fi.files[0]; if (f) handleFile(f); });

      async function handleFile(f) {
        try {
          const data = await parseExcel(f);
          if (!data.length) return toast('Excel 为空', 'error');
          parsed = data.map(r => mapRowToProduct(r, isBook)).filter(r => r.name);
          if (!parsed.length) return toast('未解析到有效数据（名称为必填）', 'error');

          preview.innerHTML = `
            <div class="text-sm text-slate-600 mb-2">
              解析到 <b class="text-brand-700">${parsed.length}</b> 条记录，预览前 5 条：
            </div>
            <div class="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
              <table class="tbl text-xs">
                <thead>${isBook
                  ? '<tr><th>编号</th><th>供应链</th><th>目标人群</th><th>书名</th><th>分类</th><th>规格</th><th>售价</th><th>纯佣金</th><th>投流佣金</th><th>物流</th><th>库存</th></tr>'
                  : '<tr><th>编号</th><th>名称</th><th>类型</th><th>学段</th><th>学科</th><th>客单价</th></tr>'
                }</thead>
                <tbody>
                  ${parsed.slice(0, 5).map(r => isBook
                    ? `<tr><td>${escapeHtml(r.id || '(自动)')}</td>
                        <td>${escapeHtml(r.supplier || '-')}</td>
                        <td>${escapeHtml(formatAudiences(r.targetAudience) || '-')}</td>
                        <td>${escapeHtml(r.name)}</td>
                        <td>${escapeHtml(r.category)}</td>
                        <td>${escapeHtml(r.spec || '-')}</td>
                        <td>¥${r.salePrice}</td>
                        <td>${r.commissionPolicy !== '' && r.commissionPolicy != null ? r.commissionPolicy + '%' : '-'}</td>
                        <td>${r.adCommissionPolicy !== '' && r.adCommissionPolicy != null ? r.adCommissionPolicy + '%' : '-'}</td>
                        <td>${escapeHtml(r.logistics || '-')}</td>
                        <td>${r.stock}</td></tr>`
                    : `<tr><td>${escapeHtml(r.id || '(自动)')}</td><td>${escapeHtml(r.name)}</td>
                        <td>${escapeHtml(formatAudiences(r.courseType))}</td><td>${escapeHtml(formatAudiences(r.stage))}</td>
                        <td>${escapeHtml(formatAudiences(r.subject))}</td><td>¥${r.price}</td></tr>`
                  ).join('')}
                </tbody>
              </table>
            </div>
          `;
          importBtn.disabled = false;
        } catch (err) {
          console.error(err); toast('解析失败：' + err.message, 'error');
        }
      }

      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      importBtn.addEventListener('click', async () => {
        if (!parsed?.length) return;
        await batchUpsertProducts(parsed);
        toast(`成功导入 ${parsed.length} 条`, 'success');
        close(); draw(main);
      });
    }
  });
}