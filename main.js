const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const http = require('node:http');
const dgram = require('node:dgram');
const os = require('node:os');
const crypto = require('node:crypto');
const DiscordRPC = require('discord-rpc');

/* =========================================================
   Константы
   ========================================================= */
const ALLOWED_VIEWS = ['home', 'library', 'downloads', 'settings', 'community'];
const ALLOWED_AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac', 'webm'];
const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'];
const ALLOWED_VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'mov', 'm4v'];
const MIME_TO_EXT = {
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a',
  'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/opus': '.opus',
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/flac': '.flac',
  'audio/webm': '.webm'
};
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

const DISCOVERY_PORT = 41234;
const PLAYLIST_HTTP_PORT = 41235;
const DEVICE_ID = crypto.randomUUID();

/* =========================================================
   Discord Rich Presence
   ========================================================= */
const DISCORD_CLIENT_ID = '1561738313935626333';
const DISCORD_LARGE_IMAGE = 'xenox_logo';
let rpcClient = null;
let rpcReady = false;

function initDiscordRPC() {
  if (rpcClient) return;
  try {
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' });
    rpcClient.on('ready', () => {
      rpcReady = true;
      console.log('[Discord RPC] Connected as', DISCORD_CLIENT_ID);
      updateDiscordActivity(null);
    });
    rpcClient.on('disconnected', () => {
      rpcReady = false;
      console.log('[Discord RPC] Disconnected');
    });
    rpcClient.login({ clientId: DISCORD_CLIENT_ID }).catch(err => {
      console.warn('[Discord RPC] Login failed:', err.message);
    });
  } catch (e) {
    console.warn('[Discord RPC] Init failed:', e.message);
  }
}

function updateDiscordActivity(track) {
  if (!rpcClient || !rpcReady) return;
  try {
    if (!track) {
      rpcClient.setActivity({
        details: 'Просматривает библиотеку',
        state: 'Ничего не играет',
        largeImageKey: DISCORD_LARGE_IMAGE,
        largeImageText: 'Xenox Music Player',
        instance: false
      }).catch(() => {});
      return;
    }
    const startTime = track.startedAt ? new Date(track.startedAt) : new Date();
    rpcClient.setActivity({
      details: `Слушает: ${(track.name || 'Неизвестный трек').slice(0, 120)}`,
      state: (track.artist || 'Xenox').slice(0, 128),
      startTimestamp: startTime,
      largeImageKey: DISCORD_LARGE_IMAGE,
      largeImageText: 'Xenox Music Player',
      instance: false
    }).catch(() => {});
  } catch (e) {
    console.warn('[Discord RPC] Update failed:', e.message);
  }
}

function clearDiscordActivity() {
  if (rpcClient && rpcReady) rpcClient.clearActivity().catch(() => {});
}

/* =========================================================
   Окна
   ========================================================= */
const appWindows = new Map();

function createWindow(view = 'home') {
  if (!ALLOWED_VIEWS.includes(view)) view = 'home';

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#121212',
    title: 'Xenox',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  win.loadFile('index.html', { query: { view } });
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol)) {
        shell.openExternal(parsed.href).catch(() => {});
      }
    } catch {}
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        if (['https:', 'http:'].includes(parsed.protocol)) {
          shell.openExternal(parsed.href).catch(() => {});
        }
      } catch {}
    }
  });

  appWindows.set('home', win);
  win.on('closed', () => {
    if (appWindows.get('home') === win) appWindows.delete('home');
  });

  return win;
}

/* =========================================================
   UDP Discovery — обнаружение пользователей в локальной сети
   ========================================================= */
let discoveredUsers = new Map(); // id -> { id, name, avatar, description, playlistsCount, address, port, lastSeen }
let discoveryServer = null;
let broadcastInterval = null;
let cleanupInterval = null;

let myProfile = {
  name: 'Пользователь',
  avatar: '',
  visible: true
};
let myPlaylists = []; // публичные плейлисты (кеш)

function getLocalIPs() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

function getBroadcastAddresses() {
  const addrs = new Set();
  for (const ip of getLocalIPs()) {
    const parts = ip.split('.');
    if (parts.length === 4) {
      addrs.add(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
    }
  }
  return Array.from(addrs);
}

function startDiscovery() {
  if (discoveryServer) return;

  discoveryServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  discoveryServer.on('error', (err) => {
    console.warn('[Discovery] Socket error:', err.message);
  });

  discoveryServer.on('message', (msg, rinfo) => {
    try {
      const data = JSON.parse(msg.toString());
      if (!data || typeof data !== 'object') return;

      // === PING: отвечаем на запрос ===
      if (data.type === 'xenox-ping' && data.id !== DEVICE_ID) {
        if (!myProfile.visible) return; // если пользователь скрыл себя — не отвечаем

        const pong = Buffer.from(JSON.stringify({
          type: 'xenox-pong',
          id: DEVICE_ID,
          name: myProfile.name,
          avatar: myProfile.avatar || '',
          description: 'Xenox User',
          playlistsCount: myPlaylists.filter(p => p.isPublic).length,
          httpPort: PLAYLIST_HTTP_PORT
        }));

        try {
          discoveryServer.send(pong, rinfo.port, rinfo.address);
        } catch {}
        return;
      }

      // === PONG: сохраняем пользователя ===
      if (data.type === 'xenox-pong' && data.id !== DEVICE_ID) {
        discoveredUsers.set(data.id, {
          id: data.id,
          name: data.name || 'Без имени',
          avatar: data.avatar || '',
          description: data.description || '',
          playlistsCount: Number(data.playlistsCount) || 0,
          httpPort: Number(data.httpPort) || PLAYLIST_HTTP_PORT,
          address: rinfo.address,
          lastSeen: Date.now()
        });
      }
    } catch {}
  });

  discoveryServer.bind(DISCOVERY_PORT, () => {
    try {
      discoveryServer.setBroadcast(true);
    } catch (e) {
      console.warn('[Discovery] setBroadcast failed:', e.message);
    }

    // Периодически отправляем ping во все broadcast-адреса
    broadcastInterval = setInterval(() => {
      const ping = Buffer.from(JSON.stringify({ type: 'xenox-ping', id: DEVICE_ID }));
      const targets = getBroadcastAddresses();

      for (const addr of targets) {
        try {
          discoveryServer.send(ping, DISCOVERY_PORT, addr);
        } catch {}
      }
    }, 3000);

    // Отправляем первый ping сразу
    const ping = Buffer.from(JSON.stringify({ type: 'xenox-ping', id: DEVICE_ID }));
    for (const addr of getBroadcastAddresses()) {
      try { discoveryServer.send(ping, DISCOVERY_PORT, addr); } catch {}
    }

    console.log('[Discovery] Started on port', DISCOVERY_PORT);
  });

  // Очистка «устаревших» пользователей (>15 сек без ответа)
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, u] of discoveredUsers) {
      if (now - u.lastSeen > 15000) discoveredUsers.delete(id);
    }
  }, 5000);
}

function stopDiscovery() {
  if (broadcastInterval) clearInterval(broadcastInterval);
  if (cleanupInterval) clearInterval(cleanupInterval);
  if (discoveryServer) {
    try { discoveryServer.close(); } catch {}
    discoveryServer = null;
  }
}

/* =========================================================
   HTTP-сервер для публичных плейлистов
   Каждый Xenox раздаёт свои публичные плейлисты на PLAYLIST_HTTP_PORT
   ========================================================= */
let playlistServer = null;

function startPlaylistServer() {
  if (playlistServer) return;

  playlistServer = http.createServer((req, res) => {
    // CORS для локальной сети
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/playlists') {
      const publicPlaylists = myPlaylists
        .filter(p => p.isPublic)
        .map(p => ({
          id: p.id,
          name: p.name,
          description: p.description || '',
          cover: p.cover || '',
          tracksCount: Array.isArray(p.tracks) ? p.tracks.length : 0
        }));

      res.writeHead(200);
      res.end(JSON.stringify({
        user: { name: myProfile.name, avatar: myProfile.avatar },
        playlists: publicPlaylists
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  playlistServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn('[PlaylistServer] Port busy, trying next...');
      // Попробуем следующий порт
      playlistServer.close();
      playlistServer = null;
    } else {
      console.warn('[PlaylistServer] Error:', err.message);
    }
  });

  playlistServer.listen(PLAYLIST_HTTP_PORT, '0.0.0.0', () => {
    console.log('[PlaylistServer] Listening on port', PLAYLIST_HTTP_PORT);
  });
}

function stopPlaylistServer() {
  if (playlistServer) {
    try { playlistServer.close(); } catch {}
    playlistServer = null;
  }
}

/* =========================================================
   Запуск приложения
   ========================================================= */
app.whenReady().then(() => {
  createWindow();
  initDiscordRPC();
  startDiscovery();
  startPlaylistServer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol)) {
        shell.openExternal(parsed.href).catch(() => {});
      }
    } catch {}
    return { action: 'deny' };
  });
});

app.on('before-quit', () => {
  stopDiscovery();
  stopPlaylistServer();
  if (rpcClient) {
    rpcClient.clearActivity().catch(() => {});
    rpcClient.destroy();
  }
});

/* =========================================================
   IPC — Discord
   ========================================================= */
ipcMain.on('discord-rpc-update', (_event, track) => updateDiscordActivity(track));
ipcMain.on('discord-rpc-clear', () => clearDiscordActivity());

/* =========================================================
   IPC — Community
   ========================================================= */
ipcMain.on('update-community-profile', (_event, profile) => {
  if (!profile || typeof profile !== 'object') return;
  if (typeof profile.name === 'string') myProfile.name = profile.name;
  if (typeof profile.avatar === 'string') myProfile.avatar = profile.avatar;
  if (typeof profile.visible === 'boolean') myProfile.visible = profile.visible;

  // Сразу пингуем сеть, чтобы другие увидели изменения
  if (discoveryServer && myProfile.visible) {
    const ping = Buffer.from(JSON.stringify({ type: 'xenox-ping', id: DEVICE_ID }));
    for (const addr of getBroadcastAddresses()) {
      try { discoveryServer.send(ping, DISCOVERY_PORT, addr); } catch {}
    }
  }
});

ipcMain.on('update-public-playlists', (_event, playlists) => {
  if (!Array.isArray(playlists)) return;
  myPlaylists = playlists.filter(p => p && typeof p === 'object');
});

ipcMain.handle('get-discovered-users', () => {
  return Array.from(discoveredUsers.values()).map(u => ({
    id: u.id,
    name: u.name,
    avatar: u.avatar,
    description: u.description,
    playlistsCount: u.playlistsCount
  }));
});

ipcMain.handle('get-user-playlists', async (_event, userId) => {
  const user = discoveredUsers.get(userId);
  if (!user) return [];
  try {
    const url = `http://${user.address}:${user.httpPort}/playlists`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.playlists) ? data.playlists : [];
  } catch (e) {
    console.warn('[Community] Fetch playlists failed:', e.message);
    return [];
  }
});

/* =========================================================
   Утилиты
   ========================================================= */
function safeName(name) {
  return (name || 'xenox-track').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 140) || 'xenox-track';
}
function isHttpUrl(value) {
  try { const p = new URL(value); return ['https:', 'http:'].includes(p.protocol); } catch { return false; }
}
function isAbsolutePath(value) { return typeof value === 'string' && path.isAbsolute(value); }
async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }); }
function getExt(filePath) { return path.extname(filePath).slice(1).toLowerCase(); }

/* =========================================================
   IPC — Папки и пути
   ========================================================= */
ipcMain.handle('default-download-folder', async () => {
  const target = path.join(app.getPath('music'), 'SoundCloud');
  await ensureDir(target);
  return target;
});

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('open-window', async (_event, view) => {
  if (!ALLOWED_VIEWS.includes(view)) return { ok: false, error: 'Неизвестный раздел.' };
  const primary = appWindows.get('home') || BrowserWindow.getAllWindows()[0];
  if (primary && !primary.isDestroyed()) {
    primary.show();
    primary.focus();
    return { ok: true, navigate: view };
  }
  createWindow('home');
  return { ok: true, navigate: view };
});

/* =========================================================
   IPC — Выбор файлов
   ========================================================= */
ipcMain.handle('pick-file', async (_event, type) => {
  let filters = [], title = 'Выбрать файл';
  if (type === 'image' || type === 'cover') { filters = [{ name: 'Изображения', extensions: ALLOWED_IMAGE_EXTS }]; title = 'Изображение'; }
  else if (type === 'video') { filters = [{ name: 'Видео', extensions: ALLOWED_VIDEO_EXTS }]; title = 'Видео'; }
  else if (type === 'audio') { filters = [{ name: 'Аудиофайлы', extensions: ALLOWED_AUDIO_EXTS }]; title = 'Аудио'; }

  const result = await dialog.showOpenDialog({ title, properties: ['openFile'], filters });
  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const ext = getExt(filePath);

  if (type === 'image' || type === 'cover') {
    if (!ALLOWED_IMAGE_EXTS.includes(ext)) throw new Error(`Формат .${ext} не поддерживается`);
  } else if (type === 'video') {
    if (!ALLOWED_VIDEO_EXTS.includes(ext)) throw new Error(`Формат .${ext} не поддерживается`);
  } else if (type === 'audio') {
    if (!ALLOWED_AUDIO_EXTS.includes(ext)) throw new Error(`Формат .${ext} не поддерживается`);
  }

  return filePath;
});

/* =========================================================
   IPC — Аудиофайлы и метаданные
   ========================================================= */
ipcMain.handle('audio-file-url', async (_event, targetPath) => {
  if (!isAbsolutePath(targetPath)) throw new Error('Некорректный путь к аудиофайлу.');
  const ext = getExt(targetPath);
  if (!ALLOWED_AUDIO_EXTS.includes(ext)) throw new Error(`Неподдерживаемое расширение: .${ext}`);
  return pathToFileURL(targetPath).href;
});

ipcMain.handle('file-url', async (_event, targetPath) => {
  if (!isAbsolutePath(targetPath)) throw new Error('Некорректный путь к файлу.');
  return pathToFileURL(targetPath).href;
});

ipcMain.handle('import-audio-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Аудиофайлы', extensions: ALLOWED_AUDIO_EXTS }]
  });
  if (result.canceled) return [];

  const files = [];
  for (const filePath of result.filePaths) {
    try {
      const stat = await fsp.stat(filePath);
      if (stat.isFile()) files.push({ path: filePath, name: path.basename(filePath) });
    } catch {}
  }
  return files;
});

let musicMetadata = null;
try { musicMetadata = require('music-metadata'); } catch {}

ipcMain.handle('read-metadata', async (_event, filePath) => {
  if (!isAbsolutePath(filePath)) throw new Error('Некорректный путь.');
  const ext = getExt(filePath);
  if (!ALLOWED_AUDIO_EXTS.includes(ext)) throw new Error(`Неподдерживаемый формат: .${ext}`);
  if (!musicMetadata) return {};

  try {
    const meta = await musicMetadata.parseFile(filePath, { duration: true, skipCovers: false });
    let cover = '';
    if (meta.common.picture && meta.common.picture[0]) {
      const pic = meta.common.picture[0];
      cover = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
    }
    return {
      title: meta.common.title || '',
      artist: meta.common.artist || '',
      album: meta.common.album || '',
      cover,
      duration: meta.format.duration || 0
    };
  } catch (e) {
    console.warn('[Xenox] read-metadata error:', e.message);
    return {};
  }
});

/* =========================================================
   IPC — Системные действия
   ========================================================= */
ipcMain.handle('open-path', async (_event, targetPath) => {
  try {
    if (!isAbsolutePath(targetPath)) throw new Error('Некорректный путь.');
    const error = await shell.openPath(targetPath);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('open-external', async (_event, url) => {
  try {
    if (!isHttpUrl(url)) throw new Error('Только HTTP/HTTPS.');
    await shell.openExternal(new URL(url).href);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* =========================================================
   IPC — Экспорт/Импорт библиотеки
   ========================================================= */
ipcMain.handle('export-library', async (_event, data) => {
  try {
    const result = await dialog.showSaveDialog({
      title: 'Экспорт библиотеки',
      defaultPath: `xenox-library-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await fsp.writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('import-library', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Импорт библиотеки',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    const data = JSON.parse(await fsp.readFile(result.filePaths[0], 'utf8'));
    if (!data || typeof data !== 'object') throw new Error('Неверный формат JSON.');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

/* =========================================================
   IPC — Прямая загрузка аудио
   ========================================================= */
async function fetchWithRedirects(url, redirectsLeft = MAX_REDIRECTS) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: {
      'Accept': 'audio/*, application/octet-stream;q=0.9, */*;q=0.5',
      'User-Agent': `Xenox/${app.getVersion()}`
    }
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('Редирект без Location.');
    if (redirectsLeft <= 0) throw new Error('Слишком много редиректов.');
    const next = new URL(location, url).href;
    if (!isHttpUrl(next)) throw new Error('Недопустимый протокол редиректа.');
    return fetchWithRedirects(next, redirectsLeft - 1);
  }

  return response;
}

ipcMain.handle('download-direct-audio', async (_event, payload) => {
  try {
    const url = payload?.url;
    const folder = payload?.folder;

    if (!isHttpUrl(url)) throw new Error('Только HTTP/HTTPS.');
    if (!isAbsolutePath(folder)) throw new Error('Выбери папку.');
    await ensureDir(folder);

    const response = await fetchWithRedirects(url);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}.`);
    }

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const isAudioMime = contentType.startsWith('audio/');
    const isOctet = contentType === 'application/octet-stream';

    let ext = MIME_TO_EXT[contentType];
    const finalUrl = new URL(response.url || url);
    if (!ext) {
      const match = finalUrl.pathname.match(/\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i);
      if (match && (isAudioMime || isOctet)) ext = '.' + match[1].toLowerCase();
    }

    if (!ext || (!isAudioMime && !isOctet)) {
      await response.body?.cancel();
      throw new Error('Это не прямой аудиофайл.');
    }

    let baseName = path.basename(finalUrl.pathname, path.extname(finalUrl.pathname)) || 'xenox-track';
    try { baseName = decodeURIComponent(baseName); } catch {}
    const suggestedName = safeName(baseName) + ext;
    const targetPath = path.join(folder, suggestedName);

    try {
      await fsp.access(targetPath, fs.constants.F_OK);
      await response.body?.cancel();
      throw new Error(`Файл уже существует: ${suggestedName}`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    const nodeStream = Readable.fromWeb(response.body);
    await pipeline(nodeStream, fs.createWriteStream(targetPath, { flags: 'wx' }));

    return { ok: true, path: targetPath, name: suggestedName };
  } catch (e) {
    const message =
      e.name === 'TimeoutError' ? 'Время ожидания истекло.' :
      e.name === 'AbortError' ? 'Загрузка прервана.' :
      e.message || 'Неизвестная ошибка загрузки.';
    return { ok: false, error: message };
  }
});

/* =========================================================
   Защита от необработанных исключений
   ========================================================= */
process.on('uncaughtException', (err) => {
  console.error('[Xenox] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Xenox] unhandledRejection:', reason);
});