// Rendert build/icon.html zu build/icon.png (512x512) mit dem Electron des Projekts.
// Aufruf: npx electron scripts/render-icon.js --ozone-platform=headless --disable-gpu --force-device-scale-factor=1
'use strict';
const { app, BaseWindow, WebContentsView } = require('electron');
const path = require('path');
const fs = require('fs');
const W = 512, H = 512;
const html = path.join(__dirname, '..', 'build', 'icon.html');
const out = path.join(__dirname, '..', 'build', 'icon.png');
app.whenReady().then(async () => {
  const w = new BaseWindow({ width: W, height: H, frame: false, transparent: true });
  w.setContentSize(W, H);
  const v = new WebContentsView();
  v.setBackgroundColor('#00000000');
  w.contentView.addChildView(v);
  v.setBounds({ x: 0, y: 0, width: W, height: H });
  await v.webContents.loadFile(html);
  v.webContents.setZoomFactor(1);
  await new Promise((r) => setTimeout(r, 1200));
  fs.writeFileSync(out, (await v.webContents.capturePage()).toPNG());
  app.quit();
});
