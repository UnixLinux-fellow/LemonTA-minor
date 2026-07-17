// 板材/门板/工艺/五金/灯带 5 组选项的共享定义。
// 之前只在 cabinet/pages/materials/index.js 里定义, 但 PDF 导出等下游也需要把 code 映射回中文,
// 所以抽到 utils 目录, 供页面 + pdf-exporter + 未来其他消费者共用。
//
// id 直接用 price / brand code, 保存到 plan.materials 后由 cost-engine v2 用 code 查价字典。
// name / desc 仅用于 UI 显示 —— 见 docs/superpowers/specs/2026-07-14-cost-calculation-redesign-design.md §4。

const PANEL_OPTIONS = [
  { id: 'panel_e2_domestic', name: 'E2 国产板', desc: '性价比之选' },
  { id: 'panel_tu_baby_domestic', name: '兔宝宝', desc: '国产环保板材' },
  { id: 'panel_kronospan_domestic', name: '国产克诺斯帮', desc: '中国制造，欧洲品牌' },
  { id: 'panel_kronospan_germany', name: '德国克诺斯帮', desc: '德国原装进口' },
  { id: 'panel_egger', name: '爱格', desc: '奥地利顶级板材' },
];

const DOOR_PANEL_OPTIONS = [
  { id: 'door_material_same_as_cabinet', name: '与柜体相同', desc: '不加价' },
  { id: 'door_material_piano_lacquer', name: '钢琴烤漆', desc: '光泽细腻' },
  { id: 'door_material_skin_feel_lacquer', name: '肤感烤漆', desc: '柔和触感' },
  { id: 'door_material_aluminum_frame_ag_glass', name: '铝框 AG 玻璃', desc: '通透显大' },
  { id: 'door_material_wood_veneer', name: '实木贴皮', desc: '木纹纹理' },
  { id: 'door_material_rubber_solid_wood', name: '橡胶实木', desc: '中等档次' },
  { id: 'door_material_ash_solid_wood', name: '白蜡实木', desc: '高端实木' },
];

const DOOR_CRAFT_OPTIONS = [
  { id: 'door_craft_none', name: '无' },
  { id: 'door_craft_skeleton_line_shallow', name: '骨格线' },
  { id: 'door_craft_european_deep', name: '欧式' },
  { id: 'door_craft_grille_door', name: '格栅门' },
];

// hardware 存的是 brand_type 本身 (domestic / import), 与 price code 的后缀对齐
const HARDWARE_OPTIONS = [
  { id: 'domestic', name: '中国品牌', desc: '默认 DTC' },
  { id: 'import', name: '海外品牌', desc: '百隆 + 海福乐' },
];

// lighting 是分流: none / led_domestic / led_import, 与 hardware 独立
const LIGHTING_OPTIONS = [
  { id: 'none', name: '无', desc: '不加装灯带' },
  { id: 'led_domestic', name: '国产灯带', desc: '10mm × 10mm 超薄' },
  { id: 'led_import', name: '海福乐灯带', desc: '柔光均匀' },
];

const DEFAULT_MATERIALS = {
  panel: 'panel_e2_domestic',
  doorPanel: 'door_material_same_as_cabinet',
  doorCraft: 'door_craft_none',
  hardware: 'domestic',
  lighting: 'none',
};

// kind: 'panel' | 'doorPanel' | 'doorCraft' | 'hardware' | 'lighting'
const _OPTS_BY_KIND = {
  panel: PANEL_OPTIONS,
  doorPanel: DOOR_PANEL_OPTIONS,
  doorCraft: DOOR_CRAFT_OPTIONS,
  hardware: HARDWARE_OPTIONS,
  lighting: LIGHTING_OPTIONS,
};

// 把 plan.materials 里的 code 映射回中文 name (用于 PDF / 明细展示 / 分享文案等)。
// miss → 返回 code 本身作为兜底, 便于排查 (而不是显示空)。
function materialName(kind, code) {
  if (!code) return '';
  const opts = _OPTS_BY_KIND[kind];
  if (!opts) return code;
  const hit = opts.find((o) => o.id === code);
  return hit ? hit.name : code;
}

module.exports = {
  PANEL_OPTIONS,
  DOOR_PANEL_OPTIONS,
  DOOR_CRAFT_OPTIONS,
  HARDWARE_OPTIONS,
  LIGHTING_OPTIONS,
  DEFAULT_MATERIALS,
  materialName,
};
