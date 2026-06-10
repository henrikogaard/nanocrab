import { AdminPlugin } from '../types.js';
import router from './routes.js';

const chatPlugin: AdminPlugin = {
  id: 'chat',
  name: 'Dashboard Chat',
  description: 'Send messages to the bot directly from the dashboard',
  version: '1.0.0',
  sidebar: {
    id: 'chat',
    icon: '\u2767', // ❧
    label: 'Chat',
  },
  router,
  pageId: 'chat',
};

export default chatPlugin;
