import { registerPlugin } from '@capacitor/core';

export interface SharedContent {
  hasContent: boolean;
  content: string;
  fileName: string;
  source: 'send_stream' | 'send_text' | 'view' | 'none';
}

interface ShareIntentPlugin {
  getSharedContent(): Promise<SharedContent>;
  clearIntent(): Promise<void>;
}

const ShareIntent = registerPlugin<ShareIntentPlugin>('ShareIntent');

export { ShareIntent };
