// 2D-canvas debug overlay (the WebGL renderer replaces this in Phase 6). Draws in display space, matching a
// mirrored <video> with object-fit: cover.

import { live } from '../../state/live';
import { HAND_BONES } from '../../vision/landmarks';
import type { GestureMessage } from '../../vision/visionClient';
import { POSE_LABEL } from '../labels';

const FINGER_TIPS = [4, 8, 12, 16, 20];

export interface OverlayColors {
  primary: string;
  secondary: string;
  text: string;
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  msg: GestureMessage | null,
  colors: OverlayColors,
) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (!msg?.overlay) return;
  // object-fit: cover mapping
  const va = msg.aspect;
  const dw = Math.max(w, h * va);
  const dh = dw / va;
  const ox = (w - dw) / 2;
  const oy = (h - dh) / 2;
  const dpr = window.devicePixelRatio || 1;

  for (const hand of msg.overlay) {
    const gesture = msg.frame.hands.find((g) => g.id === hand.id);
    const color = hand.role === 'primary' ? colors.primary : colors.secondary;
    const lm = hand.landmarks;
    const px = (i: number) => ox + lm[i * 3]! * dw;
    const py = (i: number) => oy + lm[i * 3 + 1]! * dh;
    const alpha = gesture?.coasting ? 0.35 : 1;

    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * dpr;
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    for (const [a, b] of HAND_BONES) {
      ctx.moveTo(px(a), py(a));
      ctx.lineTo(px(b), py(b));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const fingers = gesture ? Object.values(gesture.fingers) : [];
    for (let i = 0; i < 21; i++) {
      const tipIndex = FINGER_TIPS.indexOf(i);
      const extended = tipIndex >= 0 && fingers[tipIndex]?.extended;
      ctx.fillStyle = extended ? colors.text : color;
      ctx.beginPath();
      ctx.arc(px(i), py(i), (tipIndex >= 0 ? (extended ? 7 : 4.5) : 3) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (gesture) {
      const label = `${POSE_LABEL[gesture.pose.pose]}${gesture.pose.tentative ? '…' : ''}`;
      ctx.font = `600 ${14 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const x = px(0);
      const y = py(0) + 26 * dpr;
      const tw = ctx.measureText(label).width + 16 * dpr;
      ctx.fillStyle = 'rgba(7, 8, 12, 0.72)';
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, y - 16 * dpr, tw, 24 * dpr, 12 * dpr);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(label, x, y + 1 * dpr);
    }
    ctx.globalAlpha = 1;
  }
}

/** Redraw the overlay on animation frames whenever a new gesture frame arrives. Returns a cleanup fn. */
export function attachOverlay(el: HTMLCanvasElement, enabled: boolean): () => void {
  const ctx = el.getContext('2d');
  if (!ctx) return () => undefined;
  const css = getComputedStyle(document.documentElement);
  const colors = {
    primary: css.getPropertyValue('--primary').trim() || '#3fa7ff',
    secondary: css.getPropertyValue('--secondary').trim() || '#ff9f2e',
    text: css.getPropertyValue('--text').trim() || '#fff',
  };
  let raf = 0;
  let dirty = true;
  const unsubscribe = live.subscribe(() => (dirty = true));
  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(el.clientWidth * dpr);
    el.height = Math.round(el.clientHeight * dpr);
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!dirty) return;
    dirty = false;
    drawOverlay(ctx, enabled ? live.latest : null, colors);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    unsubscribe();
  };
}
