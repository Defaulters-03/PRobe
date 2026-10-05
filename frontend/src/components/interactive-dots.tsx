"use client";

import * as React from "react";

interface Dot {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  baseOpacity: number;
  opacity: number;
  radius: number;
  active: boolean;
  bucket: number;
}

const SPACING = 20;
const BASE_RADIUS = 1;

const INTERACTION_RADIUS = 140;
const MAX_DISPLACEMENT = 12;
const PEAK_ADDITIONAL_OPACITY = 0.25;
const PEAK_RADIUS_MULT = 1.3;

const LIGHT_RADIUS = 280;
const LIGHT_LERP = 0.12;

// 4 resting opacity buckets for batched rendering with subtle edge vignette
const BUCKET_COLORS = [
  "rgba(255, 255, 255, 0.08)",
  "rgba(255, 255, 255, 0.068)",
  "rgba(255, 255, 255, 0.056)",
  "rgba(255, 255, 255, 0.046)",
];

export function InteractiveDots() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Check accessibility & device capabilities
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const touchQuery = window.matchMedia("(hover: none), (pointer: coarse)");
    const isInteractive = !motionQuery.matches && !touchQuery.matches;

    let canvasWidth = 0;
    let canvasHeight = 0;
    let cols = 0;
    let rows = 0;

    let dots: Dot[] = [];
    let bucketDots: Dot[][] = [[], [], [], []];
    const activeDotIndices = new Set<number>();

    // Pointer state (viewport CSS pixels)
    let pointerX = -1000;
    let pointerY = -1000;
    let pointerInside = false;

    // Light state
    let lightX = -1000;
    let lightY = -1000;
    let lightAlpha = 0;

    let isAnimating = false;
    let rafId: number | null = null;

    function resizeAndBuildGrid() {
      if (!canvas || !ctx) return;

      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvasWidth = width;
      canvasHeight = height;

      // Internal bitmap resolution scaled by DPR
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);

      // Explicit CSS display size matching viewport
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      // Set transform once so all drawing is in CSS pixel units
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Grid dimensions covering entire screen
      cols = Math.ceil(width / SPACING) + 1;
      rows = Math.ceil(height / SPACING) + 1;

      const total = cols * rows;
      dots = new Array(total);
      bucketDots = [[], [], [], []];
      activeDotIndices.clear();

      // Top-center focal point for subtle edge fade (matching original look)
      const focalX = width * 0.5;
      const focalY = height * 0.25;
      const maxDist = Math.hypot(width * 0.5, height * 0.75) || 1;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * SPACING;
          const y = r * SPACING;

          // Distance from top-center focal point
          const d = Math.hypot(x - focalX, y - focalY);
          const normD = Math.min(1, d / maxDist);

          // Subtle falloff from 0.08 in hero to 0.046 at far edges (never 0)
          const baseOp = 0.08 - normD * 0.034;
          const bucket = Math.min(3, Math.floor(normD * 4));

          const dot: Dot = {
            baseX: x,
            baseY: y,
            x,
            y,
            baseOpacity: baseOp,
            opacity: baseOp,
            radius: BASE_RADIUS,
            active: false,
            bucket,
          };

          const idx = r * cols + c;
          dots[idx] = dot;
          bucketDots[bucket].push(dot);
        }
      }

      // Draw initial full-viewport frame
      drawFrame();
    }

    function drawFrame() {
      if (!ctx) return;

      // 1. Draw solid background
      ctx.fillStyle = "#0A0A0B";
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      // 2. Draw subtle light glow under dots if active
      if (lightAlpha > 0.001) {
        const gradient = ctx.createRadialGradient(
          lightX,
          lightY,
          0,
          lightX,
          lightY,
          LIGHT_RADIUS
        );
        // Neutral cool white with faint lime tint (7% center opacity)
        gradient.addColorStop(0, `rgba(225, 245, 210, ${(0.07 * lightAlpha).toFixed(4)})`);
        gradient.addColorStop(0.45, `rgba(200, 241, 53, ${(0.025 * lightAlpha).toFixed(4)})`);
        gradient.addColorStop(1, "rgba(10, 10, 11, 0)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(lightX, lightY, LIGHT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Batched rendering of resting dots (fast 4 draw calls for full viewport)
      for (let b = 0; b < 4; b++) {
        const list = bucketDots[b];
        if (!list || list.length === 0) continue;

        ctx.fillStyle = BUCKET_COLORS[b];
        ctx.beginPath();
        for (let i = 0; i < list.length; i++) {
          const dot = list[i];
          if (!dot.active) {
            ctx.moveTo(dot.baseX + BASE_RADIUS, dot.baseY);
            ctx.arc(dot.baseX, dot.baseY, BASE_RADIUS, 0, Math.PI * 2);
          }
        }
        ctx.fill();
      }

      // 4. Draw active dots with individual displacement and brightness
      if (activeDotIndices.size > 0) {
        activeDotIndices.forEach((idx) => {
          const dot = dots[idx];
          if (!dot) return;
          ctx.fillStyle = `rgba(255, 255, 255, ${dot.opacity.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    function animate() {
      if (!isInteractive) {
        drawFrame();
        return;
      }

      let stillNeedAnimation = false;

      // 1. Update light position and opacity
      const targetLightAlpha = pointerInside ? 1 : 0;
      const alphaDiff = targetLightAlpha - lightAlpha;
      if (Math.abs(alphaDiff) > 0.002) {
        lightAlpha += alphaDiff * (pointerInside ? 0.12 : 0.06);
        stillNeedAnimation = true;
      } else {
        lightAlpha = targetLightAlpha;
      }

      if (lightAlpha > 0.002) {
        const dx = pointerX - lightX;
        const dy = pointerY - lightY;
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          lightX += dx * LIGHT_LERP;
          lightY += dy * LIGHT_LERP;
          stillNeedAnimation = true;
        }
      }

      // 2. Query neighborhood around pointer to activate dots
      if (pointerInside) {
        const minCol = Math.max(0, Math.floor((pointerX - INTERACTION_RADIUS) / SPACING));
        const maxCol = Math.min(cols - 1, Math.ceil((pointerX + INTERACTION_RADIUS) / SPACING));
        const minRow = Math.max(0, Math.floor((pointerY - INTERACTION_RADIUS) / SPACING));
        const maxRow = Math.min(rows - 1, Math.ceil((pointerY + INTERACTION_RADIUS) / SPACING));

        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const idx = r * cols + c;
            if (idx >= 0 && idx < dots.length) {
              activeDotIndices.add(idx);
            }
          }
        }
      }

      // 3. Update active dots
      const toRemove: number[] = [];

      activeDotIndices.forEach((idx) => {
        const dot = dots[idx];
        if (!dot) {
          toRemove.push(idx);
          return;
        }

        let targetX = dot.baseX;
        let targetY = dot.baseY;
        let targetOpacity = dot.baseOpacity;
        let targetRadius = BASE_RADIUS;

        if (pointerInside) {
          const dx = dot.baseX - pointerX;
          const dy = dot.baseY - pointerY;
          const distSq = dx * dx + dy * dy;

          if (distSq < INTERACTION_RADIUS * INTERACTION_RADIUS) {
            const dist = Math.sqrt(distSq);
            // Smooth (1 - d/r)^2 quadratic falloff
            const t = 1 - dist / INTERACTION_RADIUS;
            const falloff = t * t;

            const force = falloff * MAX_DISPLACEMENT;
            const angle = dist > 0.001 ? Math.atan2(dy, dx) : 0;

            targetX = dot.baseX + Math.cos(angle) * force;
            targetY = dot.baseY + Math.sin(angle) * force;

            targetOpacity = dot.baseOpacity + falloff * PEAK_ADDITIONAL_OPACITY;
            targetRadius = BASE_RADIUS * (1 + falloff * (PEAK_RADIUS_MULT - 1));
          }
        }

        // Lerp motion toward target (400-600ms soft settling)
        const lerpFactor = 0.12;
        dot.x += (targetX - dot.x) * lerpFactor;
        dot.y += (targetY - dot.y) * lerpFactor;
        dot.opacity += (targetOpacity - dot.opacity) * lerpFactor;
        dot.radius += (targetRadius - dot.radius) * lerpFactor;

        // Check if settled back to resting state
        const isDisplaced =
          Math.abs(dot.x - dot.baseX) > 0.04 ||
          Math.abs(dot.y - dot.baseY) > 0.04 ||
          Math.abs(dot.opacity - dot.baseOpacity) > 0.004 ||
          Math.abs(dot.radius - BASE_RADIUS) > 0.02;

        if (isDisplaced) {
          dot.active = true;
          stillNeedAnimation = true;
        } else {
          dot.x = dot.baseX;
          dot.y = dot.baseY;
          dot.opacity = dot.baseOpacity;
          dot.radius = BASE_RADIUS;
          dot.active = false;
          toRemove.push(idx);
        }
      });

      for (let i = 0; i < toRemove.length; i++) {
        activeDotIndices.delete(toRemove[i]);
      }

      drawFrame();

      if (stillNeedAnimation) {
        rafId = requestAnimationFrame(animate);
      } else {
        isAnimating = false;
        rafId = null;
      }
    }

    function startAnimation() {
      if (!isInteractive) return;
      if (document.visibilityState === "hidden") return;
      if (!isAnimating) {
        isAnimating = true;
        rafId = requestAnimationFrame(animate);
      }
    }

    function handlePointerMove(e: PointerEvent) {
      pointerX = e.clientX;
      pointerY = e.clientY;

      if (!pointerInside) {
        pointerInside = true;
        // Snap light position immediately on enter to prevent gliding across screen
        lightX = pointerX;
        lightY = pointerY;
      }

      startAnimation();
    }

    function handlePointerLeave() {
      pointerInside = false;
      startAnimation();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
          isAnimating = false;
        }
      } else if (pointerInside || activeDotIndices.size > 0 || lightAlpha > 0.01) {
        startAnimation();
      }
    }

    // Build grid on mount
    resizeAndBuildGrid();

    // Resize handler (debounced)
    let resizeTimer: NodeJS.Timeout | null = null;
    const handleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeAndBuildGrid();
        if (pointerInside) startAnimation();
      }, 60);
    };

    window.addEventListener("resize", handleResize, { passive: true });

    if (isInteractive) {
      window.addEventListener("pointermove", handlePointerMove, { passive: true });
      document.addEventListener("mouseleave", handlePointerLeave, { passive: true });
      window.addEventListener("blur", handlePointerLeave, { passive: true });
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleResize);
      if (isInteractive) {
        window.removeEventListener("pointermove", handlePointerMove);
        document.removeEventListener("mouseleave", handlePointerLeave);
        window.removeEventListener("blur", handlePointerLeave);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 0,
      }}
      aria-hidden="true"
    />
  );
}
