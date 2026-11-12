import { useEffect, useRef, useState } from 'react';

const MODEL_URL = 'https://arigroup-web.vercel.app/models/astronaut.glb';

export default function ARStep2() {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const [logs, setLogs]   = useState([]);
  const [status, setStatus] = useState('Starting camera…');

  function addLog(msg, color) {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-12), { msg: `[${time}] ${msg}`, color: color || '#0f0' }]);
    console.log(msg);
  }

  useEffect(() => {
    let renderer, animId;

    // ── Load THREE + GLTFLoader from CDN ─────────────────────────────────────
    function loadScript(src) {
      return new Promise((res, rej) => {
        if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    async function init() {
      // 1. Camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        addLog('Camera OK');
        setStatus('Camera OK — loading scripts…');
      } catch (e) {
        addLog('Camera FAIL: ' + e.message, '#f00');
        setStatus('Camera error');
      }

      // 2. Three.js scripts
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.137.0/build/three.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/three@0.137.0/examples/js/loaders/GLTFLoader.js');
        addLog('Three.js loaded');
      } catch (e) {
        addLog('Script load FAIL: ' + e.message, '#f00');
        setStatus('Failed to load Three.js');
        return;
      }

      const THREE = window.THREE;

      // 3. Renderer
      renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(0x000000, 0);

      const scene  = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
      camera.position.set(0, 0, 3);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.5);
      sun.position.set(2, 4, 3); scene.add(sun);

      const handleResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener('resize', handleResize);

      // 4. Load model
      setStatus('Loading model…');
      addLog('Loading: ' + MODEL_URL.split('/').pop());

      new THREE.GLTFLoader().load(
        MODEL_URL,
        (gltf) => {
          addLog('Model loaded OK');
          setStatus('✅ Model loaded — spinning');

          const model = gltf.scene;
          const box   = new THREE.Box3().setFromObject(model);
          const size  = box.getSize(new THREE.Vector3());
          const mx    = Math.max(size.x, size.y, size.z);
          if (mx > 0) model.scale.setScalar(1 / mx);
          const c = box.getCenter(new THREE.Vector3());
          model.position.sub(c.multiplyScalar(1 / mx));
          scene.add(model);

          const animate = () => {
            animId = requestAnimationFrame(animate);
            model.rotation.y += 0.012;
            renderer.render(scene, camera);
          };
          animate();
        },
        (xhr) => {
          if (xhr.total > 0) {
            const pct = Math.round((xhr.loaded / xhr.total) * 100);
            setStatus('Loading… ' + pct + '%');
          }
        },
        (err) => {
          addLog('Model FAIL: ' + (err.message || String(err)), '#f00');
          setStatus('Model failed to load');
        }
      );

      return () => {
        window.removeEventListener('resize', handleResize);
        cancelAnimationFrame(animId);
        renderer?.dispose();
      };
    }

    const cleanup = init();
    return () => { cleanup.then(fn => fn && fn()); };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }}>
      {/* Camera feed */}
      <video
        ref={videoRef}
        autoPlay playsInline muted
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}
      />

      {/* Three.js canvas */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }}
      />

      {/* Debug log */}
      <div style={{
        position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10,
        background: 'rgba(0,0,0,0.75)', borderRadius: 8, padding: 10,
        maxHeight: 140, overflowY: 'auto', pointerEvents: 'none',
      }}>
        {logs.map((l, i) => (
          <div key={i} style={{ color: l.color, fontFamily: 'monospace', fontSize: 11 }}>{l.msg}</div>
        ))}
      </div>

      {/* Status */}
      <div style={{
        position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)', color: '#fff', zIndex: 10,
        fontFamily: '-apple-system, sans-serif', fontSize: 14, fontWeight: 600,
        padding: '10px 24px', borderRadius: 20, whiteSpace: 'nowrap',
      }}>
        {status}
      </div>
    </div>
  );
}
