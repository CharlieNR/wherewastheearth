import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Globe from 'react-globe.gl';
import * as topojson from 'topojson-client';
import { EVENTS, GEOLOGIC_FACTS, PLATE_BOUNDARIES, PLATES, PERIODS } from './data';
import './styles.css';

const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const GPLATES_URL = 'https://gws.gplates.org/reconstruct/reconstruct_feature_collection';
const GPLATES_COASTLINES_URL = 'https://gws.gplates.org/reconstruct/coastlines/';
const GPLATES_COUNTRY_URL = 'https://gws.gplates.org/reconstruct/reconstruct_feature_collection';
const GPLATES_TEST_AGE = 100;

const DAY_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const BUMP_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
const STAR_TEXTURE = 'https://unpkg.com/three-globe/example/img/night-sky.png';

const CACHE_DB_NAME = 'intheglobe-keyframe-cache-v3';
const CACHE_STORE_NAME = 'keyframes';
const CACHE_MANIFEST_KEY = 'intheglobe-keyframe-manifest-v3';
const MAX_AGE = 1800;
const PLAYBACK_STEP = 5;
const KEYFRAME_STEP = 25;
const KEYFRAME_AGES = Array.from({ length: Math.floor(MAX_AGE / KEYFRAME_STEP) + 1 }, (_, index) => Math.min(index * KEYFRAME_STEP, MAX_AGE));
const PRELOAD_WORKERS = 2;
const FRAME_REQUEST_TIMEOUT_MS = 30000;
const FRAME_REQUEST_RETRIES = 3;
const PRIORITY_KEYFRAMES = 8;
const PRELOAD_START_DELAY_MS = 1200;
const PRELOAD_FAILURE_PAUSE_MS = 12000;



const MAX_DIAGNOSTIC_LINES = 2500;
let diagnosticSink = null;

function setDiagnosticSink(sink) {
  diagnosticSink = sink;
}

function diagnostic(level, scope, message, meta) {
  const time = new Date().toISOString().slice(11, 23);
  let suffix = '';
  if (meta !== undefined) {
    try {
      suffix = ' ' + JSON.stringify(meta);
    } catch {
      suffix = ' [unserializable details]';
    }
  }
  const line = time + ' ' + level.toUpperCase().padEnd(5) + ' [' + scope + '] ' + message + suffix;
  diagnosticSink?.(line);
  if (level === 'error') console.error('[intheglobe]', line);
  else if (level === 'warn') console.warn('[intheglobe]', line);
  else console.info('[intheglobe]', line);
}

function keyframeAgeFor(age) {
  return Math.min(MAX_AGE, Math.round(Number(age) / KEYFRAME_STEP) * KEYFRAME_STEP);
}

function frameKey(age) {
  return modelForAge(age) + ':' + String(Math.round(age));
}

function readFrameManifest() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CACHE_MANIFEST_KEY) || '{}');
    return new Set(Object.keys(value));
  } catch {
    return new Set();
  }
}

function writeFrameManifestEntry(key) {
  try {
    const current = JSON.parse(window.localStorage.getItem(CACHE_MANIFEST_KEY) || '{}');
    current[key] = 1;
    window.localStorage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(current));
  } catch {
    // localStorage can be unavailable or full; IndexedDB remains the durable frame store.
  }
}

let frameDbPromise = null;

function openFrameDb() {
  if (!('indexedDB' in window)) {
    diagnostic('warn', 'CACHE', 'IndexedDB is unavailable; persistent frame storage disabled');
    return Promise.resolve(null);
  }
  if (frameDbPromise) return frameDbPromise;
  diagnostic('info', 'CACHE', 'Opening IndexedDB cache', { db: CACHE_DB_NAME, store: CACHE_STORE_NAME });
  frameDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
        request.result.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => { diagnostic('info', 'CACHE', 'IndexedDB ready'); resolve(request.result); };
    request.onerror = () => {
      frameDbPromise = null;
      diagnostic('error', 'CACHE', 'IndexedDB open failed', { message: request.error?.message || String(request.error) });
      reject(request.error);
    };
  });
}


async function getStoredFrameKeys() {
  const db = await openFrameDb().catch(() => null);
  if (!db) return new Set();
  return new Promise((resolve) => {
    const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CACHE_STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result || []));
    request.onerror = () => resolve(new Set());
  });
}

async function getStoredFrame(age) {
  const key = frameKey(age);
  diagnostic('info', 'CACHE', 'Checking stored keyframe', { age, key });
  const db = await openFrameDb().catch((error) => { diagnostic('error', 'CACHE', 'IndexedDB read setup failed', { key, error: error?.message || String(error) }); return null; });
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CACHE_STORE_NAME).get(key);
    request.onsuccess = async () => {
      const record = request.result;
      if (!record) {
        diagnostic('info', 'CACHE', 'Keyframe miss', { key });
        resolve(null);
        return;
      }
      diagnostic('info', 'CACHE', 'Keyframe record found', { key, encoding: record.encoding, bytes: typeof record.data === 'string' ? record.data.length : record.data?.byteLength || 0 });
      try {
        if (record.encoding === 'gzip' && typeof DecompressionStream === 'function') {
          const stream = new Blob([record.data]).stream().pipeThrough(new DecompressionStream('gzip'));
          const json = await new Response(stream).text();
          resolve(JSON.parse(json));
          return;
        }
        resolve(typeof record.data === 'string' ? JSON.parse(record.data) : null);
      } catch (error) {
        console.warn('Could not decode cached reconstruction frame ' + key, error);
        resolve(null);
      }
    };
    request.onerror = () => {
      diagnostic('warn', 'CACHE', 'IndexedDB key lookup failed', { key });
      resolve(null);
    };
  });
}

async function putStoredFrame(age, features) {
  const key = frameKey(age);
  diagnostic('info', 'CACHE', 'Persisting keyframe', { age, key, features: features.length });
  const compactFeatures = features.map((feature) => ({
    type: 'Feature',
    properties: {},
    geometry: feature.geometry,
  }));
  const json = JSON.stringify(compactFeatures);
  let encoding = 'json';
  let data = json;

  if (typeof CompressionStream === 'function') {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      data = await new Response(stream).arrayBuffer();
      encoding = 'gzip';
    } catch {
      encoding = 'json';
      data = json;
    }
  }

  const db = await openFrameDb().catch(() => null);
  if (db) {
    await new Promise((resolve) => {
      const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
      transaction.objectStore(CACHE_STORE_NAME).put({ key, age, model: modelForAge(age), encoding, data, savedAt: Date.now() });
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
    writeFrameManifestEntry(key);
    diagnostic('info', 'CACHE', 'Keyframe persisted', { key, compressed: encoding === 'gzip' });
  } else {
    diagnostic('warn', 'CACHE', 'Keyframe could not be persisted because IndexedDB is unavailable', { key });
  }
  return compactFeatures;
}


async function clearStoredFrames() {
  diagnostic('warn', 'CACHE', 'Clearing all stored keyframes');
  try {
    const db = await openFrameDb().catch(() => null);
    if (db) {
      await new Promise((resolve) => {
        const transaction = db.transaction(CACHE_STORE_NAME, 'readwrite');
        transaction.objectStore(CACHE_STORE_NAME).clear();
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
      });
    }
  } finally {
    try { window.localStorage.removeItem(CACHE_MANIFEST_KEY); } catch {}
  }
}


function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const started = performance.now();
  const timeout = window.setTimeout(() => {
    diagnostic('warn', 'NET', 'Request timeout fired', { timeoutMs: FRAME_REQUEST_TIMEOUT_MS, url });
    controller.abort();
  }, FRAME_REQUEST_TIMEOUT_MS);
  let abortHandler;

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      abortHandler = () => {
        diagnostic('info', 'NET', 'Request cancelled by app priority handoff', { url });
        controller.abort();
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }
  }

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    diagnostic('info', 'NET', 'HTTP response received', { status: response.status, type: response.type, ms: Math.round(performance.now() - started), url });
    return response;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      const timeoutError = new Error('Frame request timed out after ' + Math.round(FRAME_REQUEST_TIMEOUT_MS / 1000) + ' seconds');
      timeoutError.name = 'TimeoutError';
      diagnostic('error', 'NET', 'Request timed out', { ms: Math.round(performance.now() - started), url });
      throw timeoutError;
    }
    diagnostic('error', 'NET', 'Network request failed', { ms: Math.round(performance.now() - started), name: error?.name, message: error?.message, url });
    throw error;
  } finally {
    window.clearTimeout(timeout);
    if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);
  }
}

async function fetchReconstructionWithRetry(age, signal) {
  let lastError;
  for (let attempt = 1; attempt <= FRAME_REQUEST_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    diagnostic('info', 'FRAME', 'Attempt ' + attempt + '/' + FRAME_REQUEST_RETRIES, { age, model: modelForAge(age), source: 'coastlines' });
    try {
      return await fetchReconstructionFrame(age, signal);
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' && signal?.aborted) throw error;
      diagnostic('warn', 'FRAME', 'Attempt failed', { age, attempt, name: error?.name, message: error?.message });
      if (attempt < FRAME_REQUEST_RETRIES) await sleep(250 * attempt);
    }
  }
  throw lastError || new Error('Frame request failed');
}

async function fetchReconstructionFrame(age, signal) {
  const started = performance.now();
  const model = modelForAge(age);
  const url = new URL(GPLATES_COASTLINES_URL);
  url.searchParams.set('time', String(age));
  url.searchParams.set('model', model);
  url.searchParams.set('anchor_plate_id', '0');
  url.searchParams.set('wrap', 'true');

  diagnostic('info', 'FRAME', 'REQUEST start', {
    age,
    model,
    method: 'GET',
    source: 'coastlines',
    endpoint: GPLATES_COASTLINES_URL,
  });

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/geo+json, application/json;q=0.9, text/plain;q=0.8' },
    signal,
  });

  const responseText = await response.text();
  diagnostic(response.ok ? 'info' : 'error', 'FRAME', 'Response body received', {
    age,
    model,
    status: response.status,
    bytes: responseText.length,
    ms: Math.round(performance.now() - started),
    preview: response.ok ? undefined : responseText.slice(0, 700),
  });

  if (!response.ok) {
    throw new Error('GPlates coastline HTTP ' + response.status + ': ' + responseText.slice(0, 300));
  }

  let reconstructed;
  try {
    reconstructed = JSON.parse(responseText);
  } catch (error) {
    diagnostic('error', 'FRAME', 'Coastline response was not valid JSON', { age, model, message: error?.message });
    throw new Error('GPlates coastline endpoint returned invalid JSON');
  }

  const features = flattenFeatures(reconstructed)
    .filter((feature) => feature.geometry)
    .map((feature) => ({
      type: 'Feature',
      properties: feature.properties || {},
      geometry: feature.geometry,
    }));

  diagnostic('info', 'FRAME', 'REQUEST complete', {
    age,
    model,
    source: 'coastlines',
    features: features.length,
    ms: Math.round(performance.now() - started),
  });

  if (!features.length) throw new Error('No reconstructed coastline geometry returned');
  return features;
}

async function testGplatesConnectivity() {
  const started = performance.now();
  const url = new URL(GPLATES_COASTLINES_URL);
  url.searchParams.set('time', String(GPLATES_TEST_AGE));
  url.searchParams.set('model', 'MULLER2022');
  url.searchParams.set('anchor_plate_id', '0');
  url.searchParams.set('extent', '-10,10,-10,10');
  diagnostic('info', 'TEST', 'GPlates connectivity test started', {
    method: 'GET',
    endpoint: GPLATES_COASTLINES_URL,
    testAge: GPLATES_TEST_AGE,
    model: 'MULLER2022',
  });

  try {
    const response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/geo+json, application/json;q=0.9, text/plain;q=0.8' },
    });
    const body = await response.text();
    const ms = Math.round(performance.now() - started);

    let featureCount = 0;
    try {
      featureCount = flattenFeatures(JSON.parse(body)).filter((feature) => feature.geometry).length;
    } catch {
      // The status/response body diagnostics below are still useful when parsing fails.
    }

    diagnostic(response.ok ? 'info' : 'error', 'TEST', response.ok ? 'GPlates connectivity test PASSED' : 'GPlates connectivity test returned an HTTP error', {
      status: response.status,
      ok: response.ok,
      ms,
      bytes: body.length,
      featureCount,
      cors: 'browser fetch completed',
      preview: response.ok ? undefined : body.slice(0, 500),
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    return {
      ok: true,
      status: response.status,
      ms,
      bytes: body.length,
      featureCount,
    };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    diagnostic('error', 'TEST', 'GPlates connectivity test FAILED', {
      ms,
      name: error?.name,
      message: error?.message,
      hint: error?.name === 'TypeError'
        ? 'The browser could not complete the cross-origin GET. This usually indicates connectivity or a CORS/network restriction.'
        : undefined,
    });
    return { ok: false, ms, name: error?.name, message: error?.message };
  }
}


function modelForAge(age) {
  if (age <= 410) return 'MULLER2022';
  if (age <= 1000) return 'MERDITH2021';
  return 'CAO2024';
}

function countryKey(country) {
  return String(country?.id || country?.properties?.name || 'unknown');
}

function countryCacheKey(country, age) {
  return 'country:' + countryKey(country) + ':' + modelForAge(age) + ':' + String(Math.round(age));
}

function featureCentroid(feature) {
  const points = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      points.push(value);
      return;
    }
    value.forEach(collect);
  };
  collect(feature?.geometry?.coordinates);
  if (!points.length) return { lat: 0, lng: 0 };
  const lng = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const lat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return { lat, lng };
}

async function fetchCountryReconstructionWithRetry(country, age, signal) {
  let lastError;
  for (let attempt = 1; attempt <= FRAME_REQUEST_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    diagnostic('info', 'COUNTRY', 'Tracking reconstruction attempt ' + attempt + '/' + FRAME_REQUEST_RETRIES, {
      country: country?.properties?.name,
      id: countryKey(country),
      age,
      model: modelForAge(age),
    });
    try {
      const featureCollection = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          id: country?.id,
          properties: { name: country?.properties?.name || countryKey(country) },
          geometry: country.geometry,
        }],
      };
      const payload = new URLSearchParams();
      payload.set('feature_collection', JSON.stringify(featureCollection));
      payload.set('time', String(age));
      payload.set('model', modelForAge(age));
      payload.set('anchor_plate_id', '0');

      diagnostic('info', 'COUNTRY', 'Tracking request start', {
        country: country?.properties?.name,
        age,
        payloadBytes: payload.toString().length,
      });

      const response = await fetchWithTimeout(GPLATES_COUNTRY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: 'application/geo+json, application/json;q=0.9',
        },
        body: payload,
        signal,
      });
      const textBody = await response.text();
      diagnostic(response.ok ? 'info' : 'error', 'COUNTRY', 'Tracking response received', {
        country: country?.properties?.name,
        age,
        status: response.status,
        bytes: textBody.length,
      });
      if (!response.ok) throw new Error('GPlates country HTTP ' + response.status + ': ' + textBody.slice(0, 250));

      const reconstructed = JSON.parse(textBody);
      const features = flattenFeatures(reconstructed)
        .filter((feature) => feature.geometry)
        .map((feature) => ({
          type: 'Feature',
          properties: { trackedCountry: country?.properties?.name || countryKey(country) },
          geometry: feature.geometry,
          __layer: 'tracked',
        }));

      if (!features.length) throw new Error('No reconstructed country geometry returned');
      diagnostic('info', 'COUNTRY', 'Tracking reconstruction complete', {
        country: country?.properties?.name,
        age,
        features: features.length,
      });
      return features;
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' && signal?.aborted) throw error;
      diagnostic('warn', 'COUNTRY', 'Tracking attempt failed', {
        country: country?.properties?.name,
        age,
        attempt,
        name: error?.name,
        message: error?.message,
      });
      if (attempt < FRAME_REQUEST_RETRIES) await sleep(250 * attempt);
    }
  }
  throw lastError || new Error('Country tracking request failed');
}

function ageLabel(age) {
  if (age < 0.05) return 'Present day';
  if (age < 1000) return age.toFixed(age < 10 ? 1 : 0) + ' million years ago';
  return (age / 1000).toFixed(age < 10000 ? 1 : 0) + ' billion years ago';
}

function shortAge(age) {
  if (age < 0.05) return 'NOW';
  if (age < 1000) return Math.round(age) + ' Ma';
  return (age / 1000).toFixed(1) + ' Ga';
}

function nearestPeriod(age) {
  return PERIODS.reduce((closest, period) =>
    Math.abs(period.ma - age) < Math.abs(closest.ma - age) ? period : closest
  );
}

function flattenFeatures(collection) {
  if (!collection) return [];
  if (collection.type === 'FeatureCollection') return collection.features || [];
  if (collection.type === 'Feature') return [collection];
  return [];
}

function geometryToPaths(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') return geometry.type === 'LineString' ? [geometry.coordinates || []] : geometry.coordinates || [];
  return [];
}

function meshToPaths(mesh) {
  return geometryToPaths(mesh)
    .filter((points) => points.length > 1)
    .map((points) => ({ kind: 'country', points }));
}

function App() {
  const globeRef = useRef(null);
  const stageRef = useRef(null);
  const requestRef = useRef(0);
  const [age, setAge] = useState(0);
  const [direction, setDirection] = useState('Start exploring');
  const [land, setLand] = useState([]);
  const [baseLand, setBaseLand] = useState(null);
  const [countries, setCountries] = useState([]);
  const [countryBoundaries, setCountryBoundaries] = useState([]);
  const [countrySearch, setCountrySearch] = useState('');
  const [trackedCountry, setTrackedCountry] = useState(null);
  const [trackedCountryLand, setTrackedCountryLand] = useState([]);
  const [status, setStatus] = useState('loading');
  const [statusText, setStatusText] = useState('Preparing Earth…');
  const [selected, setSelected] = useState({
    kind: 'welcome',
    title: 'Meet the changing Earth',
    summary: 'Drag the Earth, zoom in, then move through geological time. Every position is a reconstruction rather than a modern map placed on a globe.',
    body: 'Start with Present day, then move the timeline slowly backward. Watch the continents separate, converge, and reorganise around the planet.',
  });
  const [search, setSearch] = useState('');
  const [plateMode, setPlateMode] = useState(false);
  const [eventMode, setEventMode] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cacheProgress, setCacheProgress] = useState({ cached: 0, total: KEYFRAME_AGES.length });
  const frameCacheRef = useRef(new Map());
  const preloadControllersRef = useRef(new Set());
  const playbackPreloadControllerRef = useRef(null);
  const trackedCountryCacheRef = useRef(new Map());
  const trackedCountryRequestRef = useRef(0);
  const foregroundRequestRef = useRef(0);
  const foregroundLoadingRef = useRef(false);
  const cacheGenerationRef = useRef(0);
  const [cacheGeneration, setCacheGeneration] = useState(0);
  const [isResettingCache, setIsResettingCache] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const terminalBodyRef = useRef(null);
  const [diagnosticLines, setDiagnosticLines] = useState([
    '--- intheglobe diagnostics boot ---',
    'INFO  [SYSTEM] Terminal ready. Detailed runtime logging is enabled.',
  ]);
  const [gplatesTestState, setGplatesTestState] = useState('idle');
  const [reducedMotion, setReducedMotion] = useState(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    setDiagnosticSink((line) => {
      setDiagnosticLines((previous) => [...previous, line].slice(-MAX_DIAGNOSTIC_LINES));
    });
    diagnostic('info', 'SYSTEM', 'Diagnostic terminal connected');
    return () => setDiagnosticSink(null);
  }, []);

  useEffect(() => {
    if (!terminalOpen) return;
    const element = terminalBodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [diagnosticLines, terminalOpen]);

  useEffect(() => {
    const onError = (event) => diagnostic('error', 'WINDOW', 'Unhandled browser error', { message: event.error?.message || event.message, source: event.filename, line: event.lineno, column: event.colno });
    const onRejection = (event) => diagnostic('error', 'WINDOW', 'Unhandled promise rejection', { reason: event.reason?.message || String(event.reason) });
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const period = useMemo(() => nearestPeriod(age), [age]);
  const keyframeAge = useMemo(() => keyframeAgeFor(age), [age]);
  const visibleEvents = useMemo(() => EVENTS.filter((event) => Math.abs(event.ma - age) < 95), [age]);
  const globePaths = useMemo(() => [
    ...countryBoundaries.map((path) => ({ ...path, age })),
    ...(plateMode ? PLATE_BOUNDARIES.map((path) => ({ kind: 'plate', ...path })) : []),
  ], [age, countryBoundaries, plateMode]);

  const countryResults = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return [];
    return countries
      .filter((country) => (country.properties?.name || '').toLowerCase().includes(query))
      .slice(0, 8);
  }, [countrySearch, countries]);

  const globePolygons = useMemo(() => [
    ...land.map((feature) => ({ ...feature, __layer: 'land' })),
    ...trackedCountryLand.map((feature) => ({ ...feature, __layer: 'tracked' })),
  ], [land, trackedCountryLand]);

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    const periodResults = PERIODS.filter((item) => (item.label + ' ' + item.era).toLowerCase().includes(query)).slice(0, 4).map((item) => ({ type: 'period', ...item }));
    const eventResults = EVENTS.filter((item) => (item.name + ' ' + item.tag + ' ' + item.summary).toLowerCase().includes(query)).slice(0, 4).map((item) => ({ type: 'event', ...item }));
    const plateResults = PLATES.filter((item) => (item.name + ' ' + item.code + ' ' + item.summary).toLowerCase().includes(query)).slice(0, 4).map((item) => ({ type: 'plate', ...item }));
    return [...periodResults, ...eventResults, ...plateResults].slice(0, 8);
  }, [search]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onChange = (event) => setReducedMotion(event.matches);
    media?.addEventListener?.('change', onChange);
    return () => media?.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setStatus('loading');
        diagnostic('info', 'WORLD', 'Loading world atlas', { url: WORLD_URL });
        setStatusText('Loading the land surface…');
        const response = await fetch(WORLD_URL);
        if (!response.ok) throw new Error('World data unavailable');
        const topology = await response.json();
        const feature = topojson.feature(topology, topology.objects.land);
        const countryFeatures = topology.objects.countries
          ? flattenFeatures(topojson.feature(topology, topology.objects.countries))
          : [];
        const countryMesh = topology.objects.countries
          ? topojson.mesh(topology, topology.objects.countries, (a, b) => a !== b)
          : null;
        if (cancelled) return;
        setBaseLand(feature);
        setLand(flattenFeatures(feature));
        setCountries(countryFeatures);
        const boundaries = meshToPaths(countryMesh);
        setCountryBoundaries(boundaries);
        diagnostic('info', 'WORLD', 'World atlas loaded', {
          geometryType: flattenFeatures(feature)[0]?.geometry?.type,
          featureCount: flattenFeatures(feature).length,
          countryFeatureCount: countryFeatures.length,
          countryBoundaryPathCount: boundaries.length,
        });
        setStatus('ready');
        setStatusText('Ready to explore');
      } catch (error) {
        diagnostic('error', 'WORLD', 'World atlas load failed', { name: error?.name, message: error?.message });
        setStatus('error');
        setStatusText('Earth data could not be loaded');
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!baseLand) return;
    let cancelled = false;
    const generation = cacheGenerationRef.current;

    const warm = async () => {
      const health = await testGplatesConnectivity();
      if (!health.ok) {
        if (!cancelled && generation === cacheGenerationRef.current) {
          setStatus('warning');
          setStatusText('GPlates connection unavailable · Present day remains available');
          diagnostic('warn', 'CACHE', 'Background preload not started because GPlates health check failed', {
            retryAfterMs: PRELOAD_FAILURE_PAUSE_MS,
          });
        }
        return;
      }

      if (!cancelled && generation === cacheGenerationRef.current) {
        setStatus('ready');
        setStatusText('GPlates connected · building keyframe cache');
      }

      diagnostic('info', 'CACHE', 'Background keyframe preload started', {
        total: KEYFRAME_AGES.length,
        workers: PRELOAD_WORKERS,
        startDelayMs: PRELOAD_START_DELAY_MS,
        strategy: 'two-worker throttled coastline requests',
      });
      const storedKeys = await getStoredFrameKeys();
      let cached = KEYFRAME_AGES.filter((frameAge) => storedKeys.has(frameKey(frameAge))).length;
      setCacheProgress({ cached, total: KEYFRAME_AGES.length });
      diagnostic('info', 'CACHE', 'Cache inventory checked', { cached, total: KEYFRAME_AGES.length, missing: KEYFRAME_AGES.length - cached });

      const missing = KEYFRAME_AGES.filter((frameAge) => !storedKeys.has(frameKey(frameAge)));
      let cursor = 0;
      let consecutiveFailures = 0;
      const retryQueue = [];
      const retryCounts = new Map();
      const ordered = [...missing].sort((a, b) => {
        const aPriority = a <= PRIORITY_KEYFRAMES * KEYFRAME_STEP ? 0 : 1;
        const bPriority = b <= PRIORITY_KEYFRAMES * KEYFRAME_STEP ? 0 : 1;
        return aPriority - bPriority || a - b;
      });

      const worker = async () => {
        while (!cancelled && generation === cacheGenerationRef.current) {
          if (consecutiveFailures >= PRELOAD_WORKERS) {
            diagnostic('warn', 'CACHE', 'Background preload paused after repeated network failures', { pauseMs: PRELOAD_FAILURE_PAUSE_MS, consecutiveFailures });
            await sleep(PRELOAD_FAILURE_PAUSE_MS);
            consecutiveFailures = 0;
          }
          let frameAge = retryQueue.shift();
          if (frameAge === undefined) {
            frameAge = ordered[cursor++];
          }
          if (frameAge === undefined) return;

          while (!cancelled && generation === cacheGenerationRef.current && foregroundLoadingRef.current) {
            await sleep(40);
          }
          if (cancelled || generation !== cacheGenerationRef.current) return;

          const key = frameKey(frameAge);
          const preloadController = new AbortController();
          preloadControllersRef.current.add(preloadController);

          try {
            let features = frameCacheRef.current.get(key);
            if (!features) features = await getStoredFrame(frameAge);

            if (!features) {
              features = await fetchReconstructionWithRetry(frameAge, preloadController.signal);
              if (cancelled || generation !== cacheGenerationRef.current) return;
              await putStoredFrame(frameAge, features);
            }

            if (cancelled || generation !== cacheGenerationRef.current) return;
            frameCacheRef.current.set(key, features);
            consecutiveFailures = 0;
            cached += 1;
            diagnostic('info', 'CACHE', 'Background keyframe ready', { age: frameAge, progress: cached + '/' + KEYFRAME_AGES.length });
            setCacheProgress({ cached: Math.min(cached, KEYFRAME_AGES.length), total: KEYFRAME_AGES.length });
          } catch (error) {
            if (!cancelled && generation === cacheGenerationRef.current) {
              if (error?.name !== 'AbortError') consecutiveFailures += 1;
              const attempts = (retryCounts.get(frameAge) || 0) + 1;
              retryCounts.set(frameAge, attempts);
              if (attempts <= FRAME_REQUEST_RETRIES) {
                retryQueue.push(frameAge);
              } else {
                diagnostic('error', 'CACHE', 'Skipping keyframe after retries', { age: frameAge, attempts, message: error?.message });
              }
            }
          } finally {
            preloadControllersRef.current.delete(preloadController);
          }
        }
      };

      await Promise.all(Array.from({ length: PRELOAD_WORKERS }, () => worker()));
    };

    // Start immediately; the app no longer waits for an idle callback.
    const start = window.setTimeout(() => warm(), PRELOAD_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [baseLand, cacheGeneration]);

  useEffect(() => {
    if (!baseLand || status === 'error') return;
    const currentRequest = ++requestRef.current;
    const controller = new AbortController();
    const targetAge = keyframeAge; 
    const delay = isPlaying ? 0 : reducedMotion ? 20 : 0;

    const timer = window.setTimeout(async () => {
      diagnostic('info', 'UI', 'Foreground keyframe requested', { age, keyframeAge: targetAge, playing: isPlaying });
      foregroundLoadingRef.current = true;
      const foregroundRequestId = ++foregroundRequestRef.current;
      for (const controller of preloadControllersRef.current) controller.abort();
      preloadControllersRef.current.clear();

      if (age < 0.05) {
        frameCacheRef.current.set(frameKey(0), flattenFeatures(baseLand));
        setLand(flattenFeatures(baseLand));
        setStatus('ready');
        setStatusText('Present day reference · local frame · cache resumed');
        if (foregroundRequestRef.current === foregroundRequestId) foregroundLoadingRef.current = false;
        return;
      }

      const key = frameKey(targetAge);
      try {
        setStatus('loading');
        setStatusText('Loading ' + shortAge(targetAge) + ' keyframe…');

        let features = frameCacheRef.current.get(key);
        if (!features) {
          features = await getStoredFrame(targetAge);
          if (features) {
            frameCacheRef.current.set(key, features);
            diagnostic('info', 'CACHE', 'Foreground keyframe cache hit', { age: targetAge });
          }
        }

        if (!features) {
          const cachedEntries = Array.from(frameCacheRef.current.entries())
            .map(([cacheKey, cachedFeatures]) => ({ age: Number(String(cacheKey).split(':').at(-1)), features: cachedFeatures }))
            .filter((entry) => Number.isFinite(entry.age) && entry.features?.length);
          const nearestCached = cachedEntries.length
            ? cachedEntries.reduce((nearest, entry) => Math.abs(entry.age - targetAge) < Math.abs(nearest.age - targetAge) ? entry : nearest, cachedEntries[0])
            : null;
          if (nearestCached) {
            setLand(nearestCached.features);
            diagnostic('info', 'FRAME', 'Nearest cached geometry shown while target loads', { targetAge, fallbackAge: nearestCached.age });
          }
          setStatusText('Loading ' + shortAge(targetAge) + ' reconstruction…');
          features = await fetchReconstructionWithRetry(targetAge, controller.signal);
          if (currentRequest !== requestRef.current) return;
          frameCacheRef.current.set(key, features);
          await putStoredFrame(targetAge, features);
        }

        if (currentRequest !== requestRef.current) return;
        setLand(features);
        setStatus('ready');
        setStatusText(shortAge(targetAge) + ' keyframe · cache resumed');
      } catch (error) {
        if (currentRequest !== requestRef.current || error?.name === 'AbortError') return;
        console.warn('Reconstruction unavailable after retries; keeping last valid geometry.', error);
        setStatus('warning');
        setStatusText(shortAge(targetAge) + ' keyframe could not be loaded — retry by scrubbing again');
      } finally {
        if (foregroundRequestRef.current === foregroundRequestId) {
          foregroundLoadingRef.current = false;
        }
      }
    }, delay);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyframeAge, baseLand, isPlaying, reducedMotion]);

  useEffect(() => {
    trackedCountryRequestRef.current += 1;
    const requestId = trackedCountryRequestRef.current;
    const controller = new AbortController();

    if (!trackedCountry) {
      setTrackedCountryLand([]);
      return () => controller.abort();
    }

    const targetAge = keyframeAge;
    const name = trackedCountry.properties?.name || countryKey(trackedCountry);
    diagnostic('info', 'COUNTRY', 'Tracking country selected', {
      country: name,
      id: countryKey(trackedCountry),
      age,
      keyframe: targetAge,
    });

    const load = async () => {
      try {
        if (age < 0.1) {
          setTrackedCountryLand([{
            ...trackedCountry,
            properties: { ...(trackedCountry.properties || {}), trackedCountry: name },
            __layer: 'tracked',
          }]);
          diagnostic('info', 'COUNTRY', 'Using exact present-day country geometry', { country: name });
          return;
        }

        const cacheKey = countryCacheKey(trackedCountry, targetAge);
        let features = trackedCountryCacheRef.current.get(cacheKey);

        if (!features) {
          const cached = await getStoredFrame(cacheKey);
          if (cached?.length) features = cached;
        }

        if (!features) {
          features = await fetchCountryReconstructionWithRetry(trackedCountry, targetAge, controller.signal);
          if (controller.signal.aborted || requestId !== trackedCountryRequestRef.current) return;
          trackedCountryCacheRef.current.set(cacheKey, features);
        }

        if (requestId !== trackedCountryRequestRef.current) return;
        trackedCountryCacheRef.current.set(cacheKey, features);
        setTrackedCountryLand(features);
        diagnostic('info', 'COUNTRY', 'Tracked country geometry displayed', {
          country: name,
          age: targetAge,
          features: features.length,
        });
      } catch (error) {
        if (requestId !== trackedCountryRequestRef.current || error?.name === 'AbortError') return;
        diagnostic('warn', 'COUNTRY', 'Tracked country reconstruction unavailable; keeping last geometry', {
          country: name,
          age: targetAge,
          message: error?.message,
        });
      }
    };

    load();
    return () => controller.abort();
  }, [trackedCountry, keyframeAge, age]);

  useEffect(() => {
    if (!globeRef.current) return;
    const controls = globeRef.current.controls();
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.38;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 155;
    controls.maxDistance = 340;
    controls.enablePan = false;
  }, [autoRotate]);

  useEffect(() => {
    if (!isPlaying) return;

    const startAge = age;
    if (startAge <= 0) {
      setIsPlaying(false);
      setDirection('Present day');
      return;
    }

    playbackPreloadControllerRef.current?.abort();
    const controller = new AbortController();
    playbackPreloadControllerRef.current = controller;

    const upcoming = KEYFRAME_AGES
      .filter((frameAge) => frameAge < keyframeAge && frameAge >= 0)
      .sort((a, b) => b - a)
      .slice(0, 10);

    (async () => {
      diagnostic('info', 'PLAY', 'Forward playback preload started', {
        fromAge: startAge,
        direction: 'toward present',
        keyframes: upcoming,
      });

      for (const frameAge of upcoming) {
        if (controller.signal.aborted) return;
        const key = frameKey(frameAge);
        let features = frameCacheRef.current.get(key);
        if (!features) features = await getStoredFrame(frameAge);

        if (!features) {
          try {
            features = await fetchReconstructionWithRetry(frameAge, controller.signal);
            if (controller.signal.aborted) return;
            await putStoredFrame(frameAge, features);
          } catch (error) {
            if (error?.name === 'AbortError') return;
            diagnostic('warn', 'PLAY', 'Playback prefetch failed', { age: frameAge, message: error?.message });
            continue;
          }
        }

        frameCacheRef.current.set(key, features);
        diagnostic('info', 'PLAY', 'Playback frame ready', { age: frameAge });
      }
    })();

    const interval = window.setInterval(() => {
      setAge((previous) => {
        const next = Math.max(0, previous - PLAYBACK_STEP);
        setDirection(next < previous ? 'Toward the present' : 'Present day');
        if (next <= 0) setIsPlaying(false);
        return next;
      });
    }, reducedMotion ? 320 : 180);

    return () => {
      window.clearInterval(interval);
      controller.abort();
      if (playbackPreloadControllerRef.current === controller) playbackPreloadControllerRef.current = null;
    };
  }, [isPlaying, reducedMotion]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }, [reducedMotion]);

  const resetFrames = async () => {
    if (isResettingCache) return;
    diagnostic('warn', 'UI', 'User requested cache reset');
    setIsResettingCache(true);
    setIsPlaying(false);
    cacheGenerationRef.current += 1;
    setCacheProgress({ cached: 1, total: KEYFRAME_AGES.length });
    frameCacheRef.current.clear();
    for (const controller of preloadControllersRef.current) controller.abort();
    preloadControllersRef.current.clear();

    try {
      await clearStoredFrames();
      setStatus('loading');
      setStatusText('Keyframe cache reset · rebuilding in the background…');
    } finally {
      setIsResettingCache(false);
      setCacheGeneration((value) => value + 1);
      setLand(flattenFeatures(baseLand));
      setTrackedCountryLand(trackedCountry ? [{
        ...trackedCountry,
        properties: { ...(trackedCountry.properties || {}), trackedCountry: trackedCountry.properties?.name || countryKey(trackedCountry) },
        __layer: 'tracked',
      }] : []);
      setAge(0);
    }
  };

  const focus = (lat, lng, altitude = 1.7) => {
    globeRef.current?.pointOfView({ lat, lng, altitude }, reducedMotion ? 0 : 850);
  };

  const selectResult = (result) => {
    setSearch('');
    if (result.type === 'period') {
      setDirection(result.ma > age ? 'Into the past' : 'Toward the present');
      setAge(result.ma);
      setSelected({ kind: 'period', title: result.label, kicker: result.era + ' · ' + shortAge(result.ma), summary: result.description, body: 'Geological time is measured in millions of years before present. Use this point as a visual anchor, then move a little earlier or later to watch the surrounding reconstruction change.' });
      return;
    }
    if (result.type === 'event') {
      setDirection(result.ma > age ? 'Into the past' : 'Toward the present');
      setAge(result.ma);
      focus(result.lat, result.lng, 1.8);
      setSelected({ kind: 'event', title: result.name, kicker: result.tag + ' · ' + shortAge(result.ma), summary: result.summary, body: 'The marker is a navigation aid, not a claim that the event occurred at one exact point. Geological reconstructions are model-dependent and increasingly approximate further back in time.' });
      return;
    }
    setSelected({ kind: 'plate', title: result.name, kicker: 'Tectonic plate · ' + result.code, summary: result.summary, body: 'Plate boundaries are shown as a simplified educational overlay. The network is designed to be readable rather than a complete GIS dataset.' });
    focus(result.lat, result.lng, 1.65);
    setPlateMode(true);
  };

  const jumpToEvent = (event) => {
    setDirection(event.ma > age ? 'Into the past' : 'Toward the present');
    setAge(event.ma);
    focus(event.lat, event.lng, 1.75);
    setSelected({ kind: 'event', title: event.name, kicker: event.tag + ' · ' + shortAge(event.ma), summary: event.summary, body: 'This marker is intended as a discovery prompt. The model and age are approximate where the underlying geology is uncertain.' });
  };

  const selectCountry = (country) => {
    const name = country.properties?.name || countryKey(country);
    const centroid = featureCentroid(country);
    setTrackedCountry(country);
    setCountrySearch('');
    setSelected({
      kind: 'country',
      title: name,
      kicker: 'Tracking · modern country geography',
      summary: 'The pink land shows where the territory represented by this present-day country reconstructs through geological time.',
      body: 'In the past, the country outline becomes a model-based reconstruction of the selected present-day territory. Other country boundaries remain as a faint modern-day wireframe reference.',
    });
    focus(centroid.lat, centroid.lng, 1.55);
    diagnostic('info', 'COUNTRY', 'Country tracking enabled', { country: name, id: countryKey(country) });
  };

  const clearTrackedCountry = () => {
    if (trackedCountry) {
      diagnostic('info', 'COUNTRY', 'Country tracking disabled', { country: trackedCountry.properties?.name || countryKey(trackedCountry) });
    }
    setTrackedCountry(null);
    setTrackedCountryLand([]);
  };

  const handleAge = (value) => {
    const next = Number(value);
    setDirection(next > age ? 'Into the past' : 'Toward the present');
    setAge(next);
    setIsPlaying(false);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button
            className="brand-mark"
            type="button"
            onClick={() => {
              setTerminalOpen((value) => {
                const next = !value;
                diagnostic('info', 'UI', next ? 'Diagnostics terminal opened from globe icon' : 'Diagnostics terminal closed from globe icon', {
                  age,
                  keyframe: keyframeAge,
                  cache: cacheProgress.cached + '/' + cacheProgress.total,
                });
                return next;
              });
            }}
            aria-expanded={terminalOpen}
            aria-controls="diagnostics-terminal"
            aria-label="Open diagnostics terminal"
            title="Open diagnostics terminal"
          >
            <span /><span /><span />
          </button>
          <div><div className="brand-name">intheglobe</div><div className="brand-sub">where was the Earth?</div></div>
        </div>
        <div className="header-status">
          <div className="status-dot" data-status={status} /><span>{statusText}</span><span className="status-divider">·</span><span>model {modelForAge(age)}</span><span className="status-divider">·</span><span>keyframes {cacheProgress.cached}/{cacheProgress.total}</span>
        </div>
        <div className="header-actions">
          <button className="present-button" onClick={() => handleAge(0)}><span aria-hidden="true">↻</span> Present day</button>
        </div>
      </header>

      {terminalOpen && (
        <div
          className="diagnostics-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setTerminalOpen(false);
          }}
        >
          <section
            id="diagnostics-terminal"
            className="diagnostics-terminal"
            role="dialog"
            aria-modal="true"
            aria-label="intheglobe diagnostics terminal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="terminal-windowbar">
              <div className="terminal-window-title">
                <span className="terminal-dot terminal-dot-red" />
                <span className="terminal-dot terminal-dot-amber" />
                <span className="terminal-dot terminal-dot-green" />
                <strong>intheglobe — diagnostics terminal</strong>
              </div>
              <div className="terminal-window-meta">{diagnosticLines.length} lines · live</div>
              <button className="terminal-close" type="button" onClick={() => setTerminalOpen(false)} aria-label="Close terminal">×</button>
            </div>

            <div className="terminal-head">
              <div>
                <strong>RUNTIME DIAGNOSTICS</strong>
                <span>Current {shortAge(age)} · keyframe {shortAge(keyframeAge)} · model {modelForAge(keyframeAge)}</span>
              </div>
              <div className="terminal-tools">
                <button
                  type="button"
                  className="terminal-test-button"
                  onClick={async () => {
                    setGplatesTestState('testing');
                    const result = await testGplatesConnectivity();
                    setGplatesTestState(result.ok ? 'passed' : 'failed');
                  }}
                  disabled={gplatesTestState === 'testing'}
                >{gplatesTestState === 'testing' ? 'TESTING…' : gplatesTestState === 'passed' ? 'GPlates OK' : gplatesTestState === 'failed' ? 'GPlates FAIL' : 'TEST GPlATES'}</button>
                <button type="button" onClick={async () => {
                  try {
                    if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
                    await navigator.clipboard.writeText(diagnosticLines.join('\\n'));
                    diagnostic('info', 'UI', 'Diagnostic log copied');
                  } catch (error) {
                    diagnostic('warn', 'UI', 'Could not copy diagnostic log', { message: error?.message });
                  }
                }}>COPY LOG</button>
                <button type="button" onClick={() => setDiagnosticLines(['--- LOG CLEARED ---', new Date().toISOString().slice(11, 23) + ' INFO  [SYSTEM] Log cleared by user.'])}>CLEAR</button>
                <button type="button" onClick={() => diagnostic('info','SYSTEM','Runtime snapshot', {
                  age,
                  keyframeAge,
                  model: modelForAge(keyframeAge),
                  cache: cacheProgress.cached + '/' + cacheProgress.total,
                  online: navigator.onLine,
                  indexedDB: 'indexedDB' in window,
                  viewport: window.innerWidth + 'x' + window.innerHeight,
                })}>SNAPSHOT</button>
              </div>
            </div>

            <pre ref={terminalBodyRef} className="terminal-body">{diagnosticLines.join('\\n')}</pre>

            <div className="terminal-input">
              <span>root@intheglobe:~$</span>
              <span>Live diagnostics enabled — network, reconstruction, cache, world data, UI, and browser errors appear here. Use TEST GPlATES to run a direct browser connectivity check.</span>
            </div>

            <div className="terminal-foot">
              <span>HTTP · CACHE · FRAME · WORLD · UI · WINDOW</span>
              <span>Cache {cacheProgress.cached}/{cacheProgress.total}</span>
            </div>
          </section>
        </div>
      )}

      <main className="experience">
        <section className="globe-stage" ref={stageRef} aria-label="Interactive Earth">
          <div className="stage-grid" aria-hidden="true" />
          <Globe
            ref={globeRef}
            width={stageRef.current?.clientWidth || window.innerWidth}
            height={Math.max(420, (stageRef.current?.clientHeight || window.innerHeight) - 88)}
            backgroundColor="rgba(0,0,0,0)"
            globeImageUrl={DAY_TEXTURE}
            bumpImageUrl={BUMP_TEXTURE}
            backgroundImageUrl={STAR_TEXTURE}
            showAtmosphere
            atmosphereColor="#6fd3a8"
            atmosphereAltitude={0.17}
            polygonsData={globePolygons}
            polygonGeoJsonGeometry={(feature) => feature.geometry}
            polygonAltitude={(feature) => feature.__layer === 'tracked' ? 0.016 : 0.01}
            polygonCapColor={(feature) => {
              if (feature.__layer === 'tracked') return '#ff5caf';
              return age < 0.1 ? 'rgba(0,0,0,0)' : '#79985f';
            }}
            polygonSideColor={(feature) => {
              if (feature.__layer === 'tracked') return '#d43f8e';
              return age < 0.1 ? 'rgba(0,0,0,0)' : '#5d794f';
            }}
            polygonStrokeColor={(feature) => feature.__layer === 'tracked' ? '#ffd1ea' : age < 0.1 ? 'rgba(255,255,255,0.15)' : 'rgba(232,246,215,0.75)'}
            polygonLabel={(feature) => feature.__layer === 'tracked'
              ? '<div class="globe-tooltip"><strong>' + (feature.properties?.trackedCountry || 'Tracked country') + '</strong><br/><span>Tracked territory · ' + ageLabel(age) + '</span></div>'
              : '<div class="globe-tooltip"><strong>Reconstructed landmass</strong><br/><span>' + ageLabel(age) + '</span></div>'}
            polygonTransitionDuration={reducedMotion ? 0 : isPlaying ? 850 : 500}
            pathsData={globePaths}
            pathPoints={(path) => path.points}
            pathPointLat={(point) => point[1]}
            pathPointLng={(point) => point[0]}
            pathColor={(path) => path.kind === 'country'
              ? (path.age < 0.1 ? 'rgba(255,255,255,0.78)' : 'rgba(231,247,239,0.28)')
              : path.type === 'Divergent' ? '#78ddb5' : path.type === 'Convergent' ? '#f0ad75' : '#9ac8ff'}
            pathStroke={(path) => path.kind === 'country' ? (path.age < 0.1 ? 0.95 : 0.65) : 2.1}
            pathAltitude={(path) => path.kind === 'country' ? 0.025 : 0.03}
            pathResolution={3}
            pathDashLength={(path) => path.kind === 'country' ? 1 : (plateMode ? 0.62 : 0)}
            pathDashGap={(path) => path.kind === 'country' ? 0 : (plateMode ? 0.28 : 0)}
            pathDashAnimateTime={2600}
            pointsData={eventMode ? visibleEvents : []}
            pointLat={(point) => point.lat}
            pointLng={(point) => point.lng}
            pointColor={(point) => point.tag === 'Supercontinent' ? '#f2c56c' : '#d4f0cd'}
            pointRadius={0.42}
            pointAltitude={0.027}
            pointResolution={16}
            onPointClick={jumpToEvent}
            pointLabel={(point) => '<div class="globe-tooltip"><strong>' + point.name + '</strong><br/><span>' + shortAge(point.ma) + ' · ' + point.tag + '</span></div>'}
            enablePointerInteraction
            showGraticules
          />

          <div className="stage-vignette" aria-hidden="true" />
          <div className="hero-overlay">
            <div className="age-badge">
              <span className="age-badge-kicker">You are here in time</span>
              <strong>{ageLabel(age)}</strong>
              <small>{period.label} · {period.era}</small>
            </div>
            <div className="explore-hint"><span className="hint-icon">✦</span><span>Drag to rotate · scroll to zoom · scrub to travel through time</span></div>
          </div>

          {status === 'loading' && <div className="loading-chip"><span className="spinner" /><span>{statusText}</span></div>}

          {status === 'error' && (
            <div className="error-card">
              <strong>Earth data unavailable</strong>
              <span>The globe needs the public world geometry feed to render. Reload the page to retry.</span>
              <button onClick={() => window.location.reload()}>Reload</button>
            </div>
          )}

          <div className="stage-controls">
            <button className={autoRotate ? 'control active' : 'control'} onClick={() => setAutoRotate((value) => !value)} aria-pressed={autoRotate}>↻<span>Spin</span></button>
            <button className={plateMode ? 'control active' : 'control'} onClick={() => setPlateMode((value) => !value)} aria-pressed={plateMode}>◈<span>Plates</span></button>
            <button className={eventMode ? 'control active' : 'control'} onClick={() => setEventMode((value) => !value)} aria-pressed={eventMode}>✦<span>Events</span></button>
          </div>
        </section>

        <aside className="right-rail">
          <div className="rail-panel search-panel">
            <div className="panel-eyebrow">Explore</div>
            <div className="search-box">
              <span aria-hidden="true">⌕</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a period, event, or plate…" aria-label="Search geological periods, events, and tectonic plates" />
              {search && <button onClick={() => setSearch('')} aria-label="Clear search">×</button>}
            </div>
            {results.length > 0 && (
              <div className="search-results">
                {results.map((result) => (
                  <button key={result.type + '-' + (result.key || result.id || result.code)} className="result" onClick={() => selectResult(result)}>
                    <span className="result-type">{result.type}</span>
                    <span className="result-copy">
                      <strong>{result.label || result.name}</strong>
                      <small>{result.type === 'period' ? shortAge(result.ma) : result.type === 'event' ? shortAge(result.ma) + ' · ' + result.tag : result.code}</small>
                    </span>
                    <span aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rail-panel country-panel">
            <div className="panel-eyebrow">Track my country</div>
            <div className="country-search-box">
              <span aria-hidden="true">⌕</span>
              <input
                value={countrySearch}
                onChange={(event) => setCountrySearch(event.target.value)}
                placeholder={trackedCountry ? (trackedCountry.properties?.name || 'Tracked country') : 'Search for a country…'}
                aria-label="Search for a country to track through geological time"
              />
              {(countrySearch || trackedCountry) && (
                <button type="button" onClick={() => {
                  setCountrySearch('');
                  if (trackedCountry) clearTrackedCountry();
                }} aria-label="Clear country tracking">×</button>
              )}
            </div>
            {countryResults.length > 0 && (
              <div className="country-results">
                {countryResults.map((country) => (
                  <button key={countryKey(country)} className="country-result" type="button" onClick={() => selectCountry(country)}>
                    <span className="country-flag" aria-hidden="true">●</span>
                    <span>
                      <strong>{country.properties?.name || countryKey(country)}</strong>
                      <small>Track this territory through time</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            )}
            {trackedCountry && (
              <div className="tracked-country-status">
                <span className="tracked-country-swatch" aria-hidden="true" />
                <div>
                  <small>TRACKING</small>
                  <strong>{trackedCountry.properties?.name || countryKey(trackedCountry)}</strong>
                  <span>{age < 0.1 ? 'Present-day territory highlighted' : 'Pink = reconstructed territory'}</span>
                </div>
              </div>
            )}
          </div>

          <div className="rail-panel story-panel">
            <div className="panel-eyebrow">Right now</div>
            <div className="story-kicker">{selected.kicker || period.label}</div>
            <h2>{selected.title}</h2>
            <p className="story-summary">{selected.summary}</p>
            {selected.body && <p className="story-body">{selected.body}</p>}
            <div className="fact-strip">
              <div><span>Model</span><strong>{modelForAge(age)}</strong></div>
              <div><span>Position</span><strong>{shortAge(age)}</strong></div>
            </div>
          </div>

          <div className="rail-panel facts-panel">
            <div className="panel-eyebrow">Build intuition</div>
            {GEOLOGIC_FACTS.map((fact) => (
              <details key={fact.label}>
                <summary>{fact.label}<span>+</span></summary>
                <p>{fact.text}</p>
              </details>
            ))}
          </div>
        </aside>
      </main>

      <section className="timeline" aria-label="Geological timeline">
        <div className="timeline-header">
          <div><div className="panel-eyebrow">Geological time</div><strong>{direction}</strong></div>
          <div className="timeline-readout"><span>{shortAge(age)}</span><small>1.8 Ga ← · NOW →</small></div>
        </div>

        <div className="slider-wrap">
          <input type="range" min="0" max={MAX_AGE} step="1" value={age} onChange={(event) => handleAge(event.target.value)} aria-label="Travel through geological time" />
          <div className="timeline-track" aria-hidden="true">
            {EVENTS.map((event) => (
              <button key={event.id} className="timeline-event" style={{ left: ((1 - event.ma / MAX_AGE) * 100) + '%' }} onClick={() => jumpToEvent(event)} title={event.name + ' — ' + shortAge(event.ma)} aria-label={'Jump to ' + event.name} />
            ))}
          </div>
          <div className="timeline-labels" aria-hidden="true"><span>1.8 Ga</span><span>1.5 Ga</span><span>1 Ga</span><span>500 Ma</span><span>250 Ma</span><span>NOW</span></div>
        </div>

        <div className="timeline-actions">
          <button className="play-button" onClick={() => age > 0 && setIsPlaying((value) => !value)} disabled={age <= 0} aria-label={isPlaying ? 'Pause geological time playback' : age > 0 ? 'Play geological time forward toward the present' : 'At present day'}><span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>{isPlaying ? 'Pause journey' : age > 0 ? 'Play forward' : 'At present'}</button>
          <button className="reset-button" onClick={resetFrames} disabled={isResettingCache} aria-label="Reset all locally cached geological frames"><span aria-hidden="true">↺</span>{isResettingCache ? 'Resetting…' : 'Reset frames'}</button>
          <label className="toggle">
            <input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
            <span className="toggle-track" /><span>Reduce motion</span>
          </label>
        </div>
      </section>

      <footer className="footer-bar">
        <span>intheglobe · an exploratory educational reconstruction</span>
        <span>Historical positions are model-dependent approximations, especially in deep time.</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
