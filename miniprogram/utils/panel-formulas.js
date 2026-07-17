// 板件严格公式表: 非标/加高柜按此表根据实际 (W, H) 重算每块板的三维尺寸。
// 与 spec §6.3 对齐; 公式与 (旧)cost-engine.js 的 R6..R23 一致, 但改用 panel_code 作 key
// (旧代码用中文 name 硬编码, 现全换成 glb 元数据的 node_name)。
//
// 单位 cm; 返回 {length, width, thickness}, thickness 恒 1.8。
// length 是长边, width 是短边 —— 与 glb 元数据 board_list[i] 的存法一致。
// 未在表中的 panel_code, 调用方(cost-engine) 会 fallback 到 baseMeta 原尺寸 + warn。

const round = (v) => Math.round(v * 100) / 100;

function _shelf(W, H) { return { length: 56.2, width: round(W - 3.6), thickness: 1.8 }; }
function _drawerFront(W, H) { return { length: round(W - 4), width: 16, thickness: 1.8 }; }
function _drawerSideBoard(W, H) { return { length: 49, width: 12, thickness: 1.8 }; }
function _drawerBack(W, H) { return { length: round(W - 8.5), width: 10.7, thickness: 1.8 }; }
function _drawerBottom(W, H) { return { length: 47.2, width: round(W - 8.5), thickness: 1.8 }; }
function _drawerSide(W, H) { return { length: 56.2, width: 16, thickness: 1.8 }; }

const PANEL_FORMULAS = {
  w1_side_left_panel_18:  (W, H) => ({ length: round(H - 6),   width: 58, thickness: 1.8 }),
  w1_side_right_panel_18: (W, H) => ({ length: round(H - 6),   width: 58, thickness: 1.8 }),
  side_left_panel_18:  (W, H) => ({ length: round(H - 6),   width: 58, thickness: 1.8 }),
  side_right_panel_18: (W, H) => ({ length: round(H - 6),   width: 58, thickness: 1.8 }),
  top_panel_18:        (W, H) => ({ length: 58, width: round(W - 3.6), thickness: 1.8 }),
  bottom_panel_18:     (W, H) => ({ length: 58, width: round(W - 3.6), thickness: 1.8 }),
  back_panel_18:       (W, H) => ({ length: round(H - 9.6), width: round(W - 3.6), thickness: 1.8 }),
  w1_top_panel_18:        (W, H) => ({ length: 58, width: round(W - 3.6), thickness: 1.8 }),
  w1_bottom_panel_18:     (W, H) => ({ length: 58, width: round(W - 3.6), thickness: 1.8 }),
  w1_back_panel_18:       (W, H) => ({ length: round(H - 9.6), width: round(W - 3.6), thickness: 1.8 }),
  kick_front_18:       (W, H) => ({ length: round(W), width: 5.5, thickness: 1.8 }),
  access_panel_18:     (W, H) => ({ length: 19.8, width: round(W - 4), thickness: 1.8 }),
  door_single_18: (W, H) => ({ length: round(H - 6.44), width: round(W - 0.6), thickness: 1.8 }),
  door_flip_18: (W, H) => ({ length: round(H - 6.44), width: round(W - 0.6), thickness: 1.8 }),
  w1_door_single_18: (W, H) => ({ length: round(H - 6.44), width: round(W - 0.6), thickness: 1.8 }),
  door_left_18:   (W, H) => ({ length: round(H - 6.44), width: round((W - 0.6) / 2), thickness: 1.8 }),
  door_right_18:  (W, H) => ({ length: round(H - 6.44), width: round((W - 0.6) / 2), thickness: 1.8 }),
};

for (let i = 1; i <= 10; i++) {
  const k = 'shelf_panel_' + String(i).padStart(2, '0') + '_18';
  PANEL_FORMULAS[k] = _shelf;
}

for (let i = 1; i <= 5; i++) {
  const id = String(i).padStart(2, '0');
  PANEL_FORMULAS['drawer_box_front_'  + id + '_18'] = _drawerFront;
  PANEL_FORMULAS['drawer_box_left_'   + id + '_18'] = _drawerSideBoard;
  PANEL_FORMULAS['drawer_box_right_'  + id + '_18'] = _drawerSideBoard;
  PANEL_FORMULAS['drawer_box_back_'   + id + '_18'] = _drawerBack;
  PANEL_FORMULAS['drawer_box_bottom_' + id + '_18'] = _drawerBottom;
  PANEL_FORMULAS['drawer_side_left_'  + id + '_18'] = _drawerSide;
  PANEL_FORMULAS['drawer_side_bottom_' + id + '_18'] = _drawerSide;
}

module.exports = { PANEL_FORMULAS };
