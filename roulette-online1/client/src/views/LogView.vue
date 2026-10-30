<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { COLOR_META, chipClass, colorOfNumber, formatDateTime, formatTime } from '@/constants.js';
import { useStore } from '@/store.js';
import { POCKETS, POCKET_COUNT, buildWheelSvg } from '@/wheel.js';

const store = useStore();

const limit = ref(50);
const colorFilter = ref('all');
const playerFilter = ref('all');
const exporting = ref(false);
const wheelSvg = ref(null);

/* ---------------- 历史备份 ---------------- */

const archives = computed(() => store.state.game.archives || []);
const openArchive = ref(''); // 当前展开的备份 id
const archiveDetail = ref(null);
const archiveLoading = ref(false);
const archiveError = ref('');
const busy = ref(false);

/** 备份里的记录也带上「当时累计步数」 */
const archiveRows = computed(() => {
  if (!archiveDetail.value || archiveDetail.value.id !== openArchive.value) return [];
  const running = new Map();
  return [...(archiveDetail.value.spins || [])]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => {
      const total = (running.get(s.playerId) || 0) + s.steps;
      running.set(s.playerId, total);
      return { ...s, playerTotal: total };
    })
    .reverse();
});

const archiveColorSteps = computed(() => {
  const raw = archiveDetail.value;
  if (!raw) return [];
  return (raw.players || []).reduce((acc, p) => {
    const hit = acc.find((x) => x.color === p.color);
    if (hit) hit.steps += p.steps || 0;
    else acc.push({ color: p.color, steps: p.steps || 0 });
    return acc;
  }, []);
});

function rangeText(a) {
  if (!a.startedAt) return '—';
  const fmt = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  return a.endedAt && a.endedAt !== a.startedAt ? `${fmt(a.startedAt)} → ${fmt(a.endedAt)}` : fmt(a.startedAt);
}

async function toggleArchive(id) {
  if (openArchive.value === id) {
    openArchive.value = '';
    return;
  }
  openArchive.value = id;
  archiveDetail.value = null;
  archiveError.value = '';
  archiveLoading.value = true;
  try {
    archiveDetail.value = await store.fetchArchive(id);
  } catch (err) {
    archiveError.value = err.message || '读取备份失败';
  } finally {
    archiveLoading.value = false;
  }
}

async function exportArchive(id) {
  busy.value = true;
  try {
    await store.downloadArchiveCsv(id);
    store.setNotice('备份 CSV 已开始下载', 'ok');
  } catch (err) {
    store.setNotice(err.message, 'warn');
  } finally {
    busy.value = false;
  }
}

async function removeArchive(a) {
  if (!window.confirm(`确定删除备份「${a.name}」吗？\n该操作会同时删除服务器上的备份文件，无法恢复。`)) return;
  busy.value = true;
  try {
    await store.deleteArchive(a.id);
    if (openArchive.value === a.id) openArchive.value = '';
    store.setNotice(`已删除备份「${a.name}」`, 'ok');
  } catch (err) {
    store.setNotice(err.message, 'warn');
  } finally {
    busy.value = false;
  }
}

const allSpins = computed(() => store.state.game.spins);

const players = computed(() => store.state.game.players);

/** 每条记录附带「该玩家当时累计步数」与「该颜色当时合计步数」 */
const enriched = computed(() => {
  const running = new Map();
  const runningColor = new Map();
  const list = [...allSpins.value]
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((s) => {
      const total = (running.get(s.playerId) || 0) + s.steps;
      running.set(s.playerId, total);
      const colorTotal = (runningColor.get(s.color) || 0) + s.steps;
      runningColor.set(s.color, colorTotal);
      return { ...s, playerTotal: total, colorTotal };
    });
  return list.reverse(); // 最新在前
});

const filtered = computed(() =>
  enriched.value.filter(
    (s) =>
      (colorFilter.value === 'all' || s.color === colorFilter.value) &&
      (playerFilter.value === 'all' || s.playerId === playerFilter.value),
  ),
);

const visible = computed(() => filtered.value.slice(0, limit.value));

/** 汇总：真实转动次数、累计步数、四色分布、平均值 */
const summary = computed(() => {
  const list = filtered.value;
  const totalSteps = list.reduce((sum, s) => sum + s.steps, 0);
  const perColor = (store.state.options?.colors || []).map((c) => {
    const group = list.filter((s) => s.color === c.key);
    const steps = group.reduce((sum, s) => sum + s.steps, 0);
    const playerCount = new Set(group.map((s) => s.playerId)).size;
    return {
      ...c,
      count: group.length,
      steps,
      playerCount,
      avg: group.length ? steps / group.length : 0,
    };
  });
  return {
    count: list.length,
    totalSteps,
    avg: list.length ? totalSteps / list.length : 0,
    zero: list.filter((s) => s.num === 0).length,
    perColor,
  };
});

/** 卡方检验：判断真实记录是否与理论分布一致 */
const chi = computed(() => {
  const counts = new Array(13).fill(0);
  for (const s of allSpins.value) counts[s.num] += 1;
  const total = allSpins.value.length;
  if (total < 50) return { total, value: null };
  let value = 0;
  for (let n = 0; n <= 12; n++) {
    const e = (total * (n === 0 ? 1 : 3)) / 37;
    value += (counts[n] - e) ** 2 / e;
  }
  return { total, value, ok: value <= 21.03, counts };
});

const numberRows = computed(() => {
  const counts = new Array(13).fill(0);
  for (const s of allSpins.value) counts[s.num] += 1;
  const total = allSpins.value.length || 1;
  return counts.map((got, num) => ({
    num,
    got,
    pct: (got / total) * 100,
    expect: num === 0 ? 2.7027 : 8.1081,
  }));
});

/** 口袋命中热力（本页记录） */
const pocketHits = computed(() => {
  const hits = new Array(POCKET_COUNT).fill(0);
  for (const s of allSpins.value) {
    if (Number.isInteger(s.pocket) && s.pocket >= 0 && s.pocket < POCKET_COUNT) {
      hits[s.pocket] += 1;
    }
  }
  return hits;
});

const maxHit = computed(() => Math.max(1, ...pocketHits.value));

/* ---------- 操作 ---------- */

function exportCsv() {
  exporting.value = true;
  try {
    const header = [
      '序号',
      '时间',
      '玩家',
      '颜色',
      '转出数字',
      '口袋编号',
      '本步数',
      '玩家累计',
      '颜色累计',
      '类型',
    ];
    const rows = [...enriched.value].reverse().map((s) => [
      s.seq,
      formatDateTime(s.at),
      s.name,
      COLOR_META[s.color]?.name || s.color,
      s.num,
      s.pocket ?? '',
      s.steps,
      s.playerTotal,
      s.colorTotal,
      s.source === 'sim' ? '试验' : '实转',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `roulette-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    store.setNotice(`已导出 ${rows.length} 条记录`, 'ok');
  } finally {
    exporting.value = false;
  }
}

function resetAll() {
  if (!store.state.identity) {
    store.setNotice('请先选择颜色进入房间', 'warn');
    return;
  }
  if (
    !window.confirm(
      '确定重置当前对局吗？\n\n当前记录会先备份保存到服务器 data/archive/ 目录，' +
        '之后仍可在本页「历史备份」中查看与导出；玩家保留颜色，步数归零。',
    )
  ) {
    return;
  }
  store
    .resetAll(true)
    .then((res) =>
      store.setNotice(
        res.archived
          ? `已备份「${res.archived.name}」（${res.archived.spinCount} 条记录）并重置当前对局`
          : '已重置当前对局（没有可备份的记录）',
        'ok',
      ),
    )
    .catch((err) => store.setNotice(err.message, 'warn'));
}

onMounted(() => {
  buildWheelSvg(wheelSvg.value);
});
watch(
  () => store.state.options,
  () => buildWheelSvg(wheelSvg.value),
);
</script>

<template>
  <header>
    <div class="kicker">Steps Ledger · Verifiable Record</div>
    <h1>记 录 专 页</h1>
    <div class="sub">逐条留档 · 颜色 / 玩家 / 数字 / 步数 / 时间</div>
    <div class="rule"><span>REGISTRE DES COUPS</span></div>
  </header>

  <main>
    <!-- ============ 记录主体 ============ -->
    <section class="stack">
      <div class="panel-card">
        <h2>总览 <span class="en">Summary</span></h2>
        <div class="log-summary">
          <div
            v-for="c in summary.perColor"
            :key="c.key"
            class="ls-cell"
            :style="{ '--c': c.hex }"
          >
            <div class="k"><i></i>{{ c.name }}色</div>
            <div class="v">{{ c.steps }} 步</div>
            <div class="s">
              {{ c.count }} 次 · {{ c.playerCount }} 人 · 均 {{ c.avg.toFixed(1) }}/次
            </div>
          </div>
        </div>
        <div class="chi-box">
          记录条数 <b>{{ summary.count }}</b> · 合计步数 <b>{{ summary.totalSteps }}</b> ·
          每次平均 <b>{{ summary.avg.toFixed(2) }}</b> 步 · 转到 0 共
          <b>{{ summary.zero }}</b> 次<br />
          <template v-if="chi.value !== null">
            卡方检验：χ² = <b>{{ chi.value.toFixed(2) }}</b>（自由度 12，95% 临界值 21.03）·
            <span class="chi-verdict" :class="chi.ok ? 'ok' : 'warn'">
              {{ chi.ok ? '通过 ✓ 记录分布与理论一致' : '偏离 — 样本尚少，继续累积再观察' }}
            </span>
          </template>
          <template v-else>
            累计 <b>50</b> 次真实转动后自动启用卡方检验（当前 <b>{{ chi.total }}</b> 次）
          </template>
          <template v-if="archives.length">
            <br />历史备份 <b>{{ archives.length }}</b> 局已归档保存（重启与服务更新都不会丢失）
          </template>
        </div>
      </div>

      <!-- 历史备份 -->
      <div class="panel-card">
        <h2>历史备份 <span class="en">Archives</span></h2>
        <p class="tiny muted" style="margin-top: -4px; margin-bottom: 12px">
          每次「重置」都会先把当前对局完整备份到服务器
          <code>data/archive/</code> 目录，页面清空但数据不丢，可随时查看或导出。
        </p>

        <div v-if="!archives.length" class="log-empty">
          还没有历史备份 · 下次点「重置」时会自动生成第 1 局备份
        </div>

        <div v-else class="archive-list">
          <div
            v-for="a in archives"
            :key="a.id"
            class="archive-item"
            :class="{ open: openArchive === a.id }"
          >
            <div class="arc-head" @click="toggleArchive(a.id)">
              <span class="arc-caret">{{ openArchive === a.id ? '▾' : '▸' }}</span>
              <span class="arc-name">{{ a.name }}</span>
              <span class="arc-range">{{ rangeText(a) }}</span>
              <span class="arc-figures">
                <b>{{ a.spinCount }}</b> 条 · <b>{{ a.totalSteps }}</b> 步 ·
                <b>{{ a.playerCount }}</b> 人
              </span>
              <span class="arc-dots">
                <i
                  v-for="p in a.players.slice(0, 3)"
                  :key="p.id"
                  :style="{ background: COLOR_META[p.color]?.hex }"
                  :title="p.name"
                ></i>
                <em v-if="a.players.length > 3">+{{ a.players.length - 3 }}</em>
              </span>
              <span class="arc-actions" @click.stop>
                <button class="mini-btn" type="button" :disabled="busy" @click="exportArchive(a.id)">
                  导出 CSV
                </button>
                <button class="mini-btn danger" type="button" :disabled="busy" @click="removeArchive(a)">
                  删除
                </button>
              </span>
            </div>

            <div v-if="openArchive === a.id" class="arc-body">
              <div v-if="archiveLoading" class="tiny muted">读取中…</div>
              <div v-else-if="archiveError" class="tiny" style="color: #e08585">{{ archiveError }}</div>
              <template v-else-if="archiveDetail">
                <div class="arc-players">
                  <span v-for="p in archiveDetail.players" :key="p.id" class="arc-player">
                    <i :style="{ background: COLOR_META[p.color]?.hex }"></i>
                    {{ p.name }}（{{ COLOR_META[p.color]?.name }}色）
                    <b>{{ p.steps }}</b> 步 · {{ p.spinCount }} 次
                  </span>
                  <span v-if="archiveDetail.simSamples" class="arc-player muted">
                    含 {{ archiveDetail.simSamples }} 次理论抽样（不计步数）
                  </span>
                </div>

                <div class="archive-table">
                  <div class="log-head arc-head-row">
                    <span>序号</span>
                    <span>颜色</span>
                    <span>玩家</span>
                    <span>数字</span>
                    <span>本步</span>
                    <span class="h-src">累计</span>
                    <span>时间</span>
                    <span class="h-src-2">类型</span>
                  </div>
                  <div
                    v-for="s in archiveRows"
                    :key="s.id"
                    class="log-line arc-line"
                    :style="{ '--c': COLOR_META[s.color]?.hex }"
                  >
                    <span class="mono" style="color: var(--gold-dim); font-size: 11px">#{{ s.seq }}</span>
                    <span class="c-color"><i></i>{{ COLOR_META[s.color]?.name }}</span>
                    <span class="c-name">{{ s.name }}</span>
                    <span class="c-num">{{ s.num }}<small v-if="s.pocket !== null">#{{ s.pocket }}</small></span>
                    <span class="c-steps" :class="{ zero: !s.steps }">{{ s.steps ? '+' + s.steps : '0' }}</span>
                    <span class="c-total">{{ s.playerTotal }}</span>
                    <span class="c-time">{{ formatTime(s.at) }}</span>
                    <span class="h-src-2 c-src">{{ s.source === 'sim' ? '试验' : '实转' }}</span>
                  </div>
                  <div v-if="!archiveRows.length" class="log-empty" style="padding: 16px">
                    这一局没有产生任何转动记录
                  </div>
                </div>

                <p class="tiny muted mt-8">
                  颜色分布：<span v-for="c in archiveColorSteps" :key="c.color">
                    {{ COLOR_META[c.color]?.name }} {{ c.steps }} 步　
                  </span>
                </p>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="panel-card">
        <h2>逐条记录 <span class="en">Ledger</span></h2>

        <div class="log-toolbar">
          <div class="seg">
            <button
              type="button"
              :class="{ on: colorFilter === 'all' }"
              @click="colorFilter = 'all'"
            >
              全部颜色
            </button>
            <button
              v-for="c in store.state.options?.colors || []"
              :key="c.key"
              type="button"
              :class="{ on: colorFilter === c.key }"
              @click="colorFilter = c.key"
            >
              {{ c.name }}
            </button>
          </div>
          <div class="seg">
            <button
              type="button"
              :class="{ on: playerFilter === 'all' }"
              @click="playerFilter = 'all'"
            >
              全部玩家
            </button>
            <button
              v-for="p in players"
              :key="p.id"
              type="button"
              :class="{ on: playerFilter === p.id }"
              @click="playerFilter = p.id"
            >
              {{ p.name }}
            </button>
          </div>
          <div class="spacer"></div>
          <button class="mini-btn" type="button" :disabled="exporting || !enriched.length" @click="exportCsv">
            导出当前 CSV
          </button>
          <button
            class="mini-btn danger"
            type="button"
            :disabled="!enriched.length && !players.length"
            title="重置前会自动把当前对局备份到 data/archive/"
            @click="resetAll"
          >
            重置当前对局（自动备份）
          </button>
        </div>

        <div v-if="visible.length" class="log-table">
          <div class="log-head">
            <span>序号</span>
            <span>颜色</span>
            <span>玩家</span>
            <span>数字</span>
            <span>本步</span>
            <span class="h-src">累计 / 颜色</span>
            <span>时间</span>
            <span class="h-src-2">类型</span>
          </div>
          <div
            v-for="s in visible"
            :key="s.id"
            class="log-line"
            :style="{ '--c': COLOR_META[s.color]?.hex }"
          >
            <span class="mono" style="color: var(--gold-dim); font-size: 11px">#{{ s.seq }}</span>
            <span class="c-color"><i></i>{{ COLOR_META[s.color]?.name }}</span>
            <span class="c-name">
              {{ s.name }}
              <span v-if="s.playerId === store.state.identity?.id" class="tag-me">本机</span>
            </span>
            <span class="c-num">
              {{ s.num }}<small v-if="s.pocket !== null">#{{ s.pocket }}</small>
            </span>
            <span class="c-steps" :class="{ zero: !s.steps }">
              {{ s.steps ? '+' + s.steps : '0' }}
            </span>
            <span class="c-total">{{ s.playerTotal }} / {{ s.colorTotal }}</span>
            <span class="c-time">{{ formatTime(s.at) }}</span>
            <span class="h-src-2 c-src">{{ s.source === 'sim' ? '试验' : '实转' }}</span>
          </div>
        </div>
        <div v-else class="log-empty">
          {{ enriched.length ? '当前筛选下没有记录' : '暂无记录 · 到轮盘页面转动一次试试' }}
        </div>

        <div v-if="filtered.length > visible.length" class="center mt-14">
          <button class="mini-btn" type="button" @click="limit += 50">
            显示更多（还有 {{ filtered.length - visible.length }} 条）
          </button>
        </div>
        <p class="tiny muted mt-14">
          展示 {{ visible.length }} / {{ filtered.length }} 条 · 服务端最多保留最近
          {{ store.state.game.spins.length }} 条实时下发（完整历史保存在服务器 data 目录的
          JSON 文件中）。<br />
          「重置当前对局」会先把本局完整备份到 <code>data/archive/</code>，因此页面清空后仍可在上方
          <b>历史备份</b>中回看与导出。
        </p>
      </div>
    </section>

    <!-- ============ 右侧：分布与说明 ============ -->
    <section class="stack">
      <div class="panel-card">
        <h2>数字分布 <span class="en">Distribution</span></h2>
        <div>
          <div v-for="r in numberRows" :key="r.num" class="stat-row">
            <div
              class="num"
              :style="{
                background: COLOR_META[colorOfNumber(r.num)].hex,
                color: r.num === 0 ? '#fff' : '#0d0f14',
              }"
            >
              {{ r.num }}
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                :style="{ width: Math.min((r.pct / (2 * r.expect)) * 100, 100) + '%' }"
              ></div>
              <div class="expect"></div>
            </div>
            <div class="stat-val">{{ r.got }} · {{ r.pct.toFixed(2) }}%</div>
          </div>
        </div>
        <p class="tiny muted mt-14">
          红柱位置为该数字的理论概率（0 为 1/37，其余为 3/37），满刻度为 2× 期望。
        </p>
      </div>

      <div class="panel-card">
        <h2>口袋命中热力 <span class="en">Pockets</span></h2>
        <div class="heat-stage">
          <svg ref="wheelSvg" viewBox="0 0 560 560"></svg>
          <div class="heat-overlay">
            <span
              v-for="(hits, i) in pocketHits"
              :key="i"
              class="heat-dot"
              :style="{
                transform: `rotate(${i * (360 / POCKET_COUNT) + 360 / POCKET_COUNT / 2}deg) translateY(-192px)`,
                opacity: hits ? 0.35 + 0.65 * (hits / maxHit) : 0,
                background: COLOR_META[colorOfNumber(POCKETS[i])].hex,
              }"
              :title="`口袋 #${i}（数字 ${POCKETS[i]}）命中 ${hits} 次`"
            ></span>
          </div>
        </div>
        <p class="tiny muted mt-14">
          圆点越亮代表该口袋被命中越多（最多 {{ maxHit }} 次）· 对应
          <RouterLink to="/wheel" style="color: var(--gold)">轮盘页面</RouterLink>
          的格位编号。
        </p>
      </div>

      <div class="panel-card">
        <h2>记录规则 <span class="en">Rules</span></h2>
        <p>
          每台设备进入时选择颜色并登记昵称，此后它产生的每一次转动都会写入本表：
          <b>谁知道、哪个颜色、转出多少、前进几步、什么时候</b>。
        </p>
        <p class="tiny">
          「本步」= 本次前进的步数（数字即步数，0 不前进）；「累计 / 颜色」=
          该玩家当前累计步数 / 该颜色全部玩家累计步数。
        </p>
        <p class="tiny muted">
          表格数据由服务器统一记录并实时下发给全部设备，任何一台设备刷新后看到的记录完全一致，
          无法单方面修改。
        </p>
        <div class="chip-row">
          <div v-for="n in 13" :key="n" class="chip" :class="chipClass(n - 1)">{{ n - 1 }}</div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.log-line {
  grid-template-columns: 56px 62px minmax(0, 1fr) 54px 54px 92px 66px 52px;
}
.log-head {
  grid-template-columns: 56px 62px minmax(0, 1fr) 54px 54px 92px 66px 52px;
}
.heat-stage {
  position: relative;
  width: min(100%, 340px);
  margin: 0 auto;
  aspect-ratio: 1;
}
.heat-stage svg {
  width: 100%;
  height: 100%;
  display: block;
  opacity: 0.85;
}
.heat-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.heat-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 13px;
  height: 13px;
  margin: -6.5px 0 0 -6.5px;
  border-radius: 50%;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.7);
  transform-origin: center center;
  transition: opacity 0.4s ease;
}

/* ---------- 历史备份 ---------- */
.archive-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.archive-item {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  overflow: hidden;
  transition: border-color 0.25s ease, background 0.25s ease;
}
.archive-item.open {
  border-color: rgba(216, 180, 90, 0.45);
  background: rgba(216, 180, 90, 0.05);
}
.arc-head {
  display: grid;
  grid-template-columns: 16px minmax(74px, auto) minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 10px;
  padding: 11px 13px;
  cursor: pointer;
}
.arc-caret {
  color: var(--gold);
  font-size: 12px;
}
.arc-name {
  color: var(--gold-hi);
  font-weight: 700;
  letter-spacing: 0.1em;
  white-space: nowrap;
}
.arc-range {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10.5px;
  color: var(--cream-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.arc-figures {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--cream-dim);
  white-space: nowrap;
}
.arc-figures b {
  color: var(--gold-hi);
}
.arc-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.arc-dots i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
}
.arc-dots em {
  font-style: normal;
  font-size: 9.5px;
  color: var(--cream-dim);
}
.arc-actions {
  display: flex;
  gap: 6px;
}
.arc-actions .mini-btn {
  padding: 5px 10px;
  font-size: 10px;
}
.arc-body {
  border-top: 1px dashed var(--line);
  padding: 12px 13px 13px;
}
.arc-players {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 12px;
  font-size: 11.5px;
  color: var(--cream-dim);
}
.arc-player {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.arc-player i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.arc-player b {
  color: var(--gold-hi);
  font-family: 'IBM Plex Mono', monospace;
}
.archive-table {
  max-height: 340px;
  overflow-y: auto;
  padding-right: 2px;
}
.arc-line,
.arc-head-row {
  grid-template-columns: 50px 56px minmax(0, 1fr) 50px 48px 62px 64px 46px;
}
.archive-table::-webkit-scrollbar {
  width: 6px;
}
.archive-table::-webkit-scrollbar-thumb {
  background: rgba(216, 180, 90, 0.25);
  border-radius: 3px;
}

@media (max-width: 1024px) {
  .log-line,
  .log-head {
    grid-template-columns: 46px 54px minmax(0, 1fr) 46px 46px 84px 60px;
  }
  /* 小屏隐藏「类型」列，改由桌面端专属列补位 */
  .log-line .c-src,
  .log-head .h-src-2 {
    display: none;
  }
  .arc-line,
  .arc-head-row {
    grid-template-columns: 46px 50px minmax(0, 1fr) 46px 42px 56px 58px;
  }
  /* 备份头折成两行，避免删除/导出按钮被挤成一列 */
  .arc-head {
    grid-template-columns: 16px minmax(0, 1fr) auto;
    row-gap: 6px;
  }
  .arc-range {
    grid-column: 2 / 4;
    grid-row: 2;
  }
  .arc-figures {
    grid-column: 2 / 4;
    grid-row: 3;
  }
  .arc-dots {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
  }
  .arc-actions {
    grid-column: 1 / 4;
    grid-row: 4;
  }
  .arc-actions .mini-btn {
    flex: 1;
    text-align: center;
    padding: 7px 4px;
  }
}

@media (max-width: 640px) {
  /* 手机端只保留：序号 / 颜色 / 玩家 / 数字 / 时间 */
  .log-line {
    grid-template-columns: 32px 44px minmax(0, 1fr) 40px 62px;
  }
  .log-line .c-steps,
  .log-line .c-total {
    display: none;
  }
  .arc-line {
    grid-template-columns: 30px 40px minmax(0, 1fr) 36px 58px;
  }
  .arc-line .c-steps,
  .arc-line .c-total,
  .arc-line .c-src {
    display: none;
  }
  .archive-table .log-head {
    display: none;
  }
  .arc-head {
    padding: 9px 10px;
  }
  .arc-name {
    font-size: 12.5px;
  }
  .arc-range {
    font-size: 9.5px;
  }
  .arc-figures {
    font-size: 10px;
  }
  .arc-body {
    padding: 10px 10px 11px;
  }
  .arc-players {
    font-size: 10.5px;
    gap: 5px 12px;
    margin-bottom: 9px;
  }
  .archive-table {
    max-height: 260px;
  }
  .heat-stage {
    width: min(100%, 260px);
  }
  .heat-dot {
    width: 9px;
    height: 9px;
    margin: -4.5px 0 0 -4.5px;
  }
}
</style>
