import { AdminPlugin } from '../types.js';
import router from './routes.js';

const workflowsPlugin: AdminPlugin = {
  id: 'workflows',
  name: 'Workflows',
  description: 'Automation workflows with triggers, conditions, and actions',
  version: '1.0.0',
  sidebar: {
    id: 'workflows',
    icon: '\u2194', // ↔
    label: 'Workflows',
  },
  router,
  pageId: 'workflows',
};

export default workflowsPlugin;
