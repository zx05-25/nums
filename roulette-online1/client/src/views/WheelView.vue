<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { COLOR_META, chipClass, colorOfNumber, formatTime } from '@/constants.js';
import { useStore } from '@/store.js';
import { POCKETS, SEG, buildWheelSvg, drawPocket, secureUnit } from '@/wheel.js';

const store = useStore();

/* =====================================================
 * 转动状态
 * ===================================================== */
const SPIN_MS = 3000;
const wheelSvg = ref(null);
const orbitEl = ref(null);
const spinning = ref(false);
const number = ref(null);
const pocketIndex = ref(null);
const lastRecorded = ref(null);
const popKey = ref(0);

let wheelRot = 0;
let ballRot = 0;
let spinTimer = null;

const myPlayer = computed(() => store.me.value);
const myColor = computed(() => COLOR_META[store.state.identity?.color] || null);
const canSpin = computed(() => Boolean(store.state.identity) && !spinning.value);

/* =====================================================
 * 四色实时步数总览
 * ===================================================== */
const board = computed(() => {
  const players = store.state.game.players;
  const turn = store.currentTurn.value;
  return (store.state.options?.colors || []).map((c) => {
    const group = players.filter((p) => p.color === c.key);
    return {
      ...c,
      group,
      steps: group.reduce((sum, p) => sum + p.steps, 0),
      isTurn: turn?.color === c.key,
      isMine: store.state.identity?.color === c.key,
    };
  });
});

/* =====================================================
 * 转动：本设备取真随机数 → 动画 → 上报服务端记账 → 全设备同步
 * ===================================================== */
function spin() {
  if (!store.state.identity) {
    store.setNotice('请先选择颜色进入房间', 'warn');
    return;
  }
  if (spinning.value) return;
  spinning.value = true;

  /* 真随机决定目标口袋 */
  const idx = drawPocket();
  const num = POCKETS[idx];

  /* 轮盘：把目标口袋转到正上方指针处 */
  const center = idx * SEG + SEG / 2;
  const cur = ((wheelRot % 360) + 360) % 360;
  const delta = (360 - center - cur + 360) % 360;
  const jitter = (secureUnit() * 2 - 1) * SEG * 0.26; // 口袋内自然抖动
  wheelRot += 360 * 4 + delta + jitter;
  if (wheelSvg.value) {
    wheelSvg.value.style.transition = `transform ${SPIN_MS - 500}ms cubic-bezier(.15,.8,.1,1)`;
    wheelSvg.value.style.transform = `rotate(${wheelRot}deg)`;
  }

  /* 小球：反向多圈滚动，最终停在顶端 */
  const curB = ((ballRot % 360) + 360) % 360;
  ballRot -= 360 * 6 + ((360 - curB) % 360);
  if (orbitEl.value) {
    orbitEl.value.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.1,.85,.08,1)`;
    orbitEl.value.style.transform = `rotate(${ballRot}deg)`;
  }

  clearTimeout(spinTimer);
  spinTimer = setTimeout(() => {
    spinning.value = false;
    reveal(num, idx);
  }, SPIN_MS + 120);
}

async function reveal(num, idx) {
  number.value = num;
  pocketIndex.value = idx;
  popKey.value += 1;

  try {
    const res = await store.submitSpin({ num, pocket: idx });
    lastRecorded.value = res.spin;
    store.setNotice(
      num === 0
        ? '本轮转到 0 · 本回合不前进'
        : `${res.spin.name} 前进 ${num} 步（累计 ${res.player.steps} 步）`,
      num === 0 ? 'warn' : 'ok',
    );
  } catch (err) {
    store.setNotice(err.message || '结果上报失败', 'warn');
  }
}

/* =====================================================
 * 统计与卡方检验（数据来自服务端记录，全员共享）
 * ===================================================== */
const realCounts = computed(() => {
  const counts = new Array(13).fill(0);
  for (const s of store.state.game.spins) {
    if (s.num >= 0 && s.num <= 12) counts[s.num] += 1;
  }
  return counts;
});

const simSamples = computed(() => store.state.game.mySimCount || 0);
const simCounts = computed(() => store.state.game.simCounts || new Array(37).fill(0));

/** 真实转动 + 本设备试验样本 的合并分布（对齐原版「批量试验验证」体验） */
const statRows = computed(() => {
  const real = realCounts.value;
  const realTotal = store.state.game.spins.length;
  const sim = simCounts.value;
  const simTotal = simSamples.value;
  const rows = [];
  for (let n = 0; n <= 12; n++) {
    const pockets = n === 0 ? [0] : [n - 1, n + 12, n + 24].filter((p) => p < 37);
    const simGot = pockets.reduce((sum, p) => sum + (sim[p] || 0), 0);
    const got = real[n] + simGot;
    const total = realTotal + simTotal;
    const exp = (n === 0 ? 1 : 3) / 37;
    const actual = total ? got / total : 0;
    rows.push({
      num: n,
      got,
      real: real[n],
      sim: simGot,
      width: Math.min((actual / (2 * exp)) * 100, 100),
      label: `${got} · ${(actual * 100).toFixed(2)}%`,
    });
  }
  return { rows, total: realTotal + simTotal, realTotal, simTotal };
});

const chi = computed(() => {
  const { total } = statRows.value;
  if (total < 50) return null;
  const counts = new Array(13).fill(0);
  for (const r of statRows.value.rows) counts[r.num] = r.got;
  let value = 0;
  for (let n = 0; n <= 12; n++) {
    const e = (total * (n === 0 ? 1 : 3)) / 37;
    value += (counts[n] - e) ** 2 / e;
  }
  return { total, value, ok: value <= 21.03 };
});

/* =====================================================
 * 历史筹码
 * ===================================================== */
const history = computed(() => store.state.game.spins.slice(0, 28));

const batchRunning = ref(false);
async function runBatch(times) {
  if (!store.state.identity) {
    store.setNotice('请先选择颜色进入房间', 'warn');
    return;
  }
  batchRunning.value = true;
  try {
    await store.simulate(times);
    store.setNotice(`已抽入 ${times} 个理论样本（不计入步数）`, 'ok');
  } catch (err) {
    store.setNotice(err.message, 'warn');
  } finally {
    batchRunning.value = false;
  }
}

/* =====================================================
 * 生命周期
 * ===================================================== */
function onKeydown(e) {
  if (e.code !== 'Space' || spinning.value) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  spin();
}

onMounted(() => {
  buildWheelSvg(wheelSvg.value);
  window.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  clearTimeout(spinTimer);
});

// 刷新页面后回显最近一次结果
watch(
  () => store.state.game.spins.length,
  (len) => {
    if (len > 0 && number.value === null) {
      const first = store.state.game.spins[0];
      number.value = first.num;
      pocketIndex.value = first.pocket;
      lastRecorded.value = first;
    }
  },
  { immediate: true },
);
</script>

<template>
  <header>
    <div class="kicker">True Random · 37 Pockets · Fair Play</div>
    <h1>命 运 轮 盘</h1>
    <div class="sub">四色棋子 · 真随机步数 · 全设备同步</div>
    <div class="rule"><span>LA ROULETTE DU DESTIN</span></div>
  </header>

  <main>
    <!-- ============ 轮盘 ============ -->
    <section class="stage-card">
      <div class="stage">
        <svg ref="wheelSvg" id="wheelSvg" viewBox="0 0 560 560"></svg>
        <div ref="orbitEl" class="ball-orbit"><div class="ball"></div></div>
        <div class="pointer"></div>
      </div>

      <div class="center mt-14">
        <span v-if="myPlayer" class="tiny" :style="{ color: myColor?.hex }">
          ● {{ myPlayer.name }} · {{ myColor?.name }}色 · 当前 {{ myPlayer.steps }} 步
        </span>
        <RouterLink v-else class="chip-btn solid" to="/">先选择你的棋子颜色 →</RouterLink>
      </div>

      <div class="spin-row">
        <button class="btn" type="button" :disabled="!canSpin" @click="spin">
          {{ spinning ? '转动中…' : '转动轮盘' }}
        </button>
        <RouterLink class="btn ghost log-link" to="/log">查看记录</RouterLink>
      </div>
      <div class="hint">
        按 空格键 亦可转动 · 结果由 crypto.getRandomValues 决定 · 数字即前进步数
      </div>

      <div class="result-band">
        <div
          :key="popKey"
          class="result-num"
          :class="{ pop: popKey > 0 }"
          :style="{ color: number === null ? '#aab2c0' : COLOR_META[colorOfNumber(number)].hex }"
        >
          {{ number === null ? '—' : number }}
        </div>
        <div class="result-meta">
          <template v-if="number === null">
            轮盘静止中<br />等待第一次转动
          </template>
          <template v-else>
            本次转到 <b>{{ number }}</b> · 口袋 <b>#{{ pocketIndex ?? '—' }}</b> · 属于
            <b>{{ COLOR_META[colorOfNumber(number)].name }}色</b><br />
            步数 <b>{{ number === 0 ? 0 : number }}</b> ·
            <template v-if="lastRecorded">
              <b>{{ lastRecorded.name }}</b> 上报于 {{ formatTime(lastRecorded.at) }}
            </template>
            <template v-else>
              理论概率 {{ number === 0 ? '1/37 ≈ 2.703%' : '3/37 ≈ 8.108%' }}
            </template>
          </template>
        </div>
      </div>
    </section>

    <!-- ============ 右侧面板 ============ -->
    <section class="stack">
      <div class="panel-card">
        <h2>四色步数总览 <span class="en">Board</span></h2>
        <div class="color-board">
          <div
            v-for="c in board"
            :key="c.key"
            class="cb-row"
            :class="{ 'is-turn': c.isTurn, 'is-me': c.isMine }"
            :style="{ '--c': c.hex }"
          >
            <span class="cb-bead"></span>
            <div class="cb-main">
              <div class="cb-title">
                {{ c.name }}色 <em>口袋 {{ c.range }}</em>
              </div>
              <div class="cb-players">
                <template v-if="c.group.length">
                  <span v-for="(p, i) in c.group" :key="p.id">
                    <template v-if="i">、</template>{{ p.name }}<i>{{ p.steps }}</i>
                  </span>
                </template>
                <span v-else class="muted">暂无玩家</span>
              </div>
            </div>
            <div class="cb-steps"><b>{{ c.steps }}</b><span>步</span></div>
          </div>
        </div>
        <p class="tiny muted mt-14">
          步数 = 转出的数字；转到 0 本回合不前进。整盘合计 <b style="color: var(--cream)">{{ store.state.game.totalSteps }}</b> 步 ·
          <RouterLink to="/log" style="color: var(--gold)">查看逐条记录</RouterLink>
        </p>
      </div>

      <div class="panel-card">
        <h2>公平性机制 <span class="en">Fairness</span></h2>
        <p>
          <b>① 设备各自取熵。</b>每次转动的数字由<b>转动那台设备</b>的
          <code>crypto.getRandomValues()</code> 生成（操作系统级加密熵源），
          服务端只负责校验与记账，无法预知也无法篡改结果。
        </p>
        <p>
          <b>② 进入即登记颜色。</b>每个设备首次进入必须选择棋子颜色并登记昵称，
          此后每一次转动都会带上颜色与玩家身份写入记录，任何人都能在记录专页逐条核对。
        </p>
        <p>
          <b>③ 全员同步。</b>一旦有人产生步数，所有在线设备顶部的公平条会立即刷新
          当前回合的颜色与步数，杜绝口头报数产生的争议。
        </p>
        <p>
          <b>④ 重置先备份再清空。</b>点「重置」时，当前整局记录会先原样存档到服务器
          <code>data/archive/</code>，页面归零但数据不丢，随时可在记录页「历史备份」中回看与导出。
        </p>
        <p>
          <b>⑤ 拒绝采样消除偏差。</b>直接取模（<code>rand % 37</code>）会让部分口袋被轻微偏爱；
          我们丢弃落入残余区间的样本重新抽取，保证 37 个口袋<b>严格等概率</b>。
        </p>
        <pre><span class="c">// 无偏真随机：从 [0, 37) 中等概率取一个口袋</span>
<span class="k">function</span> <span class="f">drawPocket</span>() {
  <span class="k">const</span> N = 37;
  <span class="k">const</span> LIMIT = 2**32 - (2**32 % N); <span class="c">// 拒绝采样上界</span>
  <span class="k">const</span> buf = <span class="k">new</span> Uint32Array(1);
  <span class="k">do</span> {
    crypto.getRandomValues(buf);       <span class="c">// 操作系统级熵</span>
  } <span class="k">while</span> (buf[0] &gt;= LIMIT);           <span class="c">// 拒绝残余区间，消除取模偏差</span>
  <span class="k">return</span> buf[0] % N;                 <span class="c">// 严格均匀分布于 0..36</span>
}</pre>
      </div>

      <div class="panel-card">
        <h2>概率结构 <span class="en">Probability</span></h2>
        <div class="prob-table">
          <div class="prob-cell">
            <div class="k">数字 0（1 格 / 共 37 格）</div>
            <div class="v">1/37 ≈ 2.7027%</div>
          </div>
          <div class="prob-cell">
            <div class="k">数字 1–12（各 3 格 / 共 37 格）</div>
            <div class="v">3/37 ≈ 8.1081%</div>
          </div>
          <div class="prob-cell">
            <div class="k">黄 1–3 · 蓝 4–6 · 红 10–12（各 9 格）</div>
            <div class="v">9/37 ≈ 24.3243%</div>
          </div>
          <div class="prob-cell">
            <div class="k">绿 7–9 + 数字 0（共 10 格）</div>
            <div class="v">10/37 ≈ 27.0270%</div>
          </div>
        </div>
        <div class="chip-row">
          <div v-for="n in 13" :key="n" class="chip" :class="chipClass(n - 1)">{{ n - 1 }}</div>
        </div>
      </div>

      <div class="panel-card">
        <h2>统计验证 <span class="en">Statistics</span></h2>
        <p style="margin-bottom: 14px">
          红柱为理论期望值（<b style="color: var(--cream)">2×期望</b> 为满刻度）。
          样本 = 服务端记录的全部真实转动 + 本设备的理论样本；随着次数增加，金条将向红柱收敛——这就是大数定律。
        </p>
        <div>
          <div v-for="row in statRows.rows" :key="row.num" class="stat-row">
            <div
              class="num"
              :style="{
                background: COLOR_META[colorOfNumber(row.num)].hex,
                color: row.num === 0 ? '#fff' : '#0d0f14',
              }"
            >
              {{ row.num }}
            </div>
            <div class="bar-track">
              <div class="bar-fill" :style="{ width: row.width + '%' }"></div>
              <div class="expect"></div>
            </div>
            <div class="stat-val">{{ row.label }}</div>
          </div>
        </div>
        <div class="chi-box">
          <template v-if="chi">
            总次数 <b>{{ chi.total }}</b>（实转 <b>{{ statRows.realTotal }}</b> + 样本
            <b>{{ statRows.simTotal }}</b>）· χ² = <b>{{ chi.value.toFixed(2) }}</b>
            （自由度 12，95% 临界值 21.03）·
            <span class="chi-verdict" :class="chi.ok ? 'ok' : 'warn'">
              {{ chi.ok ? '通过 ✓ 分布与理论一致' : '偏离 — 继续累积样本再观察' }}
            </span>
          </template>
          <template v-else>
            总次数 <b>{{ statRows.total }}</b> · 累计 50 次后启用卡方检验
          </template>
        </div>
        <div class="stat-actions">
          <button
            v-for="t in [370, 3700, 37000]"
            :key="t"
            class="mini-btn"
            type="button"
            :disabled="batchRunning"
            @click="runBatch(t)"
          >
            试验 ×{{ t }}
          </button>
          <RouterLink class="mini-btn" to="/log">记录专页</RouterLink>
        </div>
        <p class="tiny muted mt-8">
          批量试验只抽入理论样本用于验证均匀性，<b style="color: var(--cream)">不会</b>改变任何棋子的步数。
        </p>
      </div>

      <div class="panel-card">
        <h2>实时记录 <span class="en">History</span></h2>
        <div class="hist">
          <span v-if="!history.length" class="hist-empty">暂无记录</span>
          <div
            v-for="s in history"
            :key="s.id"
            class="chip"
            :class="chipClass(s.num)"
            :style="{ borderColor: COLOR_META[s.color].hex }"
            :title="`${s.name} · ${COLOR_META[s.color].name}色 · ${s.steps} 步 · ${formatTime(s.at)}`"
          >
            {{ s.num }}
          </div>
        </div>
        <p class="tiny muted mt-14">
          最近 {{ history.length }} 条 · 长按/悬停可看颜色与玩家 ·
          <RouterLink to="/log" style="color: var(--gold)">前往记录专页</RouterLink>
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.log-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
</style>
