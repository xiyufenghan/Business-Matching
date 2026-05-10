/**
 * V4 撮合 5 段流程统一定义
 * 前后端都引用此文件，避免散落硬编码
 *
 * 阶段顺序：发布需求 → 需求回应 → 需求建联 → 样品寄送（可选）→ 开始合作
 */

// 5 段英文枚举（DB 存储值，单一来源）
const STAGES = ['published', 'responded', 'connected', 'sample_sent', 'cooperating'];

// 中文标签
const STAGE_LABELS = {
  published: '发布需求',
  responded: '需求回应',
  connected: '需求建联',
  sample_sent: '样品寄送',
  cooperating: '开始合作',
};

// 阶段说明（tooltip 用）
const STAGE_DESC = {
  published: '需求已发布到广场',
  responded: '对方点击了「邀请合作 / 申请合作」',
  connected: '双方达成意向，进入建联阶段',
  sample_sent: '可选阶段，商家已寄送样品/资料给达人',
  cooperating: '双方进入实际合作执行',
};

// 哪个阶段是可选的（看板上显示"可选"角标）
const OPTIONAL_STAGES = ['sample_sent'];

// 阶段颜色（前端样式）
const STAGE_COLORS = {
  published: '#94a3b8',
  responded: '#3b82f6',
  connected: '#8b5cf6',
  sample_sent: '#f59e0b',
  cooperating: '#10b981',
};

// 兼容旧库：把所有可能出现的旧中文 stage 值映射到新英文枚举
const LEGACY_TO_NEW = {
  '需求发布': 'published',
  '合作匹配': 'connected',  // 旧的"合作匹配"语义最接近新的"需求建联"
  '达成意向': 'connected',
  '样品寄送': 'sample_sent',
  '开始合作': 'cooperating',
  // 已是英文则原样
  'published': 'published',
  'responded': 'responded',
  'connected': 'connected',
  'sample_sent': 'sample_sent',
  'cooperating': 'cooperating',
};

function normalizeStage(stage) {
  if (!stage) return 'published';
  return LEGACY_TO_NEW[stage] || 'published';
}

function getStageLabel(stage) {
  return STAGE_LABELS[normalizeStage(stage)] || stage;
}

module.exports = {
  STAGES,
  STAGE_LABELS,
  STAGE_DESC,
  OPTIONAL_STAGES,
  STAGE_COLORS,
  LEGACY_TO_NEW,
  normalizeStage,
  getStageLabel,
};
