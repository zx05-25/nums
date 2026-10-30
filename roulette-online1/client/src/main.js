import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import store from './store.js';
import './styles/fonts/fonts.css';
import './styles/global.css';

store.bootstrap();

createApp(App).use(router).mount('#app');
