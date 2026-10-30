/**
 * 轮盘与颜色的公共定义（服务端唯一事实来源）
 *
 * 轮盘结构：37 格
 *   0       × 1 格（绿）
 *   1 - 12  × 各 3 格（红 / 黑交替）
 * 与线下四色棋子的对应关系：1-3 黄 / 4-6 蓝 / 7-9 绿 / 10-12 红，0 为不前进。
 */

export const COLORS = ['yellow', 'blue', 'green', 'red'];

export const COLOR_META = {
  yellow: { key: 'yellow', name: '黄', en: 'Yellow', hex: '#e3b23c', range: '1 – 3' },
  blue: { key: 'blue', name: '蓝', en: 'Blue', hex: '#4a90d9', range: '4 – 6' },
  green: { key: 'green', name: '绿', en: 'Green', hex: '#2fbf82', range: '7 – 9' },
  red: { key: 'red', name: '红', en: 'Red', hex: '#d0344a', range: '10 – 12' },
};

/** 数字 → 棋子颜色（0 不属于任何棋子颜色） */
export const NUMBER_COLOR = (() => {
  const map = {};
  map[0] = 'green';
  for (let n = 1; n <= 12; n++) {
    map[n] = n <= 3 ? 'yellow' : n <= 6 ? 'blue' : n <= 9 ? 'green' : 'red';
  }
  return map;
})();

/** 数字 → 步数：口袋数字即步数，0 表示本回合不前进 */
export const stepsOf = (num) => (num === 0 ? 0 : num);

/** 颜色 → 中文名（导出 CSV 等纯文本场景使用） */
export const COLOR_NAME_CN = { yellow: '黄', blue: '蓝', green: '绿', red: '红' };

export const POCKETS = (() => {
  const reds = [1, 3, 5, 7, 9, 12];
  const blacks = [2, 4, 6, 8, 10, 11];
  const arr = [0];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) arr.push(reds[i], blacks[i]);
  return arr; // 长度 37
})();

export const POCKET_COUNT = POCKETS.length; // 37

/** 每个数字的理论概率 */
export const expectedProb = (num) => (num === 0 ? 1 : 3) / POCKET_COUNT;

/** 数字所属的颜色分组（1-3 黄 / 4-6 蓝 / 7-9 绿 / 10-12 红） */
export const groupColorOf = (num) => {
  if (num === 0) return null;
  return COLORS[Math.min(3, Math.floor((num - 1) / 3))];
};
