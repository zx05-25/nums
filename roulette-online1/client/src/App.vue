<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import FairnessBar from '@/components/FairnessBar.vue';
import { useStore } from '@/store.js';

const store = useStore();
const barRef = ref(null);

/**
 * 顶部公平条固定悬浮，两端高度差异较大（手机端会折成两行），
 * 这里动态测量真实高度并写入 CSS 变量，避免正文被遮挡。
 */
let observer = null;

function syncHeight() {
  const el = barRef.value?.$el;
  if (!el) return;
  const h = Math.round(el.getBoundingClientRect().height);
  if (h > 0) document.documentElement.style.setProperty('--bar-h', `${h}px`);
}

onMounted(() => {
  syncHeight();
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(syncHeight);
    const el = barRef.value?.$el;
    if (el) observer.observe(el);
  }
  window.addEventListener('orientationchange', syncHeight, { passive: true });
});

onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('orientationchange', syncHeight);
});

// 玩家数量变化会影响牌面宽度与折行高度
watch(
  () => [store.state.game.players.length, store.state.connected],
  () => requestAnimationFrame(syncHeight),
);
</script>

<template>
  <FairnessBar ref="barRef" />
  <div class="frame"></div>

  <div class="wrap">
    <RouterView />

    <footer>
      ROULETTE · ONE ZERO · TWELVE TRIPLES · THIRTY-SEVEN POCKETS<br />
      <span class="en">
        entropy: crypto.getRandomValues · rejection sampling · no modulo bias ·
        multi-device sync
      </span>
    </footer>
  </div>

  <Transition name="fade">
    <div
      v-if="store.state.notice"
      class="toast"
      :class="store.state.notice.tone"
      role="status"
    >
      {{ store.state.notice.message }}
    </div>
  </Transition>
</template>
