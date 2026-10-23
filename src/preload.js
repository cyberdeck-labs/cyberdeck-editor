// Sichere Bruecke zwischen Oberflaeche und Hauptprozess (contextIsolation, sandbox).
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => async (...a) => {
  const r = await ipcRenderer.invoke(ch, ...a);
  if (!r || !r.ok) throw new Error(r ? r.error : 'IPC-Fehler');
  return r.v;
};
const listen = (ch) => (fn) => ipcRenderer.on(ch, (_e, d) => fn(d));

contextBridge.exposeInMainWorld('cdeApi', {
  chooseVault: call('vault:choose'),
  current: call('vault:current'),
  read: call('note:read'),
  write: call('note:write'),
  createNote: call('note:create'),
  createAt: call('note:createAt'),
  createFolder: call('folder:create'),
  rename: call('entry:rename'),
  remove: call('entry:delete'),
  snapshot: call('index:snapshot'),
  graph: call('index:graph'),
  links: call('index:links'),
  search: call('search'),
  openExternal: call('open-external'),
  openFile: call('open-file'),
  showInFolder: call('show-in-folder'),
  win: (what) => ipcRenderer.send('win', what),
  ready: () => ipcRenderer.send('ui-ready'),
  installUpdate: () => ipcRenderer.send('install-update'),
  onVault: listen('vault'),
  onFs: listen('fs'),
  onUpdate: listen('update'),
  onVersions: listen('versions'),
  onMaximized: listen('maximized'),
  onFlush: listen('flush-and-close'),
});
