import * as THREE from 'three';

// Create a lightweight text sprite for small HUD-style labels that always face the camera.
// Text is rendered to a tiny canvas once; keep it short (<= 32 chars ideally).
export function createTextLabel(text, { font = '8px Helvetica, Arial, sans-serif', color = '#b6b6b6ff', paddingX = 2, paddingY = 1, bg = 'rgba(0,0,0,0)', maxWidth = 120 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  // Measure & size canvas
  const metrics = ctx.measureText(text);
  const textW = Math.min(metrics.width, maxWidth);
  const textH = 10;
  canvas.width = Math.ceil(textW + paddingX * 2);
  canvas.height = Math.ceil(textH + paddingY * 2);
  // Re-set font after resizing canvas
  ctx.font = font;
  ctx.textBaseline = 'top';
  // Draw
  if (bg && bg !== 'transparent') {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, paddingX, paddingY);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // Scale sprite so that 1 unit ~= 1 meter-ish: base on height
  const aspect = canvas.width / canvas.height;
  const heightWorld = 0.32; // world units high (smaller)
  sprite.scale.set(heightWorld * aspect, heightWorld, 1);
  sprite.userData._labelCanvas = canvas;
  return sprite;
}
