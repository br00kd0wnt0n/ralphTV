import axios from 'axios';
import { CONFIG } from '../config';

if (CONFIG.API_BASE_URL) {
  axios.defaults.baseURL = CONFIG.API_BASE_URL;
}

