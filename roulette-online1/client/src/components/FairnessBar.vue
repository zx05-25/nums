<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { COLOR_META, formatAgo, isRecent } from '@/constants.js';
import { useStore } from '@/store.js';

const store = useStore();

/** 每秒刷新一次，让「xx秒前」实时跳动；没有玩家时不跑定时器 */
const tick = ref(Date.now());
let timer = null;

const players = computed(() => store.state.game.players);

onMounted(() => {
  timer = setInterval(() => {
    if (store.state.game.players.length) tick.value = Date.now();
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));

/**
 * 每位玩家一张牌：总步数 + 最近一次步数 + 「xx秒前」。
 * 按颜色顺序、其次登记时间排序，保证发牌顺序稳定、不会因为步数变化而跳动。
 */
const cards = computed(() => {
  const now = tick.value;
  const colorOrder = (store.state.options?.colors || []).map((c) => c.key);
  return [...players.value]
    .sort(
      (a, b) =>
        (colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color)) ||
        a.name.localeCompare(b.name),
    )
    .map((p) => ({
      ...p,
      hex: COLOR_META[p.color]?.hex || '#d8b45a',
      colorName: COLOR_META[p.color]?.name || '',
      ago: formatAgo(p.lastSpinAt, now),
      fresh: isRecent(p.lastSpinAt, 8000, now),
      isMe: p.id === store.state.identity?.id,
      justNow: p.lastSpinAt && now - new Date(p.lastSpinAt).getTime() < 5000,
    }));
});

const totalSteps = computed(() => players.value.reduce((sum, p) => sum + p.steps, 0));

/** 全场最近的一次转动 */
const latest = computed(() => {
  const now = tick.value;
  const last = store.state.game.spins[0] || null;
  if (!last) return null;
  return {
    ...last,
    hex: COLOR_META[last.color]?.hex || '#d8b45a',
    ago: formatAgo(last.at, now),
  };
});

function resetAll() {
  if (!store.state.identity) {
    store.setNotice('请先选择颜色进入房间', 'warn');
    return;
  }
  const ok = window.confirm(
    '确定重置当前对局吗？\n\n当前记录会先备份保存到服务器 data/archive/ 目录，' +
      '之后仍可在「记录」页的「历史备份」里查看与导出；玩家保留颜色，步数归零。',
  );
  if (!ok) return;
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
</script>

<template>
  <div class="fair">
    <div class="fair-inner">
      <!-- 第一行：品牌 + 全场汇总 + 工具 -->
      <div class="fair-top">
        <div class="fair-brand">
          <b>命运轮盘</b>
          <span>FAIR PLAY BOARD</span>
        </div>

        <div class="fair-sum">
          <span class="fs-item">
            <i class="fs-k">玩家</i><b>{{ players.length }}</b>
            <i class="fs-k fs-sum">合计</i><b class="fs-sum">{{ totalSteps }}</b>
            <i class="fs-k fs-sum">步</i>
          </span>
          <span v-if="latest" class="fs-latest">
            <i class="fs-dot" :style="{ background: latest.hex }"></i>
            <b>{{ latest.name }}</b>
            <span class="fs-num">+{{ latest.steps }}</span>
            <span class="fs-ago">{{ latest.ago }}</span>
          </span>
          <span v-else class="fs-latest muted">
            <i class="fs-dot" style="background: #4a5a52"></i>等待第一次转动
          </span>
        </div>

        <div class="fair-tools">
          <span class="conn" :class="{ off: !store.state.connected }" title="与服务器的实时连接状态">
            <i></i><span>{{ store.state.connected ? '已同步' : '连接中' }}</span>
          </span>
          <RouterLink class="chip-btn" to="/log">记录</RouterLink>
          <RouterLink v-if="store.state.identity" class="chip-btn me" to="/">
            {{ store.state.identity.name }}
          </RouterLink>
          <RouterLink v-else class="chip-btn solid" to="/">选颜色</RouterLink>
          <button v-if="store.state.identity" class="chip-btn" type="button" @click="resetAll">
            重置
          </button>
        </div>
      </div>

      <!-- 第二行：每位玩家的总步数 + 最近一次步数（xx秒前） -->
      <div class="fair-grid">
        <div
          v-for="p in cards"
          :key="p.id"
          class="pcard"
          :class="{ 'is-me': p.isMe, 'is-fresh': p.fresh }"
          :style="{ '--c': p.hex }"
          :title="`${p.name} · ${p.colorName}色 · 合计 ${p.steps} 步 · ${p.spinCount} 次转动 · 最近 ${p.ago}`"
        >
          <span class="pc-dot"></span>
          <div class="pc-body">
            <div class="pc-name">
              {{ p.name }}
              <span v-if="p.isMe" class="pc-me">我</span>
            </div>
            <div class="pc-last">
              <template v-if="p.lastSpinNum === null || p.lastSpinNum === undefined">
                <span class="pc-none">尚未转动</span>
              </template>
              <template v-else>
                <b>{{ p.lastSpinSteps ? '+' + p.lastSpinSteps : '0' }}</b>
                <span class="pc-num">({{ p.lastSpinNum }})</span>
                <span class="pc-ago" :class="{ hot: p.justNow }">{{ p.ago }}</span>
              </template>
            </div>
          </div>
          <div class="pc-total"><b>{{ p.steps }}</b><span>步</span></div>
        </div>

        <RouterLink v-if="!cards.length" class="pcard pc-empty" to="/">
          还没有玩家登记 · 点这里选择棋子颜色 →
        </RouterLink>
      </div>
    </div>
  </div>
</template>
