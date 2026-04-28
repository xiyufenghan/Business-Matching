/**
 * 撮合管理：全流程状态跟踪（推荐-沟通-合作-效果）
 * 支持：看板视图 + 列表视图、新建撮合、状态变更、状态字段录入（合作模式/样品寄送/GMV）
 */
import {
  getProducts, getTalents, getMatches, getMatch, getProduct, getTalent,
  upsertMatch, upsertProduct, deleteMatches, nextId,
  sortBySortWeight, updateSortWeight,
  batchUpsertMatches,
  STATUS_FLOW, getStatusMeta,
  COOP_PARENT, COOP_CHILD, COOP_MODES,
  TALENT_LEVEL_META
} from './data.js';
import {
  toast, openModal, confirmDialog,
  formatMoney, formatNumber, escapeHtml, exportExcel,
  paginate, renderPagination, bindPagination,
  bindSuggestPicker,
  parseExcel, downloadTemplate
} from './utils.js';

const state = {
  view: 'kanban',   // kanban | list
  keyword: '',
  status: '',
  owner: '',
  page: 1,
  pageSize: 20,
  selected: new Set(),
};

/**
 * 判断一条撮合是否应当显示"红色五角星"徽标。
 * 规则：status === 'selling'（开始带货）且 变化佣金率 > 商品佣金率，且两者均为有效数字。
 */
function shouldShowCommissionStar(m) {
  if (!m || m.status !== 'selling') return false;
  const base = Number(m.commissionRate);
  const curr = Number(m.commissionRateNew);
  if (!isFinite(base) || !isFinite(curr)) return false;
  if (base <= 0 || curr <= 0) return false;
  return curr > base;
}

/**
 * 红色五角星徽标 HTML（可附带 title 说明）
 */
function commissionStarHtml(m, opts = {}) {
  if (!shouldShowCommissionStar(m)) return '';
  const size = opts.size || 14;
  const title = `佣金率变高：${m.commissionRate}% → ${m.commissionRateNew}%`;
  return `<span class="commission-star inline-flex items-center" title="${title}" style="color:#ef4444;line-height:1;">
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.95 6.56L22 9.6l-5.24 4.86L18.18 22 12 18.27 5.82 22l1.42-7.54L2 9.6l7.05-1.04L12 2z"/>
    </svg>
  </span>`;
}

export function renderMatching(main) { draw(main); }

function draw(main) {
  const matches = getMatches();
  const products = getProducts();
  const talents = getTalents();

  // 按状态分组
  const grouped = {};
  STATUS_FLOW.forEach(s => grouped[s.key] = []);
  const filtered = filter(matches);
  filtered.forEach(m => { if (grouped[m.status]) grouped[m.status].push(m); });

  const owners = [...new Set(matches.map(m=>m.owner).filter(Boolean))];

  main.innerHTML = `
    <div class="fade-in">
      <div class="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <a href="#/dashboard" class="hover:text-brand-700">首页</a>
            <span>›</span>
            <span class="text-slate-600">撮合管理</span>
          </div>
          <h1 class="text-2xl font-bold text-slate-900">撮合管理</h1>
          <p class="text-sm text-slate-500 mt-1">商达撮合全流程跟踪 · 推荐 → 沟通 → 合作 → 效果</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="inline-flex rounded-lg bg-slate-100 p-1">
            <button data-view="kanban" class="view-btn ${state.view==='kanban'?'bg-white shadow-sm':''} px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18"/><rect x="14" y="3" width="7" height="10"/></svg>
              看板
            </button>
            <button data-view="list" class="view-btn ${state.view==='list'?'bg-white shadow-sm':''} px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
              列表
            </button>
          </div>
          <button class="btn btn-ghost" id="exportBtn">导出</button>
        </div>
      </div>

      <!-- 筛选区 -->
      <div class="card p-4 mb-4">
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative" id="kwWrap" style="width:240px;flex:0 0 auto">
            <input id="kwInp" class="inp" placeholder="🔍 搜索商品/达人/单号/负责人" value="${escapeHtml(state.keyword)}" autocomplete="off"/>
            <div class="search-suggest hidden" id="kwSuggest"></div>
          </div>
          <select id="statusSel" class="inp" style="width:140px;flex:0 0 auto">
            <option value="">全部状态</option>
            ${STATUS_FLOW.map(s => `<option value="${s.key}" ${state.status===s.key?'selected':''}>${s.name}</option>`).join('')}
          </select>
          <select id="ownerSel" class="inp" style="width:130px;flex:0 0 auto">
            <option value="">全部负责人</option>
            ${owners.map(o => `<option ${state.owner===o?'selected':''}>${o}</option>`).join('')}
          </select>
          <button class="btn btn-ghost btn-sm" id="resetBtn">重置</button>
          ${state.selected.size > 0 ? `
            <button class="btn btn-danger btn-sm" id="batchDelBtn">
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              删除选中 (${state.selected.size})
            </button>` : ''}
          ${filtered.length > 0 ? `
            <button class="btn btn-danger btn-sm" id="delFilterBtn" title="删除当前筛选/搜索匹配的全部撮合">
              <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 11v6M14 11v6M4 7h16M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13M9 7V4h6v3"/></svg>
              删除筛选结果 (${filtered.length})
            </button>` : ''}
          <div class="ml-auto text-sm text-slate-500">共 <b class="text-brand-700">${filtered.length}</b> 单</div>
        </div>
      </div>

      <!-- 视图 -->
      ${state.view === 'kanban' ? renderKanban(grouped, products, talents) : renderListWithPg(filtered, products, talents)}
    </div>
  `;

  // 事件
  main.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; state.page = 1; draw(main); }));

  // 统一交互的搜索框：下拉联想（商品 / 达人 / 撮合单号），与"新建撮合"中的搜索器一致
  const kwInp     = main.querySelector('#kwInp');
  const kwSuggest = main.querySelector('#kwSuggest');
  if (kwInp && kwSuggest) {
    bindSuggestPicker({
      input: kwInp,
      suggest: kwSuggest,
      max: 20,
      source: () => {
        const allProds   = getProducts();
        const allTalents = getTalents();
        const allMatches = getMatches();
        // 聚合三类数据源，每项带 __kind 标识
        return [
          ...allMatches.map(x => ({ ...x, __kind: 'match' })),
          ...allTalents.map(x => ({ ...x, __kind: 'talent' })),
          ...allProds.map(x   => ({ ...x, __kind: 'product' })),
        ];
      },
      matchFn: (x, kw) => {
        if (x.__kind === 'match') {
          const p = getProduct(x.productId);
          const t = getTalent(x.talentId);
          const str = [x.id, x.owner, p?.name, t?.name, t?.videoAccount, t?.officialAccount].filter(Boolean).join(' ').toLowerCase();
          return str.includes(kw);
        }
        if (x.__kind === 'talent') {
          const str = [x.id, x.name, x.videoAccount, x.officialAccount, x.region, x.salesCategory, x.mcnName].filter(Boolean).join(' ').toLowerCase();
          return str.includes(kw);
        }
        // product
        const str = [x.id, x.name, x.category, x.supplier, x.publisher, x.merchant, x.subject, x.stage].filter(Boolean).join(' ').toLowerCase();
        return str.includes(kw);
      },
      renderItem: (x) => {
        if (x.__kind === 'match') {
          const p = getProduct(x.productId);
          const t = getTalent(x.talentId);
          const meta = getStatusMeta(x.status);
          return `<div class="flex items-center gap-2">
            <span class="badge badge-slate text-[10px]">撮合单</span>
            <span class="text-sm text-slate-800 truncate">${escapeHtml(p?.name || '-')} × ${escapeHtml(t?.name || '-')}</span>
            <span class="text-xs text-slate-400 font-mono ml-auto">${x.id}</span>
            <span class="badge ${meta.color} text-[10px]">${meta.name}</span>
          </div>`;
        }
        if (x.__kind === 'talent') {
          const levelMeta = x.level ? TALENT_LEVEL_META[x.level] : null;
          return `<div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center text-[10px] font-semibold shrink-0">${escapeHtml((x.name||'?').slice(0,1))}</div>
            <span class="text-sm text-slate-800 truncate">${escapeHtml(x.name)}${x.videoAccount?` <span class="text-xs text-slate-400">· ${escapeHtml(x.videoAccount)}</span>`:''}</span>
            ${levelMeta ? `<span class="badge ${levelMeta.badge} text-[10px] ml-auto">${escapeHtml(x.level)}级</span>` : '<span class="ml-auto"></span>'}
            <span class="badge badge-slate text-[10px]">达人</span>
          </div>`;
        }
        // product
        return `<div class="flex items-center gap-2">
          <span class="badge ${(x.type||'book')==='book'?'badge-purple':'badge-cyan'} text-[10px]">${(x.type||'book')==='book'?'图书':'课程'}</span>
          <span class="text-sm text-slate-800 truncate">${escapeHtml(x.name)}</span>
          <span class="text-xs text-slate-400 font-mono ml-auto">${x.id}</span>
          <span class="text-xs text-emerald-600">¥${x.salePrice != null && x.salePrice !== '' ? x.salePrice : (x.price||0)}</span>
        </div>`;
      },
      formatSelected: (x) => {
        if (x.__kind === 'match')   return x.id;
        if (x.__kind === 'talent')  return x.name;
        return x.name;
      },
      onSelect: (x) => {
        if (x.__kind === 'match') {
          // 直接打开撮合详情
          openDetail(x.id, main);
          return;
        }
        // 达人 / 商品：设为关键词后刷新列表
        state.keyword = x.name || '';
        state.page = 1;
        draw(main);
      },
      onInput: (kw) => {
        state.keyword = kw;
        state.page = 1;
        draw(main);
        // draw 会重绘 DOM，重新获取焦点以保持可连续输入
        const newInp = main.querySelector('#kwInp');
        if (newInp && document.activeElement !== newInp) newInp.focus();
      }
    });
  }

  main.querySelector('#statusSel').addEventListener('change', e => { state.status = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#ownerSel').addEventListener('change', e => { state.owner = e.target.value; state.page = 1; draw(main); });
  main.querySelector('#resetBtn').addEventListener('click', () => { state.keyword=''; state.status=''; state.owner=''; state.selected.clear(); state.page = 1; draw(main); });

  // 批量删除选中
  main.querySelector('#batchDelBtn')?.addEventListener('click', () => {
    const ids = [...state.selected];
    if (!ids.length) return;
    confirmDialog({
      title: '批量删除撮合',
      danger: true,
      okText: `删除 ${ids.length} 条`,
      content: `确定要删除已选中的 <b>${ids.length}</b> 条撮合单吗？此操作不可恢复。`
    }).then(async ok => {
      if (!ok) return;
      await deleteMatches(ids);
      state.selected.clear();
      toast(`已删除 ${ids.length} 条`, 'success');
      draw(main);
    });
  });

  // 自定义删除：删除当前筛选结果
  main.querySelector('#delFilterBtn')?.addEventListener('click', () => {
    const curFiltered = filter(getMatches());
    const ids = curFiltered.map(m => m.id);
    if (!ids.length) return;
    const desc = [
      state.keyword ? `关键词"${escapeHtml(state.keyword)}"` : '',
      state.status ? `状态"${escapeHtml(getStatusMeta(state.status).name)}"` : '',
      state.owner ? `负责人"${escapeHtml(state.owner)}"` : ''
    ].filter(Boolean).join(' + ') || '全部撮合';
    confirmDialog({
      title: '删除筛选结果',
      danger: true,
      okText: `删除 ${ids.length} 条`,
      content: `将删除与当前筛选条件（${desc}）匹配的 <b>${ids.length}</b> 条撮合单，此操作不可恢复。`
    }).then(async ok => {
      if (!ok) return;
      await deleteMatches(ids);
      state.selected.clear();
      toast(`已删除 ${ids.length} 条`, 'success');
      draw(main);
    });
  });

  main.querySelector('#exportBtn').addEventListener('click', () => {
    const rows = filtered.map(m => {
      const p = products.find(x=>x.id===m.productId);
      const t = talents.find(x=>x.id===m.talentId);
      const st = m.stageTimes || {};
      return {
        '撮合单号': m.id,
        '达人等级': t?.level || '',
        '达人视频号账号': t?.videoAccount || '',
        '达人公众号账号': t?.officialAccount || '',
        '货盘商品名称': p?.name || '',
        '负责人': m.owner || '',
        '当前状态': getStatusMeta(m.status).name,
        '合作模式': m.coopMode||'',
        '样品已寄送': m.sampleSent?'是':'否',
        '样品寄送日': m.sampleDate||'',
        'GMV': m.gmv||0,
        '订单数': m.orderCount||0,
        '货盘推荐时间': st.recommend || '',
        '确认合作时间': st.confirmed || '',
        '样品寄送时间': st.sampling || '',
        '开始带货时间': st.selling || '',
        '最近更新': m.lastUpdate,
        '备注': m.note||''
      };
    });
    exportExcel(rows, `撮合数据_${new Date().toISOString().slice(0,10)}.xlsx`);
    toast('已导出 '+rows.length+' 条','success');
  });

  bindCardEvents(main);

  // 看板列头：清空某状态
  main.querySelectorAll('[data-clear-status]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.clearStatus;
      const meta = getStatusMeta(key);
      const toDel = filter(getMatches()).filter(m => m.status === key);
      if (!toDel.length) return;
      confirmDialog({
        title: `清空「${meta.name}」`,
        danger: true,
        okText: `删除 ${toDel.length} 条`,
        content: `确定要删除当前筛选下「<b>${meta.name}</b>」阶段的全部 <b>${toDel.length}</b> 条撮合吗？此操作不可恢复。`
      }).then(async ok => {
        if (!ok) return;
        await deleteMatches(toDel.map(m => m.id));
        toDel.forEach(m => state.selected.delete(m.id));
        toast(`已删除 ${toDel.length} 条`, 'success');
        draw(main);
      });
    });
  });

  // 列表视图：全选 / 单选 checkbox
  const selAll = main.querySelector('#selAllChk');
  if (selAll) {
    selAll.addEventListener('change', e => {
      const checked = e.target.checked;
      const pgList = paginate(filter(getMatches()), state.page, state.pageSize).pageList;
      if (checked) pgList.forEach(m => state.selected.add(m.id));
      else pgList.forEach(m => state.selected.delete(m.id));
      draw(main);
    });
  }
  main.querySelectorAll('.row-chk').forEach(chk => {
    chk.addEventListener('change', e => {
      e.stopPropagation();
      const id = chk.dataset.id;
      if (chk.checked) state.selected.add(id);
      else state.selected.delete(id);
      draw(main);
    });
    chk.addEventListener('click', e => e.stopPropagation());
  });

  // 列表视图下绑定分页事件
  if (state.view === 'list') {
    const filteredForPg = filter(getMatches());
    const pgInfo = paginate(filteredForPg, state.page, state.pageSize);
    bindPagination(main, pgInfo, ({ page, pageSize }) => {
      state.page = page;
      state.pageSize = pageSize;
      draw(main);
    });

    // 序号徽章点击 → 切换为输入框（与商品货盘 / 达人管理一致）
    // 失焦 / 回车保存（下限 1，数字越大越靠前）
    main.querySelectorAll('.seq-badge[data-seq-kind="match"]').forEach(badge => {
      badge.addEventListener('click', e => {
        e.stopPropagation();
        const cur = Number(badge.dataset.seqCurrent) || 1;
        const id = badge.dataset.seqId;
        const cell = badge.parentElement;
        cell.innerHTML = `<input type="number" min="1" step="1" class="seq-weight-inp" value="${cur}" style="width:60px"/>`;
        const inp = cell.querySelector('input');
        inp.focus();
        inp.select();
        let committed = false;
        const commit = async () => {
          if (committed) return;
          committed = true;
          let v = Math.floor(Number(inp.value));
          if (!Number.isFinite(v) || v < 1) v = 1;
          await updateSortWeight('match', id, v);
          toast('已更新序号', 'success', 1000);
          draw(main);
        };
        const cancel = () => {
          if (committed) return;
          committed = true;
          draw(main);
        };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
        });
      });
    });

    // 商品价格 inline 编辑
    main.querySelectorAll('.prod-price-edit').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const pid = el.dataset.prodId;
        const p = getProduct(pid); if (!p) return;
        const curPrice = (p.salePrice != null && p.salePrice !== '' ? p.salePrice : p.price) || 0;
        const parent = el.parentElement;
        parent.innerHTML = `<input type="number" class="inp" style="height:30px;width:100px;text-align:right" value="${curPrice}"/>`;
        const ipt = parent.querySelector('input');
        ipt.focus(); ipt.select();
        const commit = async () => {
          const v = Number(ipt.value);
          if (!isNaN(v) && v !== curPrice) {
            await upsertProduct({ ...p, price: v, salePrice: v });
            toast(`已更新 ${p.name} 价格：¥${v}`, 'success');
            draw(main);
          } else {
            draw(main);
          }
        };
        ipt.addEventListener('blur', commit);
        ipt.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); ipt.blur(); }
          else if (ev.key === 'Escape') { ev.preventDefault(); draw(main); }
        });
      });
    });
  }
}

// 全局只绑定一次的标志
let _cardEventsBound = false;
function bindCardEventsOnce(main) {
  if (_cardEventsBound) return;
  _cardEventsBound = true;
  main.addEventListener('click', e => {
    const card = e.target.closest('[data-match-id]');
    if (!card) return;
    if (e.target.closest('[data-act="advance"]')) {
      e.stopPropagation();
      advance(card.dataset.matchId, main);
      return;
    }
    if (e.target.closest('[data-act="edit"]')) {
      e.stopPropagation();
      openMatchForm(main, card.dataset.matchId);
      return;
    }
    if (e.target.closest('[data-act="del"]')) {
      e.stopPropagation();
      const id = card.dataset.matchId;
      confirmDialog({ title:'删除撮合', danger:true, okText:'删除', content:`确认删除撮合单 <b>${id}</b> ？` }).then(async ok=>{
        if (ok) { await deleteMatches([id]); toast('已删除','success'); draw(main); }
      });
      return;
    }
    openDetail(card.dataset.matchId, main);
  });
}

function filter(list) {
  const kw = state.keyword.trim().toLowerCase();
  const products = getProducts();
  const talents = getTalents();
  const filtered = list.filter(m => {
    if (state.status && m.status !== state.status) return false;
    if (state.owner && m.owner !== state.owner) return false;
    if (kw) {
      const p = products.find(x=>x.id===m.productId);
      const t = talents.find(x=>x.id===m.talentId);
      const text = [m.id, p?.name, t?.name].filter(Boolean).join(' ').toLowerCase();
      if (!text.includes(kw)) return false;
    }
    return true;
  });
  return sortBySortWeight(filtered);
}

function bindCardEvents(main) { bindCardEventsOnce(main); }

/* ========== 看板视图 ========== */
function renderKanban(grouped, products, talents) {
  const colors = ['#64748b','#06b6d4','#3b82f6','#8b5cf6','#f59e0b','#10b981'];
  return `
    <div class="grid gap-3 overflow-x-auto pb-2" style="grid-template-columns: repeat(${STATUS_FLOW.length}, minmax(260px, 1fr));">
      ${STATUS_FLOW.map((s, i) => `
        <div class="kanban-col rounded-xl bg-slate-100/60 border border-slate-200 flex flex-col min-h-[500px]">
          <div class="p-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-2 h-2 rounded-full shrink-0" style="background:${colors[i]}"></span>
              <span class="font-semibold text-slate-800 text-sm truncate">${s.name}</span>
              <span class="text-xs text-slate-400 shrink-0">${grouped[s.key].length}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <span class="text-[10px] uppercase tracking-wider text-slate-400 font-medium">${s.stage}</span>
              ${grouped[s.key].length > 0 ? `
                <button data-clear-status="${s.key}" class="w-6 h-6 grid place-items-center rounded hover:bg-rose-50 text-slate-400 hover:text-rose-500" title="清空「${s.name}」下全部撮合">
                  <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                </button>` : ''}
            </div>
          </div>
          <div class="p-2 flex-1 space-y-2 overflow-y-auto">
            ${grouped[s.key].length ? grouped[s.key].map(m => renderKanbanCard(m, products, talents)).join('')
              : `<div class="text-xs text-slate-400 text-center py-8">暂无数据</div>`}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderKanbanCard(m, products, talents) {
  const p = products.find(x=>x.id===m.productId);
  const t = talents.find(x=>x.id===m.talentId);
  const meta = getStatusMeta(m.status);
  const isLast = STATUS_FLOW[STATUS_FLOW.length-1].key === m.status;
  const stageTime = (m.stageTimes || {})[m.status] || '';
  const levelMeta = t?.level ? TALENT_LEVEL_META[t.level] : null;
  const prodPrice = (p && (p.salePrice != null && p.salePrice !== '' ? p.salePrice : p.price)) || 0;
  const trackText = t?.salesCategory || (t?.categories||[]).join('、') || '';
  return `
    <div data-match-id="${m.id}" class="bg-white rounded-lg border border-slate-200 p-3 cursor-pointer hover:border-brand-400 hover:shadow-sm transition">
      <div class="flex items-start justify-between gap-2 mb-2">
        <div class="font-medium text-sm text-slate-800 leading-snug line-clamp-2 flex items-center gap-1">
          ${commissionStarHtml(m, { size: 14 })}
          <span>${escapeHtml(p?.name || '未知商品')}</span>
        </div>
        <span class="text-[10px] text-slate-400 font-mono shrink-0">${m.id}</span>
      </div>
      ${p ? `<div class="text-xs text-emerald-600 mb-1.5 font-medium">¥${prodPrice}</div>` : ''}
      <div class="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <div class="w-6 h-6 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center text-[10px] font-semibold shrink-0">${escapeHtml(t?.name?.[0]||'?')}</div>
        <div class="text-xs text-slate-700 font-medium">${escapeHtml(t?.name||'未知达人')}</div>
        ${levelMeta ? `<span class="badge ${levelMeta.badge} text-[10px] px-1.5 py-0">${escapeHtml(t.level)}级</span>` : ''}
      </div>
      <div class="text-[11px] text-slate-500 space-y-0.5 mb-2">
        ${t?.videoAccount ? `<div class="truncate">🎬 视频号：${escapeHtml(t.videoAccount)}</div>` : ''}
        ${t?.officialAccount ? `<div class="truncate">📢 公众号：${escapeHtml(t.officialAccount)}</div>` : ''}
        ${trackText ? `<div class="truncate">🏷️ 赛道：${escapeHtml(trackText)}</div>` : ''}
      </div>
      ${m.coopMode ? `<div class="text-[11px] text-slate-500 mb-2"><span class="badge badge-purple">${escapeHtml(m.coopMode)}</span></div>` : ''}
      ${m.gmv ? `<div class="text-xs mb-2"><span class="text-slate-400">GMV:</span> <b class="text-emerald-600">${formatMoney(m.gmv)}</b></div>` : ''}
      <div class="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-400">
        <div class="flex items-center gap-1">
          <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a7 7 0 0113 0"/></svg>
          ${escapeHtml(m.owner||'-')}
        </div>
        <div>${stageTime ? `进入于 ${stageTime}` : m.lastUpdate}</div>
      </div>
      <div class="mt-2 flex gap-1">
        ${!isLast ? `<button data-act="advance" class="flex-1 text-xs py-1 rounded bg-brand-50 text-brand-700 hover:bg-brand-100 font-medium">推进 →</button>`:''}
        <button data-act="edit" class="px-2 text-xs py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">编辑</button>
        <button data-act="del" class="px-2 text-xs py-1 rounded bg-rose-50 text-rose-600 hover:bg-rose-100" title="删除">
          <svg viewBox="0 0 24 24" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    </div>
  `;
}

/* ========== 列表视图 ========== */
function renderListWithPg(matches, products, talents) {
  if (!matches.length) return `<div class="card"><div class="empty">暂无数据</div></div>`;
  const pgInfo = paginate(matches, state.page, state.pageSize);
  state.page = pgInfo.page;
  return `
    <div class="card overflow-hidden">
      ${renderListInner(pgInfo.pageList, products, talents)}
      ${renderPagination(pgInfo)}
    </div>
  `;
}

function renderListInner(matches, products, talents) {
  const pageIds = matches.map(m => m.id);
  const allSelected = pageIds.length > 0 && pageIds.every(id => state.selected.has(id));
  const someSelected = pageIds.some(id => state.selected.has(id));
  return `
      <div class="overflow-x-auto">
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:40px">
                <input type="checkbox" class="chk" id="selAllChk" ${allSelected?'checked':''} ${!allSelected&&someSelected?'data-indeterminate="1"':''}/>
              </th>
              <th style="width:70px" title="序号越大越靠前">序号</th>
              <th style="width:110px">撮合单号</th>
              <th>达人等级</th>
              <th>达人</th>
              <th>视频号账号</th>
              <th>公众号账号</th>
              <th>货盘商品名称</th>
              <th class="text-right">商品价格</th>
              <th>负责人</th>
              <th>当前状态</th>
              <th>阶段时间</th>
              <th>合作模式</th>
              <th class="text-right">GMV</th>
              <th style="width:160px">操作</th>
            </tr>
          </thead>
          <tbody>
            ${matches.map((m, idx) => {
              const p = products.find(x=>x.id===m.productId);
              const t = talents.find(x=>x.id===m.talentId);
              const meta = getStatusMeta(m.status);
              const isLast = STATUS_FLOW[STATUS_FLOW.length-1].key === m.status;
              const levelMeta = t?.level ? TALENT_LEVEL_META[t.level] : null;
              const stageTime = (m.stageTimes || {})[m.status] || '';
              const checked = state.selected.has(m.id);
              const seq = idx + 1 + (state.page - 1) * state.pageSize;
              const sortWeight = Number(m.sortWeight) || 0;
              // 统一与商品货盘/达人管理的序号列：仅显示一列
              // 若已设置 sortWeight（>=1）则显示该值，否则用自然序号占位
              const displaySeq = sortWeight >= 1 ? sortWeight : seq;
              const prodPrice = (p && (p.salePrice != null && p.salePrice !== '' ? p.salePrice : p.price)) || 0;
              return `
                <tr data-match-id="${m.id}" class="${checked?'selected':''}">
                  <td><input type="checkbox" class="chk row-chk" data-id="${m.id}" ${checked?'checked':''}/></td>
                  <td class="seq-cell">
                    <span class="seq-badge" data-seq-id="${m.id}" data-seq-kind="match" data-seq-current="${displaySeq}" title="点击修改序号：数字越大越靠前（最小值 1）">${displaySeq}</span>
                  </td>
                  <td class="font-mono text-xs text-slate-500">${m.id}</td>
                  <td>${levelMeta ? `<span class="badge ${levelMeta.badge}">${escapeHtml(t.level)}级</span>` : '<span class="text-slate-300">-</span>'}</td>
                  <td>
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center text-xs font-semibold">${escapeHtml(t?.name?.[0]||'?')}</div>
                      <div>
                        <div class="text-sm text-slate-800">${escapeHtml(t?.name||'-')}</div>
                        <div class="text-xs text-slate-400">${escapeHtml(t?.region||'')}</div>
                      </div>
                    </div>
                  </td>
                  <td class="text-sm text-slate-700">${escapeHtml(t?.videoAccount||'-')}</td>
                  <td class="text-sm text-slate-700">${escapeHtml(t?.officialAccount||'-')}</td>
                  <td>
                    <div class="font-medium text-slate-800 line-clamp-1 flex items-center gap-1">
                      ${commissionStarHtml(m, { size: 14 })}
                      <span>${escapeHtml(p?.name||'-')}</span>
                    </div>
                    <div class="text-xs text-slate-400">${escapeHtml(p?.category||(p?.type==='course'?'课程':''))}</div>
                  </td>
                  <td class="text-right">
                    ${p ? `<span class="prod-price-edit text-emerald-700 font-semibold cursor-pointer hover:underline" data-prod-id="${p.id}" title="点击修改商品价格">¥${prodPrice}</span>` : '<span class="text-slate-300">-</span>'}
                  </td>
                  <td class="text-slate-600">${escapeHtml(m.owner||'-')}</td>
                  <td><span class="badge ${meta.color} badge-dot">${meta.name}</span></td>
                  <td class="text-xs text-slate-500">${stageTime || '<span class="text-slate-300">-</span>'}</td>
                  <td>${m.coopMode ? `<span class="badge badge-purple">${escapeHtml(m.coopMode)}</span>` : '<span class="text-slate-300">-</span>'}</td>
                  <td class="text-right font-semibold ${m.gmv?'text-emerald-600':'text-slate-300'}">${m.gmv?formatMoney(m.gmv):'-'}</td>
                  <td>
                    ${!isLast?`<button class="text-brand-600 hover:underline text-sm mr-2" data-act="advance">推进</button>`:''}
                    <button class="text-slate-600 hover:underline text-sm mr-2" data-act="edit">编辑</button>
                    <button class="text-rose-500 hover:underline text-sm" data-act="del">删除</button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
  `;
}

function renderList(matches, products, talents) {
  if (!matches.length) return `<div class="card"><div class="empty">暂无数据</div></div>`;
  return `
    <div class="card overflow-hidden">
      ${renderListInner(matches, products, talents)}
    </div>
  `;
}

/* ========== 推进状态 ========== */
function advance(id, main) {
  const m = getMatch(id); if (!m) return;
  const idx = STATUS_FLOW.findIndex(s => s.key === m.status);
  if (idx >= STATUS_FLOW.length - 1) return toast('已是最终状态', 'info');
  const next = STATUS_FLOW[idx + 1];

  // 某些状态切换时弹窗补充必要字段
  if (next.key === 'confirmed') {
    openCoopModeDialog(m, main, next);
    return;
  }
  if (next.key === 'sampling') {
    openSampleDialog(m, main, next);
    return;
  }
  if (next.key === 'selling') {
    openGmvDialog(m, main, next);
    return;
  }

  // 其他阶段弹窗选择进入时间
  openStageTimeDialog(m, main, next);
}

function openStageTimeDialog(m, main, next) {
  const today = new Date().toISOString().slice(0,10);
  const body = `
    <div class="text-sm text-slate-600 mb-4">推进到 <b>${escapeHtml(next.name)}</b> 阶段，请确认进入时间：</div>
    <div>
      <label class="form-label">进入时间 <span class="req">*</span></label>
      <input name="stageTime" type="date" class="inp" value="${today}" style="max-width:260px"/>
    </div>
  `;
  const footer = `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认推进</button>`;
  openModal({
    title:`推进 · ${next.name}`, bodyHtml: body, footerHtml: footer, width:'480px',
    onBack: () => openDetail(m.id, main),
    onMount(root, close) {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        const dt = root.querySelector('[name="stageTime"]').value || today;
        const stageTimes = { ...(m.stageTimes || {}), [next.key]: dt };
        await upsertMatch({ ...m, status: next.key, stageTimes });
        toast(`已推进至：${next.name}`,'success');
        close(); draw(main);
      });
    }
  });
}

function openCoopModeDialog(m, main, next) {
  const today = new Date().toISOString().slice(0,10);
  const body = `
    <div class="text-sm text-slate-600 mb-4">推进到 <b>确认合作</b> 阶段，请选择合作模式：</div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="form-label">合作模式（一级）<span class="req">*</span></label>
        <select name="parent" class="inp">${COOP_PARENT.map(p=>`<option>${p}</option>`).join('')}</select>
      </div>
      <div>
        <label class="form-label">链接类型（二级）</label>
        <select name="child" class="inp"></select>
      </div>
      <div>
        <label class="form-label">确认合作时间 <span class="req">*</span></label>
        <input name="stageTime" type="date" class="inp" value="${today}"/>
      </div>
      <div>
        <label class="form-label">广告账户 ID <span class="text-xs text-slate-400 font-normal">（投流需填）</span></label>
        <input name="adAccountId" class="inp" value="${escapeHtml(m.adAccountId||'')}"/>
      </div>
    </div>
    <div class="mt-4">
      <label class="form-label">备注</label>
      <textarea name="note" class="inp" placeholder="可选，记录合作细节">${escapeHtml(m.note||'')}</textarea>
    </div>
  `;
  const footer = `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认</button>`;
  openModal({
    title:'确认合作模式', bodyHtml: body, footerHtml: footer,
    onBack: () => openDetail(m.id, main),
    onMount(root, close) {
      const pSel = root.querySelector('[name="parent"]');
      const cSel = root.querySelector('[name="child"]');
      const fill = () => {
        const children = COOP_CHILD[pSel.value] || [];
        if (!children.length) {
          cSel.innerHTML = `<option value="">（无二级）</option>`;
          cSel.disabled = true;
        } else {
          cSel.innerHTML = children.map(c=>`<option>${c}</option>`).join('');
          cSel.disabled = false;
        }
      };
      pSel.addEventListener('change', fill); fill();
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        const mode = cSel.disabled || !cSel.value ? pSel.value : `${pSel.value}-${cSel.value}`;
        const dt = root.querySelector('[name="stageTime"]').value || today;
        const stageTimes = { ...(m.stageTimes || {}), confirmed: dt };
        const adAccountId = root.querySelector('[name="adAccountId"]').value.trim();
        await upsertMatch({ ...m, status:'confirmed', coopMode: mode, stageTimes, adAccountId, note: root.querySelector('[name="note"]').value });
        toast(`已确认合作：${mode}`,'success');
        close(); draw(main);
      });
    }
  });
}

function openSampleDialog(m, main, next) {
  const today = new Date().toISOString().slice(0,10);
  const body = `
    <div class="text-sm text-slate-600 mb-4">推进到 <b>样品寄送</b> 阶段，请填写寄送信息：</div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="form-label">寄送日期 <span class="req">*</span></label>
        <input name="sampleDate" type="date" class="inp" value="${today}"/>
      </div>
      <div>
        <label class="form-label">快递单号</label>
        <input name="trackingNo" class="inp" placeholder="可选"/>
      </div>
    </div>
  `;
  const footer = `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认寄送</button>`;
  openModal({
    title:'样品寄送', bodyHtml: body, footerHtml: footer,
    onBack: () => openDetail(m.id, main),
    onMount(root, close) {
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        const d = root.querySelector('[name="sampleDate"]').value || today;
        const stageTimes = { ...(m.stageTimes || {}), sampling: d };
        await upsertMatch({ ...m, status:'sampling', sampleSent:true, sampleDate: d, stageTimes });
        toast('样品寄送信息已登记','success');
        close(); draw(main);
      });
    }
  });
}

function openGmvDialog(m, main, next) {
  const today = new Date().toISOString().slice(0,10);
  const p = getProduct(m.productId);
  const defaultUnit = m.unitPrice != null && m.unitPrice !== '' && Number(m.unitPrice) > 0
    ? Number(m.unitPrice)
    : (p ? Number(p.salePrice != null && p.salePrice !== '' ? p.salePrice : p.price) || 0 : 0);
  const body = `
    <div class="text-sm text-slate-600 mb-4">推进到 <b>开始带货</b> 阶段，填写客单价与订单数，<b class="text-emerald-600">GMV 将自动计算</b>（GMV = 客单价 × 订单数）：</div>
    <div class="grid grid-cols-3 gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 mb-4">
      <div>
        <label class="text-xs text-slate-500 block mb-1">客单价 (元) <span class="req">*</span></label>
        <input name="unitPrice" type="number" step="0.01" class="inp" value="${defaultUnit}"/>
      </div>
      <div>
        <label class="text-xs text-slate-500 block mb-1">订单数 <span class="req">*</span></label>
        <input name="orderCount" type="number" class="inp" value="${m.orderCount||0}"/>
      </div>
      <div>
        <label class="text-xs text-slate-500 block mb-1">GMV (元) <span class="text-emerald-600 text-[10px]">自动</span></label>
        <input name="gmv" type="number" class="inp" value="${m.gmv||0}" style="font-weight:600;color:#047857;background:#f0fdf4" readonly/>
      </div>
    </div>
    <div>
      <label class="form-label">开始带货时间 <span class="req">*</span></label>
      <input name="stageTime" type="date" class="inp" value="${today}" style="max-width:260px"/>
    </div>
  `;
  const footer = `<button class="btn btn-ghost" data-act="cancel">取消</button><button class="btn btn-primary" data-act="ok">确认开始带货</button>`;
  openModal({
    title:'开始带货 · 数据录入', bodyHtml: body, footerHtml: footer,
    onBack: () => openDetail(m.id, main),
    onMount(root, close) {
      const upInp = root.querySelector('[name="unitPrice"]');
      const ocInp = root.querySelector('[name="orderCount"]');
      const gmvInp = root.querySelector('[name="gmv"]');
      const recalc = () => {
        const up = Number(upInp.value) || 0;
        const oc = Number(ocInp.value) || 0;
        gmvInp.value = Math.round(up * oc * 100) / 100;
      };
      upInp.addEventListener('input', recalc);
      ocInp.addEventListener('input', recalc);
      recalc();
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="ok"]').addEventListener('click', async () => {
        const up = Number(upInp.value) || 0;
        const oc = Number(ocInp.value) || 0;
        const gmv = Math.round(up * oc * 100) / 100;
        const dt = root.querySelector('[name="stageTime"]').value || today;
        const stageTimes = { ...(m.stageTimes || {}), selling: dt };
        await upsertMatch({ ...m, status:'selling', unitPrice: up, orderCount: oc, gmv, stageTimes });
        toast('已开始带货 · 数据录入成功','success');
        close(); draw(main);
      });
    }
  });
}

/* ========== 新增/编辑撮合 ========== */
function openMatchForm(main, id) {
  const editing = id ? getMatch(id) : null;
  const m = editing || {
    id: nextId('M'), productId: '', talentId: '', status: 'recommend',
    coopMode: '', sampleSent: false, sampleDate: '', gmv: 0, orderCount: 0,
    unitPrice: 0,
    commissionRate: '', commissionRateNew: '',
    supplierName: '', customerName: '', adAccountId: '',
    recommendDate: new Date().toISOString().slice(0,10),
    lastUpdate: new Date().toISOString().slice(0,10), owner: '', note: '',
    stageTimes: {}
  };
  const stageTimes = m.stageTimes || {};
  const products = getProducts();
  const talents = getTalents();
  const initProduct = products.find(p => p.id === m.productId);
  const initTalent  = talents.find(t => t.id === m.talentId);
  const initProductText = initProduct ? `${initProduct.name} (${initProduct.id})` : '';
  const initTalentText  = initTalent  ? `${initTalent.name} · ${initTalent.level || ''}级 · ${initTalent.videoAccount || ''} (${initTalent.id})` : '';
  // 若编辑时带有初始商品，默认客单价=商品价格
  const initUnitPrice = m.unitPrice != null && m.unitPrice !== '' && Number(m.unitPrice) > 0
    ? Number(m.unitPrice)
    : (initProduct ? Number(initProduct.salePrice != null && initProduct.salePrice !== '' ? initProduct.salePrice : initProduct.price) || 0 : 0);

  const body = `
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="form-label">撮合单号</label>
        <input class="inp" value="${m.id}" readonly/>
      </div>
      <div>
        <label class="form-label">状态 <span class="req">*</span></label>
        <select name="status" class="inp">
          ${STATUS_FLOW.map(s=>`<option value="${s.key}" ${m.status===s.key?'selected':''}>${s.name}</option>`).join('')}
        </select>
      </div>

      <!-- 商品选择：支持手动输入关键词模糊搜索 -->
      <div class="col-span-2 relative" id="prodPickerWrap">
        <label class="form-label">货盘商品 <span class="req">*</span> <span class="text-xs text-slate-400 font-normal">（可输入关键词模糊查找）</span></label>
        <input type="text" name="productSearch" class="inp" autocomplete="off" placeholder="输入书名/课程名/编号，从下拉列表中选择" value="${escapeHtml(initProductText)}"/>
        <input type="hidden" name="productId" value="${m.productId||''}"/>
        <div class="search-suggest hidden" id="prodSuggest"></div>
      </div>

      <!-- 达人选择：支持手动输入关键词模糊搜索 -->
      <div class="col-span-2 relative" id="talentPickerWrap">
        <label class="form-label">达人 <span class="req">*</span> <span class="text-xs text-slate-400 font-normal">（可输入姓名/视频号/地区模糊查找）</span></label>
        <input type="text" name="talentSearch" class="inp" autocomplete="off" placeholder="输入达人姓名/视频号/公众号/编号" value="${escapeHtml(initTalentText)}"/>
        <input type="hidden" name="talentId" value="${m.talentId||''}"/>
        <div class="search-suggest hidden" id="talentSuggest"></div>
      </div>

      <!-- 合作模式：一级（纯佣/投流+佣金/互选/原生二次推广/素材合作）+ 二级（仅前两者有） -->
      <div>
        <label class="form-label">合作模式（一级）</label>
        <select name="coopParent" class="inp">
          <option value="">未确认</option>
          ${COOP_PARENT.map(p=>`<option ${m.coopMode?.startsWith(p)?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">链接类型（二级）</label>
        <select name="coopChild" class="inp"></select>
      </div>

      <!-- 新增业务字段：货盘供应链名称、客户名称、广告账户ID -->
      <div>
        <label class="form-label">货盘供应链名称</label>
        <input name="supplierName" class="inp" value="${escapeHtml(m.supplierName||'')}" placeholder="如：中信出版社 · 中信书旗旗舰店"/>
      </div>
      <div>
        <label class="form-label">客户名称</label>
        <input name="customerName" class="inp" value="${escapeHtml(m.customerName||'')}" placeholder="下单客户/商家的名称"/>
      </div>
      <div class="col-span-2">
        <label class="form-label">广告账户 ID <span class="text-xs text-slate-400 font-normal">（投流时填写）</span></label>
        <input name="adAccountId" class="inp" value="${escapeHtml(m.adAccountId||'')}" placeholder="投流广告账户 ID"/>
      </div>

      <div class="col-span-2 grid grid-cols-3 gap-4">
        <label class="flex items-center gap-2 pt-7">
          <input type="checkbox" class="chk" name="sampleSent" ${m.sampleSent?'checked':''}/>
          <span class="text-sm text-slate-700">样品已寄送</span>
        </label>
        <div>
          <label class="form-label">样品寄送日</label>
          <input name="sampleDate" type="date" class="inp" value="${m.sampleDate||''}"/>
        </div>
        <div>
          <label class="form-label">负责人</label>
          <input name="owner" class="inp" value="${escapeHtml(m.owner||'')}"/>
        </div>
      </div>

      <!-- 开始带货模块：客单价 × 订单数 = GMV（自动计算）+ 佣金率 / 变化佣金率 -->
      <div class="col-span-2">
        <label class="form-label mb-2">开始带货数据 <span class="text-xs text-slate-400 font-normal">（GMV = 客单价 × 订单数，自动计算；变化佣金率 &gt; 商品佣金率时将在撮合列表显示 <span style="color:#ef4444;">★</span> 标记）</span></label>
        <div class="grid grid-cols-3 gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <div>
            <label class="text-xs text-slate-500 block mb-1">客单价 (元)</label>
            <input name="unitPrice" type="number" step="0.01" class="inp" value="${initUnitPrice}" style="height:34px"/>
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">订单数</label>
            <input name="orderCount" type="number" class="inp" value="${m.orderCount||0}" style="height:34px"/>
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">GMV (元) <span class="text-[10px] text-emerald-600">自动</span></label>
            <input name="gmv" type="number" class="inp" value="${m.gmv||0}" style="height:34px;background:#f0fdf4;font-weight:600;color:#047857" readonly/>
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">商品佣金率 (%)</label>
            <input name="commissionRate" type="number" step="0.01" min="0" class="inp" value="${m.commissionRate!=null&&m.commissionRate!==''?m.commissionRate:''}" placeholder="如 20" style="height:34px"/>
          </div>
          <div>
            <label class="text-xs text-slate-500 block mb-1">变化佣金率 (%)</label>
            <input name="commissionRateNew" type="number" step="0.01" min="0" class="inp" value="${m.commissionRateNew!=null&&m.commissionRateNew!==''?m.commissionRateNew:''}" placeholder="如 25（变高将显示 ★）" style="height:34px"/>
          </div>
          <div class="flex items-end">
            <div id="starPreview" class="text-xs" style="min-height:34px;display:flex;align-items:center;gap:6px;">
              <span class="text-slate-400">红星标记预览：</span>
              <span id="starPreviewDot"></span>
            </div>
          </div>
        </div>
      </div>

      <div class="col-span-2">
        <label class="form-label mb-2" style="margin-bottom:10px">各阶段开始时间（可选填写）</label>
        <div class="grid grid-cols-3 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
          ${STATUS_FLOW.map(s => `
            <div>
              <label class="text-xs text-slate-500 block mb-1">${s.name}</label>
              <input name="stageTime_${s.key}" type="date" class="inp" value="${stageTimes[s.key]||''}" style="height:32px;font-size:13px"/>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="col-span-2">
        <label class="form-label">备注</label>
        <textarea name="note" class="inp" rows="3">${escapeHtml(m.note||'')}</textarea>
      </div>
    </div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="save">${editing?'保存修改':'创建撮合'}</button>
  `;
  openModal({
    title: editing?'编辑撮合单':'新建撮合单', bodyHtml: body, footerHtml: footer, width:'820px',
    onBack: editing ? () => openDetail(id, main) : () => {},
    onMount(root, close) {
      // 联动 coop 二级（支持无子项的合作模式）
      const pSel = root.querySelector('[name="coopParent"]');
      const cSel = root.querySelector('[name="coopChild"]');
      const refillChild = (keepVal) => {
        const list = COOP_CHILD[pSel.value] || [];
        if (!list.length) {
          // 无二级：隐藏或禁用
          cSel.innerHTML = `<option value="">（无二级）</option>`;
          cSel.disabled = true;
        } else {
          cSel.innerHTML = `<option value="">--</option>` + list.map(c=>`<option ${keepVal===c?'selected':''}>${c}</option>`).join('');
          cSel.disabled = false;
        }
      };
      // 解析 coopMode：可能是 "纯佣-商品链接" 或 "互选"（无二级）
      const initParent = COOP_PARENT.find(p => m.coopMode?.startsWith(p)) || '';
      const initChild = initParent && m.coopMode && m.coopMode !== initParent
        ? m.coopMode.replace(initParent + '-', '')
        : '';
      refillChild(initChild);
      pSel.addEventListener('change', () => refillChild(''));

      // 商品模糊搜索
      bindSearchPicker(root, {
        inputName: 'productSearch',
        hiddenName: 'productId',
        suggestId: 'prodSuggest',
        source: () => getProducts(),
        matchFn: (p, kw) => {
          const str = [p.id, p.name, p.category, p.supplier, p.publisher, p.merchant, p.subject, p.stage].filter(Boolean).join(' ').toLowerCase();
          return str.includes(kw);
        },
        renderItem: (p) => `
          <div class="flex items-center gap-2">
            <span class="badge ${(p.type||'book')==='book'?'badge-purple':'badge-cyan'} text-[10px]">${(p.type||'book')==='book'?'图书':'课程'}</span>
            <span class="flex-1 truncate text-sm text-slate-800">${escapeHtml(p.name)}</span>
            <span class="text-xs text-slate-400 font-mono">${p.id}</span>
            <span class="text-xs text-emerald-600">¥${p.salePrice != null && p.salePrice !== '' ? p.salePrice : p.price}</span>
          </div>`,
        formatSelected: (p) => `${p.name} (${p.id})`,
        onSelect: (p) => {
          // 选择商品后自动回填客单价与供应链名称（若还未填）
          const unitPriceInp = root.querySelector('[name="unitPrice"]');
          const supplierInp  = root.querySelector('[name="supplierName"]');
          const crInp        = root.querySelector('[name="commissionRate"]');
          const price = Number(p.salePrice != null && p.salePrice !== '' ? p.salePrice : p.price) || 0;
          if (unitPriceInp && (!unitPriceInp.value || Number(unitPriceInp.value) === 0)) unitPriceInp.value = price;
          if (supplierInp && !supplierInp.value) supplierInp.value = p.supplier || p.publisher || p.merchant || '';
          if (crInp && (!crInp.value || Number(crInp.value) === 0)) {
            const cr = (p.commissionPolicy != null && p.commissionPolicy !== '')
              ? Number(p.commissionPolicy)
              : Number(p.commissionRate);
            if (Number.isFinite(cr) && cr > 0) crInp.value = cr;
          }
          recalcGmv(root);
          refreshStarPreview(root);
        }
      });

      // 达人模糊搜索
      bindSearchPicker(root, {
        inputName: 'talentSearch',
        hiddenName: 'talentId',
        suggestId: 'talentSuggest',
        source: () => getTalents(),
        matchFn: (t, kw) => {
          const str = [t.id, t.name, t.videoAccount, t.officialAccount, t.region, t.salesCategory, t.mcnName].filter(Boolean).join(' ').toLowerCase();
          return str.includes(kw);
        },
        renderItem: (t) => `
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center text-[10px] font-semibold">${escapeHtml((t.name||'?').slice(0,1))}</div>
            <span class="flex-1 text-sm text-slate-800 truncate">${escapeHtml(t.name)} <span class="text-xs text-slate-400">${t.level?`· ${t.level}级`:''} · ${escapeHtml(t.videoAccount||'-')}</span></span>
            <span class="text-xs text-slate-400">${escapeHtml(t.region||'')}</span>
          </div>`,
        formatSelected: (t) => `${t.name} · ${t.level || ''}级 · ${t.videoAccount || ''} (${t.id})`,
        onSelect: (_t) => {}
      });

      // GMV 自动计算：客单价 × 订单数
      const upInp = root.querySelector('[name="unitPrice"]');
      const ocInp = root.querySelector('[name="orderCount"]');
      upInp.addEventListener('input', () => recalcGmv(root));
      ocInp.addEventListener('input', () => recalcGmv(root));

      // 佣金率变化：实时刷新"红星标记预览"
      const crInp  = root.querySelector('[name="commissionRate"]');
      const crnInp = root.querySelector('[name="commissionRateNew"]');
      const stInp  = root.querySelector('[name="status"]');
      if (crInp)  crInp.addEventListener('input',  () => refreshStarPreview(root));
      if (crnInp) crnInp.addEventListener('input', () => refreshStarPreview(root));
      if (stInp)  stInp.addEventListener('change', () => refreshStarPreview(root));
      refreshStarPreview(root);

      root.querySelector('[data-act="cancel"]').addEventListener('click', close);
      root.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const data = { ...m };
        const newStageTimes = { ...(m.stageTimes || {}) };
        root.querySelectorAll('[name]').forEach(el => {
          if (el.name.startsWith('stageTime_')) {
            const key = el.name.replace('stageTime_', '');
            if (el.value) newStageTimes[key] = el.value;
            else delete newStageTimes[key];
            return;
          }
          if (el.type === 'checkbox') data[el.name] = el.checked;
          else data[el.name] = (el.value || '').toString().trim();
        });
        if (!data.productId) return toast('请选择商品','error');
        if (!data.talentId) return toast('请选择达人','error');
        // 合并合作模式
        if (data.coopParent) {
          if (data.coopChild) data.coopMode = `${data.coopParent}-${data.coopChild}`;
          else data.coopMode = data.coopParent; // 互选/原生二次推广/素材合作 等无二级的情况
        } else {
          data.coopMode = '';
        }
        delete data.coopParent; delete data.coopChild;
        delete data.productSearch; delete data.talentSearch;
        data.unitPrice = Number(data.unitPrice) || 0;
        data.orderCount = Number(data.orderCount) || 0;
        data.gmv = Number(data.gmv) || (data.unitPrice * data.orderCount);
        // 佣金率字段转数字（空值保留空串以便未填时不误触发红星）
        data.commissionRate    = data.commissionRate    === '' || data.commissionRate    == null ? '' : Number(data.commissionRate);
        data.commissionRateNew = data.commissionRateNew === '' || data.commissionRateNew == null ? '' : Number(data.commissionRateNew);
        data.stageTimes = newStageTimes;
        if (newStageTimes.recommend) data.recommendDate = newStageTimes.recommend;
        await upsertMatch(data);
        toast(editing?'已保存':'撮合单已创建','success');
        close(); draw(main);
      });
    }
  });
}

// 工具：客单价*订单数=GMV 自动计算
function recalcGmv(root) {
  const up = Number(root.querySelector('[name="unitPrice"]')?.value) || 0;
  const oc = Number(root.querySelector('[name="orderCount"]')?.value) || 0;
  const gmvInp = root.querySelector('[name="gmv"]');
  if (gmvInp) gmvInp.value = Math.round(up * oc * 100) / 100;
}

// 工具：根据当前表单值，刷新"红星标记预览"
function refreshStarPreview(root) {
  const dot = root.querySelector('#starPreviewDot');
  if (!dot) return;
  const status = root.querySelector('[name="status"]')?.value || '';
  const base   = Number(root.querySelector('[name="commissionRate"]')?.value);
  const curr   = Number(root.querySelector('[name="commissionRateNew"]')?.value);
  const on = status === 'selling' && isFinite(base) && isFinite(curr) && base > 0 && curr > 0 && curr > base;
  if (on) {
    dot.innerHTML = `<span style="color:#ef4444;display:inline-flex;align-items:center;gap:4px;font-weight:600;">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2l2.95 6.56L22 9.6l-5.24 4.86L18.18 22 12 18.27 5.82 22l1.42-7.54L2 9.6l7.05-1.04L12 2z"/></svg>
      将显示红星（${base}% → ${curr}%）
    </span>`;
  } else if (status !== 'selling') {
    dot.innerHTML = `<span class="text-slate-400">仅"开始带货"状态下才会显示</span>`;
  } else if (!isFinite(base) || !isFinite(curr) || base <= 0 || curr <= 0) {
    dot.innerHTML = `<span class="text-slate-400">请填写两项佣金率</span>`;
  } else {
    dot.innerHTML = `<span class="text-slate-400">变化佣金率未高于商品佣金率</span>`;
  }
}

// 通用模糊搜索选择器：输入时弹出候选列表
// 这里是 openMatchForm 内使用的 name/id 形式适配层，底层委派给 utils.bindSuggestPicker，
// 与"撮合管理 / 商品货盘 / 达人管理"等模块共享同一套下拉联想交互。
function bindSearchPicker(root, opt) {
  const inp = root.querySelector(`[name="${opt.inputName}"]`);
  const hid = root.querySelector(`[name="${opt.hiddenName}"]`);
  const sug = root.querySelector(`#${opt.suggestId}`);
  if (!inp || !hid || !sug) return;
  return bindSuggestPicker({
    input: inp,
    hidden: hid,
    suggest: sug,
    source: opt.source,
    matchFn: opt.matchFn,
    renderItem: opt.renderItem,
    formatSelected: opt.formatSelected,
    onSelect: opt.onSelect,
    clearOnInput: true,
  });
}

/* ========== 详情抽屉（弹窗） ========== */
function openDetail(id, main) {
  const m = getMatch(id); if (!m) return;
  const p = getProduct(m.productId);
  const t = getTalent(m.talentId);
  const meta = getStatusMeta(m.status);
  const stageIdx = STATUS_FLOW.findIndex(s => s.key === m.status);

  const timeline = STATUS_FLOW.map((s, i) => {
    const done = i <= stageIdx;
    const current = i === stageIdx;
    const stageTime = (m.stageTimes || {})[s.key] || '';
    return `
      <div class="flex items-start gap-3 relative">
        <div class="flex flex-col items-center">
          <div class="w-7 h-7 rounded-full grid place-items-center ${done?(current?'bg-brand-600 text-white ring-4 ring-brand-100':'bg-emerald-500 text-white'):'bg-slate-200 text-slate-400'}">
            ${done && !current ? `<svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>` : (i+1)}
          </div>
          ${i < STATUS_FLOW.length-1 ? `<div class="w-0.5 flex-1 ${i<stageIdx?'bg-emerald-300':'bg-slate-200'}" style="min-height:28px"></div>`:''}
        </div>
        <div class="pb-4 flex-1">
          <div class="font-medium text-sm ${done?'text-slate-800':'text-slate-400'}">${s.name}</div>
          <div class="text-xs text-slate-400 mt-0.5">${s.stage}阶段${stageTime?` · ${stageTime}`:''}</div>
        </div>
      </div>
    `;
  }).join('');

  const body = `
    <div class="grid grid-cols-3 gap-5">
      <div class="col-span-2">
        <div class="flex items-start justify-between mb-4 pb-4 border-b border-slate-100">
          <div>
            <div class="text-xs text-slate-400 mb-1">${m.id}</div>
            <div class="text-lg font-bold text-slate-900 flex items-center gap-2">
              ${commissionStarHtml(m, { size: 18 })}
              <span>${escapeHtml(p?.name || '未知商品')}</span>
            </div>
            <div class="text-sm text-slate-500 mt-0.5">与 <b>${escapeHtml(t?.name||'')}</b>（${escapeHtml(t?.platform||'')}）的撮合</div>
          </div>
          <span class="badge ${meta.color} badge-dot">${meta.name}</span>
        </div>

        <div class="grid grid-cols-2 gap-3 text-sm mb-4">
          <InfoItem label="合作模式">${m.coopMode ? `<span class="badge badge-purple">${escapeHtml(m.coopMode)}</span>`:'<span class="text-slate-300">未确认</span>'}</InfoItem>
          <InfoItem label="负责人">${escapeHtml(m.owner||'-')}</InfoItem>
          <InfoItem label="样品状态">${m.sampleSent?`<span class="text-emerald-600">已寄送 · ${m.sampleDate||''}</span>`:`<span class="text-slate-400">未寄送</span>`}</InfoItem>
          <InfoItem label="推荐日期">${m.recommendDate||'-'}</InfoItem>
          <InfoItem label="商品价格">${p ? `<b class="text-emerald-600 text-base">¥${p.salePrice != null && p.salePrice !== '' ? p.salePrice : (p.price||0)}</b>` : '-'}</InfoItem>
          <InfoItem label="客单价">${m.unitPrice ? `¥${m.unitPrice}` : '<span class="text-slate-300">-</span>'}</InfoItem>
          <InfoItem label="订单数">${m.orderCount?formatNumber(m.orderCount):'-'}</InfoItem>
          <InfoItem label="GMV">${m.gmv?`<b class="text-emerald-600 text-base">${formatMoney(m.gmv)}</b>`:'<span class="text-slate-300">-</span>'}</InfoItem>
          <InfoItem label="商品佣金率">${(m.commissionRate!=null && m.commissionRate!=='')?`<b>${m.commissionRate}%</b>`:'<span class="text-slate-300">-</span>'}</InfoItem>
          <InfoItem label="变化佣金率">${(m.commissionRateNew!=null && m.commissionRateNew!=='')?`<b style="${shouldShowCommissionStar(m)?'color:#ef4444;':''}">${m.commissionRateNew}%</b>${shouldShowCommissionStar(m)?' '+commissionStarHtml(m,{size:14}):''}`:'<span class="text-slate-300">-</span>'}</InfoItem>
          <InfoItem label="供应链名称">${escapeHtml(m.supplierName || p?.supplier || p?.publisher || p?.merchant || '-')}</InfoItem>
          <InfoItem label="客户名称">${escapeHtml(m.customerName||'-')}</InfoItem>
          <InfoItem label="广告账户 ID">${m.adAccountId ? `<span class="font-mono">${escapeHtml(m.adAccountId)}</span>` : '<span class="text-slate-300">-</span>'}</InfoItem>
        </div>

        ${m.note ? `
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-4">
            <div class="flex items-center gap-1.5 font-medium mb-1">
              <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
              运营备注
            </div>
            <div>${escapeHtml(m.note)}</div>
          </div>
        `:''}

        <div class="grid grid-cols-2 gap-3">
          <div class="rounded-lg border border-slate-200 p-3">
            <div class="text-xs text-slate-400 mb-2">商品信息</div>
            <div class="text-sm font-medium">${escapeHtml(p?.name||'-')}</div>
            <div class="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <span class="badge badge-purple">${escapeHtml(p?.category||'-')}</span>
              <span>定价 ¥${p?.price||'-'}</span>
              <span>佣金 ${(p?.commissionPolicy != null && p?.commissionPolicy !== '') ? p.commissionPolicy : (p?.commissionRate||'-')}%</span>
            </div>
          </div>
          <div class="rounded-lg border border-slate-200 p-3">
            <div class="text-xs text-slate-400 mb-2">达人信息</div>
            <div class="text-sm font-medium flex items-center gap-2 flex-wrap">
              ${escapeHtml(t?.name||'-')}
              ${t?.level ? `<span class="badge ${TALENT_LEVEL_META[t.level]?.badge||'badge-slate'}">${escapeHtml(t.level)}级</span>` : ''}
            </div>
            <div class="mt-2 space-y-0.5 text-xs text-slate-500">
              ${t?.videoAccount ? `<div>🎬 视频号：${escapeHtml(t.videoAccount)}（${formatNumber(t?.videoFans||t?.followers||0)}万粉丝）</div>` : ''}
              ${t?.officialAccount ? `<div>📢 公众号：${escapeHtml(t.officialAccount)}${t?.officialFans?`（${formatNumber(t.officialFans)}万粉丝）`:''}</div>` : ''}
              <div>📍 地区：${escapeHtml(t?.region||'-')}</div>
              <div>🏷️ 品类赛道：${escapeHtml(t?.salesCategory || (t?.categories||[]).join('、') || '-')}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="col-span-1">
        <div class="text-xs text-slate-400 mb-3 font-medium uppercase tracking-wider">进度时间线</div>
        ${timeline}
      </div>
    </div>
  `.replace(/<InfoItem label="([^"]+)">([\s\S]*?)<\/InfoItem>/g,
    (_, l, c) => `<div><div class="text-xs text-slate-400 mb-0.5">${l}</div><div class="text-slate-800">${c}</div></div>`);

  const isLast = stageIdx === STATUS_FLOW.length - 1;
  const footer = `
    <button class="btn btn-ghost" data-act="edit">编辑详情</button>
    ${!isLast ? `<button class="btn btn-primary" data-act="advance">推进到：${STATUS_FLOW[stageIdx+1].name} →</button>`:''}
  `;
  openModal({
    title:'撮合详情', bodyHtml: body, footerHtml: footer, width:'860px',
    onBack: () => {},
    onMount(root, close) {
      root.querySelector('[data-act="edit"]').addEventListener('click', () => { close(); openMatchForm(main, id); });
      const ab = root.querySelector('[data-act="advance"]');
      if (ab) ab.addEventListener('click', () => { close(); advance(id, main); });
    }
  });
}

/* ========== 撮合批量上传（Excel） ==========
 * 模板字段：
 *  - 货盘商品名称 / 商品编号（至少有一个用于关联商品；缺则新建空占位商品亦不允许）
 *  - 达人视频号账号 / 达人名称 / 达人编号（至少一个用于关联达人）
 *  - 当前状态（货盘推荐/确认合作/样品寄送/开始带货）
 *  - 合作模式（可选，必须匹配 COOP_MODES 键名）
 *  - 负责人、备注
 *  - 客单价、订单数、GMV（仅开始带货生效；若 GMV 留空则 客单价*订单数）
 *  - 纯佣金率(%)、变化佣金率(%)、广告账户ID、客户名称、货盘供应链名称
 */
export function matchTemplate() {
  return [
    '货盘商品名称', '商品编号',
    '达人视频号账号', '达人名称', '达人编号',
    '当前状态', '合作模式', '负责人', '备注',
    '客单价', '订单数', 'GMV',
    '纯佣金率(%)', '变化佣金率(%)',
    '广告账户ID', '客户名称', '货盘供应链名称'
  ];
}

function _findProductByRow(r, products) {
  const byId = String(r['商品编号'] || '').trim();
  if (byId) {
    const m = products.find(p => p.id === byId);
    if (m) return m;
  }
  const name = String(r['货盘商品名称'] || r['商品名称'] || r['商品'] || '').trim();
  if (name) {
    return products.find(p => (p.name || '').trim() === name)
        || products.find(p => (p.name || '').includes(name));
  }
  return null;
}

function _findTalentByRow(r, talents) {
  const byId = String(r['达人编号'] || '').trim();
  if (byId) {
    const m = talents.find(t => t.id === byId);
    if (m) return m;
  }
  const videoAcc = String(r['达人视频号账号'] || r['视频号账号'] || '').trim();
  if (videoAcc) {
    const m = talents.find(t => (t.videoAccount || '').trim() === videoAcc);
    if (m) return m;
  }
  const name = String(r['达人名称'] || r['达人'] || '').trim();
  if (name) {
    return talents.find(t => (t.name || '').trim() === name)
        || talents.find(t => (t.name || '').includes(name));
  }
  return null;
}

function _parseStatus(val) {
  const s = String(val || '').trim();
  if (!s) return 'recommend';
  const hit = STATUS_FLOW.find(x => x.name === s || x.key === s);
  return hit ? hit.key : 'recommend';
}

function _parseCoopMode(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  // 兼容顿号 / 破折号 两种分隔
  const normalized = s.replace(/[、—/\\]/g, '-');
  if (COOP_MODES[normalized]) return normalized;
  if (COOP_MODES[s]) return s;
  return '';
}

function mapRowToMatch(r, products, talents) {
  const product = _findProductByRow(r, products);
  const talent = _findTalentByRow(r, talents);
  const status = _parseStatus(r['当前状态']);
  const price = Number(r['客单价']) || (product ? Number(product.salePrice || product.price || 0) : 0);
  const orderCount = Number(r['订单数']) || 0;
  let gmv = Number(r['GMV']) || 0;
  if (!gmv && status === 'selling') gmv = price * orderCount;

  return {
    _row: r,
    _product: product,
    _talent: talent,
    _valid: !!(product && talent),
    data: {
      id: '', // 由系统生成
      productId: product?.id || '',
      talentId: talent?.id || '',
      status,
      coopMode: _parseCoopMode(r['合作模式']),
      owner: String(r['负责人'] || '').trim(),
      note: String(r['备注'] || '').trim(),
      unitPrice: price,
      productPrice: price,
      orderCount,
      gmv,
      commissionRate: r['纯佣金率(%)'] === '' || r['纯佣金率(%)'] == null ? (product?.commissionPolicy ?? 0) : Number(r['纯佣金率(%)']) || 0,
      changedCommissionRate: r['变化佣金率(%)'] === '' || r['变化佣金率(%)'] == null ? '' : Number(r['变化佣金率(%)']) || '',
      adAccountId: String(r['广告账户ID'] || '').trim(),
      clientName: String(r['客户名称'] || '').trim(),
      supplier: String(r['货盘供应链名称'] || (product?.supplier || '')).trim(),
      sampleSent: status === 'sampling' || status === 'selling',
      sampleDate: '',
    }
  };
}

function openBulkUploadMatch(main) {
  const body = `
    <div class="space-y-4">
      <div class="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-200">
        <div class="font-medium text-slate-700 mb-1">📋 批量导入说明</div>
        <ul class="text-xs text-slate-500 leading-relaxed list-disc pl-4">
          <li>请先下载"撮合导入模板"，按模板字段填写。</li>
          <li>商品与达人可通过"名称"或"编号"关联系统中已存在的记录；未匹配到的行将被跳过并标注失败原因。</li>
          <li>支持一次导入多条撮合，导入后会自动为每条撮合生成编号。</li>
          <li>当前状态可填中文（如"货盘推荐"）或英文 key（如"recommend"）。</li>
        </ul>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <button class="btn btn-ghost btn-sm" data-act="download-tpl">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v14m0 0l-5-5m5 5l5-5M5 21h14"/></svg>
          下载模板
        </button>
        <label class="btn btn-primary btn-sm cursor-pointer">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          选择 Excel 文件
          <input type="file" accept=".xlsx,.xls,.csv" class="hidden" id="bmFile"/>
        </label>
        <span class="text-xs text-slate-400" id="bmFileName">尚未选择文件</span>
      </div>
      <div id="bmPreview"></div>
    </div>
  `;
  const footer = `
    <button class="btn btn-ghost" data-act="cancel">取消</button>
    <button class="btn btn-primary" data-act="import" disabled>导入</button>
  `;
  let parsed = [];
  openModal({
    title: '批量上传撮合', bodyHtml: body, footerHtml: footer, width: '820px',
    onBack: () => {},
    onMount(root, close) {
      const fileNameEl = root.querySelector('#bmFileName');
      const previewEl = root.querySelector('#bmPreview');
      const importBtn = root.querySelector('[data-act="import"]');

      root.querySelector('[data-act="download-tpl"]').addEventListener('click', () => {
        downloadTemplate(matchTemplate(), '撮合导入模板.xlsx');
        toast('模板已下载', 'success');
      });
      root.querySelector('[data-act="cancel"]').addEventListener('click', close);

      root.querySelector('#bmFile').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        fileNameEl.textContent = file.name;
        try {
          const rows = await parseExcel(file);
          const products = getProducts();
          const talents = getTalents();
          parsed = rows.map(r => mapRowToMatch(r, products, talents));
          const validCnt = parsed.filter(x => x._valid).length;
          const invalidCnt = parsed.length - validCnt;
          previewEl.innerHTML = `
            <div class="text-sm mb-2">
              共解析 <b class="text-slate-700">${parsed.length}</b> 条，
              有效 <b class="text-emerald-600">${validCnt}</b>，
              无效 <b class="text-rose-500">${invalidCnt}</b>（商品或达人未匹配）
            </div>
            <div class="border border-slate-200 rounded-lg overflow-auto max-h-60">
              <table class="w-full text-xs">
                <thead class="bg-slate-50 text-slate-500 sticky top-0">
                  <tr><th class="px-2 py-2 text-left">#</th><th class="px-2 py-2 text-left">商品</th><th class="px-2 py-2 text-left">达人</th><th class="px-2 py-2 text-left">状态</th><th class="px-2 py-2 text-left">GMV</th><th class="px-2 py-2 text-left">状态</th></tr>
                </thead>
                <tbody>
                  ${parsed.slice(0, 30).map((x, i) => `
                    <tr class="${x._valid ? '' : 'bg-rose-50'}">
                      <td class="px-2 py-1.5 text-slate-400">${i + 1}</td>
                      <td class="px-2 py-1.5">${escapeHtml(x._product?.name || x._row['货盘商品名称'] || '-')}</td>
                      <td class="px-2 py-1.5">${escapeHtml(x._talent?.name || x._row['达人名称'] || '-')}</td>
                      <td class="px-2 py-1.5">${escapeHtml(getStatusMeta(x.data.status).name)}</td>
                      <td class="px-2 py-1.5">${x.data.gmv || '-'}</td>
                      <td class="px-2 py-1.5">${x._valid ? '<span class="text-emerald-600">✓ 有效</span>' : '<span class="text-rose-500">✗ 未匹配</span>'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              ${parsed.length > 30 ? `<div class="text-center text-xs text-slate-400 py-2">仅预览前 30 行</div>` : ''}
            </div>
          `;
          importBtn.disabled = validCnt === 0;
        } catch (err) {
          console.error(err);
          toast('解析 Excel 失败：' + err.message, 'error');
        }
      });

      importBtn.addEventListener('click', async () => {
        const valid = parsed.filter(x => x._valid);
        if (!valid.length) return toast('没有可导入的有效行', 'error');
        // id 由 batchUpsertMatches 内部分配；此处传入去掉 id 的新对象
        const list = valid.map(x => ({ ...x.data, id: '' }));
        await batchUpsertMatches(list);
        toast(`已导入 ${list.length} 条撮合`, 'success');
        close();
        draw(main);
      });
    }
  });
}