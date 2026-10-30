<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { COLOR_META } from '@/constants.js';
import { useStore } from '@/store.js';

const store = useStore();
const router = useRouter();
const route = useRoute();

const name = ref(store.state.identity?.name || '');
const color = ref(store.state.identity?.color || '');
const submitting = ref(false);
const editing = ref(!store.state.identity);

const colors = computed(
  () => store.state.options?.colors || Object.values(COLOR_META),
);

/** 每个颜色当前有哪些玩家（颜色可以多人共用，但各自独立记步） */
const tiles = computed(() => {
  const players = store.state.game.players;
  return colors.value.map((c) => {
    const group = players.filter((p) => p.color === c.key);
    return {
      ...c,
      group,
      steps: group.reduce((sum, p) => sum + p.steps, 0),
      taken: group.length > 0,
      mine: store.state.identity?.color === c.key,
    };
  });
});

const roster = computed(() =>
  [...store.state.game.players].sort(
    (a, b) => b.steps - a.steps || a.name.localeCompare(b.name),
  ),
);

const canSubmit = computed(() => Boolean(name.value.trim()) && Boolean(color.value));

function pick(key) {
  color.value = key;
}

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    const res = await store.join({ name: name.value.trim(), color: color.value });
    const meta = COLOR_META[color.value];
    store.setNotice(
      res.resumed
        ? `已更新：${res.player.name} · ${meta.name}色`
        : `欢迎 ${res.player.name}！你执 ${meta.name}色棋子`,
      'ok',
    );
    editing.value = false;
    // 若之前被路由守卫挡回，登记完成后自动回到目标页
    router.push(typeof route.query.redirect === 'string' ? route.query.redirect : '/wheel');
  } catch (err) {
    store.setNotice(err.message || '进入失败，请重试', 'warn');
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  if (!store.state.options) store.bootstrap();
});
</script>

<template>
  <header>
    <div class="kicker">Fair Play · 4 Colors · Steps Ledger</div>
    <h1>命 运 轮 盘</h1>
    <div class="sub">先选棋子颜色 · 每次转动只前进自己的棋子</div>
    <div class="rule"><span>CHOISISSEZ VOTRE COULEUR</span></div>
  </header>

  <main>
    <!-- ============ 登记卡 ============ -->
    <section class="stage-card">
      <template v-if="!store.state.identity || editing">
        <div class="row-between" style="margin-bottom: 18px">
          <h2 class="card-title">第一步 · 登记你的颜色</h2>
          <span class="tiny muted">同一种颜色允许多人共用</span>
        </div>

        <label class="field">
          <span>玩家昵称</span>
          <input
            v-model="name"
            class="input"
            type="text"
            maxlength="12"
            placeholder="例如：阿明 / 老王 / 小美"
            @keyup.enter="submit"
          />
        </label>

        <div class="field">
          <span>选择棋子颜色</span>
          <div class="color-grid">
            <div
              v-for="c in tiles"
              :key="c.key"
              class="color-tile"
              :class="{ 'is-active': color === c.key }"
              :style="{ '--c': c.hex }"
              role="button"
              tabindex="0"
              @click="pick(c.key)"
              @keyup.enter="pick(c.key)"
            >
              <span v-if="c.mine" class="badge">我的</span>
              <div class="bead"></div>
              <div class="cname">{{ c.name }}色</div>
              <div class="crange">口袋 {{ c.range }}</div>
              <div class="cowner">
                <template v-if="c.group.length">
                  <b>{{ c.group.map((p) => p.name).join('、') }}</b><br />
                  已走 {{ c.steps }} 步
                </template>
                <span v-else class="none">暂无人选择</span>
              </div>
            </div>
          </div>
        </div>

        <div class="spin-row" style="margin-top: 20px">
          <button class="btn" type="button" :disabled="!canSubmit || submitting" @click="submit">
            {{ submitting ? '登记中…' : store.state.identity ? '保存并进入' : '进入轮盘' }}
          </button>
          <button
            v-if="store.state.identity"
            class="btn ghost"
            type="button"
            @click="editing = false"
          >
            取消
          </button>
        </div>
        <div class="hint">
          颜色仅用于标记「谁走的步」· 步数由转动结果决定 · 数字即步数，0 不前进
        </div>
      </template>

      <!-- 已登记：展示身份与快捷入口 -->
      <template v-else>
        <div class="identity" :style="{ '--c': COLOR_META[store.state.identity.color].hex }">
          <div class="bead"></div>
          <div class="id-main">
            <div class="id-name">{{ store.state.identity.name }}</div>
            <div class="id-color">
              执 {{ COLOR_META[store.state.identity.color].name }}色棋子 ·
              口袋 {{ COLOR_META[store.state.identity.color].range }}
            </div>
          </div>
          <div class="id-steps">
            <b>{{ store.me.value?.steps ?? 0 }}</b><span>步</span>
            <div class="tiny muted">{{ store.me.value?.spinCount ?? 0 }} 次转动</div>
          </div>
        </div>

        <div class="spin-row" style="margin-top: 22px">
          <RouterLink class="btn" to="/wheel" style="display: inline-flex; align-items: center">
            开始转动
          </RouterLink>
          <button class="btn ghost" type="button" @click="editing = true">修改昵称 / 颜色</button>
        </div>
        <div class="hint">
          本机身份已保存在浏览器中，刷新页面无需重新选择
        </div>
      </template>
    </section>

    <!-- ============ 右侧信息 ============ -->
    <section class="stack">
      <div class="panel-card">
        <h2>公平性规则 <span class="en">Fair Play</span></h2>
        <p>
          <b>① 每个设备进入时必须选择颜色并登记昵称。</b>
          颜色是这台设备的身份，之后它产生的每一次步数都会被记到该颜色与该昵称名下。
        </p>
        <p>
          <b>② 每次转动只前进自己的棋子</b>（线下多色棋盘上互不影响），
          转出的数字即前进步数，转到 <code>0</code> 本回合不前进。
        </p>
        <p>
          <b>③ 所有设备顶部固定显示四色实时步数与当前回合</b>，
          任何人产生新步数，其余设备会在瞬间同步刷新，不需要口头报数。
        </p>
        <p>
          <b>④ 记录专页留档。</b>颜色、昵称、数字、步数、时间逐条可查，
          并附带 χ² 卡方检验判断分布是否与理论一致。
        </p>
        <p>
          <b>⑤ 重置只清页面、不清数据。</b>每次「重置」都会先把当前对局完整备份到服务器
          <code>data/archive/</code>，可在记录页的「历史备份」里回看与导出 CSV。
        </p>
        <p class="tiny muted">
          数字由转动设备的 <code>crypto.getRandomValues()</code> 生成并采用拒绝采样消除取模偏差，
          服务端只记账、不参与随机 —— 详见主页面「公平性机制」。
        </p>
      </div>

      <div class="panel-card">
        <h2>玩家名单 <span class="en">Players</span></h2>
        <div v-if="roster.length" class="roster">
          <div
            v-for="p in roster"
            :key="p.id"
            class="roster-row"
            :class="{ 'is-me': p.id === store.state.identity?.id }"
            :style="{ '--c': COLOR_META[p.color].hex }"
          >
            <span class="rdot"></span>
            <div class="rname">
              {{ p.name }}
              <em>{{ COLOR_META[p.color].name }}色</em>
              <span v-if="p.id === store.state.identity?.id" class="tag-me">本机</span>
            </div>
            <div class="rmeta"><b>{{ p.steps }}</b> 步 · {{ p.spinCount }} 次</div>
          </div>
        </div>
        <p v-else class="hist-empty" style="padding: 10px 0">
          还没有玩家登记 · 请在上方选择颜色进入
        </p>
      </div>

      <div class="panel-card">
        <h2>四色步数总览 <span class="en">Board</span></h2>
        <div class="color-board">
          <div v-for="c in tiles" :key="c.key" class="cb-row" :style="{ '--c': c.hex }">
            <span class="cb-bead"></span>
            <div class="cb-main">
              <div class="cb-title">{{ c.name }}色 <em>口袋 {{ c.range }}</em></div>
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
      </div>

      <div class="panel-card">
        <h2>连线说明 <span class="en">Connect</span></h2>
        <p class="tiny">
          手机等其他设备请连接<b>同一个局域网</b>，在浏览器打开服务器启动时打印的
          <code>http://&lt;局域网IP&gt;:3000</code> 即可进入本页；
          需要跨网络时把 <code>3000</code> 端口做内网穿透。
        </p>
        <p class="tiny muted">
          顶部标识：<span class="conn" :class="{ off: !store.state.connected }"><i></i>
            {{ store.state.connected ? '已同步' : '连接中' }}</span>
          —— 显示「已同步」表示本机与服务器实时连通。
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.card-title {
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0.2em;
  color: var(--gold);
}
.identity {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 18px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--c, var(--gold));
  border-radius: 14px;
  padding: 20px 22px;
  background: linear-gradient(150deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.22));
}
.identity .bead {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: radial-gradient(circle at 33% 27%, rgba(255, 255, 255, 0.85), var(--c) 50%, rgba(0, 0, 0, 0.6));
  border: 2px solid rgba(216, 180, 90, 0.5);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.55), inset -2px -4px 8px rgba(0, 0, 0, 0.4);
}
.id-name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--cream);
}
.id-color {
  font-size: 12px;
  color: var(--cream-dim);
  letter-spacing: 0.1em;
  margin-top: 5px;
}
.id-steps {
  text-align: right;
  font-family: 'IBM Plex Mono', monospace;
}
.id-steps b {
  font-size: 34px;
  color: var(--gold-hi);
}
.id-steps span {
  font-size: 12px;
  color: var(--gold-dim);
  margin-left: 4px;
}

@media (max-width: 640px) {
  .card-title {
    font-size: 12.5px;
    letter-spacing: 0.1em;
  }
  .identity {
    gap: 11px;
    padding: 12px 12px;
    border-radius: 10px;
    border-left-width: 3px;
  }
  .identity .bead {
    width: 42px;
    height: 42px;
  }
  .id-name {
    font-size: 16px;
  }
  .id-color {
    font-size: 9.5px;
    margin-top: 3px;
  }
  .id-steps b {
    font-size: 24px;
  }
  .id-steps span {
    font-size: 9px;
  }
  .roster-row .rmeta {
    text-align: right;
  }
}
</style>
