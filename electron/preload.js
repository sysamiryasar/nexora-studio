'use strict';
/* NEXORA ↔ disk bridge. The page stays sandboxed (no Node); it gets only these calls, each handled in electron/main.js. */
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke('nxfs:' + ch, ...a);
contextBridge.exposeInMainWorld('nxfs', {
  isElectron: true,
  pathForFile: f => { try { return webUtils.getPathForFile(f) || ''; } catch (e) { return ''; } },
  defaultRoot: () => call('defaultRoot'),
  pickFolder: (o) => call('pickFolder', o || {}),
  pickFiles: (o) => call('pickFiles', o || {}),
  stat: p => call('stat', p),
  readText: p => call('readText', p),
  writeText: (p, t) => call('writeText', p, t),
  writeBytes: (p, buf) => call('writeBytes', p, buf),
  copyFile: (a, b) => call('copyFile', a, b),
  rename: (a, b) => call('rename', a, b),
  mkdir: p => call('mkdir', p),
  remove: p => call('remove', p),
  find: (dir, names, depth) => call('find', dir, names, depth || 12),
  list: d => call('list', d),
  free: p => call('free', p),
  reveal: p => call('reveal', p),
  join: (...p) => call('join', ...p),
  rel: (from, to) => call('rel', from, to),
  sep: process.platform === 'win32' ? '\\' : '/'
});
/* FFmpeg (electron/ffmpeg.js): structured export jobs and media conversion — no raw command lines from the page */
const ff = (ch, ...a) => ipcRenderer.invoke('nxff:' + ch, ...a);
contextBridge.exposeInMainWorld('nxff', {
  probe: () => ff('probe'),
  codecs: () => ff('codecs'),
  start: (spec, wav) => ff('start', spec, wav || null),
  frame: (id, buf) => ff('frame', id, buf),
  finish: id => ff('finish', id),
  cancel: id => ff('cancel', id),
  info: p => ff('info', p),
  optimize: (input, output, kind) => ff('optimize', input, output, kind),
  cancelOptimize: output => ff('cancelOptimize', output),
  extractAudio: o => ff('extractAudio', o),
  cacheDir: () => ff('cacheDir'),
  saveDialog: o => ff('saveDialog', o || {}),
  onProgress: cb => { const f = (_e, out, p) => cb(out, p); ipcRenderer.on('nxff:progress', f); return () => ipcRenderer.removeListener('nxff:progress', f); }
});
/* accounts (electron/auth.js): secrets stay in the main process; each call returns { ok, error?, ... } */
const AUTH = ['status', 'signUp', 'signIn', 'verify2fa', 'send2faEmail', 'cancel2fa', 'emailCodeRequest', 'emailCodeSignIn', 'verifyEmailSend', 'verifyEmailConfirm', 'resetRequest', 'resetPassword', 'signOut', 'updateProfile', 'changePassword', 'changeEmail', 'totpBegin', 'totpConfirm', 'totpDisable', 'recoveryRegenerate', 'setEmailOtp', 'oauth', 'oauthCancel', 'unlink', 'activity', 'exportData', 'deleteAccount', 'providers', 'providerSet', 'smtpGet', 'smtpSet', 'smtpTest', 'verifySignup', 'resendSignup', 'gasGet', 'gasSet', 'gasScript'];
contextBridge.exposeInMainWorld('nxauth', {
  ...Object.fromEntries(AUTH.map(n => [n, (...a) => ipcRenderer.invoke('nxauth:' + n, ...a)])),
  onEvent: cb => { const f = (_e, type, data) => cb(type, data); ipcRenderer.on('nxauth:event', f); return () => ipcRenderer.removeListener('nxauth:event', f); },
  test: (op, a) => ipcRenderer.invoke('nxauthtest', op, a)     // automated tests only (handler exists only with --nx-hidden)
});
contextBridge.exposeInMainWorld('nxmusic', { search: o => ipcRenderer.invoke('nxmusic:search', o), download: id => ipcRenderer.invoke('nxmusic:download', id), scan: dirs => ipcRenderer.invoke('nxmusic:scan', dirs) });
/* Claude (electron/ai.js): the API key stays in the main process */
contextBridge.exposeInMainWorld('nxai', {
  status: () => ipcRenderer.invoke('nxai:status'),
  setKey: k => ipcRenderer.invoke('nxai:setKey', k),
  setModel: m => ipcRenderer.invoke('nxai:setModel', m),
  setFreeOnly: on => ipcRenderer.invoke('nxai:setFreeOnly', on),
  refreshModels: () => ipcRenderer.invoke('nxai:refreshModels'),
  turn: req => ipcRenderer.invoke('nxai:turn', req),
  cancel: id => ipcRenderer.invoke('nxai:cancel', id),
  onDelta: cb => { const f = (_e, id, d) => cb(id, d); ipcRenderer.on('nxai:delta', f); return () => ipcRenderer.removeListener('nxai:delta', f); },
  test: (op, a) => ipcRenderer.invoke('nxaitest', op, a)
});
/* update check (electron/updates.js): reads the latest public release on GitHub */
contextBridge.exposeInMainWorld('nxupdate', { check: automatic => ipcRenderer.invoke('nxupdate:check', !!automatic), test: rel => ipcRenderer.invoke('nxupdatetest', rel) });
contextBridge.exposeInMainWorld('nxcap', {
  sources: () => ipcRenderer.invoke('nxcap:sources'),
  choose: id => ipcRenderer.invoke('nxcap:choose', id),
  // automated tests only (handlers exist only when the app was started with --nx-hidden)
  testTarget: () => ipcRenderer.invoke('nxcap:testTarget'),
  testTargetClose: () => ipcRenderer.invoke('nxcap:testTargetClose')
});
