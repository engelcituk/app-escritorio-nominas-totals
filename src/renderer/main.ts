import { createApp } from 'vue';
import { createPinia } from 'pinia';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './styles/app.scss';
import App from './App.vue';
import router from './router';
import { installPreviewApi } from './services/installPreviewApi';

installPreviewApi();
createApp(App).use(createPinia()).use(router).mount('#app');
