/** 前端公共常量与工具（与 server/src/game/shared.js 的映射保持一致） */

export const COLORS = ['yellow', 'blue', 'green', 'red'];

export const COLOR_META = {
  yellow: { key: 'yellow', name: '黄', en: 'Yellow', hex: '#e3b23c', range: '1 – 3' },
  blue: { key: 'blue', name: '蓝', en: 'Blue', hex: '#4a90d9', range: '4 – 6' },
  green: { key: 'green', name: '绿', en: 'Green', hex: '#2fbf82', range: '7 – 9' },
  red: { key: 'red', name: '红', en: 'Red', hex: '#d0344a', range: '10 – 12' },
};

/**
 * 构建轮盘 SVG 时使用的格位配色。
 * 口袋数字 1–12 的红/黑交替排列保持不变，同时让 1–12 按四色棋子分组
 * （1-3 黄 / 4-6 蓝 / 7-9 绿 / 10-12 红），方便线下对照走子。
 */
export const REDS = new Set([1, 3, 5, 7, 9, 12]);

/** 数字 → 轮盘格位配色 class（chip 用） */
export const chipClass = (num) => (num === 0 ? 'green' : REDS.has(num) ? 'red' : 'black');

/** 数字 → 棋子颜色 */
export const colorOfNumber = (num) => {
  if (num === 0) return 'green';
  if (num <= 3) return 'yellow';
  if (num <= 6) return 'blue';
  if (num <= 9) return 'green';
  return 'red';
};

/** 数字 → 轮盘格填色（1-12 用四色分组色，保留金色描边） */
export const pocketFill = (num) => COLOR_META[colorOfNumber(num)].hex;

export const stepsOf = (num) => (num === 0 ? 0 : num);

export const SOURCE_LABEL = { manual: '实转', sim: '试验' };

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

/**
 * 相对时间：刚刚 / 12秒前 / 3分钟前 / 2小时前 / 具体时刻
 * @param {string|null} iso 目标时间
 * @param {number} [now] 参考时间戳（毫秒）；外部定时刷新时传入，保证每秒更新
 */
export function formatAgo(iso, now = Date.now()) {
  if (!iso) return '尚未转动';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '尚未转动';
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 5) return '刚刚';
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}小时前`;
  const d = new Date(then);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 距上次转动是否在 ms 毫秒内（用于「刚动过」高亮） */
export function isRecent(iso, ms = 8000, now = Date.now()) {
  if (!iso) return false;
  const then = new Date(iso).getTime();
  return !Number.isNaN(then) && now - then < ms;
}
