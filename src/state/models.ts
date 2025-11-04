export type Day = 'Monday'|'Tuesday'|'Wednesday'|'Thursday'|'Friday'|'Saturday'|'Sunday';

export const DAYS: Day[] = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

export type Asset = {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'unknown';
  url: string;
  // Backend-related fields (optional in V1)
  fileId?: string;
  mimeType?: string;
  size?: number;
  s3Key?: string;
  uploadedAt?: string; // ISO timestamp
  tags?: string[];
  vimeoReference?: string;
  durationSec?: number;
  categoryId?: string;
  normStatus?: string; // 'pending' | 'processing' | 'ready' | 'error'
};

export type Category = {
  id: string;
  name: string;
  color: string; // hex like #4CAF50
};

export type ScheduledItem = {
  id: string;
  assetId: string;
};
