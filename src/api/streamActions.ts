import { CONFIG } from '../config';
import { apiGet, apiPost } from './client';

export async function logStreamAction(action: 'start' | 'stop' | 'restart') {
  return apiPost<any>(`${CONFIG.API_BASE_URL}/stream-actions/log`, { action });
}

export async function getLastStreamAction() {
  return apiGet<any>(`${CONFIG.API_BASE_URL}/stream-actions/last`);
}
