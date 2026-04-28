/**
 * 达人管理
 * 字段与 Excel 批量上传模板对齐：
 *  - 达人等级 level
 *  - 地区 region
 *  - 达人姓名 name
 *  - 视频号账号名称 videoAccount
 *  - 公众号昵称 officialAccount
 *  - 视频号带货品类赛道 salesCategory
 *  - 现视频号品类销售额(月)-短视频(万) shortVideoSales
 *  - 现视频号品类销售额(月)-直播(万) liveSales
 *  - 视频号粉丝数量(万) videoFans
 *  - 公众号粉丝数(万) officialFans
 *  - 图书推广品类 categories[]
 *  - 可接受的合作类型 coopAccept[]
 *  - 视频号图书品类带货意愿 bookWillingness
 *  - 视频号少儿课程品类带货意愿 courseWillingness
 *  - 最近3个月、日常短视频更新频率 shortVideoFreq
 *  - 最近3个月、日常直播频率 liveFreq
 *  - 是否有MCN hasMCN
 *  - MCN名称 mcnName
 *  - 是否已入驻互选 joinedHuxuan
 *  - 内容形式 contentForms[]
 *  - 介绍 intro
 * 功能：新增/编辑、批量上传(本地Excel)、批量编辑、批量删除、导出、详情
 */
import {
  getTalents, upsertTalent, deleteTalents, batchUpsertTalents, nextId,
  sortBySortWeight, updateSortWeight,
  BOOK_CATEGORIES_FOR_TALENT, REGIONS, CONTENT_FORMS, COOP_ACCEPT,
  TALENT_LEVELS, TALENT_LEVEL_META,
  WILLINGNESS_LEVELS, UPDATE_FREQUENCIES, LIVE_FREQUENCIES, YES_NO
} from './data.js';
import {
  toast, openModal, confirmDialog,
  parseExcel, exportExcel, downloadTemplate,
  formatNumber, escapeHtml,
  paginate, renderPagination, bindPagination,
  bindSuggestPicker
} from './utils.js';

const state = {
  keyword: '',
  region: '',
  contentForm: '',
  level: '',
  salesCategory: '',
  bookWillingness: '',
  courseWillingness: '',
  hasMCN: '',
  joinedHuxuan: '',
  coopAccept: '',
  salesOwner: '',
  selected: new Set(),
  page: 1,
  pageSize: 20,
};

export function renderTalents(main) {
  state.selected.clear();
  draw(main);
}

function draw(main) {
  const all = getTalents();
  const list = filter(all);
  const pgInfo = paginate(list, state.page, state.pageSize);
  state.page = pgInfo.page;
  const pageList = pgInfo.pageList;
  const selectedCount = state.selected.size;

  const levelCount = {};
  TALENT_LEVELS.forEach(lv => { levelCount[lv] = 0; });
  all.forEach(t => {
    const lv = t.level || 'C';
    levelCount[lv] = (levelCount[lv] || 0) + 1;
  });

  main.innerHTML = `
    <div class="fade-in">
      <div class="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <a href="#/dashboard" class="hover:text-brand-700">首页</a>
            <span>›</span>
            <span class="text-slate-600">达人管理</span>
          </div>
          <h1 class="text-2xl font-bold text-slate-900">达人管理</h1>
          <p class="text-sm text-slate-500 mt-1">共 <b class="text-brand-700">${all.length}</b> 位达人 · 按等级分布：${TALENT_LEVELS.map(lv => `${lv}级 ${levelCount[lv]||0}`).join(' / ')}</p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button class="btn btn-ghost" id="exportBtn">导出</button>
          <div class="relative inline-block" id="dangerMenuWrap">
            <button class="btn btn-ghost" id="dangerMenuBtn" title="批量删除操作">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/></svg>
              一键删除
              <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            <div id="dangerMenu" class="absolute right-0 top-full mt-1 w-56 rounded-lg bg-white border border-slate-200 shadow-lg py-1 z-20 hidden">
              <button data-danger-act="all" class="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                删除全部达人 <span class="text-xs text-slate-400 ml-auto">${all.length}</span>
              </button>
              <div class="border-t border-slate-100 my-1"></div>
              <div class="px-3 py-1 text-[11px] text-slate-400">按等级删除</div>
              ${TALENT_LEVELS.map(lv => {
                const cnt = levelCount[lv] || 0;
                const meta = TALENT_LEVEL_META[lv];
                return `<button data-danger-act="level" data-level="${lv}" class="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-rose-50 hover:text-rose-600 flex items-center gap-2 ${cnt===0?'opacity-40 cursor-not-allowed':''}" ${cnt===0?'disabled':''}>
                  <span class="w-5 h-5 rounded text-white text-[11px] font-bold grid place-items-center shrink-0" style="background:${meta.color}">${lv}</span>
                  删除所有 ${lv} 级达人
                  <span class="text-xs text-slate-400 ml-auto">${cnt}</span>
                </button>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- 统计卡片 -->
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div class="card p-4 flex items-center gap-3 hover-lift cursor-pointer transition-all ${state.level===''?'ring-2 ring-brand-500':''} bg-gradient-to-br from-brand-50 to-pink-50 border-brand-200" data-filter-level="__all__" title="查看全部达人">
          <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500 to-pink-500 grid place-items-center text-white shrink-0">
            <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M17 11a3 3 0 100-6M3 21v-1a6 6 0 0112 0v1M17 14a6 6 0 014 5.65V21"/></svg>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-xs text-slate-500">达人总数</div>
            <div class="text-2xl font-bold text-slate-900">${all.length} <span class="text-sm font-normal text-slate-400">位</span></div>
          </div>
        </div>
        ${TALENT_LEVELS.map(lv => {
          const meta = TALENT_LEVEL_META[lv];
          const cnt = levelCount[lv] || 0;
          const pct = all.length ? (cnt / all.length * 100).toFixed(0) : 0;
          const active = state.level === lv;
          return `
            <div class="card p-4 flex items-center gap-3 hover-lift cursor-pointer transition-all ${active?'ring-2 ring-brand-500 bg-brand-50 shadow-soft':''}" data-filter-level="${lv}" title="${active?'再次点击取消筛选':'点击筛选'+lv+'级达人'}">
              <div class="w-10 h-10 rounded-lg grid place-items-center text-white font-bold text-lg shrink-0" style="background:${meta.color}">${lv}</div>
              <div class="flex-1 min-w-0">
                <div class="text-xs ${active?'text-brand-700 font-semibold':'text-slate-500'} truncate">${meta.name} · ${meta.desc}</div>
                <div class="flex items-baseline gap-1">
                  <div class="text-2xl font-bold ${active?'text-brand-700':'text-slate-900'}">${cnt}</div>
                  <div class="text-xs text-slate-400">位 · ${pct}%</div>
                  ${active?'<svg viewBox="0 0 24 24" class="w-3.5 h-3.5 text-brand-500 ml-auto" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>':''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- 筛选 -->
      <div class="card p-4 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative" id="kwWrap" style="width:200px;flex:0 0 auto">
            <input id="kwInp" class="inp" placeholder="🔍 搜索达人" value="${escapeHtml(state.keyword)}" autocomplete="off"/>
            <div class="search-suggest hidden" id="kwSuggest"></div>
          </div>
          <select id="levelSel" class="inp" style="width:110px;flex:0 0 auto">
            <option value="">全部等级</option>
            ${TALENT_LEVELS.map(lv => `<option value="${lv}" ${state.level===lv?'selected':''}>${lv} 级</option>`).join('')}
          </select>
          <select id="regionSel" class="inp" style="width:110px;flex:0 0 auto">
            <option value="">全部地区</option>
            ${REGIONS.map(r => `<option ${state.region===r?'selected':''}>${r}</option>`).join('')}
          </select>
          <select id="formSel" class="inp" style="width:130px;flex:0 0 auto">
            <option value="">全部内容形式</option>
            ${CONTENT_FORMS.map(c => `<option ${state.contentForm===c?'selected':''}>${c}</option>`).join('')}
          </select>
          <select id="categorySel" class="inp" style="width:140px;flex:0 0 auto">
            <option value="">全部赛道</option>
            ${BOOK_CATEGORIES_FOR_TALENT.map(c => `<option ${state.salesCategory===c?'selected':''}>${c}</option>`).join('')}
          </select>
          <select id="bookWillSel" class="inp" style="width:140px;flex:0 0 auto">
            <option value="">图书意愿</option>
            ${WILLINGNESS_LEVELS.map(w => `<option ${state.bookWillingness===w?'selected':''}>${w}</option>`).join('')}
          </select>
          <select id="courseWillSel" class="inp" style="width:140px;flex:0 0 auto">
            <option value="">课程意愿</option>
            ${WILLINGNESS_LEVELS.map(w => `<option ${state.courseWillingness===w?'selected':''}>${w}</option>`).join('')}
          </select>
          <select id="mcnSel" class="inp" style="width:120px;flex:0 0 auto">
            <option value="">MCN</option>
            ${YES_NO.map(v => `<option value="${v}" ${state.hasMCN===v?'selected':''}>${v==='是'?'有MCN':'无MCN'}</option>`).join('')}
          </select>
          <select id="huxuanSel" class="inp" style="width:120px;flex:0 0 auto">
            <option value="">互选</option>
            ${YES_NO.map(v => `<option value="${v}" ${state.joinedHuxuan===v?'selected':''}>${v==='是'?'已入驻':'未入驻'}</option>`).join('')}
          </select>
          <select id="coopSel" class="inp" style="width:150px;flex:0 0 auto">
            <option value="">全部合作类型</option>
            ${COOP_ACCEPT.map(c => `<option ${state.coopAccept===c?'selected':''}>${c}</option>`).join('')}
          </select>
          <select id="salesOwnerSel" class="inp" style="width:130px;flex:0 0 auto">
            <option value="">全部归属销售</option>
            ${[...new Set(all.map(t => t.salesOwner).filter(Boolean))].sort().map(s => `<option value="${escapeHtml(s)}" ${state.salesOwner===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" id="resetBtn">重置</button>
          ${selectedCount > 0 ? `
            <div class="ml-auto flex items-center gap-2">
              <span class="text-sm text-slate-500">已选 <b class="text-brand-700">${selectedCount}</b> 位</span>
              <button class="btn btn-ghost btn-sm" id="batchEditBtn">批量编辑</button>
              <button class="btn btn-danger btn-sm" id="batchDelBtn">批量删除</button>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto">${renderTable(pageList)}</div>
        ${renderPagination(pgInfo)}
      </div>
    </div>
  `;

  main.querySelectorAll('[data-filter-level]').forEach(card => {
    card.addEventListener('click', () => {
      const lv = card.dataset.filterLevel;
      if (lv === '__all__') {
        state.level = '';
      } else {
        state.level = state.level === lv ? '' : lv;
      }
      state.page = 1;
      draw(main);
    });
  });

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
      source: () => getTalents(),
      matchFn: (t, kw) => {
        const str = [t.id, t.name, t.videoAccount, t.officialAccount, t.region, t.salesCategory, t.mcnName, t.salesOwner, t.level]
          .filter(Boolean).join(' ').toLowerCase();
        return str.includes(kw);
      },
      renderItem: (t) => {
        const levelMeta = t.level ? TALENT_LEVEL_META[t.level] : null;
        return `
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center text-[10px] font-semibold shrink-0">${escapeHtml((t.name||'?').slice(0,1))}</div>
            <span class="flex-1 text-sm text-slate-800 truncate">${escapeHtml(t.name)}${t.videoAccount?` <span class="text-xs text-slate-400">· ${escapeHtml(t.videoAccount)}</span>`:''}</span>
            <span class="text-xs text-slate-400">${escapeHtml(t.region||'')}</span>
            ${levelMeta ? `<span class="badge ${levelMeta.badge} text-[10px]">${escapeHtml(t.level)}级</span>` : ''}
          </div>`;
      },
      formatSelected: (t) => t.name,
      onSelect: (t) => {
        state.keyword = t.name || '';
        state.page = 1;
        draw(main);
      },
      onInput: (kw) => {
        state.keyword = kw;
        state.page = 1;
        draw(main);
        const newInp = main.querySelector('#kwInp');
        if (newInp && document.activeElement !== newInp) newInp.focus();
      }
    });
  }
  main.querySelector('#levelSel').addEventListener('change', e => { state.level = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#regionSel').addEventListener('change', e => { state.region = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#formSel').addEventListener('change', e => { state.contentForm = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#categorySel').addEventListener('change', e => { state.salesCategory = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#bookWillSel').addEventListener('change', e => { state.bookWillingness = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#courseWillSel').addEventListener('change', e => { state.courseWillingness = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#mcnSel').addEventListener('change', e => { state.hasMCN = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#huxuanSel').addEventListener('change', e => { state.joinedHuxuan = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#coopSel').addEventListener('change', e => { state.coopAccept = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#salesOwnerSel').addEventListener('change', e => { state.salesOwner = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#resetBtn').addEventListener('click', () => {
    state.keyword = ''; state.region = ''; state.contentForm = ''; state.level = '';
    state.salesCategory = ''; state.bookWillingness = ''; state.courseWillingness = '';
    state.hasMCN = ''; state.joinedHuxuan = ''; state.coopAccept = '';
    state.salesOwner = '';
    state.selected.clear(); state.page = 1; draw(main);
  });

  main.querySelector('#exportBtn').addEventListener('click', () => exportList(list));

  // 一键删除下拉菜单
  const dangerBtn = main.querySelector('#dangerMenuBtn');
  const dangerMenu = main.querySelector('#dangerMenu');
  if (dangerBtn && dangerMenu) {
    const closeMenu = () => dangerMenu.classList.add('hidden');
    const toggleMenu = (e) => {
      e.stopPropagation();
      dangerMenu.classList.toggle('hidden');
    };
    dangerBtn.addEventListener('click', toggleMenu);
    document.addEventListener('click', (e) => {
      if (!main.querySelector('#dangerMenuWrap')?.contains(e.target)) closeMenu();
    });
    dangerMenu.querySelectorAll('[data-danger-act]').forEach(btn => {
      btn.addEventListener('click', async () => {
        closeMenu();
        const act = btn.dataset.dangerAct;
        if (act === 'all') {
          if (!all.length) return toast('暂无达人可删除', 'info');
          const ok = await confirmDialog({
            title: '删除全部达人',
            danger: true,
            okText: `删除全部 ${all.length} 位`,
            content: `此操作将<b class="text-rose-600">永久删除所有 ${all.length} 位达人</b>，相关撮合数据中的达人关联也将失效，操作不可恢复。<br/><br/>请确认是否继续？`
          });
          if (ok) {
            await deleteTalents(all.map(t => t.id));
            state.selected.clear();
            state.page = 1;
            toast(`已清空全部达人（${all.length} 位）`, 'success');
            draw(main);
          }
        } else if (act === 'level') {
          const lv = btn.dataset.level;
          const targets = all.filter(t => (t.level || 'C') === lv);
          if (!targets.length) return toast(`暂无 ${lv} 级达人`, 'info');
          const ok = await confirmDialog({
            title: `删除 ${lv} 级达人`,
            danger: true,
            okText: `删除 ${targets.length} 位 ${lv} 级`,
            content: `将删除 <b class="text-rose-600">${lv} 级</b> 共 <b>${targets.length}</b> 位达人，操作不可恢复。<br/><br/>请确认是否继续？`
          });
          if (ok) {
            await deleteTalents(targets.map(t => t.id));
            state.selected.clear();
            state.page = 1;
            toast(`已删除 ${lv} 级达人 ${targets.length} 位`, 'success');
            draw(main);
          }
        }
      });
    });
  }

  const be = main.querySelector('#batchEditBtn');
  if (be) be.addEventListener('click', () => openBatchEdit(main));
  const bd = main.querySelector('#batchDelBtn');
  if (bd) bd.addEventListener('click', async () => {
    const ok = await confirmDialog({ title:'批量删除', danger:true, okText:'确认删除',
      content:`确定删除选中的 <b>${state.selected.size}</b> 位达人？` });
    if (ok) { await deleteTalents([...state.selected]); state.selected.clear(); toast('已删除','success'); draw(main); }
  });

  const tbody = main.querySelector('tbody');
  if (tbody) {
    const allChk = main.querySelector('#chkAll');
    if (allChk) allChk.addEventListener('change', e => {
      if (e.target.checked) pageList.forEach(t => state.selected.add(t.id));
      else pageList.forEach(t => state.selected.delete(t.id));
      draw(main);
    });
    tbody.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.matches('.chk')) {
        if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
        draw(main); return;
      }
      // 序号徽章或其编辑输入框点击不触发其它事件
      if (e.target.classList && (e.target.classList.contains('seq-weight-inp') || e.target.classList.contains('seq-badge'))) {
        e.stopPropagation();
        return;
      }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'view') { openDetail(main, id); return; }
      if (act === 'edit') { openForm(main, id); return; }
      if (act === 'del') {
        confirmDialog({ title:'删除达人', danger:true, okText:'删除',
          content:`确认删除「${escapeHtml(getTalents().find(t=>t.id===id)?.name||'')}」？` }).then(async ok=>{
          if (ok) { await deleteTalents([id]); toast('已删除','success'); draw(main); }
        });
        return;
      }
      // Inline 编辑：点击可编辑单元格进入就地编辑
      const editTd = e.target.closest('td.editable');
      if (editTd && tr.contains(editTd) && !editTd.classList.contains('editing')) {
        startTalentInlineEdit(main, editTd, id);
      }
    });

    // 序号编辑：点击徽章 → 输入框；失焦/回车保存（下限 1，数字越大越靠前）
    tbody.querySelectorAll('.seq-badge').forEach(badge => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        if (badge.classList.contains('editing')) return;
        const id = badge.dataset.seqId;
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
            inp.remove();
            badge.style.display = '';
            badge.classList.remove('editing');
            return;
          }
          await updateSortWeight('talent', id, v);
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
  }

  bindPagination(main, pgInfo, ({ page, pageSize }) => {
    state.page = page;
    state.pageSize = pageSize;
    draw(main);
  });
}

function filter(list) {
  const kw = state.keyword.trim().toLowerCase();
  const filtered = list.filter(t => {
    if (state.region && t.region !== state.region) return false;
    if (state.contentForm && !(t.contentForms||[]).includes(state.contentForm)) return false;
    if (state.level && (t.level||'C') !== state.level) return false;
    if (state.salesCategory) {
      // 同时在 salesCategory 文本和 categories 数组中匹配
      const sc = (t.salesCategory || '').toLowerCase();
      const inCats = (t.categories || []).includes(state.salesCategory);
      if (!sc.includes(state.salesCategory.toLowerCase()) && !inCats) return false;
    }
    if (state.bookWillingness && t.bookWillingness !== state.bookWillingness) return false;
    if (state.courseWillingness && t.courseWillingness !== state.courseWillingness) return false;
    if (state.hasMCN && (t.hasMCN || '否') !== state.hasMCN) return false;
    if (state.joinedHuxuan && (t.joinedHuxuan || '否') !== state.joinedHuxuan) return false;
    if (state.salesOwner && (t.salesOwner || '') !== state.salesOwner) return false;
    if (state.coopAccept && !(t.coopAccept || []).includes(state.coopAccept)) return false;
    if (kw) {
      const str = [t.name, t.videoAccount, t.officialAccount, t.id, t.mcnName, t.salesCategory, t.salesOwner].filter(Boolean).join(' ').toLowerCase();
      if (!str.includes(kw)) return false;
    }
    return true;
  });
  return sortBySortWeight(filtered);
}

function renderTable(list) {
  if (!list.length) return `<div class="empty">暂无达人数据</div>`;
  return `
    <table class="tbl talents-tbl">
      <thead>
        <tr>
          <th style="width:40px"><input id="chkAll" type="checkbox" class="chk"/></th>
          <th style="width:80px" title="序号越大越靠前">序号</th>
          <th>达人</th>
          <th style="width:80px">等级</th>
          <th>地区</th>
          <th>视频号 / 公众号</th>
          <th class="text-right">视频号粉丝</th>
          <th>带货品类赛道</th>
          <th class="text-right">近月销售额(万)</th>
          <th>图书带货意愿</th>
          <th>课程带货意愿</th>
          <th>更新频率</th>
          <th>MCN</th>
          <th>入驻互选</th>
          <th>归属销售</th>
          <th>合作类型</th>
          <th style="width:140px">操作</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((t, idx) => {
          const totalSales = Number(t.shortVideoSales||0) + Number(t.liveSales||0);
          const lv = t.level || 'C';
          const lvMeta = TALENT_LEVEL_META[lv] || TALENT_LEVEL_META.C;
          const seq = idx + 1 + (state.page - 1) * state.pageSize;
          const sortWeight = Number(t.sortWeight) || 0;
          const displaySeq = sortWeight >= 1 ? sortWeight : seq;
          return `
          <tr data-id="${t.id}" class="${state.selected.has(t.id)?'selected':''}">
            <td><input type="checkbox" class="chk" ${state.selected.has(t.id)?'checked':''}/></td>
            <td class="seq-cell">
              <span class="seq-badge" data-seq-id="${t.id}" data-seq-kind="talent" data-seq-current="${displaySeq}" title="点击修改序号：数字越大越靠前（最小值 1）">${displaySeq}</span>
            </td>
            <td class="editable" data-field="name" data-type="text" title="点击编辑">
              <div class="flex items-center gap-2">
                <div class="w-9 h-9 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center font-semibold">${escapeHtml((t.name||'?').slice(0,1))}</div>
                <div>
                  <div class="font-medium text-slate-800">${escapeHtml(t.name)}</div>
                  <div class="text-xs text-slate-400 font-mono">${escapeHtml(t.id)}</div>
                </div>
              </div>
            </td>
            <td class="editable" data-field="level" data-type="select" data-options="${TALENT_LEVELS.join('|')}">
              <span class="inline-flex items-center justify-center w-7 h-7 rounded-md text-white text-xs font-bold" style="background:${lvMeta.color}" title="${lvMeta.desc}">${lv}</span>
            </td>
            <td class="editable" data-field="region" data-type="select" data-options="${REGIONS.join('|')}"><span class="badge badge-slate">${escapeHtml(t.region||'-')}</span></td>
            <td class="text-xs cell-2line" title="视频号 / 公众号">
              <div class="editable" data-field="videoAccount" data-type="text">
                ${t.videoAccount?`<div class="flex items-center gap-1 text-slate-600"><span class="text-emerald-600">📹</span>${escapeHtml(t.videoAccount)}</div>`:'<span class="text-slate-300">未填视频号</span>'}
              </div>
              <div class="editable mt-0.5" data-field="officialAccount" data-type="text">
                ${t.officialAccount?`<div class="flex items-center gap-1 text-slate-500"><span class="text-blue-600">📰</span>${escapeHtml(t.officialAccount)}</div>`:'<span class="text-slate-300">未填公众号</span>'}
              </div>
            </td>
            <td class="editable text-right font-semibold" data-field="videoFans" data-type="number">${t.videoFans?formatNumber(t.videoFans)+'万':'<span class="text-slate-300">-</span>'}</td>
            <td class="editable text-xs text-slate-600 clamp-2" data-field="categories" data-type="tags" data-options="${BOOK_CATEGORIES_FOR_TALENT.join('|')}" title="${escapeHtml((t.categories||[]).join('、') || t.salesCategory || '')}">
              <div class="tag-list clamp-2-inner">
                ${(() => {
                  const cats = (t.categories && t.categories.length)
                    ? t.categories
                    : (t.salesCategory ? String(t.salesCategory).split(/[,，、;；/|]/).map(s=>s.trim()).filter(Boolean) : []);
                  return cats.length
                    ? cats.map(c => `<span class="badge badge-purple">${escapeHtml(c)}</span>`).join('')
                    : '<span class="text-slate-300">-</span>';
                })()}
              </div>
            </td>
            <td class="text-right cell-2line">
              <div class="font-semibold ${totalSales?'text-emerald-600':'text-slate-300'}">${totalSales?formatNumber(totalSales):'-'}</div>
              <div class="text-[10px] text-slate-400">短${t.shortVideoSales||0}/直${t.liveSales||0}</div>
            </td>
            <td class="editable" data-field="bookWillingness" data-type="select" data-options="${WILLINGNESS_LEVELS.join('|')}">${willingnessBadge(t.bookWillingness)}</td>
            <td class="editable" data-field="courseWillingness" data-type="select" data-options="${WILLINGNESS_LEVELS.join('|')}">${willingnessBadge(t.courseWillingness)}</td>
            <td class="text-xs text-slate-500 cell-2line">
              <div>短: ${escapeHtml(t.shortVideoFreq||'-')}</div>
              <div>直: ${escapeHtml(t.liveFreq||'-')}</div>
            </td>
            <td class="editable text-xs" data-field="mcnName" data-type="text">
              ${t.hasMCN==='是'
                ? `<span class="badge badge-purple">${escapeHtml(t.mcnName||'有')}</span>`
                : '<span class="text-slate-400">无</span>'}
            </td>
            <td class="editable" data-field="joinedHuxuan" data-type="select" data-options="是|否">${t.joinedHuxuan==='是'?'<span class="badge badge-green">是</span>':'<span class="badge badge-slate">否</span>'}</td>
            <td class="editable text-xs" data-field="salesOwner" data-type="text">
              ${t.salesOwner
                ? `<span class="badge badge-blue">${escapeHtml(t.salesOwner)}</span>`
                : '<span class="text-slate-300">-</span>'}
            </td>
            <td class="cell-2line">
              ${(t.coopAccept||[]).slice(0,2).map(c => `<span class="badge badge-amber mr-1 mb-1 text-[10px]">${escapeHtml(c)}</span>`).join('')}
              ${(t.coopAccept||[]).length>2?`<span class="text-xs text-slate-400">+${t.coopAccept.length-2}</span>`:''}
              ${!(t.coopAccept||[]).length?'<span class="text-slate-300 text-xs">-</span>':''}
            </td>
            <td>
              <button class="text-brand-600 hover:underline text-sm mr-2" data-act="view">详情</button>
              <button class="text-brand-600 hover:underline text-sm mr-2" data-act="edit">编辑</button>
              <button class="text-rose-500 hover:underline text-sm" data-act="del">删除</button>
            </td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;
}

function willingnessBadge(v) {
  if (!v) return '<span class="text-slate-300 text-xs">-</span>';
  const map = {
    '强意愿':   'badge-green',
    '一般意愿': 'badge-blue',
    '观望':     'badge-amber',
    '暂无意愿': 'badge-slate'
  };
  return `<span class="badge ${map[v]||'badge-slate'} text-[10px]">${escapeHtml(v)}</span>`;
}

/* ========== 达人详情 ========== */
function openDetail(main, id) {
  const t = getTalents().find(x => x.id === id); if (!t) return;
  const lv = t.level || 'C';
  const lvMeta = TALENT_LEVEL_META[lv] || TALENT_LEVEL_META.C;
  const body = `
    <div class="flex items-start gap-5 mb-5 pb-5 border-b border-slate-100">
      <div class="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-500 to-pink-500 grid place-items-center text-white text-3xl font-bold shrink-0 relative">
        ${escapeHtml((t.name||'?').slice(0,1))}
        <span class="absolute -top-1 -right-1 w-7 h-7 rounded-lg grid place-items-center text-white text-xs font-bold border-2 border-white" style="background:${lvMeta.color}">${lv}</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-xs text-slate-400 font-mono mb-1">${t.id}</div>
        <h3 class="text-xl font-bold text-slate-900">${escapeHtml(t.name)} <span class="text-sm font-normal text-slate-500 ml-1">· ${lvMeta.name}</span></h3>
        <div class="flex items-center gap-2 mt-1 flex-wrap">
          <span class="badge badge-slate">📍 ${escapeHtml(t.region||'-')}</span>
          ${(t.contentForms||[]).map(c => `<span class="badge badge-cyan">${escapeHtml(c)}</span>`).join('')}
          ${t.hasMCN==='是' ? `<span class="badge badge-purple">MCN: ${escapeHtml(t.mcnName||'有')}</span>` : ''}
          ${t.joinedHuxuan==='是' ? `<span class="badge badge-green">已入驻互选</span>` : ''}
          ${t.salesOwner ? `<span class="badge badge-blue">归属销售: ${escapeHtml(t.salesOwner)}</span>` : ''}
        </div>
        <p class="text-sm text-slate-600 mt-2 leading-relaxed">${escapeHtml(t.intro||'暂无介绍')}</p>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-3 mb-5">
      <div class="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
        <div class="text-xs text-slate-500">视频号粉丝</div>
        <div class="text-lg font-bold text-emerald-700 mt-0.5">${formatNumber(t.videoFans||0)}<span class="text-xs font-normal ml-0.5">万</span></div>
        <div class="text-[10px] text-slate-400 mt-0.5 truncate">${escapeHtml(t.videoAccount||'-')}</div>
      </div>
      <div class="p-3 rounded-lg bg-blue-50 border border-blue-100">
        <div class="text-xs text-slate-500">公众号粉丝</div>
        <div class="text-lg font-bold text-blue-700 mt-0.5">${formatNumber(t.officialFans||0)}<span class="text-xs font-normal ml-0.5">万</span></div>
        <div class="text-[10px] text-slate-400 mt-0.5 truncate">${escapeHtml(t.officialAccount||'-')}</div>
      </div>
      <div class="p-3 rounded-lg bg-purple-50 border border-purple-100">
        <div class="text-xs text-slate-500">短视频销售额(月)</div>
        <div class="text-lg font-bold text-purple-700 mt-0.5">${t.shortVideoSales||0}<span class="text-xs font-normal ml-0.5">万</span></div>
      </div>
      <div class="p-3 rounded-lg bg-amber-50 border border-amber-100">
        <div class="text-xs text-slate-500">直播销售额(月)</div>
        <div class="text-lg font-bold text-amber-700 mt-0.5">${t.liveSales||0}<span class="text-xs font-normal ml-0.5">万</span></div>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-5 mb-5">
      <div>
        <div class="text-xs text-slate-400 mb-2 font-medium">视频号带货品类赛道</div>
        <div class="text-sm text-slate-700">${escapeHtml(t.salesCategory||'-')}</div>
      </div>
      <div>
        <div class="text-xs text-slate-400 mb-2 font-medium">图书推广品类</div>
        <div class="flex flex-wrap gap-1.5">
          ${(t.categories||[]).map(c => `<span class="badge badge-purple">${escapeHtml(c)}</span>`).join('') || '<span class="text-sm text-slate-400">暂无</span>'}
        </div>
      </div>
      <div>
        <div class="text-xs text-slate-400 mb-2 font-medium">图书品类带货意愿</div>
        <div>${willingnessBadge(t.bookWillingness)||'-'}</div>
      </div>
      <div>
        <div class="text-xs text-slate-400 mb-2 font-medium">少儿课程品类带货意愿</div>
        <div>${willingnessBadge(t.courseWillingness)||'-'}</div>
      </div>
      <div>
        <div class="text-xs text-slate-400 mb-2 font-medium">短视频更新频率（近3月）</div>
        <div class="text-sm text-slate-700">${escapeHtml(t.shortVideoFreq||'-')}</div>
      </div>
      <div>
        <div class="text-xs text-slate-400 mb-2 font-medium">直播频率（近3月）</div>
        <div class="text-sm text-slate-700">${escapeHtml(t.liveFreq||'-')}</div>
      </div>
      <div class="col-span-2">
        <div class="text-xs text-slate-400 mb-2 font-medium">可接受合作类型</div>
        <div class="flex flex-wrap gap-1.5">
          ${(t.coopAccept||[]).map(c => `<span class="badge badge-amber">${escapeHtml(c)}</span>`).join('') || '<span class="text-sm text-slate-400">暂无</span>'}
        </div>
      </div>
      <div>
        <div class="text-xs text-slate-400 mb-2 font-medium">归属销售</div>
        <div class="text-sm text-slate-700">${t.salesOwner ? `<span class="badge badge-blue">${escapeHtml(t.salesOwner)}</span>` : '<span class="text-slate-400">-</span>'}</div>
      </div>
    </div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">关闭</button>
    <button class="btn btn-primary" data-act="edit">编辑此达人</button>
  `;
  openModal({
    title:'达人详情', bodyHtml: body, footerHtml: footer, width:'820px',
    onBack: () => {},
    onMount(root, close) {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="edit"]').addEventListener('click', () => {
        close(); openForm(main, id, () => openDetail(main, id));
      });
    }
  });
}

/* ========== 新增/编辑表单 ========== */
function openForm(main, id, onBackToDetail) {
  const editing = id ? getTalents().find(t => t.id === id) : null;
  const t = editing || {
    id: nextId('T'), name:'', region: REGIONS[0], intro:'',
    videoAccount:'', officialAccount:'',
    videoFans:'', officialFans:'',
    level: 'B',
    categories: [],
    salesCategory: '',
    shortVideoSales: 0, liveSales: 0,
    contentForms: [], coopAccept: [],
    bookWillingness: '', courseWillingness: '',
    shortVideoFreq: '', liveFreq: '',
    hasMCN: '否', mcnName: '',
    joinedHuxuan: '否',
    salesOwner: '',
    createdAt: new Date().toISOString().slice(0,10)
  };
  const body = `
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="form-label">达人姓名 <span class="req">*</span></label>
        <input name="name" class="inp" value="${escapeHtml(t.name)}"/>
      </div>
      <div>
        <label class="form-label">达人编号</label>
        <input name="id" class="inp" value="${escapeHtml(t.id)}" ${editing?'readonly':''}/>
      </div>
      <div>
        <label class="form-label">达人等级 <span class="req">*</span></label>
        <select name="level" class="inp">
          ${TALENT_LEVELS.map(lv => {
            const m = TALENT_LEVEL_META[lv];
            return `<option value="${lv}" ${ (t.level||'B') === lv ? 'selected' : ''}>${m.name} · ${m.desc}</option>`;
          }).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">地区</label>
        <select name="region" class="inp">
          ${REGIONS.map(r => `<option ${t.region===r?'selected':''}>${r}</option>`).join('')}
        </select>
      </div>
      <div class="col-span-2">
        <label class="form-label">介绍</label>
        <textarea name="intro" class="inp" rows="2" placeholder="达人简介、风格定位、代表内容等">${escapeHtml(t.intro||'')}</textarea>
      </div>

      <div class="col-span-2 mt-1 -mb-2">
        <div class="text-sm font-semibold text-slate-700">账号信息</div>
      </div>
      <div>
        <label class="form-label">视频号账号名称</label>
        <input name="videoAccount" class="inp" value="${escapeHtml(t.videoAccount||'')}" placeholder="视频号展示名"/>
      </div>
      <div>
        <label class="form-label">公众号昵称</label>
        <input name="officialAccount" class="inp" value="${escapeHtml(t.officialAccount||'')}" placeholder="公众号昵称（可选）"/>
      </div>
      <div>
        <label class="form-label">视频号粉丝数量 (万)</label>
        <input name="videoFans" type="number" step="0.1" class="inp" value="${t.videoFans||''}"/>
      </div>
      <div>
        <label class="form-label">公众号粉丝数 (万)</label>
        <input name="officialFans" type="number" step="0.1" class="inp" value="${t.officialFans||''}"/>
      </div>

      <div class="col-span-2 mt-1 -mb-2">
        <div class="text-sm font-semibold text-slate-700">带货能力 · 近一个月</div>
      </div>
      <div class="col-span-2">
        <label class="form-label">视频号带货品类赛道</label>
        <input name="salesCategory" class="inp" value="${escapeHtml(t.salesCategory||'')}" placeholder="例如：少儿图书、社科历史（多个用、/,分隔）"/>
      </div>
      <div>
        <label class="form-label">现视频号品类销售额-短视频(月，万)</label>
        <input name="shortVideoSales" type="number" step="0.1" class="inp" value="${t.shortVideoSales||0}"/>
      </div>
      <div>
        <label class="form-label">现视频号品类销售额-直播(月，万)</label>
        <input name="liveSales" type="number" step="0.1" class="inp" value="${t.liveSales||0}"/>
      </div>
      <div>
        <label class="form-label">视频号图书品类带货意愿</label>
        <select name="bookWillingness" class="inp">
          <option value="">未填写</option>
          ${WILLINGNESS_LEVELS.map(w=>`<option ${t.bookWillingness===w?'selected':''}>${w}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">视频号少儿课程品类带货意愿</label>
        <select name="courseWillingness" class="inp">
          <option value="">未填写</option>
          ${WILLINGNESS_LEVELS.map(w=>`<option ${t.courseWillingness===w?'selected':''}>${w}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">最近3个月、日常短视频更新频率</label>
        <select name="shortVideoFreq" class="inp">
          <option value="">未填写</option>
          ${UPDATE_FREQUENCIES.map(w=>`<option ${t.shortVideoFreq===w?'selected':''}>${w}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">最近3个月、日常直播频率</label>
        <select name="liveFreq" class="inp">
          <option value="">未填写</option>
          ${LIVE_FREQUENCIES.map(w=>`<option ${t.liveFreq===w?'selected':''}>${w}</option>`).join('')}
        </select>
      </div>

      <div class="col-span-2 mt-1 -mb-2">
        <div class="text-sm font-semibold text-slate-700">其他信息</div>
      </div>
      <div>
        <label class="form-label">是否有MCN</label>
        <select name="hasMCN" class="inp" id="hasMCNSel">
          ${YES_NO.map(v=>`<option value="${v}" ${t.hasMCN===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">MCN名称</label>
        <input name="mcnName" class="inp" value="${escapeHtml(t.mcnName||'')}" placeholder="如：MCN星光" ${t.hasMCN==='是'?'':'disabled'}/>
      </div>
      <div>
        <label class="form-label">是否已入驻互选</label>
        <select name="joinedHuxuan" class="inp">
          ${YES_NO.map(v=>`<option value="${v}" ${t.joinedHuxuan===v?'selected':''}>${v}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">归属销售</label>
        <input name="salesOwner" class="inp" value="${escapeHtml(t.salesOwner||'')}" placeholder="该达人归属的销售/BD 姓名"/>
      </div>

      <div class="col-span-2">
        <label class="form-label">图书推广品类（多选）</label>
        <div class="flex flex-wrap gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
          ${BOOK_CATEGORIES_FOR_TALENT.map(c => `
            <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 cursor-pointer hover:border-brand-400 text-sm">
              <input type="checkbox" class="chk" name="cat" value="${c}" ${(t.categories||[]).includes(c)?'checked':''}/>
              ${c}
            </label>
          `).join('')}
        </div>
      </div>

      <div class="col-span-2">
        <label class="form-label">内容形式（必选，可多选）<span class="req">*</span></label>
        <div class="flex flex-wrap gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
          ${CONTENT_FORMS.map(c => `
            <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-200 cursor-pointer hover:border-brand-400 text-sm">
              <input type="checkbox" class="chk" name="contentForm" value="${c}" ${(t.contentForms||[]).includes(c)?'checked':''}/>
              ${c}
            </label>
          `).join('')}
        </div>
      </div>

      <div class="col-span-2">
        <label class="form-label">可接受合作类型（必选，可多选）<span class="req">*</span></label>
        <div class="flex flex-wrap gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
          ${COOP_ACCEPT.map(c => `
            <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-200 cursor-pointer hover:border-brand-400 text-sm">
              <input type="checkbox" class="chk" name="coopAccept" value="${c}" ${(t.coopAccept||[]).includes(c)?'checked':''}/>
              ${c}
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="save">${editing?'保存修改':'确认录入'}</button>
  `;
  openModal({
    title: editing?'编辑达人':'录入达人', bodyHtml: body, footerHtml: footer, width:'860px',
    onBack: onBackToDetail || (() => {}),
    onMount(root, close) {
      // 是否有MCN 联动
      const hasMcnSel = root.querySelector('#hasMCNSel');
      const mcnInp = root.querySelector('[name="mcnName"]');
      hasMcnSel?.addEventListener('change', e => {
        if (e.target.value === '是') mcnInp.disabled = false;
        else { mcnInp.disabled = true; mcnInp.value = ''; }
      });

      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const d = {};
        root.querySelectorAll('[name]:not([type="checkbox"])').forEach(el => d[el.name] = (el.value || '').toString().trim());
        d.categories = [...root.querySelectorAll('input[name="cat"]:checked')].map(e=>e.value);
        d.contentForms = [...root.querySelectorAll('input[name="contentForm"]:checked')].map(e=>e.value);
        d.coopAccept = [...root.querySelectorAll('input[name="coopAccept"]:checked')].map(e=>e.value);
        if (!d.name) return toast('请填写达人姓名','error');
        if (!d.contentForms.length) return toast('请至少选择一项内容形式','error');
        if (!d.coopAccept.length) return toast('请至少选择一项可接受合作类型','error');

        d.videoFans = Number(d.videoFans)||0;
        d.officialFans = Number(d.officialFans)||0;
        d.shortVideoSales = Number(d.shortVideoSales)||0;
        d.liveSales = Number(d.liveSales)||0;
        if (!d.level || !TALENT_LEVELS.includes(d.level)) d.level = 'B';

        // 兼容历史字段
        d.platform = '视频号';
        d.followers = d.videoFans;
        d.tier = d.videoFans>=300?'头部':d.videoFans>=50?'腰部':'尾部';
        d.gpm = 2000 + d.videoFans * 10;
        d.commissionBase = editing?.commissionBase ?? 20;
        d.score = editing?.score ?? 75;
        d.createdAt = editing?.createdAt || new Date().toISOString().slice(0,10);

        await upsertTalent(d);
        toast(editing?'已保存':'录入成功','success');
        close(); draw(main);
      });
    }
  });
}

/* ========== 批量编辑 ========== */
function openBatchEdit(main) {
  const ids = [...state.selected];
  const body = `
    <div class="mb-4 text-sm text-slate-500">将对选中的 <b class="text-brand-700">${ids.length}</b> 位达人进行批量修改，留空字段不会被修改。</div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="form-label">达人等级</label>
        <select name="level" class="inp">
          <option value="">不修改</option>
          ${TALENT_LEVELS.map(lv => `<option value="${lv}">${TALENT_LEVEL_META[lv].name}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">地区</label>
        <select name="region" class="inp">
          <option value="">不修改</option>
          ${REGIONS.map(r=>`<option>${r}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">图书带货意愿</label>
        <select name="bookWillingness" class="inp">
          <option value="">不修改</option>
          ${WILLINGNESS_LEVELS.map(w=>`<option>${w}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">课程带货意愿</label>
        <select name="courseWillingness" class="inp">
          <option value="">不修改</option>
          ${WILLINGNESS_LEVELS.map(w=>`<option>${w}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">是否已入驻互选</label>
        <select name="joinedHuxuan" class="inp">
          <option value="">不修改</option>
          ${YES_NO.map(v=>`<option>${v}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">是否有MCN</label>
        <select name="hasMCN" class="inp">
          <option value="">不修改</option>
          ${YES_NO.map(v=>`<option>${v}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">归属销售</label>
        <input name="salesOwner" class="inp" placeholder="留空不修改，填入则覆盖为此销售"/>
      </div>
      <div class="col-span-2">
        <label class="form-label">追加推广品类（不会覆盖已有）</label>
        <div class="flex flex-wrap gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
          ${BOOK_CATEGORIES_FOR_TALENT.map(c => `
            <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 cursor-pointer hover:border-brand-400 text-sm">
              <input type="checkbox" class="chk" name="appendCat" value="${c}"/>${c}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="col-span-2">
        <label class="form-label">追加内容形式（不会覆盖已有）</label>
        <div class="flex flex-wrap gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
          ${CONTENT_FORMS.map(c => `
            <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-200 cursor-pointer hover:border-brand-400 text-sm">
              <input type="checkbox" class="chk" name="appendForm" value="${c}"/>${c}
            </label>
          `).join('')}
        </div>
      </div>
      <div class="col-span-2">
        <label class="form-label">追加合作类型（不会覆盖已有）</label>
        <div class="flex flex-wrap gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
          ${COOP_ACCEPT.map(c => `
            <label class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-200 cursor-pointer hover:border-brand-400 text-sm">
              <input type="checkbox" class="chk" name="appendCoop" value="${c}"/>${c}
            </label>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="save">应用到 ${ids.length} 项</button>
  `;
  openModal({
    title:'批量编辑达人', bodyHtml: body, footerHtml: footer,
    onBack: () => {},
    onMount(root, close) {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const d = {};
        root.querySelectorAll('[name]:not([type="checkbox"])').forEach(el => d[el.name] = el.value.trim());
        const appendCat = [...root.querySelectorAll('input[name="appendCat"]:checked')].map(e=>e.value);
        const appendForm = [...root.querySelectorAll('input[name="appendForm"]:checked')].map(e=>e.value);
        const appendCoop = [...root.querySelectorAll('input[name="appendCoop"]:checked')].map(e=>e.value);
        const list = getTalents().filter(x=>ids.includes(x.id)).map(x => {
          const u = { ...x };
          if (d.level && TALENT_LEVELS.includes(d.level)) u.level = d.level;
          if (d.region) u.region = d.region;
          if (d.bookWillingness) u.bookWillingness = d.bookWillingness;
          if (d.courseWillingness) u.courseWillingness = d.courseWillingness;
          if (d.joinedHuxuan) u.joinedHuxuan = d.joinedHuxuan;
          if (d.hasMCN) u.hasMCN = d.hasMCN;
          if (d.salesOwner) u.salesOwner = d.salesOwner;
          if (appendCat.length) u.categories = [...new Set([...(u.categories||[]), ...appendCat])];
          if (appendForm.length) u.contentForms = [...new Set([...(u.contentForms||[]), ...appendForm])];
          if (appendCoop.length) u.coopAccept = [...new Set([...(u.coopAccept||[]), ...appendCoop])];
          return u;
        });
        await batchUpsertTalents(list);
        toast(`已更新 ${list.length} 项`,'success');
        state.selected.clear(); close(); draw(main);
      });
    }
  });
}

/* ========== 批量上传：仅保留本地 Excel（已移除腾讯文档通道） ========== */
function templateHeaders() {
  // Excel 模板字段顺序，无需填写达人编号（由系统自动生成）
  return [
    '达人等级', '视频号账号名称', '视频号带货品类赛道',
    '现视频号品类销售额（月）短视频（万）', '现视频号品类销售额（月）直播（万）',
    '视频号粉丝数量', '可接受的合作类型',
    '视频号图书品类带货意愿', '视频号少儿课程品类带货意愿',
    '最近3个月、日常短视频更新频率', '最近3个月、日常直播频率',
    '是否有MCN', 'MCN名称', '地区', '是否已入驻互选', '归属销售',
    // 辅助字段
    '达人姓名', '介绍', '公众号昵称', '公众号粉丝(万)', '图书推广品类', '内容形式'
  ];
}

function exportList(list) {
  const rows = list.map(t => ({
    '达人编号': t.id,
    '达人等级': t.level||'',
    '视频号账号名称': t.videoAccount||'',
    '视频号带货品类赛道': t.salesCategory|| (t.categories||[]).join('、'),
    '现视频号品类销售额（月）短视频（万）': t.shortVideoSales||0,
    '现视频号品类销售额（月）直播（万）': t.liveSales||0,
    '视频号粉丝数量': t.videoFans||0,
    '可接受的合作类型': (t.coopAccept||[]).join(','),
    '视频号图书品类带货意愿': t.bookWillingness||'',
    '视频号少儿课程品类带货意愿': t.courseWillingness||'',
    '最近3个月、日常短视频更新频率': t.shortVideoFreq||'',
    '最近3个月、日常直播频率': t.liveFreq||'',
    '是否有MCN': t.hasMCN||'',
    'MCN名称': t.mcnName||'',
    '地区': t.region||'',
    '是否已入驻互选': t.joinedHuxuan||'',
    '归属销售': t.salesOwner||'',
    '达人姓名': t.name||'',
    '介绍': t.intro||'',
    '公众号昵称': t.officialAccount||'',
    '公众号粉丝(万)': t.officialFans||0,
    '图书推广品类': (t.categories||[]).join(','),
    '内容形式': (t.contentForms||[]).join(','),
    '创建时间': t.createdAt
  }));
  exportExcel(rows, `达人列表_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('已导出 ' + rows.length + ' 条', 'success');
}

/* 字段容错映射：表头 → 标准值 */
function mapRowToTalent(r) {
  const getField = (...keys) => {
    for (const k of keys) {
      if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
    }
    return '';
  };
  const videoFans = Number(getField('视频号粉丝数量', '视频号粉丝(万)', '视频号粉丝数量(万)', '视频号粉丝'))||0;
  const officialFans = Number(getField('公众号粉丝(万)','公众号粉丝','公众号粉丝数'))||0;
  const contentForms = splitMulti(getField('内容形式','内容形式(逗号分隔)'));
  const coopAccept = splitMulti(getField('可接受的合作类型','可接受合作形式','可接受合作类型','可接受合作形式(逗号分隔)'));
  const categories = splitMulti(getField('图书推广品类','图书推广品类(逗号分隔)','视频号带货品类赛道'));
  const salesCategory = String(getField('视频号带货品类赛道','带货品类赛道')||categories.join('、')||'').trim();
  const level = String(getField('达人等级')||'').trim().toUpperCase().replace(/级$/,'') || 'B';
  const levelOK = TALENT_LEVELS.includes(level) ? level : 'B';
  const hasMCN = String(getField('是否有MCN','是否MCN','是否有mcn')||'否').trim();

  const t = {
    id: '',
    level: levelOK,
    region: String(getField('地区','所在地区')||REGIONS[0]),
    name: String(getField('达人姓名','达人名称','姓名')||'').trim(),
    intro: String(getField('介绍','达人介绍','简介')||'').trim(),
    videoAccount: String(getField('视频号账号名称','视频号','视频号昵称')||'').trim(),
    officialAccount: String(getField('公众号昵称','公众号账号','公众号')||'').trim(),
    videoFans, officialFans,
    categories,
    salesCategory,
    shortVideoSales: Number(getField(
      '现视频号品类销售额（月）短视频（万）',
      '现视频号品类销售额(月)短视频(万)',
      '现视频号销售额-短视频(万元/月)',
      '现视频号销售额-短视频'
    ))||0,
    liveSales: Number(getField(
      '现视频号品类销售额（月）直播（万）',
      '现视频号品类销售额(月)直播(万)',
      '现视频号销售额-直播(万元/月)',
      '现视频号销售额-直播'
    ))||0,
    contentForms,
    coopAccept,
    bookWillingness: String(getField('视频号图书品类带货意愿','图书带货意愿')||'').trim(),
    courseWillingness: String(getField('视频号少儿课程品类带货意愿','少儿课程带货意愿','课程带货意愿')||'').trim(),
    shortVideoFreq: String(getField('最近3个月、日常短视频更新频率','短视频更新频率')||'').trim(),
    liveFreq: String(getField('最近3个月、日常直播频率','直播频率')||'').trim(),
    hasMCN: (hasMCN==='是'||hasMCN==='有'||hasMCN==='Y'||hasMCN==='y'||hasMCN==='1') ? '是' : '否',
    mcnName: String(getField('MCN名称','机构名称','MCN')||'').trim(),
    joinedHuxuan: (String(getField('是否已入驻互选','是否入驻互选','互选入驻')||'否').trim()==='是') ? '是' : '否',
    salesOwner: String(getField('归属销售','销售负责人','BD','销售')||'').trim(),
    // 兼容字段
    platform: '视频号', followers: videoFans,
    tier: videoFans>=300?'头部':videoFans>=50?'腰部':'尾部',
    gpm: 2000 + videoFans*10, commissionBase: 20, score: 75,
    createdAt: new Date().toISOString().slice(0,10)
  };
  // 如果"视频号账号名称"有值但"达人姓名"为空，兜底用视频号名
  if (!t.name) t.name = t.videoAccount;
  return t;
}

function openImport(main) {
  const body = `
    <div id="panelLocal">
      <div class="text-sm text-slate-600 mb-3">支持 <b>.xlsx / .xls</b>，表头与达人管理字段一致，达人编号由系统自动生成，无需填写。多选字段请用中英文逗号分隔。</div>
      <div class="drop-zone" id="dropZone">
        <div class="flex flex-col items-center gap-2 text-slate-500">
          <svg viewBox="0 0 24 24" class="w-10 h-10 text-brand-400" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 10l5-5 5 5M12 5v12M5 19h14"/></svg>
          <div class="font-medium text-slate-700">点击或拖拽 Excel 文件到此处</div>
          <div class="text-xs">或 <button class="text-brand-600 underline" id="dlTplBtn">下载模板</button></div>
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
    title:'批量上传达人', bodyHtml: body, footerHtml: footer, width:'760px',
    onBack: () => {},
    onMount(root, close) {
      const dz = root.querySelector('#dropZone');
      const fi = root.querySelector('#fileInp');
      const prev = root.querySelector('#previewArea');
      const imp = root.querySelector('[data-act="import"]');
      let parsed = null;

      root.querySelector('#dlTplBtn').addEventListener('click', e => {
        e.stopPropagation();
        downloadTemplate(templateHeaders(), '达人导入模板.xlsx');
      });
      // 本地 Excel
      dz.addEventListener('click', () => fi.click());
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
      dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
      fi.addEventListener('change', () => { const f = fi.files[0]; if (f) handleFile(f); });

      async function handleFile(f) {
        try {
          const data = await parseExcel(f);
          if (!data.length) return toast('Excel为空','error');
          parsed = data.map(mapRowToTalent).filter(r => r.name);
          if (!parsed.length) return toast('未解析到有效数据（达人姓名/视频号账号名称必填一项）','error');

          prev.innerHTML = `
            <div class="text-sm text-slate-600 mb-2">
              解析到 <b class="text-brand-700">${parsed.length}</b> 条，预览前 5 条：
            </div>
            <div class="border border-slate-200 rounded-lg overflow-hidden overflow-x-auto">
              <table class="tbl text-xs"><thead>
                <tr>
                  <th>编号</th><th>等级</th><th>视频号</th><th>姓名</th>
                  <th>地区</th><th>赛道</th><th>粉丝(万)</th>
                  <th>短视频销售(万)</th><th>直播销售(万)</th>
                  <th>图书意愿</th><th>课程意愿</th><th>MCN</th><th>互选</th><th>归属销售</th>
                </tr>
              </thead><tbody>
                ${parsed.slice(0,5).map(r => `<tr>
                  <td>${escapeHtml(r.id||'(自动)')}</td>
                  <td>${escapeHtml(r.level)}</td>
                  <td>${escapeHtml(r.videoAccount||'-')}</td>
                  <td>${escapeHtml(r.name)}</td>
                  <td>${escapeHtml(r.region)}</td>
                  <td>${escapeHtml(Array.isArray(r.salesCategory)?r.salesCategory.join('、'):(r.salesCategory||'-'))}</td>
                  <td>${r.videoFans}</td>
                  <td>${r.shortVideoSales}</td>
                  <td>${r.liveSales}</td>
                  <td>${escapeHtml(r.bookWillingness||'-')}</td>
                  <td>${escapeHtml(r.courseWillingness||'-')}</td>
                  <td>${r.hasMCN==='是'?escapeHtml(r.mcnName||'有'):'无'}</td>
                  <td>${escapeHtml(r.joinedHuxuan||'-')}</td>
                  <td>${escapeHtml(r.salesOwner||'-')}</td>
                </tr>`).join('')}
              </tbody></table>
            </div>`;
          imp.disabled = false;
        } catch(err){ console.error(err); toast('解析失败：'+err.message,'error'); }
      }

      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      imp.addEventListener('click', async () => {
        if (!parsed?.length) return;
        await batchUpsertTalents(parsed);
        toast(`成功导入 ${parsed.length} 位达人`,'success');
        close(); draw(main);
      });
    }
  });
}

function splitMulti(str) {
  if (str == null || str === '') return [];
  return String(str).split(/[,，;；、/|]/).map(s => s.trim()).filter(Boolean);
}

/* ========== 列内编辑 ========== */
function startTalentInlineEdit(main, td, id) {
  const talent = getTalents().find(t => t.id === id);
  if (!talent) return;
  const field = td.dataset.field;
  const type = td.dataset.type || 'text';
  const oldHtml = td.innerHTML;
  const curValue = talent[field] != null ? talent[field] : '';

  td.classList.add('editing');

  // 多值标签编辑器（带货品类赛道 等场景）
  if (type === 'tags') {
    const opts = (td.dataset.options || '').split('|').filter(Boolean);
    // 初始值兼容：数组 / 字符串（多种分隔符）/ 空
    const initFrom = (v) => {
      if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
      if (!v) return [];
      return String(v).split(/[,，、;；/|]/).map(s => s.trim()).filter(Boolean);
    };
    // categories 字段优先用 categories 数组；salesCategory 作为兜底
    let selected = field === 'categories'
      ? (Array.isArray(talent.categories) && talent.categories.length ? [...talent.categories] : initFrom(talent.salesCategory))
      : initFrom(curValue);
    selected = [...new Set(selected)];

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
        : '<span class="text-xs text-slate-400">暂无已选，请勾选或在输入框中输入新赛道</span>';
      selBox.querySelectorAll('.tag-chip-x').forEach(b => b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const i = Number(b.dataset.i);
        const removed = current[i];
        current.splice(i, 1);
        wrap.querySelectorAll('.tag-opt input[type=checkbox]').forEach(c => {
          if (c.value === removed) c.checked = false;
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
      const parts = initFrom(inp.value);
      parts.forEach(v => { if (!current.includes(v)) current.push(v); });
      inp.value = '';
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
      if (inp.value.trim()) addFromInput();
      const arr = [...new Set(current.map(s => String(s).trim()).filter(Boolean))];
      const origArr = field === 'categories'
        ? (Array.isArray(talent.categories) ? talent.categories : initFrom(talent.salesCategory))
        : initFrom(curValue);
      if (arr.join('|') === origArr.join('|')) { cancel(); return; }
      const patch = { ...talent };
      if (field === 'categories') {
        patch.categories = arr;
        // 同步 salesCategory 便于搜索/导出（用顿号连接）
        patch.salesCategory = arr.join('、');
      } else {
        patch[field] = arr;
      }
      await upsertTalent(patch);
      toast('已更新', 'success', 1200);
      draw(main);
    };
    wrap.querySelector('[data-act="save"]').addEventListener('click', commit);
    wrap.querySelector('[data-act="cancel"]').addEventListener('click', cancel);
    wrap.addEventListener('click', e => e.stopPropagation());
    setTimeout(() => inp.focus(), 0);
    return;
  }

  let inputEl;
  if (type === 'select') {
    const opts = (td.dataset.options || '').split('|').filter(Boolean);
    inputEl = document.createElement('select');
    inputEl.innerHTML = `<option value=""></option>` + opts.map(o =>
      `<option value="${o}" ${String(curValue) === o ? 'selected' : ''}>${o}</option>`
    ).join('');
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
    let newVal = type === 'number' ? (inputEl.value === '' ? 0 : Number(inputEl.value)) : inputEl.value.trim();
    if (String(newVal) === String(curValue)) { cancel(); return; }
    const patch = { ...talent, [field]: newVal };
    // 级联：选 MCN 名称时，自动置 hasMCN='是'；清空 MCN 名称则置'否'
    if (field === 'mcnName') patch.hasMCN = newVal ? '是' : '否';
    // 视频号粉丝变更同步 followers/tier
    if (field === 'videoFans') {
      patch.followers = newVal;
      patch.tier = newVal >= 300 ? '头部' : newVal >= 50 ? '腰部' : '尾部';
    }
    await upsertTalent(patch);
    toast('已更新', 'success', 1200);
    draw(main);
  };
  inputEl.addEventListener('blur', commit);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
}