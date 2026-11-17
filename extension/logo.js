// V2 Client - logo drawn in code (no image files needed).
// The same function paints the popup logo and the toolbar icon.
// Designed by Alex Anderson.

function drawLogo(ctx, s) {
  const r = s * 0.26;
  ctx.save();
  ctx.clearRect(0, 0, s, s);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(s, 0, s, s, r);
  ctx.arcTo(s, s, 0, s, r);
  ctx.arcTo(0, s, 0, 0, r);
  ctx.arcTo(0, 0, s, 0, r);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#7c5cff');
  g.addColorStop(1, '#00d4ff');
  ctx.fillStyle = g;
  ctx.fill();

  // soft highlight
  const h = ctx.createLinearGradient(0, 0, 0, s * 0.6);
  h.addColorStop(0, 'rgba(255,255,255,0.28)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = h;
  ctx.fill();

  // power glyph: open ring + stem
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, s * 0.085);
  ctx.beginPath();
  ctx.arc(s * 0.5, s * 0.54, s * 0.245, -Math.PI / 2 + 0.62, -Math.PI / 2 - 0.62 + Math.PI * 2, false);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.5, s * 0.2);
  ctx.lineTo(s * 0.5, s * 0.5);
  ctx.stroke();
  ctx.restore();
}

// Service worker only: paint the toolbar icon (works without PNG files).
async function setToolbarIcon() {
  if (typeof OffscreenCanvas === 'undefined' || !chrome.action) return;
  const imageData = {};
  for (const s of [16, 32, 48, 128]) {
    const c = new OffscreenCanvas(s, s);
    drawLogo(c.getContext('2d'), s);
    imageData[s] = c.getContext('2d').getImageData(0, 0, s, s);
  }
  await chrome.action.setIcon({ imageData });
}
