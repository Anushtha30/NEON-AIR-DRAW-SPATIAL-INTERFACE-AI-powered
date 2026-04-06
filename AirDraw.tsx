import { useRef, useEffect, useState, useCallback } from "react";
import {
  Stroke,
  Point,
  createStroke,
  addPointToStroke,
  renderStrokes,
  renderStroke,
  getNearestStroke,
  eraseStrokes,
  getStrokeCentroid,
  NEON_COLORS,
} from "@/lib/drawingEngine";
import { detectGesture, mirrorX, HandResults, GestureType } from "@/lib/handTracking";
import Toolbar from "@/components/Toolbar";
import GestureGuide from "@/components/GestureGuide";
import HUD from "@/components/HUD";
import Loader from "@/components/Loader";
import Background from "@/components/Background";
import IntroScreen from "@/components/IntroScreen";

declare global {
  interface Window {
    Hands: new (config: { locateFile: (file: string) => string }) => {
      setOptions: (opts: {
        maxNumHands: number;
        modelComplexity: number;
        minDetectionConfidence: number;
        minTrackingConfidence: number;
      }) => void;
      onResults: (cb: (results: HandResults) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
    };
  }
}

export default function AirDraw() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<ReturnType<typeof window.Hands> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameLoopRef = useRef<number>(0);
  const onResultsRef = useRef<typeof onResults | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const activeStrokeIdRef = useRef<string | null>(null);
  const prevGestureRef = useRef<GestureType>("idle");
  const prevPinchDistRef = useRef<number>(0);
  const prevMoveRef = useRef<Point | null>(null);
  const prevRotRef = useRef<Point | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentColor, setCurrentColor] = useState(NEON_COLORS[0]);
  const [brushSize, setBrushSize] = useState(4);
  const [opacity, setOpacity] = useState(0.9);
  const [gesture, setGesture] = useState<GestureType>("idle");
  const [rightGesture, setRightGesture] = useState<GestureType>("idle");
  const [leftGesture, setLeftGesture] = useState<GestureType>("idle");
  const [fps, setFps] = useState(0);
  const [phase, setPhase] = useState<"intro" | "loading" | "ready">("intro");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const fpsCounterRef = useRef({ frames: 0, last: Date.now() });
  const raf = useRef<number>(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderStrokes(ctx, strokesRef.current, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    strokesRef.current = strokes;
    redraw();
  }, [strokes, redraw]);

  const updateFps = useCallback(() => {
    const fc = fpsCounterRef.current;
    fc.frames++;
    const now = Date.now();
    if (now - fc.last >= 1000) {
      setFps(fc.frames);
      fc.frames = 0;
      fc.last = now;
    }
  }, []);

  const onResults = useCallback(
    (results: HandResults) => {
      updateFps();
      const overlay = overlayRef.current;
      const canvas = canvasRef.current;
      if (!overlay || !canvas) return;
      const octx = overlay.getContext("2d");
      if (!octx) return;
      octx.clearRect(0, 0, overlay.width, overlay.height);

      if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
        prevGestureRef.current = "idle";
        prevMoveRef.current = null;
        prevRotRef.current = null;
        setGesture("idle");
        setRightGesture("idle");
        setLeftGesture("idle");
        return;
      }

      for (let hi = 0; hi < results.multiHandLandmarks.length; hi++) {
        const landmarks = results.multiHandLandmarks[hi];
        const handedness = results.multiHandedness[hi];
        const rawLabel = handedness.label as "Left" | "Right";
        const handLabel = rawLabel === "Right" ? "Left" : "Right";

        const mirroredLandmarks = landmarks.map((lm) => ({
          x: mirrorX(lm.x),
          y: lm.y,
          z: lm.z,
        }));

        const info = detectGesture(mirroredLandmarks, handLabel);
        const { gesture: g, indexTip, pinchDistance } = info;

        const w = overlay.width;
        const h = overlay.height;

        if (handLabel === "Right") {
          setRightGesture(g);
          setGesture(g);

          if (g === "drawing") {
            if (prevGestureRef.current !== "drawing") {
              const stroke = createStroke(currentColor, brushSize, opacity);
              activeStrokeRef.current = stroke;
              activeStrokeIdRef.current = stroke.id;
            }

            if (activeStrokeRef.current) {
              const pt: Point = { x: indexTip.x, y: indexTip.y };
              activeStrokeRef.current = addPointToStroke(activeStrokeRef.current, pt);

              const ctx = canvas.getContext("2d");
              if (ctx) {
                renderStrokes(ctx, strokesRef.current, w, h);
                renderStroke(ctx, activeStrokeRef.current, w, h);
              }
            }

            octx.beginPath();
            octx.arc(indexTip.x * w, indexTip.y * h, 6, 0, Math.PI * 2);
            octx.fillStyle = currentColor;
            octx.shadowBlur = 15;
            octx.shadowColor = currentColor;
            octx.fill();
          } else if (g === "erasing") {
            const er = 40;
            octx.beginPath();
            octx.arc(indexTip.x * w, indexTip.y * h, er, 0, Math.PI * 2);
            octx.strokeStyle = "rgba(255,100,100,0.8)";
            octx.lineWidth = 2;
            octx.shadowBlur = 10;
            octx.shadowColor = "rgba(255,100,100,0.8)";
            octx.stroke();

            setStrokes((prev) => {
              const updated = eraseStrokes(prev, indexTip.x, indexTip.y, er, w, h);
              strokesRef.current = updated;
              return updated;
            });
          } else if (g === "clear") {
            octx.fillStyle = "rgba(255, 50, 50, 0.08)";
            octx.fillRect(0, 0, w, h);
          }

          if (prevGestureRef.current === "drawing" && g !== "drawing") {
            if (activeStrokeRef.current && activeStrokeRef.current.points.length > 1) {
              const finished = activeStrokeRef.current;
              setStrokes((prev) => [...prev, finished]);
              strokesRef.current = [...strokesRef.current, finished];
            }
            activeStrokeRef.current = null;
            activeStrokeIdRef.current = null;
          }

          if (g === "clear" && prevGestureRef.current !== "clear") {
            setTimeout(() => {
              setStrokes([]);
              strokesRef.current = [];
              const ctx = canvas.getContext("2d");
              if (ctx) ctx.clearRect(0, 0, w, h);
            }, 300);
          }

          prevGestureRef.current = g;
        } else {
          setLeftGesture(g);

          if (g === "move") {
            const nearest = getNearestStroke(strokesRef.current, indexTip.x, indexTip.y, w, h);
            if (nearest) {
              const centroid = getStrokeCentroid(nearest, w, h);
              const realX = centroid.x / w + nearest.tx;
              const realY = centroid.y / h + nearest.ty;
              const dist = Math.sqrt(
                (realX - indexTip.x) ** 2 + (realY - indexTip.y) ** 2
              );

              octx.beginPath();
              octx.arc(indexTip.x * w, indexTip.y * h, 12, 0, Math.PI * 2);
              octx.strokeStyle = "#4aaeff";
              octx.lineWidth = 2;
              octx.shadowBlur = 15;
              octx.shadowColor = "#4aaeff";
              octx.stroke();

              octx.beginPath();
              octx.moveTo(indexTip.x * w - 15, indexTip.y * h);
              octx.lineTo(indexTip.x * w + 15, indexTip.y * h);
              octx.moveTo(indexTip.x * w, indexTip.y * h - 15);
              octx.lineTo(indexTip.x * w, indexTip.y * h + 15);
              octx.stroke();

              if (prevMoveRef.current) {
                const dx = indexTip.x - prevMoveRef.current.x;
                const dy = indexTip.y - prevMoveRef.current.y;

                if (dist < 0.35) {
                  setStrokes((prev) =>
                    prev.map((s) =>
                      s.id === nearest.id
                        ? { ...s, tx: s.tx + dx, ty: s.ty + dy }
                        : s
                    )
                  );
                }
              }
              prevMoveRef.current = { x: indexTip.x, y: indexTip.y };
            }
          } else {
            prevMoveRef.current = null;
          }

          if (g === "scale") {
            const nearest = getNearestStroke(strokesRef.current, indexTip.x, indexTip.y, w, h);
            if (nearest) {
              const scaleRings = [20, 35, 50];
              for (const r of scaleRings) {
                octx.beginPath();
                octx.arc(indexTip.x * w, indexTip.y * h, r, 0, Math.PI * 2);
                octx.strokeStyle = `rgba(100, 220, 220, ${0.4 - r / 150})`;
                octx.lineWidth = 1;
                octx.stroke();
              }

              if (prevPinchDistRef.current > 0) {
                const ratio = pinchDistance / prevPinchDistRef.current;
                const clampedRatio = Math.max(0.9, Math.min(1.1, ratio));
                setStrokes((prev) =>
                  prev.map((s) =>
                    s.id === nearest.id
                      ? { ...s, scale: Math.max(0.1, Math.min(5, s.scale * clampedRatio)) }
                      : s
                  )
                );
              }
              prevPinchDistRef.current = pinchDistance;
            }
          } else {
            prevPinchDistRef.current = 0;
          }

          if (g === "rotate") {
            const nearest = getNearestStroke(strokesRef.current, indexTip.x, indexTip.y, w, h);
            if (nearest) {
              const radius = 40;
              octx.beginPath();
              octx.arc(indexTip.x * w, indexTip.y * h, radius, 0, Math.PI * 2);
              octx.strokeStyle = "rgba(255, 165, 0, 0.6)";
              octx.lineWidth = 2;
              octx.shadowBlur = 15;
              octx.shadowColor = "rgba(255, 165, 0, 0.6)";
              octx.stroke();

              for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                const snapX = indexTip.x * w + Math.cos(angle) * radius;
                const snapY = indexTip.y * h + Math.sin(angle) * radius;
                octx.beginPath();
                octx.arc(snapX, snapY, 3, 0, Math.PI * 2);
                octx.fillStyle = "rgba(255, 165, 0, 0.8)";
                octx.fill();
              }

              if (prevRotRef.current) {
                const dx = indexTip.x - prevRotRef.current.x;
                const dy = indexTip.y - prevRotRef.current.y;
                const rotDelta = dx * 3;

                setStrokes((prev) =>
                  prev.map((s) =>
                    s.id === nearest.id
                      ? { ...s, rotation: s.rotation + rotDelta }
                      : s
                  )
                );
              }
              prevRotRef.current = { x: indexTip.x, y: indexTip.y };
            }
          } else {
            prevRotRef.current = null;
          }
        }

        for (const lm of mirroredLandmarks) {
          octx.beginPath();
          octx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
          octx.fillStyle =
            handLabel === "Right"
              ? "rgba(177, 108, 234, 0.7)"
              : "rgba(74, 174, 255, 0.7)";
          octx.fill();
        }

        const connections = [
          [0, 1], [1, 2], [2, 3], [3, 4],
          [0, 5], [5, 6], [6, 7], [7, 8],
          [5, 9], [9, 10], [10, 11], [11, 12],
          [9, 13], [13, 14], [14, 15], [15, 16],
          [13, 17], [17, 18], [18, 19], [19, 20],
          [0, 17],
        ];
        octx.strokeStyle =
          handLabel === "Right"
            ? "rgba(177, 108, 234, 0.4)"
            : "rgba(74, 174, 255, 0.4)";
        octx.lineWidth = 1.5;
        octx.shadowBlur = 0;
        for (const [a, b] of connections) {
          octx.beginPath();
          octx.moveTo(mirroredLandmarks[a].x * w, mirroredLandmarks[a].y * h);
          octx.lineTo(mirroredLandmarks[b].x * w, mirroredLandmarks[b].y * h);
          octx.stroke();
        }
      }
    },
    [currentColor, brushSize, opacity, updateFps]
  );

  // Keep a stable ref to onResults so the frame loop never captures a stale closure
  useEffect(() => { onResultsRef.current = onResults; }, [onResults]);

  const handleStart = useCallback(() => {
    setPhase("loading");
  }, []);

  // ── Camera init: runs once when phase becomes "loading" ──────────────────
  // IMPORTANT: the cleanup here must NOT stop the stream — that would kill the
  // camera the moment phase changes to "ready". Stream teardown lives below.
  useEffect(() => {
    if (phase !== "loading") return;
    let active = true; // guards async state updates only

    async function init() {
      try {
        // 1. Load MediaPipe Hands script
        await new Promise<void>((resolve, reject) => {
          if (typeof window.Hands !== "undefined") { resolve(); return; }
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
          s.crossOrigin = "anonymous";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Failed to load MediaPipe Hands"));
          document.head.appendChild(s);
        });

        if (!active) return;

        // 2. Open camera — browser shows permission prompt here
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("NotAllowedError: Camera API not available in this context");
        }

        let stream: MediaStream | null = null;
        const constraintsList: MediaStreamConstraints[] = [
          { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: true, audio: false },
        ];
        let lastErr: unknown;
        for (const c of constraintsList) {
          try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
          catch (e) { lastErr = e; }
        }
        if (!stream) {
          const e = lastErr as DOMException | undefined;
          const name = e?.name ?? "";
          if (name === "NotFoundError" || name === "DevicesNotFoundError") throw new Error("NotFoundError");
          throw new Error("NotAllowedError");
        }

        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }

        // 3. Wire stream to video element (race-safe readyState check)
        const video = videoRef.current!;
        video.srcObject = stream;
        streamRef.current = stream; // kept alive until component unmounts

        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("Video metadata timeout")), 8000);
          const done = () => { clearTimeout(t); resolve(); };
          if (video.readyState >= 1) {
            video.play().then(done).catch(done);
          } else {
            video.onloadedmetadata = () => video.play().then(done).catch(done);
          }
        });

        if (!active) return;

        // 4. Init MediaPipe Hands
        const hands = new window.Hands({
          locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
        });
        hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
        hands.onResults((results: HandResults) => {
          if (onResultsRef.current) onResultsRef.current(results);
        });
        handsRef.current = hands;

        // 5. rAF loop — keeps running until component unmounts (frameLoopRef is cancelled below)
        let busy = false;
        const loop = async () => {
          if (!streamRef.current) return; // stream gone = component unmounted
          if (!busy && handsRef.current && video.readyState >= 2) {
            busy = true;
            try { await handsRef.current.send({ image: video }); } catch { /* ignore */ }
            busy = false;
          }
          frameLoopRef.current = requestAnimationFrame(loop);
        };
        frameLoopRef.current = requestAnimationFrame(loop);

        if (active) setPhase("ready"); // phase "ready" — cleanup below does NOT stop stream

      } catch (err: unknown) {
        console.error("Camera init error:", err);
        const msg = err instanceof Error ? err.message : String(err);
        if (active) {
          setPhase("ready");
          if (msg.includes("NotFound")) {
            setCameraError("No camera found. Please connect a webcam and try again.");
          } else if (msg.includes("NotAllowed")) {
            setCameraError("Camera permission denied. Click 'Allow' when your browser asks, then try again.");
          } else {
            setCameraError(`Could not start camera: ${msg}`);
          }
        }
      }
    }

    init();

    // Only mark inactive — do NOT stop stream here (phase change would kill it)
    return () => { active = false; };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stream teardown: runs only when the component unmounts ───────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(frameLoopRef.current);
      cancelAnimationFrame(raf.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []); // empty deps = unmount only

  useEffect(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas!.width = w;
      canvas!.height = h;
      overlay!.width = w;
      overlay!.height = h;
      renderStrokes(canvas!.getContext("2d")!, strokesRef.current, w, h);
    }

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const handleUndo = useCallback(() => {
    setStrokes((prev) => {
      const updated = prev.slice(0, -1);
      strokesRef.current = updated;
      redraw();
      return updated;
    });
  }, [redraw]);

  const handleClear = useCallback(() => {
    setStrokes([]);
    strokesRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const handleSave = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `neon-air-draw-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden" style={{ background: "#04060f" }}>
      <Background />
      <video
        ref={videoRef}
        className="hidden"
        autoPlay
        playsInline
        muted
        data-testid="webcam-video"
      />

      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        data-testid="drawing-canvas"
      />
      <canvas
        ref={overlayRef}
        className="absolute inset-0 z-20 pointer-events-none"
        data-testid="overlay-canvas"
      />

      {phase === "intro" && <IntroScreen onStart={handleStart} />}
      {phase === "loading" && <Loader />}

      {cameraError && phase === "ready" && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-sm"
          data-testid="camera-error"
        >
          <div className="text-5xl mb-6" style={{ filter: "drop-shadow(0 0 20px #ff5e69)" }}>
            📷
          </div>
          <h2 className="text-xl font-semibold text-white mb-3">Camera Required</h2>
          <p className="text-sm text-white/50 text-center max-w-sm font-mono-premium leading-relaxed">
            {cameraError}
          </p>
          <div className="flex flex-col items-center gap-3 mt-6">
            <div className="flex gap-3">
              <button
                onClick={() => { setCameraError(null); setPhase("intro"); }}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
                data-testid="btn-retry"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/70 text-sm font-medium transition-colors"
                data-testid="btn-reload"
              >
                Reload Page
              </button>
            </div>
            <button
              onClick={() => window.open(window.location.href, "_blank")}
              className="px-5 py-2 rounded-xl text-xs text-purple-300 hover:text-purple-200 underline underline-offset-2 transition-colors"
              data-testid="btn-new-tab"
            >
              Open in new tab (fixes camera in embedded views)
            </button>
          </div>
        </div>
      )}

      {phase === "ready" && !cameraError && (
        <HUD
          gesture={gesture}
          rightGesture={rightGesture}
          leftGesture={leftGesture}
          fps={fps}
          strokeCount={strokes.length}
        />
      )}

      {phase === "ready" && (
        <Toolbar
          currentColor={currentColor}
          onColorChange={setCurrentColor}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          opacity={opacity}
          onOpacityChange={setOpacity}
          onUndo={handleUndo}
          onClear={handleClear}
          onSave={handleSave}
          onGuide={() => setShowGuide(true)}
        />
      )}

      {showGuide && <GestureGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
