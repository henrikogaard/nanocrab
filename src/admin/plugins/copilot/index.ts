import { AdminPlugin } from '../types.js';
import router from './routes.js';

const copilotPlugin: AdminPlugin = {
  id: 'copilot',
  name: 'GitHub Copilot',
  description:
    'GitHub Copilot coding agent — assign Copilot to issues, track PRs, multi-account OAuth',
  version: '1.0.0',
  sidebar: {
    id: 'copilot',
    icon: '\u2318', // ⌘
    label: 'Copilot',
  },
  router,
  pageId: 'copilot',
};

export default copilotPlugin;
