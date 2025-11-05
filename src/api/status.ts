import { CONFIG } from '../config';
import { apiGet } from './client';

export async function getStatusToday(channel: string, week: string) {
  return apiGet<any>(`${CONFIG.API_BASE_URL}/status/${encodeURIComponent(channel)}/${encodeURIComponent(week)}/today`);
}

