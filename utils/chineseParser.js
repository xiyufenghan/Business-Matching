// 中文数据解析工具 - 统一处理 Excel 输入的"X万"/"暂无"等中文格式
// 让导入函数和数据迁移共用

/**
 * 解析"X万"格式数字 → 标准数字
 * 输入: "5万" / "5.5万" / "100" / "无" / "暂无" / "" / 50 / "1000"
 * 输出: number 或 null（无效/空时）
 *
 * 业务约定（数据库统一存原始数字 = 元/人）：
 *   "5万"     → 50000
 *   "1.5万"   → 15000
 *   "1000"    → 1000
 *   "无"/"暂无"/"不直播"/"" → null（与 0 区分，0 表示明确填了 0）
 */
function parseChineseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim();
  if (!s) return null;
  // 标记"无意义"值
  const blanks = ['无', '暂无', '不直播', '-', 'N/A', 'NA', 'null'];
  if (blanks.includes(s)) return null;
  // 提取"万"单位
  const wanMatch = s.match(/^([\d.]+)\s*万$/);
  if (wanMatch) {
    const n = parseFloat(wanMatch[1]);
    return Number.isFinite(n) ? Math.round(n * 10000) : null;
  }
  // 纯数字（带千分位）
  const cleaned = s.replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 标准化文本字段：去空白；统一空值表示
 * 输入: "  科技、AI  " / "暂无" / undefined
 * 输出: 字符串或空字符串
 */
function normalizeText(value, blanksToEmpty = true) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (!s) return '';
  if (blanksToEmpty && ['无', '暂无', '不详', 'N/A'].includes(s)) return '';
  return s;
}

/**
 * 标准化"是/否"字段
 */
function normalizeYesNo(value, defaultValue = '否') {
  const s = normalizeText(value);
  if (!s) return defaultValue;
  if (['是', 'Y', 'y', 'YES', 'yes', 'Yes', '1', 'true'].includes(s)) return '是';
  if (['否', 'N', 'n', 'NO', 'no', 'No', '0', 'false'].includes(s)) return '否';
  return s;  // 其他原样返回
}

module.exports = { parseChineseNumber, normalizeText, normalizeYesNo };
