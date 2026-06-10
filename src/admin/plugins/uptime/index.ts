import { AdminPlugin } from '../types.js';
import router, { startUptimeChecker } from './routes.js';

const uptimePlugin: AdminPlugin = {
  id: 'uptime',
  name: 'Uptime Monitor',
  description:
    'Health probes for websites and services — alerts via bot when down',
  version: '1.0.0',
  sidebar: {
    id: 'uptime',
    icon: '\u2261', // ≡
    label: 'Uptime',
  },
  router,
  pageId: 'uptime',
  onInit() {
    // Start checking monitors after a short delay
    setTimeout(startUptimeChecker, 3000);
  },
};

export default uptimePlugin;
