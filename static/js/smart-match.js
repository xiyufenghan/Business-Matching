/**
 * 智能匹配：根据选定的商品，推荐最匹配的达人；或根据选定达人，推荐合适的商品
 */
import {
  getProducts, getTalents, getMatches, upsertMatch, nextId
} from './data.js';
import {
  toast, openModal, formatNumber, formatMoney, escapeHtml
} from './utils.js';

const state = {
  mode: 'product2talent',  // product2talent | talent2product
  selectedId: '',
};

export function renderSmart(main) {
  if (!state.selectedId) {
    if (state.mode === 'product2talent') state.selectedId = getProducts()[0]?.id || '';
    else state.selectedId = getTalents()[0]?.id || '';
  }
  draw(main);
}

function draw(main) {
  const products = getProducts();
  const talents = getTalents();

  main.innerHTML = `
    <div class="fade-in">
      <div class="mb-5">
        <div class="flex items-center gap-2 text-xs text-slate-400 mb-1">
          <a href="#/dashboard" class="hover:text-brand-700">首页</a>
          <span>›</span>
          <span class="text-slate-600">智能匹配</span>
        </div>
        <h1 class="text-2xl font-bold text-slate-900">智能匹配</h1>
        <p class="text-sm text-slate-500 mt-1">基于分类、粉丝量级、佣金率、带货能力等多维权重，自动推荐最合适的商达组合</p>
      </div>

      <!-- 模式切换 -->
      <div class="card p-5 mb-4">
        <div class="flex items-center gap-2 mb-4">
          <div class="inline-flex rounded-lg bg-slate-100 p-1">
            <button data-mode="product2talent" class="${state.mode==='product2talent'?'bg-white shadow-sm text-brand-700':'text-slate-500'} px-4 py-1.5 rounded-md text-sm font-medium">
              商品 → 推荐达人
            </button>
            <button data-mode="talent2product" class="${state.mode==='talent2product'?'bg-white shadow-sm text-brand-700':'text-slate-500'} px-4 py-1.5 rounded-md text-sm font-medium">
              达人 → 推荐商品
            </button>
          </div>
        </div>
        <div>
          <label class="form-label">${state.mode==='product2talent'?'选择要匹配的商品':'选择要匹配的达人'}</label>
          ${state.mode==='product2talent'
            ? `<select id="selSrc" class="inp" style="max-width:560px">
                ${products.map(p => `<option value="${p.id}" ${state.selectedId===p.id?'selected':''}>[${(p.type||'book')==='book'?'图书':'课程'}] ${escapeHtml(p.name)} · ¥${p.price}</option>`).join('')}
              </select>`
            : `<select id="selSrc" class="inp" style="max-width:560px">
                ${talents.map(t => `<option value="${t.id}" ${state.selectedId===t.id?'selected':''}>${escapeHtml(t.name)} · ${escapeHtml(t.region||'-')} · 视频号${formatNumber(t.videoFans||t.followers||0)}万</option>`).join('')}
              </select>`
          }
        </div>
      </div>

      ${renderResult()}
    </div>
  `;

  main.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    state.selectedId = state.mode==='product2talent' ? products[0]?.id : talents[0]?.id;
    draw(main);
  }));
  main.querySelector('#selSrc').addEventListener('change', e => { state.selectedId = e.target.value; draw(main); });

  // 推荐卡片事件
  main.querySelectorAll('[data-rec-id]').forEach(card => {
    card.querySelector('[data-act="create"]')?.addEventListener('click', () => {
      const sp = state.mode === 'product2talent' ? state.selectedId : card.dataset.recId;
      const st = state.mode === 'product2talent' ? card.dataset.recId : state.selectedId;
      createMatch(sp, st, main);
    });
  });
}

/* 计算匹配度 */
export function productCategory(p) {
  // 图书返回 category；课程用"课程学习"作为匹配标签
  if (!p) return '';
  if ((p.type||'book') === 'course') return '课程学习';
  return p.category || '';
}

export function scoreMatch(product, talent, existingMatches) {
  let score = 0;
  const reasons = [];

  // 统一读取\"纯佣金\"数值（单位%）：优先 commissionPolicy，兼容历史 commissionRate
  const prodCommission = (product.commissionPolicy != null && product.commissionPolicy !== '')
    ? Number(product.commissionPolicy)
    : Number(product.commissionRate || 0);

  // 1. 分类匹配（40%）
  const pCat = productCategory(product);
  if ((talent.categories||[]).includes(pCat)) {
    score += 40; reasons.push({ t:'分类完全匹配', pos:true });
  } else {
    reasons.push({ t:'分类未直接匹配', pos:false });
  }

  // 2. 佣金率（20%）：达人基础佣金率 ≤ 商品纯佣金，视为可接受
  if (prodCommission >= (talent.commissionBase||0)) {
    const margin = prodCommission - (talent.commissionBase||0);
    score += Math.min(20, 10 + margin);
    reasons.push({ t:`佣金空间 ${margin}%`, pos:true });
  } else {
    score += 5; reasons.push({ t:'佣金率略低于达人基础', pos:false });
  }

  // 3. 粉丝量 × 商品价位匹配（15%）
  const p = product.price||0;
  const f = talent.followers||0;
  if (p > 200 && f > 200) { score += 15; reasons.push({ t:'高价货+大粉丝', pos:true }); }
  else if (p < 100 && f < 200) { score += 15; reasons.push({ t:'平价货+泛粉丝', pos:true }); }
  else if (p <= 200) { score += 10; reasons.push({ t:'价格适配度较好', pos:true }); }
  else { score += 5; }

  // 4. 达人评分（15%）
  score += (talent.score||0) * 0.15;
  if ((talent.score||0) >= 80) reasons.push({ t:`高评分 ${talent.score}`, pos:true });

  // 5. 是否已有撮合（10%） - 有合作过的给加分
  const had = existingMatches.find(m => m.productId===product.id && m.talentId===talent.id);
  if (had) {
    if (had.status === 'selling') { score += 10; reasons.push({ t:'历史合作有效果', pos:true }); }
    else { score -= 3; reasons.push({ t:'近期已有在途撮合', pos:false }); }
  } else {
    score += 10;
  }

  // 轻微噪声让排序自然
  score += Math.random() * 2;

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

function renderResult() {
  const products = getProducts();
  const talents = getTalents();
  const matches = getMatches();

  if (state.mode === 'product2talent') {
    const p = products.find(x => x.id === state.selectedId);
    if (!p) return '<div class="empty">请先选择商品</div>';

    const ranked = talents.map(t => ({ t, ...scoreMatch(p, t, matches) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 12);

    return `
      <!-- 源商品概览 -->
      <div class="card p-5 mb-4 bg-gradient-to-r from-brand-50 to-pink-50 border-brand-200">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-500 to-pink-500 grid place-items-center text-white">
            <svg viewBox="0 0 24 24" class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7L12 3 4 7v10l8 4 8-4V7z"/></svg>
          </div>
          <div class="flex-1">
            <div class="text-lg font-bold text-slate-900">${escapeHtml(p.name)}</div>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              <span class="badge ${(p.type||'book')==='book'?'badge-purple':'badge-cyan'}">${(p.type||'book')==='book'?'图书':'课程'}</span>
              ${(p.type||'book')==='book'
                ? `<span class="badge badge-slate">${escapeHtml(p.category||'-')}</span>`
                : `<span class="badge badge-blue">${escapeHtml(Array.isArray(p.stage)?p.stage.join('、'):(p.stage||'-'))}</span><span class="badge badge-slate">${escapeHtml(Array.isArray(p.subject)?p.subject.join('、'):(p.subject||'-'))}</span>`}
              <span class="text-sm text-slate-600">定价 <b>¥${p.price}</b></span>
              <span class="text-sm text-slate-600">佣金 <b>${(p.commissionPolicy != null && p.commissionPolicy !== '') ? p.commissionPolicy : (p.commissionRate||0)}%</b></span>
              ${(p.tags||[]).slice(0,3).map(t => `<span class="badge badge-slate">${escapeHtml(t)}</span>`).join('')}
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-400">推荐达人数</div>
            <div class="text-2xl font-bold text-brand-700">${ranked.length}</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        ${ranked.map((r, i) => renderRecCard(r.t, r.score, r.reasons, 'talent', i)).join('')}
      </div>
    `;
  } else {
    const t = talents.find(x => x.id === state.selectedId);
    if (!t) return '<div class="empty">请先选择达人</div>';

    const ranked = products.map(p => ({ p, ...scoreMatch(p, t, matches) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 12);

    return `
      <div class="card p-5 mb-4 bg-gradient-to-r from-brand-50 to-pink-50 border-brand-200">
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-pink-500 grid place-items-center text-white text-xl font-bold">${escapeHtml(t.name[0])}</div>
          <div class="flex-1">
            <div class="text-lg font-bold text-slate-900">${escapeHtml(t.name)}</div>
            <div class="flex items-center gap-2 mt-1 flex-wrap">
              <span class="badge badge-slate">📍 ${escapeHtml(t.region||'-')}</span>
              ${(t.contentForms||[]).map(c=>`<span class="badge badge-cyan">${escapeHtml(c)}</span>`).join('')}
              <span class="text-sm text-slate-600">视频号 <b>${formatNumber(t.videoFans||t.followers||0)}</b>万</span>
              ${t.officialFans?`<span class="text-sm text-slate-600">公众号 <b>${formatNumber(t.officialFans)}</b>万</span>`:''}
              <span class="text-sm text-slate-600">近月带货 <b>${(Number(t.shortVideoSales||0)+Number(t.liveSales||0))}</b>万</span>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-400">推荐商品数</div>
            <div class="text-2xl font-bold text-brand-700">${ranked.length}</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        ${ranked.map((r, i) => renderRecCard(r.p, r.score, r.reasons, 'product', i)).join('')}
      </div>
    `;
  }
}

function renderRecCard(item, score, reasons, type, rank) {
  const level = score >= 80 ? { text:'强推', color:'bg-emerald-500' }
              : score >= 65 ? { text:'推荐', color:'bg-brand-500' }
              : score >= 50 ? { text:'可选', color:'bg-amber-500' }
                            : { text:'弱相关', color:'bg-slate-400' };
  return `
    <div data-rec-id="${item.id}" class="card p-4 hover-lift relative">
      <div class="absolute top-3 right-3 flex items-center gap-1">
        <span class="text-[10px] px-2 py-0.5 rounded-full text-white font-medium ${level.color}">${level.text}</span>
      </div>
      <div class="flex items-center gap-3 mb-3">
        ${type==='talent'
          ? `<div class="w-12 h-12 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center text-lg font-bold">${escapeHtml(item.name[0])}</div>`
          : `<div class="w-12 h-12 rounded-lg bg-gradient-to-br from-violet-400 to-indigo-400 text-white grid place-items-center">
              <svg viewBox="0 0 24 24" class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7L12 3 4 7v10l8 4 8-4V7z"/></svg>
             </div>`}
        <div class="flex-1 min-w-0">
          <div class="font-semibold text-slate-800 truncate">${escapeHtml(item.name)}</div>
          ${type==='talent'
            ? `<div class="text-xs text-slate-500 mt-0.5">${escapeHtml(item.region||'-')} · 视频号${formatNumber(item.videoFans||item.followers||0)}万${item.officialFans?` · 公众号${formatNumber(item.officialFans)}万`:''}</div>`
            : `<div class="text-xs text-slate-500 mt-0.5">${(item.type||'book')==='book'?escapeHtml(item.category||'图书'):`${escapeHtml(Array.isArray(item.stage)?item.stage.join('、'):(item.stage||''))}·${escapeHtml(Array.isArray(item.subject)?item.subject.join('、'):(item.subject||''))}`} · ¥${item.price} · 佣金${(item.commissionPolicy != null && item.commissionPolicy !== '') ? item.commissionPolicy : (item.commissionRate||0)}%</div>`}
        </div>
      </div>

      <div class="flex items-baseline gap-1 mb-1">
        <span class="text-xs text-slate-400">匹配度</span>
        <span class="text-xl font-bold text-brand-700">${score}</span>
        <span class="text-xs text-slate-400">/100</span>
      </div>
      <div class="score-bar mb-3"><span style="width:${score}%"></span></div>

      <div class="space-y-1 mb-3 min-h-[60px]">
        ${reasons.slice(0,3).map(r => `
          <div class="flex items-center gap-1.5 text-xs">
            ${r.pos
              ? `<svg viewBox="0 0 24 24" class="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`
              : `<svg viewBox="0 0 24 24" class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`}
            <span class="${r.pos?'text-slate-700':'text-slate-400'}">${r.t}</span>
          </div>
        `).join('')}
      </div>

      <div class="flex gap-2">
        <button class="btn btn-primary btn-sm flex-1" data-act="create">
          <svg viewBox="0 0 24 24" class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          创建撮合
        </button>
      </div>
    </div>
  `;
}

function createMatch(productId, talentId, main) {
  const id = nextId('M');
  const today = new Date().toISOString().slice(0,10);
  upsertMatch({
    id, productId, talentId,
    status: 'recommend',
    coopMode: '', sampleSent: false, sampleDate: '',
    gmv: 0, orderCount: 0,
    recommendDate: today, lastUpdate: today,
    owner: '系统推荐', note: '由智能匹配创建'
  });
  toast(`已创建撮合单 ${id}，可前往撮合管理跟进`, 'success', 3000);
  draw(main);
}
