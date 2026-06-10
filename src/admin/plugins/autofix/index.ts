import { AdminPlugin } from '../types.js';
import router from './routes.js';

const autofixPlugin: AdminPlugin = {
  id: 'autofix',
  name: 'GitHub Autofix',
  description:
    'Autonomous coding agent — auto-fix issues, review PRs, triggered by GitHub webhooks or manually',
  version: '1.0.0',
  sidebar: {
    id: 'autofix',
    icon: '\u2692', // ⚒
    label: 'Autofix',
  },
  router,
  pageId: 'autofix',
};

export default autofixPlugin;
