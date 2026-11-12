import { useEffect, useRef, useState } from 'react';

/*
  Android AR viewer — WebXR hit-test (surface tracking) with Three.js.
  Based on Three.js webxr_ar_hittest.html (proven working example).
  Falls back to gyroscope-float mode if WebXR unavailable.
  Receives ?model=<url> query param (or prop) for the GLB to place.
*/

const DEFAULT_MODEL = 'https://arigroup-web.vercel.app/models/astronaut.glb';

function getModelUrl() {
  const p = new URLSearchParams(window.location.search).get('model');
  return p ? decodeURIComponent(p) : DEFAULT_MODEL;
}

export default function ARViewer2({ glbUrl, onClose }) {
  const mountRef = useRef(null);
  const [phase, setPhase]   = useState('idle');   // idle | loading | xr | gyro | error
  const [msg, setMsg]       = useState('');
  const [supported, setSupported] = useState(null);
  const stateRef = useRef({});

  // Check WebXR support on mount
  useEffect(() => {
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-ar')
        .then(ok => setSupported(ok))
        .catch(() => setSupported(false));
    } else {
      setSupported(false);
    }
  }, []);

  async function startAR() {
    setPhase('loading');
    setMsg('Loading Three.js…');

    try {
      await loadScript('https://cdn.jsdelivr.net/npm/three@0.137.0/build/three.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/three@0.137.0/examples/js/loaders/GLTFLoader.js');
      await loadScript('https://cdn.jsdelivr.net/npm/three@0.137.0/examples/js/webxr/ARButton.js');
    } catch (e) {
      setPhase('error'); setMsg('Failed to load Three.js: ' + e.message); return;
    }

    const THREE = window.THREE;
    const modelUrl = glbUrl || getModelUrl();

    // ── Scene ──────────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(1, 3, 2); scene.add(dirLight);

    // ── Renderer ───────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.setClearColor(0x000000, 0);
    mountRef.current.appendChild(renderer.domElement);

    // ── Reticle (shows where surface was found) ────────────────────────────────
    const reticleGeo = new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const reticle = new THREE.Mesh(reticleGeo, reticleMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // ── Camera ─────────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    // ── Load model ─────────────────────────────────────────────────────────────
    setMsg('Loading model…');
    let modelScene = null;
    await new Promise((res, rej) => {
      new THREE.GLTFLoader().load(
        modelUrl,
        (gltf) => {
          modelScene = gltf.scene;
          // Normalise to ~0.3m tall
          const box = new THREE.Box3().setFromObject(modelScene);
          const size = box.getSize(new THREE.Vector3());
          const mx = Math.max(size.x, size.y, size.z);
          if (mx > 0) modelScene.scale.setScalar(0.3 / mx);
          const c = box.getCenter(new THREE.Vector3());
          modelScene.position.sub(c.multiplyScalar(0.3 / mx));
          modelScene.visible = false;
          scene.add(modelScene);
          setMsg('Model ready');
          res();
        },
        null,
        (err) => rej(new Error('Model load failed: ' + (err.message || err)))
      );
    }).catch(e => { setPhase('error'); setMsg(e.message); throw e; });

    // ── WebXR path ─────────────────────────────────────────────────────────────
    if (supported) {
      setMsg('Starting camera…');
      let hitTestSource = null;
      let hitTestSourceRequested = false;
      let placed = false;

      try {
        const session = await navigator.xr.requestSession('immersive-ar', {
          requiredFeatures: ['hit-test'],
          optionalFeatures: ['dom-overlay'],
          domOverlay: { root: mountRef.current },
        });

        renderer.xr.setSession(session);
        setPhase('xr');
        setMsg('Scan a surface…');

        session.addEventListener('select', () => {
          if (reticle.visible && modelScene && !placed) {
            modelScene.position.setFromMatrixPosition(reticle.matrix);
            modelScene.visible = true;
            placed = true;
            setMsg('Placed! Tap again to reposition');
          } else if (reticle.visible && modelScene && placed) {
            modelScene.position.setFromMatrixPosition(reticle.matrix);
          }
        });

        renderer.setAnimationLoop((timestamp, frame) => {
          if (frame) {
            const refSpace = renderer.xr.getReferenceSpace();
            const session2 = renderer.xr.getSession();

            if (!hitTestSourceRequested) {
              session2.requestReferenceSpace('viewer').then(vs => {
                session2.requestHitTestSource({ space: vs }).then(s => { hitTestSource = s; });
              });
              session2.addEventListener('end', () => { hitTestSourceRequested = false; hitTestSource = null; });
              hitTestSourceRequested = true;
            }

            if (hitTestSource) {
              const hits = frame.getHitTestResults(hitTestSource);
              if (hits.length > 0) {
                const pose = hits[0].getPose(refSpace);
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
                if (!placed) setMsg('Surface found — tap to place');
              } else {
                reticle.visible = false;
                if (!placed) setMsg('Keep scanning…');
              }
            }
          }
          renderer.render(scene, camera);
        });

        stateRef.current.cleanup = () => {
          renderer.setAnimationLoop(null);
          session.end().catch(() => {});
          renderer.dispose();
          mountRef.current?.removeChild(renderer.domElement);
        };

      } catch (e) {
        // WebXR failed — fall through to gyroscope
        setMsg('WebXR failed, using gyroscope…');
        startGyroMode(scene, camera, renderer, modelScene, setMsg, setPhase, stateRef, mountRef);
      }

    } else {
      // Gyroscope fallback
      setMsg('No WebXR — using gyroscope mode');
      startGyroMode(scene, camera, renderer, modelScene, setMsg, setPhase, stateRef, mountRef);
    }
  }

  function stop() {
    stateRef.current.cleanup?.();
    stateRef.current = {};
    setPhase('idle');
    setMsg('');
    onClose?.();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      {/* WebXR / Three.js canvas mounts here */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      {/* Start screen */}
      {phase === 'idle' && (
        <div style={styles.center}>
          <div style={styles.card}>
            <div style={styles.cardTitle}>ARIGroup AR Viewer</div>
            <div style={styles.cardSub}>
              {supported === true  && 'Surface tracking ready'}
              {supported === false && 'Gyroscope mode (no WebXR)'}
              {supported === null  && 'Checking device…'}
            </div>
            <button style={styles.startBtn} onClick={startAR} disabled={supported === null}>
              Start AR
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {phase === 'loading' && (
        <div style={styles.center}>
          <div style={styles.spinner} />
          <div style={styles.loadingTxt}>{msg}</div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && (
        <div style={styles.center}>
          <div style={{ color: '#f55', fontFamily: 'monospace', padding: 20, textAlign: 'center', fontSize: 13 }}>
            {msg}
          </div>
          <button style={styles.exitBtn} onClick={stop}>Close</button>
        </div>
      )}

      {/* Active AR — status pill + exit */}
      {(phase === 'xr' || phase === 'gyro') && (
        <>
          <div style={styles.pill}>{msg}</div>
          <button style={styles.exitBtn} onClick={stop}>✕ Exit</button>
        </>
      )}
    </div>
  );
}

// ── Gyroscope fallback ───────────────────────────────────────────────────────
function startGyroMode(scene, camera, renderer, modelScene, setMsg, setPhase, stateRef, mountRef) {
  const THREE = window.THREE;
  if (modelScene) { modelScene.visible = true; modelScene.position.set(0, 0, -1.5); }

  // Camera feed as background
  const video = document.createElement('video');
  video.autoplay = true; video.muted = true; video.playsInline = true;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    .then(s => { video.srcObject = s; video.play(); })
    .catch(() => {});

  const vidTex = new THREE.VideoTexture(video);
  scene.background = vidTex;

  let alpha0 = null, beta0 = null, gamma0 = null;
  const onOri = (e) => {
    if (alpha0 === null) { alpha0 = e.alpha; beta0 = e.beta; gamma0 = e.gamma; }
    const da = THREE.MathUtils.degToRad((e.alpha - alpha0) || 0);
    const db = THREE.MathUtils.degToRad((e.beta  - beta0)  || 0);
    camera.rotation.set(db * 0.5, -da * 0.5, 0, 'YXZ');
  };
  window.addEventListener('deviceorientation', onOri);

  renderer.setAnimationLoop(() => {
    if (modelScene) modelScene.rotation.y += 0.008;
    renderer.render(scene, camera);
  });

  setPhase('gyro');
  setMsg('Gyroscope mode — model floating in front');

  stateRef.current.cleanup = () => {
    window.removeEventListener('deviceorientation', onOri);
    renderer.setAnimationLoop(null);
    renderer.dispose();
    video.srcObject?.getTracks().forEach(t => t.stop());
    mountRef.current?.removeChild(renderer.domElement);
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

const styles = {
  center: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  card: {
    background: 'rgba(0,0,0,0.85)', borderRadius: 16, padding: '32px 28px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
    minWidth: 240,
  },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: 700, fontFamily: '-apple-system,sans-serif' },
  cardSub: { color: '#aaa', fontSize: 13, fontFamily: '-apple-system,sans-serif', textAlign: 'center' },
  startBtn: {
    background: '#e37400', color: '#fff', border: 'none', borderRadius: 10,
    fontSize: 16, fontWeight: 700, padding: '13px 36px', cursor: 'pointer',
    fontFamily: '-apple-system,sans-serif',
  },
  spinner: {
    width: 44, height: 44, border: '3px solid #333', borderTopColor: '#e37400',
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },
  loadingTxt: {
    color: '#fff', fontSize: 14, fontFamily: '-apple-system,sans-serif',
    marginTop: 16, textAlign: 'center', padding: '0 20px',
  },
  pill: {
    position: 'absolute', bottom: 50, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.75)', color: '#fff', zIndex: 10,
    fontFamily: '-apple-system,sans-serif', fontSize: 14, fontWeight: 600,
    padding: '10px 24px', borderRadius: 20, whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  exitBtn: {
    position: 'absolute', top: 20, right: 20, zIndex: 20,
    background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none',
    borderRadius: 20, padding: '8px 18px', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', fontFamily: '-apple-system,sans-serif',
  },
};
