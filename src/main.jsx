import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Globe from 'react-globe.gl';
import * as topojson from 'topojson-client';
import { EVENTS, GEOLOGIC_FACTS, PLATE_BOUNDARIES, PLATES, PERIODS } from './data';
import './styles.css';

const WORLD_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const GPLATES_URL = 'https://gws.gplates.org/reconstruct/reconstruct_feature_collection';
const DAY_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg';
const BUMP_TEXTURE = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
const STAR_TEXTURE = 'https://unpkg.com/three-globe/example/img/night-sky.png';

const CACHE_DB_NAME = 'intheglobe-frame-cache-v2';
const CACHE_STORE_NAME = 'frames';
const CACHE_MANIFEST_KEY = 'intheglobe-frame-manifest-v2';
const MAX_AGE = 1800;
const FRAME_STEP = 5;
const FRAME_AGES = Array.from({ length: Math.floor(MAX_AGE / FRAME_STEP) + 1 }, (_, index) => index * FRAME_STEP);
const PRELOAD_WORKERS = 6;

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

function openFrameDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
        request.result.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredFrame(age) {
  const key = frameKey(age);
  const db = await openFrameDb().catch(() => null);
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction(CACHE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CACHE_STORE_NAME).get(key);
    request.onsuccess = async () => {
      const record = request.result;
      if (!record) {
        resolve(null);
        return;
      }
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
    request.onerror = () => resolve(null);
  });
}

async function putStoredFrame(age, features) {
  const key = frameKey(age);
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
  }
  return compactFeatures;
}


async function clearStoredFrames() {
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

async function fetchReconstructionFrame(age, baseLand, signal) {
  const payload = new URLSearchParams();
  payload.set('feature_collection', JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: baseLand.geometry }],
  }));
  payload.set('time', String(age));
  payload.set('model', modelForAge(age));
  payload.set('anchor_plate_id', '0');

  const response = await fetch(GPLATES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: payload,
    signal,
  });
  if (!response.ok) throw new Error('GPlates responded with ' + response.status);
  const reconstructed = await response.json();
  const features = flattenFeatures(reconstructed).filter((feature) => feature.geometry).map((feature) => ({
    type: 'Feature',
    properties: {},
    geometry: feature.geometry,
  }));
  if (!features.length) throw new Error('No reconstructed geometry returned');
  return features;
}

function modelForAge(age) {
  if (age <= 410) return 'MULLER2022';
  if (age <= 1000) return 'MERDITH2021';
  return 'CAO2024';
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

function App() {
  const globeRef = useRef(null);
  const stageRef = useRef(null);
  const requestRef = useRef(0);
  const [age, setAge] = useState(0);
  const [direction, setDirection] = useState('Start exploring');
  const [land, setLand] = useState([]);
  const [baseLand, setBaseLand] = useState(null);
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
  const [cacheProgress, setCacheProgress] = useState({ cached: 0, total: FRAME_AGES.length });
  const frameCacheRef = useRef(new Map());
  const preloadControllersRef = useRef(new Set());
  const foregroundRequestRef = useRef(0);
  const foregroundLoadingRef = useRef(false);
  const cacheGenerationRef = useRef(0);
  const [cacheGeneration, setCacheGeneration] = useState(0);
  const [isResettingCache, setIsResettingCache] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  const period = useMemo(() => nearestPeriod(age), [age]);
  const visibleEvents = useMemo(() => EVENTS.filter((event) => Math.abs(event.ma - age) < 95), [age]);

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
        setStatusText('Loading the land surface…');
        const response = await fetch(WORLD_URL);
        if (!response.ok) throw new Error('World data unavailable');
        const topology = await response.json();
        const feature = topojson.feature(topology, topology.objects.land);
        if (cancelled) return;
        setBaseLand(feature);
        setLand(flattenFeatures(feature));
        setStatus('ready');
        setStatusText('Ready to explore');
      } catch (error) {
        console.error(error);
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
      const manifest = readFrameManifest();
      let cached = FRAME_AGES.filter((frameAge) => frameAge === 0 || manifest.has(frameKey(frameAge))).length;
      setCacheProgress({ cached, total: FRAME_AGES.length });

      const missing = FRAME_AGES.filter((frameAge) => frameAge > 0 && !manifest.has(frameKey(frameAge)));
      // Prioritise the near-present sequence so playback becomes useful quickly,
      // then continue through the rest of deep time.
      missing.sort((a, b) => a - b);
      let cursor = 0;

      const worker = async () => {
        while (!cancelled && generation === cacheGenerationRef.current) {
          const index = cursor++;
          if (index >= missing.length) return;

          while (!cancelled && generation === cacheGenerationRef.current && foregroundLoadingRef.current) {
            await new Promise((resolve) => window.setTimeout(resolve, 40));
          }
          if (cancelled || generation !== cacheGenerationRef.current) return;

          const frameAge = missing[index];
          const key = frameKey(frameAge);
          const preloadController = new AbortController();
          preloadControllersRef.current.add(preloadController);

          try {
            let features = frameCacheRef.current.get(key);
            if (!features) features = await getStoredFrame(frameAge);

            if (!features) {
              features = await fetchReconstructionFrame(frameAge, baseLand, preloadController.signal);
              if (cancelled || generation !== cacheGenerationRef.current) return;
              await putStoredFrame(frameAge, features);
            }

            if (cancelled || generation !== cacheGenerationRef.current) return;
            frameCacheRef.current.set(key, features);
            cached += 1;
            setCacheProgress({ cached: Math.min(cached, FRAME_AGES.length), total: FRAME_AGES.length });
          } catch (error) {
            if (error?.name !== 'AbortError') {
              console.warn('Background frame preload failed for ' + shortAge(frameAge), error);
            }
          } finally {
            preloadControllersRef.current.delete(preloadController);
          }
        }
      };

      await Promise.all(Array.from({ length: PRELOAD_WORKERS }, () => worker()));
    };

    // Start immediately; the app no longer waits for an idle callback.
    const start = window.setTimeout(() => warm(), 80);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [baseLand, cacheGeneration]);

  useEffect(() => {
    if (!baseLand || status === 'error') return;
    const currentRequest = ++requestRef.current;
    const controller = new AbortController();
    const targetAge = Math.round(age);
    const delay = isPlaying ? 0 : reducedMotion ? 40 : 180;

    const timer = window.setTimeout(async () => {
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
        setStatusText('Loading ' + shortAge(targetAge) + ' from the local frame cache…');

        let features = frameCacheRef.current.get(key);
        if (!features) {
          features = await getStoredFrame(targetAge);
          if (features) frameCacheRef.current.set(key, features);
        }

        if (!features) {
          setStatusText('Caching ' + shortAge(targetAge) + ' reconstruction…');
          features = await fetchReconstructionFrame(targetAge, baseLand, controller.signal);
          if (currentRequest !== requestRef.current) return;
          frameCacheRef.current.set(key, features);
          await putStoredFrame(targetAge, features);
        }

        if (currentRequest !== requestRef.current) return;
        setLand(features);
        setStatus('ready');
        setStatusText(shortAge(targetAge) + ' reconstruction · cache resumed');
      } catch (error) {
        if (currentRequest !== requestRef.current || error?.name === 'AbortError') return;
        console.warn('Reconstruction unavailable; keeping last valid geometry.', error);
        setStatus('warning');
        setStatusText('Frame unavailable — keeping the last valid view');
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
  }, [age, baseLand, isPlaying, reducedMotion]);

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
    const interval = window.setInterval(() => {
      setAge((previous) => {
        const next = Math.min(MAX_AGE, previous + FRAME_STEP);
        setDirection(next > previous ? 'Into the past' : 'At the deep-time boundary');
        if (next >= MAX_AGE) setIsPlaying(false);
        return next;
      });
    }, reducedMotion ? 320 : 180);
    return () => window.clearInterval(interval);
  }, [isPlaying, reducedMotion]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }, [reducedMotion]);

  const resetFrames = async () => {
    if (isResettingCache) return;
    setIsResettingCache(true);
    setIsPlaying(false);
    cacheGenerationRef.current += 1;
    setCacheProgress({ cached: 1, total: FRAME_AGES.length });
    frameCacheRef.current.clear();

    try {
      await clearStoredFrames();
      setStatus('loading');
      setStatusText('Frame cache reset · rebuilding in the background…');
    } finally {
      setIsResettingCache(false);
      setCacheGeneration((value) => value + 1);
      setLand(flattenFeatures(baseLand));
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
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><div className="brand-name">intheglobe</div><div className="brand-sub">where was the Earth?</div></div>
        </div>
        <div className="header-status">
          <div className="status-dot" data-status={status} /><span>{statusText}</span><span className="status-divider">·</span><span>model {modelForAge(age)}</span><span className="status-divider">·</span><span>frames {cacheProgress.cached}/{cacheProgress.total}</span>
        </div>
        <button className="present-button" onClick={() => handleAge(0)}><span aria-hidden="true">↻</span> Present day</button>
      </header>

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
            polygonsData={land}
            polygonGeoJsonGeometry={(feature) => feature.geometry}
            polygonAltitude={0.004}
            polygonCapColor={() => period.ma === 0 ? 'rgba(229, 240, 215, 0.02)' : 'rgba(214, 188, 121, 0.36)'}
            polygonSideColor={() => period.ma === 0 ? 'rgba(88, 152, 107, 0.14)' : 'rgba(145, 104, 61, 0.16)'}
            polygonStrokeColor={() => 'rgba(244, 246, 232, 0.22)'}
            polygonLabel={() => '<div class="globe-tooltip"><strong>Reconstructed land</strong><br/><span>' + ageLabel(age) + '</span></div>'}
            polygonTransitionDuration={reducedMotion ? 0 : isPlaying ? 160 : 700}
            pathsData={plateMode ? PLATE_BOUNDARIES : []}
            pathPoints={(path) => path.points}
            pathPointLat={(point) => point[1]}
            pathPointLng={(point) => point[0]}
            pathColor={(path) => path.type === 'Divergent' ? '#78ddb5' : path.type === 'Convergent' ? '#f0ad75' : '#9ac8ff'}
            pathStroke={2.1}
            pathResolution={3}
            pathDashLength={plateMode ? 0.62 : 0}
            pathDashGap={plateMode ? 0.28 : 0}
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
          <button className="play-button" onClick={() => setIsPlaying((value) => !value)} aria-label={isPlaying ? 'Pause geological time playback' : 'Play the locally cached geological time sequence'}><span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>{isPlaying ? 'Pause journey' : 'Animate journey'}</button>
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
