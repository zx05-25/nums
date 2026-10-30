import { createRouter, createWebHistory } from 'vue-router';
import HomeView from '@/views/HomeView.vue';
import store from '@/store.js';

const routes = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '选择颜色' } },
  {
    path: '/wheel',
    name: 'wheel',
    component: () => import('@/views/WheelView.vue'),
    meta: { title: '转动轮盘', requiresPlayer: true },
  },
  {
    path: '/log',
    name: 'log',
    component: () => import('@/views/LogView.vue'),
    meta: { title: '记录专页' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

/**
 * 未登记颜色的设备不能直接进轮盘页（公平性第一条：进入必须先选颜色），
 * 统一引导回登记页。带上 redirect 以便登记完成后自动返回。
 */
router.beforeEach((to) => {
  if (!to.meta?.requiresPlayer) return true;
  if (store.state.identity) return true;
  store.setNotice('请先选择棋子颜色并登记昵称', 'warn');
  return { name: 'home', query: { redirect: to.fullPath } };
});

router.afterEach((to) => {
  document.title = to.meta?.title
    ? `命运轮盘 · ${to.meta.title}`
    : '命运轮盘 · 四色棋子联机版';
});

export default router;
