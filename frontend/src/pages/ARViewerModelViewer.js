import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
// Bundling the library directly (instead of injecting a <script> tag that
// points at a CDN at runtime) guarantees the <model-viewer> custom element
// is registered before React ever tries to render it, and removes a whole
// class of "worked locally, blank on the phone" bugs caused by the CDN
// script losing the race against the first render or being blocked by a
// carrier/network filter.
import '@google/model-viewer';
import '../styles/ARViewerModelViewer.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// Render's free tier spins the API down after ~15 min idle; the first
// request after that can take 30-60s to answer while the instance boots.
// Without this, the viewer just looks broken ("Loading..." forever) during
// that window, which is very likely what was happening during testing.
const COLD_START_HINT_MS = 8000;
const HARD_TIMEOUT_MS = 60000;

// The fetch progress event only tracks bytes downloaded — it hits 100%
// as soon as the last byte of the GLB arrives over the network, which is
// NOT the same moment as model-viewer's 'load' event. Between those two
// points three.js still has to parse the buffer, decode any embedded
// textures, and upload everything to the GPU, and none of that reports
// progress. For a texture-heavy scan (e.g. a Polycam export with a large
// embedded JPEG) that gap can be several seconds to tens of seconds even
// on fast hardware. Previously the status text just froze at whatever
// the last sub-100% number was (commonly "99%", since progress rarely
// lands on an exact 100 before the final chunk), which reads as a hang
// even though the page is still working and the existing HARD_TIMEOUT_MS
// watchdog below will still catch a genuine failure. This is a second,
// shorter timer purely for user-facing feedback during that decode gap.
const PARSE_STALL_HINT_MS = 12000;

// Real-world AR display cap, in meters, for the model's longest dimension.
// glTF/GLB treats 1 unit = 1 meter, but a lot of export pipelines (and, in
// this app's case, an upload-time "scale" field that was collected but
// never actually applied anywhere) don't calibrate to that, so models can
// come through many times larger than intended and blow up to room-size in
// AR. This is a last-resort safety net applied after the per-model scale
// below, not a replacement for exporting/uploading at a sane size.
const MAX_AR_METERS = 0.1; // 20% of original size

const isIOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as "MacIntel" with touch support, indistinguishable
    // from a real Mac unless you check for touch points.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

// Metadata fetch is non-blocking for both the 3D view and AR launch, but it
// was previously allowed to hang forever on a stalled connection. Give it
// its own short budget so a slow/dead metadata endpoint can never leave a
// silent, uncancelled request in flight.
const METADATA_FETCH_TIMEOUT_MS = 5000;

function ARViewerModelViewer() {
  const { modelId } = useParams();
  const modelViewerRef = useRef(null);
  const metaScaleRef = useRef(1);
  const arLaunchedRef = useRef(false);
  const tapListenerRef = useRef(null);
  // iOS Quick Look, when there's no pre-built ios-src USDZ, generates one
  // on the fly via model-viewer's prepareUSDZ() — which is async. Calling
  // that *inside* activateAR() (model-viewer's own default behavior) means
  // the eventual anchor.click() happens after an `await`, outside the
  // synchronous scope of whatever user gesture triggered it. WebKit only
  // honors AR Quick Look handoffs triggered synchronously from a trusted
  // gesture, so that await is what was silently killing auto-launch on
  // iPhone: canActivateAR was true, the tap fired, but by the time the
  // conversion finished, Safari no longer considered it a valid user
  // action and dropped the handoff. Fix: run the (slow) conversion eagerly
  // the moment the model finishes loading — well before any tap — and cache
  // the resulting blob URL, so the actual tap only has to do a synchronous
  // anchor.click() with no async work left in the critical path.
  const usdzBlobUrlRef = useRef(null);
  const usdzPreparingRef = useRef(false);
  const usdzFailedRef = useRef(false);
  // Tracks the decode/parse gap between "download finished" (100% progress)
  // and the 'load' event actually firing — see PARSE_STALL_HINT_MS above.
  const parseStallTimerRef = useRef(null);
  const downloadCompleteAtRef = useRef(null);
  const mountedAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());
  // Ticks once/2s only during the parse/decode phase (between download-
  // complete and 'load'). If these heartbeats stop appearing in the console
  // while the UI is still frozen on "Processing model…", the main JS thread
  // itself is blocked (e.g. a synchronous, slow image decode) — timers
  // literally cannot fire, which is also why PARSE_STALL_HINT_MS/
  // HARD_TIMEOUT_MS can silently fail to update the UI in that scenario. If
  // heartbeats keep ticking right up to HARD_TIMEOUT_MS, the thread is fine
  // and something async (e.g. prepareUSDZ, a hung fetch for a sub-resource)
  // is what never resolved. This distinction is the single most useful
  // signal for diagnosing an iOS-only silent hang after the fact.
  const heartbeatTimerRef = useRef(null);

  const [status, setStatus] = useState('Loading 3D model...');
  const [modelError, setModelError] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [arSupported, setArSupported] = useState(null); // null = unknown yet
  const [coldStartHint, setColdStartHint] = useState(false);
  const [instantArAvailable, setInstantArAvailable] = useState(false);

  // On-device diagnostics. This exists because the reported failure mode —
  // black screen stuck on "Processing model" on iOS, working fine on
  // Android with the identical code — has several plausible root causes
  // (library never registered, model URL unreachable from this browser
  // specifically, parse/decode hang, AR just genuinely unsupported) that
  // all look identical from the outside, and the person hitting this is
  // very likely on a phone with no attached console. Surfacing these
  // checks directly in the UI (see the diag panel in the render below)
  // means the failure can be diagnosed from a screenshot of the phone
  // itself instead of requiring Safari's remote-debugging-over-USB setup.
  const [diag, setDiag] = useState({
    mvDefined: null,       // is the <model-viewer> custom element registered at all?
    mvElementFound: null,  // did our ref actually attach to a real DOM element?
    fetchCheck: 'pending', // 'pending' | 'ok' | 'error' — independent fetch of modelSrc
    fetchDetail: '',
    canAR: null,           // raw canActivateAR reading, set once the model loads
  });
  const [showDiag, setShowDiag] = useState(false);

  const modelSrc = `${API_URL}/model/${modelId}`;

  // Fetch the per-model scale that was set at upload time. Stored in a ref
  // (not state) so it never becomes a React-controlled prop on
  // <model-viewer> — applying it imperatively in handleLoad, alongside the
  // AR-size cap below, means a late-arriving fetch can never stomp a scale
  // value handleLoad already computed and set directly on the element.
  // This request is entirely independent of model loading / AR launch —
  // it is never awaited by either, only best-effort applied if/when it
  // resolves in time.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), METADATA_FETCH_TIMEOUT_MS);

    console.log(`[AR] Fetching model metadata: /model/${modelId}/info`);
    fetch(`${API_URL}/model/${modelId}/info`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data && Number.isFinite(data.scale) && data.scale > 0) {
          metaScaleRef.current = data.scale;
          console.log(`[AR] Metadata loaded, scale=${data.scale}`);
        }
      })
      .catch((err) => {
        // Non-fatal — falls back to the default scale of 1 plus whatever
        // the AR-size cap below decides. Logged (not silently swallowed)
        // so a slow/dead metadata endpoint is visible in the console
        // instead of just manifesting as "model looks the wrong size".
        if (err?.name === 'AbortError') {
          console.warn(`[AR] Metadata fetch timed out after ${METADATA_FETCH_TIMEOUT_MS}ms — continuing without it`);
        } else {
          console.warn('[AR] Metadata fetch failed — continuing without it:', err);
        }
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [modelId]);

  // Diagnostics: run once, right on mount, ahead of everything else.
  //
  // 1. Is <model-viewer> actually a registered custom element? The
  //    `import '@google/model-viewer'` at the top of this file calls
  //    customElements.define('model-viewer', ...) synchronously as a side
  //    effect of that import, so this should always read true by the time
  //    this component mounts. If it's false, the library's JS never
  //    executed on this device — a failed/blocked chunk load, a content
  //    blocker, or (rarely) an engine that choked on some syntax in the
  //    bundle — and nothing downstream (3D render, AR, canActivateAR) can
  //    possibly work. That's a fundamentally different failure than "the
  //    model is just slow to parse", so it's checked first and, if it
  //    fails, short-circuits straight to a clear error instead of leaving
  //    the user staring at "Loading 3D model..." with no forward progress.
  // 2. Did the <model-viewer> element actually mount in the DOM?
  // 3. Is modelSrc actually fetchable from *this* browser? Runs as a fetch
  //    fully independent of model-viewer's own internal loading, so a CORS
  //    rejection, TLS/network block, or server error is visible
  //    immediately and explicitly — instead of only ever showing up
  //    indirectly as a silent hang or a bare model-viewer 'error' event
  //    that may or may not fire depending on exactly where its internal
  //    pipeline failed.
  useEffect(() => {
    const mvDefined = typeof window !== 'undefined' && !!window.customElements?.get('model-viewer');
    console.log(`[AR][diag] <model-viewer> custom element registered: ${mvDefined}`);
    setDiag((d) => ({ ...d, mvDefined }));

    if (!mvDefined) {
      console.error('[AR][diag] CRITICAL: <model-viewer> is not registered — the model-viewer library failed to load/execute on this device/browser.');
      setModelError(true);
      setStatus('❌ The AR viewer library failed to load on this device/browser. Try reloading the page, or switch browsers.');
      return undefined;
    }

    const mvElementFound = !!modelViewerRef.current;
    console.log(`[AR][diag] <model-viewer> DOM element present: ${mvElementFound}`);
    setDiag((d) => ({ ...d, mvElementFound }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    console.log(`[AR][diag] Independent fetch check: ${modelSrc}`);
    fetch(modelSrc, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: controller.signal })
      .then((res) => {
        const detail = `HTTP ${res.status} ${res.statusText}; content-type=${res.headers.get('content-type') || 'n/a'}; content-length=${res.headers.get('content-length') || 'n/a'}; accept-ranges=${res.headers.get('accept-ranges') || 'n/a'}`;
        console.log(`[AR][diag] Fetch check result: ${detail}`);
        // 200 (server ignored Range) or 206 (partial content honored) both
        // mean the URL is genuinely reachable; anything else is a real
        // problem worth flagging even though model-viewer's own fetch is
        // still what actually loads the model.
        setDiag((d) => ({ ...d, fetchCheck: res.ok || res.status === 206 ? 'ok' : 'error', fetchDetail: detail }));
      })
      .catch((err) => {
        const detail = err?.name === 'AbortError' ? 'timed out after 8000ms' : String(err?.message || err);
        console.error(`[AR][diag] Fetch check FAILED: ${detail}`);
        setDiag((d) => ({ ...d, fetchCheck: 'error', fetchDetail: detail }));
      })
      .finally(() => clearTimeout(timeoutId));

    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
    // Runs once on mount only — this is a one-shot capability/reachability
    // check, not something that should re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global crash trap. model-viewer's own 'error' custom event only fires
  // for failures *inside* its own loader pipeline that it catches and
  // reports itself — it is not a catch-all. A synchronous exception thrown
  // deep inside three.js's GLTF/texture parsing (or a rejected promise
  // nobody in that call chain awaits/catches) can crash the work in
  // progress without ever reaching that event, which would look exactly
  // like "stuck at Processing model…, nothing in the console, no error
  // shown" — matching this bug report. window 'error'/'unhandledrejection'
  // catch those cases regardless of where in the page they originate, so
  // this is the backstop for exactly the class of failure the structured
  // handlers can miss. Also logs a one-time device/GPU capability snapshot
  // on iOS, since a 4096x4096 texture exceeding the device's actual
  // MAX_TEXTURE_SIZE (older A-series GPUs cap at 4096, some report less
  // under memory pressure) is a concrete, checkable explanation for a
  // decode/upload stage that never completes.
  useEffect(() => {
    const onWindowError = (event) => {
      console.error('[AR] Uncaught window error during model load/processing:', {
        message: event?.message,
        filename: event?.filename,
        lineno: event?.lineno,
        colno: event?.colno,
        error: event?.error,
        elapsedMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - mountedAtRef.current),
      });
      if (!modelReady) {
        setModelError(true);
        setStatus(`❌ A page error interrupted model loading: ${event?.message || 'unknown error'}. Try again.`);
      }
    };
    const onUnhandledRejection = (event) => {
      console.error('[AR] Unhandled promise rejection during model load/processing:', {
        reason: event?.reason,
        elapsedMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - mountedAtRef.current),
      });
      if (!modelReady) {
        setModelError(true);
        setStatus(`❌ A background task failed while loading the model: ${event?.reason?.message || event?.reason || 'unknown error'}. Try again.`);
      }
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    if (isIOS) {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
          const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
          const renderer = dbgInfo ? gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) : 'unknown (WEBGL_debug_renderer_info unavailable)';
          console.log(`[AR] iOS WebGL capability check: MAX_TEXTURE_SIZE=${maxTextureSize}, renderer=${renderer}, devicePixelRatio=${window.devicePixelRatio}`);
          if (maxTextureSize < 4096) {
            console.warn(`[AR] Device's MAX_TEXTURE_SIZE (${maxTextureSize}) is smaller than this model's 4096x4096 texture — this is a likely cause of a silent decode/upload failure.`);
          }
        } else {
          console.warn('[AR] Could not get a WebGL context to check MAX_TEXTURE_SIZE on iOS.');
        }
      } catch (e) {
        console.warn('[AR] WebGL capability check failed:', e);
      }
    }

    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [modelReady]);

  const disarmTapListener = useCallback(() => {
    if (tapListenerRef.current) {
      document.removeEventListener('pointerdown', tapListenerRef.current);
      tapListenerRef.current = null;
    }
  }, []);

  const clearParseStallTimer = useCallback(() => {
    if (parseStallTimerRef.current) {
      clearTimeout(parseStallTimerRef.current);
      parseStallTimerRef.current = null;
    }
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  // Applies the uploaded model's scale, then measures the model's real
  // on-screen size (in meters, as AR will render it) and shrinks it further
  // if it's still bigger than a sane tabletop/handheld object — this is
  // what actually fixes "the cube loads too big in AR" regardless of what
  // scale (if any) was set when the model was uploaded.
  const applyArSafeScale = useCallback((el) => {
    if (!el) return;
    const base = metaScaleRef.current > 0 ? metaScaleRef.current : 1;
    el.setAttribute('scale', `${base} ${base} ${base}`);
    try {
      const dims = el.getDimensions();
      const maxDim = Math.max(dims.x, dims.y, dims.z);
      if (Number.isFinite(maxDim) && maxDim > MAX_AR_METERS) {
        const corrected = base * (MAX_AR_METERS / maxDim);
        el.setAttribute('scale', `${corrected} ${corrected} ${corrected}`);
      }
    } catch (e) {
      console.warn('AR auto-size check failed, using uploaded scale as-is:', e);
    }
  }, []);

  // Kick off Quick Look's USDZ conversion as early as possible — right when
  // the model finishes loading, not when the user taps. This is the fix for
  // "doesn't automatically enter AR mode" on iPhone: by the time the user's
  // first tap arrives, the (slow) conversion is already done, so the tap
  // handler below only has to do a synchronous anchor.click(), which is what
  // Safari actually requires for Quick Look to accept the handoff.
  const prepareIOSQuickLook = useCallback(() => {
    const el = modelViewerRef.current;
    if (!el || !isIOS || usdzPreparingRef.current || usdzBlobUrlRef.current) return;
    usdzPreparingRef.current = true;
    usdzFailedRef.current = false;
    console.log('[AR] iOS detected — pre-generating USDZ for Quick Look ahead of any tap...');
    el.prepareUSDZ()
      .then((url) => {
        if (!url) {
          throw new Error('prepareUSDZ() returned empty URL (model not ready?)');
        }
        usdzBlobUrlRef.current = url;
        console.log('[AR] USDZ ready — AR launch is now instant on next tap:', url);
      })
      .catch((err) => {
        usdzFailedRef.current = true;
        console.error('[AR] USDZ pre-generation failed:', err);
        setStatus('❌ Could not prepare AR for this device. Tap to retry, or rotate the model above.');
      })
      .finally(() => {
        usdzPreparingRef.current = false;
      });
  }, []);

  // Android: hand off to Scene Viewer directly with mode=ar_only and
  // resizable=false instead of going through model-viewer's default
  // activateAR() (which requests mode=ar_preferred). The default mode is
  // what puts up Scene Viewer's "View as object" AR/3D toggle and its
  // pinch-to-resize handle — both reported as unwanted extra UI. ar_only
  // skips straight into AR with no toggle, and resizable=false removes the
  // resize control.
  //
  // iOS: bypass model-viewer's own activateAR()/Quick Look path entirely.
  // Its internal handler re-runs the (slow, async) USDZ conversion on every
  // call with no caching, which is what breaks the user-gesture requirement
  // — see prepareIOSQuickLook above. Instead we do exactly what Apple's own
  // docs describe for a manual AR Quick Look launch (an `<a rel="ar">` with
  // an <img> child, clicked synchronously) using the blob URL we already
  // generated ahead of time.
  const launchAR = useCallback(() => {
    const el = modelViewerRef.current;
    if (!el || arLaunchedRef.current) return;

    if (isIOS) {
      if (!usdzBlobUrlRef.current) {
        // Not ready yet (rare — conversion is kicked off as soon as the
        // model loads, well before a human can realistically tap). Don't
        // consume the gesture on a launch that can't succeed; leave the
        // tap listener armed so the very next tap retries. Nudge the
        // conversion in case it hasn't started/errored for some reason.
        console.warn('[AR] Tap received but USDZ still not ready — will retry on next tap');
        if (usdzFailedRef.current) prepareIOSQuickLook();
        return;
      }
      arLaunchedRef.current = true;
      disarmTapListener();
      console.log('[AR] Launching Quick Look directly (pre-generated USDZ, no async work in the tap handler)');
      setStatus('📱 Opening AR — look at your surroundings and tap to place');
      const anchor = document.createElement('a');
      anchor.setAttribute('rel', 'ar');
      anchor.href = usdzBlobUrlRef.current;
      anchor.appendChild(document.createElement('img'));
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Revoke after Quick Look has had time to fetch the blob (WebKit
      // does this as part of the app-switch, essentially immediately) —
      // delayed rather than immediate so we're not racing that fetch.
      const blobToRevoke = usdzBlobUrlRef.current;
      setTimeout(() => URL.revokeObjectURL(blobToRevoke), 5000);
      usdzBlobUrlRef.current = null;
      return;
    }

    arLaunchedRef.current = true;
    disarmTapListener();

    if (isAndroid) {
      const fallback = window.location.href;
      const intentUrl =
        `intent://arvr.google.com/scene-viewer/1.0?file=${encodeURIComponent(modelSrc)}` +
        `&mode=ar_only&resizable=false#Intent;scheme=https;package=com.google.ar.core;` +
        `action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(fallback)};end;`;
      window.location.href = intentUrl;
    } else {
      el.activateAR();
    }
  }, [modelSrc, disarmTapListener, prepareIOSQuickLook]);

  const handleLoad = useCallback(() => {
    clearParseStallTimer();
    stopHeartbeat();
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const parseMs = downloadCompleteAtRef.current != null ? Math.round(now - downloadCompleteAtRef.current) : null;
    console.log(
      `[AR] Model loaded (total ${Math.round(now - mountedAtRef.current)}ms` +
      (parseMs != null ? `, parse/decode phase ${parseMs}ms` : '') + ')'
    );
    setModelReady(true);
    setModelError(false);
    setColdStartHint(false);

    applyArSafeScale(modelViewerRef.current);

    // canActivateAR reflects real, per-device/browser support (ARCore
    // Scene Viewer / ARKit Quick Look / in-page WebXR) and is only
    // accurate once the model itself has loaded.
    const canAR = !!modelViewerRef.current?.canActivateAR;
    setArSupported(canAR);
    setDiag((d) => ({ ...d, canAR }));
    console.log(`[AR] canActivateAR=${canAR} isIOS=${isIOS} isAndroid=${isAndroid}`);
    setStatus(canAR ? '📱 Launching AR...' : '✓ Model loaded');

    if (canAR) {
      // On iOS, start generating the USDZ Quick Look needs right now,
      // before any tap — see prepareIOSQuickLook for why this timing is
      // what actually makes auto-launch work.
      if (isIOS) {
        prepareIOSQuickLook();
      }

      // Arm a first-tap-anywhere fallback on every platform. iOS in
      // particular requires AR to be triggered from inside a genuine user
      // gesture — WebKit will silently drop, or half-launch, an AR handoff
      // that comes from a setTimeout, and a half-launch is exactly what
      // produces Quick Look's "object could not be opened" error. Since
      // this is a full-screen AR view, the user's very first touch
      // (whether meant to tap anything or just look at the model) fires
      // this immediately, so it reads as automatic without ever needing a
      // visible "View in AR" button. It also safety-nets Android/desktop
      // in case the eager auto-launch below doesn't fire.
      const armedListener = (event) => {
        if (event.target?.closest?.('.exit-btn')) return;
        launchAR();
      };
      tapListenerRef.current = armedListener;
      document.addEventListener('pointerdown', armedListener);

      // Eager auto-launch: safe on Android/desktop, where the Scene
      // Viewer/WebXR handoff isn't gated behind a trusted user gesture the
      // way iOS Quick Look is. Skipped on iOS — see armedListener above and
      // prepareIOSQuickLook; a real trusted tap is a hard platform
      // requirement there, not a choice this code makes.
      if (!isIOS) {
        setTimeout(() => {
          launchAR();
        }, 500);
      }
    }
  }, [applyArSafeScale, launchAR, prepareIOSQuickLook, clearParseStallTimer, stopHeartbeat]);

  const handleError = useCallback((event) => {
    clearParseStallTimer();
    stopHeartbeat();
    const detail = event?.detail;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // Log everything useful for diagnosing a silent failure after the fact
    // — which phase it failed in, how long it had been running, and the
    // exact URL involved — instead of just the bare model-viewer event,
    // which by itself doesn't say whether this was a network failure, a
    // parse failure, or something else.
    console.error('[AR] model-viewer load error:', {
      detail,
      src: modelSrc,
      phase: downloadCompleteAtRef.current != null ? 'parse/decode' : 'download',
      elapsedMs: Math.round(now - mountedAtRef.current),
      event,
    });
    setModelError(true);
    const reason = detail?.type ? ` (${detail.type})` : '';
    setStatus(`❌ Could not load this model${reason}. It may have expired, or the server is waking up — try again in a moment.`);
  }, [modelSrc, clearParseStallTimer, stopHeartbeat]);

  const handleProgress = useCallback((event) => {
    const pct = Math.round((event?.detail?.totalProgress || 0) * 100);
    if (pct === 0) {
      console.log('[AR] Model fetch started');
      setStatus('Connecting to server…');
    } else if (pct < 100) {
      setStatus(`Loading 3D model… ${pct}%`);
    } else if (downloadCompleteAtRef.current == null) {
      // Download just finished. model-viewer/three.js still has to parse
      // the buffer, decode any embedded textures, and upload to the GPU
      // before 'load' fires — none of which reports progress, so without
      // this the status text would just sit frozen on the last percentage
      // (typically "99%") and look hung even while it's still working.
      downloadCompleteAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.log('[AR] Model fetch complete, parsing/decoding…');
      setStatus('Processing model…');
      clearParseStallTimer();
      parseStallTimerRef.current = setTimeout(() => {
        console.warn(`[AR] Still parsing/decoding ${PARSE_STALL_HINT_MS}ms after download finished — likely a large embedded texture`);
        setStatus('⏳ Still processing… high-detail models with large textures can take a bit longer');
      }, PARSE_STALL_HINT_MS);
      // See heartbeatTimerRef declaration above for why this matters: it's
      // the only way to tell "main thread blocked" apart from "a promise
      // never resolved" after the fact, from console logs alone.
      stopHeartbeat();
      const startedAt = downloadCompleteAtRef.current;
      heartbeatTimerRef.current = setInterval(() => {
        const nowTick = typeof performance !== 'undefined' ? performance.now() : Date.now();
        console.log(`[AR] …still in parse/decode, ${Math.round(nowTick - startedAt)}ms elapsed (main thread is not blocked)`);
      }, 2000);
    }
  }, [clearParseStallTimer, stopHeartbeat]);

  const handleArStatus = useCallback((event) => {
    const arStatus = event?.detail?.status;
    console.log(`[AR] ar-status: ${arStatus}`);
    if (arStatus === 'session-started') {
      arLaunchedRef.current = true;
      disarmTapListener();
      setStatus('📱 Point your camera at a flat surface, then tap to place');
    } else if (arStatus === 'object-placed') {
      setStatus('✓ Placed! Move around to view it from any angle');
    } else if (arStatus === 'failed') {
      // Allow another attempt (the tap-anywhere listener stays/gets
      // re-armed) rather than staying permanently latched as "launched".
      arLaunchedRef.current = false;
      console.error('[AR] AR session failed to start');
      setStatus('❌ AR session failed to start — tap anywhere to try again');
    } else if (arStatus === 'not-presenting') {
      setStatus(modelReady ? '✓ Ready — tap anywhere to view in AR' : 'Loading 3D model...');
    }
  }, [modelReady, disarmTapListener]);

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el) return undefined;

    el.addEventListener('load', handleLoad);
    el.addEventListener('error', handleError);
    el.addEventListener('progress', handleProgress);
    el.addEventListener('ar-status', handleArStatus);

    return () => {
      el.removeEventListener('load', handleLoad);
      el.removeEventListener('error', handleError);
      el.removeEventListener('progress', handleProgress);
      el.removeEventListener('ar-status', handleArStatus);
      disarmTapListener();
      clearParseStallTimer();
      stopHeartbeat();
    };
  }, [handleLoad, handleError, handleProgress, handleArStatus, disarmTapListener, clearParseStallTimer, stopHeartbeat]);

  // Cold-start / hard-timeout watchdog, independent of model-viewer's own
  // events (those never fire at all if the fetch just hangs).
  useEffect(() => {
    const hintTimer = setTimeout(() => {
      if (!modelReady && !modelError) {
        setColdStartHint(true);
        setStatus('⏳ Waking up the server… first load can take up to a minute');
      }
    }, COLD_START_HINT_MS);

    const hardTimer = setTimeout(() => {
      if (!modelReady && !modelError) {
        const stalledInParse = downloadCompleteAtRef.current != null;
        console.error(
          `[AR] Hard timeout after ${HARD_TIMEOUT_MS}ms — never reached 'load' or 'error'. ` +
          `Stalled in: ${stalledInParse ? 'parse/decode (download had completed)' : 'download'}.`
        );
        stopHeartbeat();
        setModelError(true);
        setStatus(
          stalledInParse
            ? '❌ Timed out processing this model. It may have a very large texture — try again, or use a lower-resolution export.'
            : '❌ Timed out loading the model. Please check your connection and try again.'
        );
      }
    }, HARD_TIMEOUT_MS);

    return () => {
      clearTimeout(hintTimer);
      clearTimeout(hardTimer);
    };
  }, [modelReady, modelError, stopHeartbeat]);

  // Real, tap-free auto-placement is only possible via a raw in-page WebXR
  // hit-test session (Chrome on ARCore-capable Android). Scene Viewer and
  // Quick Look are native OS hand-offs that always require one placement
  // tap by platform design — no web API can skip that step there. We
  // detect the one case where a truly automatic placement flow is
  // possible and offer it as an extra option rather than promising
  // something the platform won't allow.
  useEffect(() => {
    let cancelled = false;
    if (navigator.xr?.isSessionSupported) {
      navigator.xr.isSessionSupported('immersive-ar')
        .then((supported) => {
          if (!cancelled) setInstantArAvailable(supported);
        })
        .catch(() => {
          if (!cancelled) setInstantArAvailable(false);
        });
    }
    return () => { cancelled = true; };
  }, []);

  // Release the pre-generated USDZ blob if the user navigates away before
  // ever tapping (otherwise it leaks for the life of the tab).
  useEffect(() => {
    return () => {
      if (usdzBlobUrlRef.current) {
        URL.revokeObjectURL(usdzBlobUrlRef.current);
        usdzBlobUrlRef.current = null;
      }
    };
  }, []);

  const retry = () => {
    setModelError(false);
    setModelReady(false);
    setColdStartHint(false);
    setStatus('Loading 3D model...');
    arLaunchedRef.current = false;
    usdzBlobUrlRef.current = null;
    usdzFailedRef.current = false;
    downloadCompleteAtRef.current = null;
    mountedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    clearParseStallTimer();
    stopHeartbeat();
    disarmTapListener();
    const el = modelViewerRef.current;
    if (el) {
      // Force a fresh fetch rather than relying on a cached failure.
      const src = el.src;
      el.src = '';
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
      el.src = src;
    }
  };

  // Renders the on-device diagnostics tab/panel described above. Shared
  // between the normal view and the error screen so it's available
  // regardless of which state the component ends up stuck in — that's the
  // whole point, since the failure being diagnosed is exactly the case
  // where the person hitting it has no other way to see what happened.
  const renderDiagPanel = () => (
    <>
      <button
        className="diag-tab"
        onClick={() => setShowDiag((v) => !v)}
        aria-label="Toggle diagnostics"
      >
        🐞
      </button>
      {showDiag && (
        <div className="diag-panel">
          <p><strong>model-viewer registered:</strong> {diag.mvDefined === null ? '…' : diag.mvDefined ? '✓ yes' : '✗ NO'}</p>
          <p><strong>&lt;model-viewer&gt; element:</strong> {diag.mvElementFound === null ? '…' : diag.mvElementFound ? '✓ found' : '✗ missing'}</p>
          <p><strong>Model URL fetch:</strong> {diag.fetchCheck === 'pending' ? '… checking' : diag.fetchCheck === 'ok' ? '✓ ok' : '✗ failed'}</p>
          {diag.fetchDetail && <p className="diag-detail">{diag.fetchDetail}</p>}
          <p><strong>canActivateAR:</strong> {diag.canAR === null ? '… (unknown until model loads)' : diag.canAR ? '✓ true' : '✗ false'}</p>
          <p><strong>Model loaded:</strong> {modelReady ? '✓ yes' : '✗ not yet'}</p>
          <p><strong>Platform:</strong> {isIOS ? 'iOS' : isAndroid ? 'Android' : 'other'}</p>
          <p className="diag-detail">{typeof navigator !== 'undefined' ? navigator.userAgent : ''}</p>
          <p className="diag-detail">src: {modelSrc}</p>
        </div>
      )}
    </>
  );

  return (
    <div className="ar-viewer-mv">
      {!modelError ? (
        <>
          <model-viewer
            ref={modelViewerRef}
            src={modelSrc}
            alt="3D Model"
            ar
            ar-modes="scene-viewer webxr quick-look"
            ar-placement="floor"
            ar-scale="fixed"
            crossorigin="anonymous"
            camera-controls
            touch-action="pan-y"
            auto-rotate
            shadow-intensity="1"
            environment-image="neutral"
            loading="eager"
            reveal="auto"
            class="model-viewer-element"
          >
            {/* model-viewer renders its own floating default AR button
                (one more piece of unwanted UI) unless something is slotted
                into ar-button. There is intentionally NO visible AR button
                anywhere in this component — AR launching is entirely
                driven by our own code (eager auto-launch on Android/desktop,
                pre-generated-USDZ tap-anywhere on iOS). This stays
                empty/invisible; it only exists to suppress model-viewer's
                default button. */}
            <button slot="ar-button" className="ar-button-slot-suppressed" aria-hidden="true" tabIndex={-1} />
          </model-viewer>

          <div className="ar-status-overlay">
            <div className="status-box">
              <p>{status}</p>
              {coldStartHint && !modelError && (
                <div className="spinner" aria-label="loading" />
              )}
            </div>

            {modelReady && arSupported === false && (
              <div className="status-box status-box-secondary">
                <p>AR isn't supported by this browser/device. You can still rotate and pinch-to-zoom the 3D model above.</p>
              </div>
            )}

            {modelReady && arSupported && instantArAvailable && (
              <a href={`/view-webxr/${modelId}`} className="instant-ar-link">
                Try instant auto-placing AR (experimental)
              </a>
            )}
          </div>

          <button
            className="exit-btn"
            onClick={() => { window.location.href = '/'; }}
          >
            ✕ Exit
          </button>

          {renderDiagPanel()}
        </>
      ) : (
        <div className="error-screen">
          <div className="error-message">
            <p>{status}</p>
            <button onClick={retry}>Try Again</button>
            <button onClick={() => window.location.href = '/'} className="secondary-btn">
              Return to Dashboard
            </button>
          </div>

          {renderDiagPanel()}
        </div>
      )}
    </div>
  );
}

export default ARViewerModelViewer;
