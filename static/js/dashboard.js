/**
 * 数据看板：聚合展示四大模块数据（撮合管理 / 商品货盘 / 达人管理 / 智能匹配）
 * - 所有数据均从对应模块的数据源 (getProducts/getTalents/getMatches) 动态调取
 * - 智能匹配指标复用 smart-match.js 的 scoreMatch 评分算法
 * - 点击各模块标题/按钮可跳转至对应功能页
 */
import {
  getProducts, getTalents, getMatches,
  STATUS_FLOW, getStatusMeta,
  TALENT_LEVELS, TALENT_LEVEL_META
} from './data.js';
import { formatMoney, formatNumber, escapeHtml } from './utils.js';

export function renderDashboard(main) {
  // ========== 数据实时调取 ==========
  const products = getProducts();                 // 来自：商品货盘
  const talents  = getTalents();                  // 来自：达人管理
  const matches  = getMatches();                  // 来自：撮合管理

  // ========== 撮合管理指标（按用户要求口径调取）==========
  // 统计方式：漏斗累计口径（到达过该阶段即计入）
  // - 货盘推荐数 = 所有撮合单数（起步阶段）
  // - 合作确认数 = 当前状态为"确认合作"或之后阶段的撮合数
  // - 开始带货数 = 当前状态为"开始带货"的撮合数
  const stageCount = {};
  STATUS_FLOW.forEach(s => stageCount[s.key] = 0);
  matches.forEach(m => { stageCount[m.status] = (stageCount[m.status] || 0) + 1; });

  const orderKeys = STATUS_FLOW.map(s => s.key);
  const funnelCum = orderKeys.map((k, i) => {
    const total = orderKeys.slice(i).reduce((sum, kk) => sum + (stageCount[kk] || 0), 0);
    return { key: k, name: getStatusMeta(k).name, value: total };
  });

  // 货盘推荐累计数（= 所有撮合单）
  const recommendCumulative = matches.length;
  // 确认合作累计数（= 到达"确认合作"及之后阶段的撮合单数）
  const confirmedCumulative = matches.filter(m => ['confirmed','sampling','selling'].includes(m.status)).length;
  // 开始带货数
  const sellingCount = matches.filter(m => m.status === 'selling').length;
  // 累计 GMV：仅统计「开始带货」阶段的撮合单的 GMV
  const totalGmv = matches.filter(m => m.status === 'selling').reduce((s, m) => s + (Number(m.gmv) || 0), 0);
  const totalOrder = matches.filter(m => m.status === 'selling').reduce((s, m) => s + (Number(m.orderCount) || 0), 0);
  // 推荐转化率 = 开始带货数 / 货盘推荐数 * 100%
  const convRate = recommendCumulative ? (sellingCount / recommendCumulative * 100).toFixed(1) : 0;

  // ========== 环比（最近30天 vs 上一个30天） ==========
  const now = Date.now();
  const DAY = 86400000;
  const in30 = (d) => d && (now - new Date(d).getTime()) <= 30 * DAY;
  const in30to60 = (d) => d && (now - new Date(d).getTime() > 30 * DAY) && (now - new Date(d).getTime() <= 60 * DAY);

  const matchCur = matches.filter(m => in30(m.recommendDate)).length;
  const matchPrev = matches.filter(m => in30to60(m.recommendDate)).length;
  const matchDelta = calcDelta(matchCur, matchPrev);

  const gmvCur = matches.filter(m => in30(m.lastUpdate)).reduce((s,m)=>s+(Number(m.gmv)||0), 0);
  const gmvPrev = matches.filter(m => in30to60(m.lastUpdate)).reduce((s,m)=>s+(Number(m.gmv)||0), 0);
  const gmvDelta = calcDelta(gmvCur, gmvPrev);

  const talentCur = talents.filter(t => in30(t.createdAt)).length;
  const talentPrev = talents.filter(t => in30to60(t.createdAt)).length;
  const talentDelta = calcDelta(talentCur, talentPrev);

  const confirmCur = matches.filter(m => in30(m.lastUpdate) && ['confirmed','sampling','selling'].includes(m.status)).length;
  const confirmPrev = matches.filter(m => in30to60(m.lastUpdate) && ['confirmed','sampling','selling'].includes(m.status)).length;
  const confirmDelta = calcDelta(confirmCur, confirmPrev);

  const convCur = matchCur ? (confirmCur / matchCur * 100) : 0;
  const convPrev = matchPrev ? (confirmPrev / matchPrev * 100) : 0;
  const convDeltaVal = (convCur - convPrev).toFixed(1);
  const convDelta = {
    text: (convDeltaVal >= 0 ? '+' : '') + convDeltaVal + 'pp',
    dir: convDeltaVal >= 0 ? 'up' : 'down'
  };

  // ========== 商品货盘指标 ==========
  const bookCount = products.filter(p => (p.type||'book') === 'book').length;
  const courseCount = products.filter(p => p.type === 'course').length;
  const avgCommission = products.length
    ? (products.reduce((s,p)=>{
        const v = (p.commissionPolicy != null && p.commissionPolicy !== '')
          ? Number(p.commissionPolicy)
          : Number(p.commissionRate);
        return s + (Number.isFinite(v) ? v : 0);
      },0) / products.length).toFixed(1)
    : 0;

  // 智能匹配已移至管理后台

  main.innerHTML = `
    <div class="fade-in">
      <!-- 页面标题 -->
      <div class="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 class="text-2xl font-bold text-slate-900">数据看板</h1>
          <p class="text-sm text-slate-500 mt-1">
            数据实时汇总自
            <a href="#/matching" class="text-brand-600 hover:underline">撮合管理</a> ·
            <a href="#/products" class="text-brand-600 hover:underline">商品货盘</a> ·
            <a href="#/talents"  class="text-brand-600 hover:underline">达人管理</a>
          </p>
        </div>
        <div class="flex items-center gap-2">
          <select class="inp" style="width:140px">
            <option>最近7天</option>
            <option selected>最近30天</option>
            <option>最近90天</option>
            <option>今年</option>
          </select>
          <button class="btn btn-ghost" id="refreshDashBtn">
            <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            刷新
          </button>
        </div>
      </div>

      <!-- KPI 卡片区：达人总数 / 总撮合 / 合作确认 / 累计GMV / 推荐转化率 -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
        ${kpiCard('达人总数', talents.length, '位', talentDelta.text, talentDelta.dir, 'from-fuchsia-500 to-pink-500', 'users', 'talents')}
        ${kpiCard('总撮合数', recommendCumulative, '单', matchDelta.text, matchDelta.dir, 'from-violet-500 to-indigo-500', 'briefcase', 'matching')}
        ${kpiCard('合作确认数', confirmedCumulative, '位', confirmDelta.text, confirmDelta.dir, 'from-pink-500 to-rose-500', 'check', 'matching')}
        ${kpiCard('累计GMV', formatMoney(totalGmv), '', gmvDelta.text, gmvDelta.dir, 'from-amber-500 to-orange-500', 'cash', 'matching')}
        ${kpiCard('推荐转化率', convRate + '%', '', convDelta.text, convDelta.dir, 'from-cyan-500 to-blue-500', 'trend', 'matching')}
      </div>

      <!-- 两大模块概览：商品货盘 / 达人等级 -->
      <div class="grid grid-cols-12 gap-4 mb-5">
        <!-- 商品货盘概览 -->
        <div class="card p-4 col-span-12 md:col-span-6">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-md bg-gradient-to-br from-violet-500 to-indigo-500 grid place-items-center text-white">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7L12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/></svg>
              </div>
              <div class="text-sm font-semibold text-slate-700">商品货盘概览</div>
            </div>
            <button class="text-xs text-brand-600 hover:underline" data-nav="products">管理货盘 →</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="p-3 rounded-lg bg-gradient-to-br from-brand-50 to-pink-50 border border-brand-100">
              <div class="text-xs text-slate-500">货盘总量</div>
              <div class="flex items-baseline gap-1">
                <div class="text-2xl font-bold text-brand-700">${products.length}</div>
                <div class="text-xs text-slate-400">件</div>
              </div>
            </div>
            <div class="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div class="text-xs text-slate-500">平均纯佣金率</div>
              <div class="flex items-baseline gap-1">
                <div class="text-2xl font-bold text-slate-800">${avgCommission}</div>
                <div class="text-xs text-slate-400">%</div>
              </div>
            </div>
            <div class="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div class="text-xs text-slate-500">图书货盘</div>
              <div class="flex items-baseline gap-1">
                <div class="text-xl font-bold text-slate-800">${bookCount}</div>
                <div class="text-xs text-slate-400">册</div>
              </div>
            </div>
            <div class="p-3 rounded-lg bg-slate-50 border border-slate-100">
              <div class="text-xs text-slate-500">课程货盘</div>
              <div class="flex items-baseline gap-1">
                <div class="text-xl font-bold text-slate-800">${courseCount}</div>
                <div class="text-xs text-slate-400">门</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 达人等级分布 -->
        <div class="card p-4 col-span-12 md:col-span-6">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-md bg-gradient-to-br from-fuchsia-500 to-pink-500 grid place-items-center text-white">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M17 11a3 3 0 100-6M3 21v-1a6 6 0 0112 0v1M17 14a6 6 0 014 5.65V21"/></svg>
              </div>
              <div class="text-sm font-semibold text-slate-700">达人等级分布</div>
            </div>
            <button class="text-xs text-brand-600 hover:underline" data-nav="talents">查看达人 →</button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            ${TALENT_LEVELS.map(lv => {
              const cnt = talents.filter(t => (t.level||'C') === lv).length;
              const meta = TALENT_LEVEL_META[lv];
              const pct = talents.length ? (cnt / talents.length * 100).toFixed(0) : 0;
              return `
                <div class="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                  <div class="w-9 h-9 rounded-lg grid place-items-center text-white font-bold shrink-0" style="background:${meta.color}">${lv}</div>
                  <div class="flex-1 min-w-0">
                    <div class="text-[11px] text-slate-500 truncate">${meta.name}</div>
                    <div class="flex items-baseline gap-1">
                      <div class="text-lg font-bold text-slate-900">${cnt}</div>
                      <div class="text-[11px] text-slate-400">位 · ${pct}%</div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- 漏斗 + 状态分布 -->
      <div class="grid grid-cols-12 gap-4 mb-5">
        <div class="card p-5 col-span-12 lg:col-span-7">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="text-base font-semibold text-slate-800">撮合漏斗分析</div>
              <div class="text-xs text-slate-400 mt-0.5">推荐 → 沟通 → 合作 → 效果 全流程转化</div>
            </div>
            <button class="text-xs text-brand-600 hover:underline" data-nav="matching">撮合管理 →</button>
          </div>
          <div id="funnelChart" style="height: 320px;"></div>
          <!-- 漏斗诊断结论 -->
          <div class="diagnosis-card mt-4 p-4 rounded-xl border border-brand-100 bg-gradient-to-br from-brand-50 to-white">
            <div class="flex items-center gap-2 mb-2">
              <div class="w-6 h-6 rounded-md bg-brand-100 text-brand-700 grid place-items-center">
                <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
              </div>
              <div class="text-sm font-semibold text-brand-800">诊断结论</div>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">AI 自动分析</span>
            </div>
            <div class="text-sm text-slate-700 leading-relaxed space-y-1" id="funnelDiagnosis">
              ${renderFunnelDiagnosis(funnelCum)}
            </div>
          </div>
        </div>

        <div class="card p-5 col-span-12 lg:col-span-5">
          <div class="flex items-center justify-between mb-4">
            <div class="text-base font-semibold text-slate-800">各状态撮合分布</div>
            <span class="text-xs text-slate-400">共 ${matches.length} 单</span>
          </div>
          <div class="space-y-2.5">
            ${STATUS_FLOW.map((s, i) => {
              const count = stageCount[s.key] || 0;
              const pct = matches.length ? (count / matches.length * 100) : 0;
              const colors = ['#64748b','#06b6d4','#3b82f6','#8b5cf6','#f59e0b','#10b981'];
              return `
              <div>
                <div class="flex items-center justify-between text-sm mb-1.5">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full" style="background:${colors[i]}"></span>
                    <span class="text-slate-700">${s.name}</span>
                  </div>
                  <div class="text-slate-500"><span class="font-semibold text-slate-800">${count}</span> · ${pct.toFixed(1)}%</div>
                </div>
                <div class="score-bar"><span style="width:${pct}%; background:${colors[i]}"></span></div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- 趋势 + 分类 -->
      <div class="grid grid-cols-12 gap-4 mb-5">
        <div class="card p-5 col-span-12 lg:col-span-8">
          <div class="flex items-center justify-between mb-4">
            <div class="text-base font-semibold text-slate-800">GMV 与 撮合量 趋势</div>
            <div class="flex gap-1">
              <button class="text-xs px-3 py-1 rounded-md bg-brand-100 text-brand-700 font-medium">周</button>
              <button class="text-xs px-3 py-1 rounded-md hover:bg-slate-100 text-slate-500">月</button>
            </div>
          </div>
          <div id="trendChart" style="height: 300px;"></div>
        </div>

        <div class="card p-5 col-span-12 lg:col-span-4">
          <div class="flex items-center justify-between mb-4">
            <div class="text-base font-semibold text-slate-800">货盘分类分布</div>
            <button class="text-xs text-brand-600 hover:underline" data-nav="products">查看 →</button>
          </div>
          <div id="categoryChart" style="height: 300px;"></div>
        </div>
      </div>

      <!-- 达人合作效果 Top -->
      <div class="card p-5">
        <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <div class="text-base font-semibold text-slate-800">达人合作效果排行</div>
            <div class="text-xs text-slate-400 mt-0.5">按累计GMV排序，展示 Top 10 合作达人</div>
          </div>
          <button class="btn btn-ghost btn-sm" data-nav="matching">查看全部 →</button>
        </div>
        <div class="overflow-x-auto">
          ${renderTopTalents(matches, talents, products)}
        </div>
      </div>
    </div>
  `;

  // 渲染Echarts
  renderFunnel(funnelCum);
  renderTrend(matches);
  renderCategoryChart(products, matches);

  // 事件
  main.querySelectorAll('[data-nav]').forEach(b => {
    b.addEventListener('click', () => location.hash = '#/' + b.dataset.nav);
  });
  main.querySelector('#refreshDashBtn').addEventListener('click', () => renderDashboard(main));
}

/* ===== 辅助：计算环比 ===== */
function calcDelta(cur, prev) {
  if (!prev) {
    if (!cur) return { text: '持平', dir: 'up' };
    return { text: '新增', dir: 'up' };
  }
  const r = ((cur - prev) / prev * 100);
  const text = (r >= 0 ? '+' : '') + r.toFixed(1) + '%';
  return { text, dir: r >= 0 ? 'up' : 'down' };
}

function kpiCard(label, value, unit, delta, dir, gradient, iconName, navTo) {
  const icons = {
    briefcase: `<path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>`,
    check: `<path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    cash: `<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>`,
    trend: `<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>`,
    users: `<circle cx="9" cy="8" r="4"/><path d="M17 11a3 3 0 100-6M3 21v-1a6 6 0 0112 0v1M17 14a6 6 0 014 5.65V21"/>`
  };
  return `
    <div class="card hover-lift p-5 ${navTo?'cursor-pointer':''}" ${navTo?`data-nav="${navTo}"`:''}>
      <div class="flex items-start justify-between mb-3">
        <div class="text-sm text-slate-500">${label}</div>
        <div class="w-9 h-9 rounded-lg grid place-items-center bg-gradient-to-br ${gradient} text-white">
          <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2">${icons[iconName]}</svg>
        </div>
      </div>
      <div class="flex items-baseline gap-1">
        <div class="text-2xl font-bold text-slate-900">${value}</div>
        ${unit ? `<div class="text-sm text-slate-400">${unit}</div>` : ''}
      </div>
      <div class="mt-2 text-xs ${dir === 'up' ? 'trend-up' : 'trend-down'} flex items-center gap-1">
        ${dir === 'up'
          ? `<svg viewBox="0 0 24 24" class="w-3 h-3" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg>`
          : `<svg viewBox="0 0 24 24" class="w-3 h-3" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>`}
        ${delta} <span class="text-slate-400">较上周期</span>
      </div>
    </div>
  `;
}

function renderFunnelDiagnosis(funnelCum) {
  if (!funnelCum || !funnelCum.length) return '<div class="text-slate-400">暂无撮合数据，无法生成诊断。</div>';
  const recommendNum = Number(funnelCum[0]?.value) || 0;
  if (recommendNum === 0) return '<div class="text-slate-400">尚未有"货盘推荐"记录，建议先导入商品和达人信息后进行撮合推荐。</div>';

  // 依次读取每一层
  const getStage = (name) => Number(funnelCum.find(x => x.name === name)?.value || 0);
  const confirmN = getStage('确认合作');
  const sampleN = getStage('样品寄送');
  const sellingN = getStage('开始带货');

  const pct = (a, b) => (b ? Math.round((a/b)*1000)/10 : 0);
  const confirmPct = pct(confirmN, recommendNum);
  const sellingPct = pct(sellingN, recommendNum);

  // 各阶段环节相对转化率
  const recommendToConfirm = pct(confirmN, recommendNum);
  const confirmToSample = pct(sampleN, confirmN);
  const sampleToSelling = pct(sellingN, sampleN);

  // 诊断规则
  const lines = [];
  lines.push(`<div>📊 当前总撮合推荐 <b class="text-brand-700">${recommendNum}</b> 条，最终推动到"开始带货"共 <b class="text-emerald-600">${sellingN}</b> 条，整体推荐转化率 <b class="text-brand-700">${sellingPct}%</b>，合作确认率 <b>${confirmPct}%</b>。</div>`);

  // 等级评估
  let overallAssess;
  if (sellingPct >= 15) overallAssess = `<span class="text-emerald-600 font-semibold">转化健康</span>，建议扩大推荐量级，保持当前运营节奏。`;
  else if (sellingPct >= 8) overallAssess = `<span class="text-amber-600 font-semibold">转化中等</span>，存在优化空间，需关注流失最严重的漏斗节点。`;
  else if (sellingPct >= 3) overallAssess = `<span class="text-orange-600 font-semibold">转化偏低</span>，建议系统性复盘推荐到合作各环节的沟通效率与选品精准度。`;
  else overallAssess = `<span class="text-rose-600 font-semibold">转化明显不足</span>，推荐→带货链路存在严重阻塞，建议回顾达人匹配质量与佣金政策。`;
  lines.push(`<div>🎯 整体判断：${overallAssess}</div>`);

  // 定位瓶颈节点
  const steps = [
    { name: '推荐 → 确认合作', rate: recommendToConfirm, tip: '加强达人触达与选品推送，优化合作政策（佣金/投流补贴/样品支持），降低合作确认门槛' },
    { name: '确认合作 → 样品寄送', rate: confirmToSample, tip: '缩短样品寄送周期，建立标准化物流 SOP' },
    { name: '样品寄送 → 开始带货', rate: sampleToSelling, tip: '跟进达人档期，提供带货素材与投流支持' }
  ];
  // 找最低节点（忽略为 0 且上游也为 0 的情况）
  const validSteps = steps.filter(s => !isNaN(s.rate));
  if (validSteps.length) {
    const weakest = validSteps.reduce((a, b) => (a.rate < b.rate ? a : b));
    lines.push(`<div>⚠️ 瓶颈环节：<b>${weakest.name}</b>（当前 ${weakest.rate}%）。建议：${weakest.tip}。</div>`);
  }

  // 漏斗形态诊断
  if (recommendNum > 0 && confirmN === 0) {
    lines.push(`<div>💡 已有推荐但未进入确认合作阶段，建议排查达人沟通话术与选品推荐清单是否覆盖达人核心品类。</div>`);
  }
  if (confirmN > 0 && sellingN === 0) {
    lines.push(`<div>💡 已确认合作但未开始带货，建议跟进样品寄送进度与达人档期规划。</div>`);
  }
  if (recommendNum >= 20 && sellingN >= 2 && sellingPct < 10) {
    lines.push(`<div>💡 推荐基数充足，但转化偏弱；建议将看板右侧"Top 达人"所示高效能达人与图书精准二次匹配。</div>`);
  }
  if (recommendNum < 10) {
    lines.push(`<div>💡 当前推荐样本较小（&lt; 10 条），建议扩大货盘推荐数量以获得更稳定的转化统计结论。</div>`);
  }

  return lines.join('');
}

function renderFunnel(data) {
  const chart = echarts.init(document.getElementById('funnelChart'));
  const max = data[0]?.value || 1;
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}<br/>数量：{c}<br/>占比：{d}%' },
    series: [{
      type: 'funnel',
      left: '10%', right: '10%', top: 10, bottom: 10,
      width: '80%',
      min: 0, max: max,
      sort: 'descending',
      gap: 2,
      label: { show: true, position: 'inside', color: '#fff', fontWeight: 600, fontSize: 13,
        formatter: (p) => `${p.name}  ${p.value}` },
      labelLine: { show: false },
      itemStyle: { borderColor: '#fff', borderWidth: 2 },
      data: data.map((d, i) => ({
        value: d.value, name: d.name,
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: ['#6366f1','#8b5cf6','#a855f7','#d946ef','#ec4899','#f43f5e'][i] },
            { offset: 1, color: ['#818cf8','#a78bfa','#c084fc','#e879f9','#f472b6','#fb7185'][i] }
          ])
        }
      }))
    }]
  });
  window.addEventListener('resize', () => chart.resize(), { once: true });
}

function renderTrend(matches) {
  // 过去12周，每周的 GMV 与撮合新增数
  const weeks = 12;
  const now = new Date();
  const labels = [];
  const gmvData = [];
  const countData = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = new Date(now); end.setDate(end.getDate() - i * 7);
    const start = new Date(end); start.setDate(start.getDate() - 6);
    labels.push(`${start.getMonth()+1}/${start.getDate()}`);
    let gmv = 0, count = 0;
    matches.forEach(m => {
      const d = new Date(m.recommendDate || m.lastUpdate);
      if (d >= start && d <= end) {
        count++;
        gmv += Number(m.gmv) || 0;
      }
    });
    gmvData.push(gmv);
    countData.push(count);
  }
  const chart = echarts.init(document.getElementById('trendChart'));
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { data: ['GMV(元)', '新增撮合'], right: 10, top: 0, icon: 'roundRect' },
    grid: { left: 50, right: 50, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: labels, axisLine: { lineStyle: { color: '#e2e8f0' } }, axisLabel: { color: '#94a3b8' } },
    yAxis: [
      { type: 'value', name: 'GMV', splitLine: { lineStyle: { color: '#f1f5f9' } }, axisLabel: { color: '#94a3b8', formatter: (v) => v >= 10000 ? (v / 10000).toFixed(0) + 'w' : v } },
      { type: 'value', name: '撮合', splitLine: { show: false }, axisLabel: { color: '#94a3b8' } }
    ],
    series: [
      { name: 'GMV(元)', type: 'line', smooth: true, data: gmvData,
        symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 3, color: '#8b5cf6' }, itemStyle: { color: '#8b5cf6' },
        areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1, [
          { offset: 0, color: 'rgba(139,92,246,.3)' },
          { offset: 1, color: 'rgba(139,92,246,0)' }
        ])}
      },
      { name: '新增撮合', type: 'bar', yAxisIndex: 1, data: countData,
        barWidth: 14, itemStyle: { color: '#fbcfe8', borderRadius: [4,4,0,0] } }
    ]
  });
  window.addEventListener('resize', () => chart.resize(), { once: true });
}

function renderCategoryChart(products, matches) {
  // 合并图书(category) + 课程(按课程学段)，优先按货盘分类聚合
  const catMap = {};
  products.forEach(p => {
    const k = (p.type||'book') === 'course' ? `课程·${p.stage||'其他'}` : (p.category || '其他');
    catMap[k] = (catMap[k] || 0) + 1;
  });
  let data = Object.entries(catMap).map(([name, value]) => ({ name, value }));
  // 若尚无货盘数据，则尝试按撮合的商品分类回退
  if (!data.length) {
    const fb = {};
    matches.forEach(m => {
      const p = products.find(pp => pp.id === m.productId);
      if (!p) return;
      const k = (p.type||'book') === 'course' ? `课程·${p.stage||'其他'}` : (p.category || '其他');
      fb[k] = (fb[k] || 0) + 1;
    });
    data = Object.entries(fb).map(([name, value]) => ({ name, value }));
  }
  const chart = echarts.init(document.getElementById('categoryChart'));
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    color: ['#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#6366f1','#f97316','#ef4444','#14b8a6','#a855f7'],
    series: [{
      type: 'pie',
      radius: ['55%', '78%'],
      center: ['50%', '55%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 11, color: '#64748b' },
      labelLine: { length: 8, length2: 8 },
      data
    }]
  });
  window.addEventListener('resize', () => chart.resize(), { once: true });
}

function renderTopTalents(matches, talents, products) {
  // 按达人聚合GMV
  const agg = {};
  matches.forEach(m => {
    if (!m.talentId) return;
    if (!agg[m.talentId]) agg[m.talentId] = { gmv: 0, orders: 0, count: 0, sales: 0 };
    agg[m.talentId].gmv += Number(m.gmv) || 0;
    agg[m.talentId].orders += Number(m.orderCount) || 0;
    agg[m.talentId].count += 1;
    if (m.status === 'selling') agg[m.talentId].sales += 1;
  });
  const rows = Object.entries(agg)
    .map(([tid, v]) => {
      const t = talents.find(x => x.id === tid);
      return t ? { ...t, ...v } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.gmv - a.gmv)
    .slice(0, 10);

  if (!rows.length) return `<div class="empty">暂无合作数据</div>`;

  return `
    <table class="tbl">
      <thead>
        <tr>
          <th style="width:50px">排名</th>
          <th>达人</th>
          <th>平台</th>
          <th>等级</th>
          <th>粉丝(万)</th>
          <th>撮合数</th>
          <th>合作中</th>
          <th>订单数</th>
          <th class="text-right">累计GMV</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => {
          const lvMeta = TALENT_LEVEL_META[r.level] || TALENT_LEVEL_META['C'];
          return `
          <tr>
            <td>
              ${i < 3
                ? `<span class="inline-flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-bold" style="background:${['#f59e0b','#94a3b8','#f97316'][i]}">${i+1}</span>`
                : `<span class="text-slate-400 pl-2">${i+1}</span>`}
            </td>
            <td>
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-pink-400 text-white grid place-items-center text-xs font-semibold">${escapeHtml(r.name.slice(0,1))}</div>
                <div>
                  <div class="font-medium text-slate-800">${escapeHtml(r.name)}</div>
                  <div class="text-xs text-slate-400">${escapeHtml(r.id)}</div>
                </div>
              </div>
            </td>
            <td><span class="badge">${escapeHtml(r.platform||'视频号')}</span></td>
            <td><span class="badge" style="background:${lvMeta.color}22;color:${lvMeta.color}">${r.level||'C'} · ${lvMeta.name.replace(/\s.*$/, '')}</span></td>
            <td>${formatNumber(r.videoFans || r.followers)}</td>
            <td>${r.count}</td>
            <td>${r.sales}</td>
            <td>${formatNumber(r.orders)}</td>
            <td class="text-right font-semibold text-slate-900">${formatMoney(r.gmv)}</td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;
}