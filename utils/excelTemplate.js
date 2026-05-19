/**
 * V5: Excel 模板生成与解析的统一工具
 * 用于多个路由（excel-import / influencers / merchants）共享
 *
 * 注意：模板生成用 xlsx-js-style（支持单元格样式）
 *       数据解析仍用 xlsx（性能更好）
 */
const XLSX = require('xlsx-js-style');

/**
 * 生成"双行表头 + 示例数据"的工作表
 * 必填字段标红+加粗；第二行字段说明灰字斜体
 *
 * @param {Array<{name, desc, required}>} fields - 字段定义数组
 * @param {Array[]} sampleRows - 示例数据数组（不含表头）
 * @returns {object} XLSX worksheet
 *
 * 输出结构：
 *   第 1 行：字段名（必填项加 *）
 *   第 2 行：字段说明（灰字斜体）
 *   第 3 行+：示例数据
 */
function buildTemplateSheet(fields, sampleRows = []) {
  const headerRow = fields.map(f => f.required ? `${f.name} *` : f.name);
  const descRow = fields.map(f => f.desc || '');
  const aoa = [headerRow, descRow, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 列宽
  ws['!cols'] = fields.map(f => ({ wch: Math.max((f.name || '').length * 2, 14) }));

  // 给表头/说明行上样式
  for (let c = 0; c < fields.length; c++) {
    const headerCell = XLSX.utils.encode_cell({ r: 0, c });
    const descCell = XLSX.utils.encode_cell({ r: 1, c });

    if (ws[headerCell]) {
      ws[headerCell].s = {
        font: {
          color: { rgb: fields[c].required ? 'C00000' : '1F2937' },
          bold: true,
          sz: 12
        },
        fill: fields[c].required ? { fgColor: { rgb: 'FEE2E2' }, patternType: 'solid' } : undefined,
        alignment: { horizontal: 'center', vertical: 'center' }
      };
    }
    if (ws[descCell]) {
      ws[descCell].s = {
        font: { color: { rgb: '888888' }, italic: true, sz: 10 },
        fill: { fgColor: { rgb: 'F8FAFC' }, patternType: 'solid' },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true }
      };
    }
  }

  // 加大行高
  ws['!rows'] = [
    { hpt: 24 },
    { hpt: 36 },
  ];

  return ws;
}

/**
 * 导入时跳过模板说明行 + 归一化字段名（去掉必填标记 ' *'）
 * 检查第 0 行是否为说明性文字（命中 ≥2 个关键词）
 *
 * V5: 因为模板表头是"图书商家 *"形式，导入时要把 ' *' 去掉，
 *     让字段映射 MAP 能正常匹配（MAP 的 key 还是"图书商家"）
 */
function stripTemplateHintRow(jsonData) {
  if (!jsonData || jsonData.length === 0) return jsonData;

  // 1) 先归一化所有 row 的 key（去掉末尾 ' *' 必填标记）
  const normalized = jsonData.map(row => {
    const out = {};
    for (const k of Object.keys(row)) {
      const cleanKey = String(k).replace(/\s*\*\s*$/, '').trim();
      out[cleanKey] = row[k];
    }
    return out;
  });

  // 2) 判定第 0 行是否为说明行
  const firstRow = normalized[0];
  const firstRowText = Object.values(firstRow).join('|');
  const HINT_KEYWORDS = [
    '如：', '格式：', '多值', '数值', '可填', '必填',
    '不存在将自动创建', '逗号分隔', '系统中', '商家/',
    '11位', '唯一标识', '高/中/低', '是/否', 'S/A/B/C/D',
    '万元', '百分比', '关联公众号', '负责销售'
  ];
  const hitCount = HINT_KEYWORDS.filter(k => firstRowText.includes(k)).length;
  if (hitCount >= 2) {
    return normalized.slice(1);
  }
  return normalized;
}

/**
 * 生成"填写说明" sheet（保留作为详细说明）
 */
function buildHelperNoteSheet(fields, extraNotes = []) {
  const noteData = [
    ['字段', '说明', '是否必填'],
    ...fields.map(f => [f.name, f.desc, f.required ? '是' : '否']),
    ['', '', ''],
    ['📌 重要提示', '模板第一行是字段名（红色 * 表示必填），第二行是字段说明，从第三行开始填写真实数据。系统导入时会自动忽略说明行。', ''],
    ...extraNotes.map(n => [n[0] || '', n[1] || '', n[2] || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(noteData);
  ws['!cols'] = [{ wch: 18 }, { wch: 60 }, { wch: 10 }];
  return ws;
}

module.exports = {
  buildTemplateSheet,
  stripTemplateHintRow,
  buildHelperNoteSheet,
  // V5: 一站式生成完整 xlsx buffer（含样式 + sheet2 详细说明）
  buildTemplateBuffer(sheetName, fields, sampleRows, extraNotes = []) {
    const wb = XLSX.utils.book_new();
    const ws = buildTemplateSheet(fields, sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const noteWs = buildHelperNoteSheet(fields, extraNotes);
    XLSX.utils.book_append_sheet(wb, noteWs, '填写说明');
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  },
};
