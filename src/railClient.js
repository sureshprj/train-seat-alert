import axios from 'axios';
import { getSetting, setSetting } from './database';
import { toIndianRailDate } from './utils';

const BASE = 'https://www.indianrail.gov.in/enquiry';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const browserHeaders = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: `${BASE}/SEAT/SeatAvailability.html?locale=en`,
  Origin: 'https://www.indianrail.gov.in'
};

function base64FromArrayBuffer(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  let index = 0;

  while (index < bytes.length) {
    const a = bytes[index++];
    const b = index < bytes.length ? bytes[index++] : Number.NaN;
    const c = index < bytes.length ? bytes[index++] : Number.NaN;
    output += chars[a >> 2];
    output += chars[((a & 3) << 4) | (Number.isNaN(b) ? 0 : b >> 4)];
    output += Number.isNaN(b) ? '=' : chars[((b & 15) << 2) | (Number.isNaN(c) ? 0 : c >> 6)];
    output += Number.isNaN(c) ? '=' : chars[c & 63];
  }

  return output;
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(/,(?=\s*[^;,]+=)/);
}

async function getCookieMap() {
  const stored = await getSetting('rail_cookie_jar', '{}');
  try {
    return JSON.parse(stored) || {};
  } catch {
    return {};
  }
}

async function getCookieHeader() {
  const cookieMap = await getCookieMap();
  return Object.entries(cookieMap)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

async function persistSetCookies(setCookieHeader) {
  const setCookies = splitSetCookieHeader(setCookieHeader);
  if (!setCookies.length) return;

  const cookieMap = await getCookieMap();
  for (const rawCookie of setCookies) {
    const [pair] = String(rawCookie).split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name) cookieMap[name] = value;
  }
  await setSetting('rail_cookie_jar', JSON.stringify(cookieMap));
}

async function railRequest(config) {
  const cookieHeader = await getCookieHeader();
  const useStoredCookies = config.useStoredCookies !== false;
  const response = await axios({
    timeout: 20000,
    withCredentials: true,
    ...config,
    headers: {
      ...browserHeaders,
      ...(useStoredCookies && cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(config.headers || {})
    }
  });

  await persistSetCookies(response.headers?.['set-cookie'] || response.headers?.['Set-Cookie']);
  return response;
}

export async function getSessionStatus() {
  const lastUsed = await getSetting('rail_session_last_used', '');
  return {
    isActive: (await getSetting('rail_session_active', '0')) === '1',
    lastUsed
  };
}

async function markSessionActive(isActive) {
  await setSetting('rail_session_active', isActive ? '1' : '0');
  await setSetting('rail_session_last_used', new Date().toISOString());
}

export async function fetchCaptchaImage() {
  const response = await railRequest({
    method: 'GET',
    url: `${BASE}/captchaDraw.png?${Date.now()}`,
    responseType: 'arraybuffer',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
    }
  });

  await markSessionActive(false);
  return `data:image/png;base64,${base64FromArrayBuffer(response.data)}`;
}

async function fetchReferenceValues(type, options = {}) {
  const cacheKey = `rail_reference_${type}`;
  const stored = await getSetting(cacheKey, '');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed.values) && Date.now() - parsed.loadedAt < CACHE_MAX_AGE_MS) {
        return parsed.values;
      }
    } catch {
      // Ignore corrupt cache and refetch below.
    }
  }

  if (options.cacheOnly) return [];

  const endpoint = type === 'trains' ? 'FetchTrainData' : 'FetchAutoComplete';
  const response = await railRequest({
    method: 'GET',
    url: `${BASE}/${endpoint}`,
    headers: {
      Referer: `${BASE}/SEAT/SeatAvailability.html?locale=en`
    }
  });

  const values = Array.isArray(response.data) ? response.data : [];
  await setSetting(cacheKey, JSON.stringify({ values, loadedAt: Date.now() }));
  return values;
}

function normalizeSearchText(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function searchReferenceValues(values, query, parseValue, limit = 8) {
  const normalizedQuery = normalizeSearchText(query);
  const compactQuery = compactSearchText(query);
  if (normalizedQuery.length < 2 && compactQuery.length < 2) return [];

  const scored = [];
  for (const rawValue of values) {
    const label = String(rawValue || '').trim();
    if (!label) continue;

    const value = parseValue(label);
    const normalizedLabel = normalizeSearchText(label);
    const compactLabel = compactSearchText(label);
    const normalizedValue = normalizeSearchText(value);
    const compactValue = compactSearchText(value);

    let score = 0;
    if (compactValue === compactQuery) score = 100;
    else if (compactValue.startsWith(compactQuery)) score = 90;
    else if (normalizedLabel.startsWith(normalizedQuery)) score = 80;
    else if (normalizedLabel.includes(normalizedQuery)) score = 60;
    else if (compactLabel.includes(compactQuery)) score = 50;
    if (!score) continue;

    scored.push({ label, value, score });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map(({ label, value }) => ({ label, value }));
}

function trainNumberFromSelector(selector) {
  const match = String(selector || '').match(/\b\d{4,6}\b/);
  return match ? match[0] : String(selector || '').trim();
}

function stationCodeFromSelector(selector) {
  const text = String(selector || '').trim().toUpperCase();
  const trailingCode = text.match(/-\s*([A-Z0-9]{2,6})\s*$/);
  if (trailingCode) return trailingCode[1];

  const leadingCode = text.match(/^([A-Z0-9]{2,6})\s*-/);
  if (leadingCode) return leadingCode[1];

  return text;
}

export async function searchTrainSuggestions(query, limit = 8) {
  const trains = await fetchReferenceValues('trains');
  return searchReferenceValues(trains, query, trainNumberFromSelector, limit);
}

export async function searchStationSuggestions(query, limit = 8) {
  const stations = await fetchReferenceValues('stations');
  return searchReferenceValues(stations, query, stationCodeFromSelector, limit);
}

function resolveTrainSelector(input, trains) {
  const value = String(input || '').trim().toUpperCase();
  if (!value) return '';
  if (value.includes(' - ')) return input;
  const match = trains.find((train) => train.toUpperCase().startsWith(`${value} -`));
  return match || input;
}

function resolveStationSelector(input, stations) {
  const value = String(input || '').trim().toUpperCase();
  if (!value) return '';
  if (value.includes(' - ') && !/^[A-Z0-9]{2,6}\s*-\s*.+$/.test(value)) return input;

  const compactCodeNameMatch = value.match(/^([A-Z0-9]{2,6})\s*-\s*(.+)$/);
  if (compactCodeNameMatch) {
    const stationCode = compactCodeNameMatch[1];
    const codeMatch = stations.find((station) => station.toUpperCase().endsWith(` - ${stationCode}`));
    if (codeMatch) return codeMatch;
  }

  const exactCodeMatch = stations.find((station) => station.toUpperCase().endsWith(` - ${value}`));
  if (exactCodeMatch) return exactCodeMatch;

  const nameMatch = stations.find((station) => station.toUpperCase().startsWith(value));
  return nameMatch || input;
}

async function buildAvailabilityParams(row, inputCaptcha) {
  const [trains, stations] = await Promise.all([
    fetchReferenceValues('trains'),
    fetchReferenceValues('stations')
  ]);

  const params = new URLSearchParams({
    trainNo: resolveTrainSelector(row.train_no, trains),
    dt: toIndianRailDate(row.travel_date),
    sourceStation: resolveStationSelector(row.source_station, stations),
    destinationStation: resolveStationSelector(row.destination_station, stations),
    classc: row.class_code,
    quota: row.quota,
    inputPage: 'SEAT',
    language: 'en',
    _: String(Date.now())
  });

  if (inputCaptcha) params.set('inputCaptcha', inputCaptcha);
  return params;
}

function isCaptchaOrSessionError(err) {
  const status = err.response?.status;
  if (status === 401 || status === 403 || status === 419 || status === 428 || status === 440) return true;

  const detail = typeof err.response?.data === 'string'
    ? err.response.data
    : JSON.stringify(err.response?.data || '');
  return /captcha|session|invalid|expired/i.test(detail);
}

function responseIndicatesCaptchaOrSession(raw) {
  const detail = typeof raw === 'string' ? raw : JSON.stringify(raw || {});
  if (/valid train number/i.test(detail)) return false;
  if (/valid station/i.test(detail)) return false;
  return /captcha|session\s*(out|timed?\s*out|timeout|expired|invalid)|invalid\s+request|request\s+invalid|expired/i.test(detail);
}

export async function requestAvailability(row, options = {}) {
  const session = await getSessionStatus();
  if (!options.inputCaptcha && !session.isActive) {
    return { captchaRequired: true };
  }

  try {
    const params = await buildAvailabilityParams(row, options.inputCaptcha);
    const response = await railRequest({
      method: 'GET',
      url: `${BASE}/CommonCaptcha?${params.toString()}`,
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${BASE}/SEAT/SeatAvailability.html?locale=en`
      }
    });

    if (responseIndicatesCaptchaOrSession(response.data)) {
      await markSessionActive(false);
      return {
        captchaRequired: true,
        detail: response.data
      };
    }

    await markSessionActive(true);
    return { raw: response.data };
  } catch (err) {
    await markSessionActive(false);
    if (isCaptchaOrSessionError(err)) {
      return {
        captchaRequired: true,
        detail: err.response?.data || err.message
      };
    }
    throw err;
  }
}
