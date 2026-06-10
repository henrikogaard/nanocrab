import { AdminPlugin } from '../types.js';
import router from './routes.js';

const wikiPlugin: AdminPlugin = {
  id: 'wiki',
  name: 'Wiki',
  description: 'Knowledge base with markdown pages — browse, edit, and search',
  version: '1.0.0',
  sidebar: null, // Wiki is accessed via Memory tab, not its own sidebar entry
  router,
  pageId: 'wiki',
};

export default wikiPlugin;
