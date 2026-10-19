/* =========================================================
   Xenox v0.42.0 — Full renderer.js
   ========================================================= */

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const STORAGE = {
  SETTINGS: 'xenox-settings',
  TRACKS: 'xenox-tracks',
  PLAYLISTS: 'xenox-playlists',
  POSITION: 'xenox-position',
  PROFILE: 'xenox-profile'
};

const SECTIONS = ['home', 'library', 'downloads', 'settings', 'playlist', 'community'];
const SECTION_TITLES = {
  home: 'Обзор', library: 'Библиотека', downloads: 'Загрузки',
  settings: 'Настройки', playlist: 'Плейлист', community: 'Сообщество'
};
const THEMES = ['midnight', 'aurora', 'forest', 'ember', 'light'];
const AUDIO_RE = /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i;

/* ---------- State ---------- */
const state = {
  folder: '',
  tracks: [],
  playlists: [],
  currentTrackIndex: -1,
  currentPlaylistId: null,
  shuffle: false,
  repeat: 'off',
  activeTab: 'all',
  searchQuery: '',
  navHistory: ['home'],
  editingTrackIndex: -1,
  editingPlaylistId: null,
  lastSoundCloudUrl: '',
  contextTrack: null,
  communityUsers: [],
  selectedCommunityUser: null,
  profile: {
    name: 'Пользователь',
    avatar: '',
    totalPlays: 0
  }
};

const settings = {
  theme: 'midnight',
  persistLibrary: true,
  rememberPosition: false,
  autoPlay: true,
  eq: new Array(10).fill(0),
  backgroundType: 'default',
  backgroundPath: '',
  glassOpacity: 55,
  glassBlur: 22,
  playerSize: 'standard',
  communityVisible: true,
  communitySharePlaylists: false
};

/* ---------- Audio graph ---------- */
let audioCtx = null;
let eqFilters = [];
let sourceNode = null;
let visualizerAnalyser = null;
let visualizerData = null;
let playsCountedForCurrentTrack = false;

/* =========================================================
   Helpers
   ========================================================= */
const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const formatTime = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

const coverFor = (track) => {
  if (track && track.cover) return `<img src="${escapeHtml(track.cover)}" alt="" loading="lazy">`;
  const letter = (track && track.name ? track.name.charAt(0) : '♫').toUpperCase();
  return `<span>${escapeHtml(letter)}</span>`;
};

const safeOn = (id, event, handler) => {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
};

/* =========================================================
   Toast
   ========================================================= */
function toast(message, kind = 'info', duration = 3000) {
  const container = $('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, duration);
}

/* =========================================================
   Storage
   ========================================================= */
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE.SETTINGS) || '{}');
    if (s && typeof s === 'object') {
      if (THEMES.includes(s.theme)) settings.theme = s.theme;
      if (typeof s.persistLibrary === 'boolean') settings.persistLibrary = s.persistLibrary;
      if (typeof s.rememberPosition === 'boolean') settings.rememberPosition = s.rememberPosition;
      if (typeof s.autoPlay === 'boolean') settings.autoPlay = s.autoPlay;
      if (Array.isArray(s.eq) && s.eq.length === 10) settings.eq = s.eq;
      if (['default', 'image', 'video'].includes(s.backgroundType)) settings.backgroundType = s.backgroundType;
      if (typeof s.backgroundPath === 'string') settings.backgroundPath = s.backgroundPath;
      if (typeof s.glassOpacity === 'number') settings.glassOpacity = s.glassOpacity;
      if (typeof s.glassBlur === 'number') settings.glassBlur = s.glassBlur;
      if (['small', 'standard', 'large'].includes(s.playerSize)) settings.playerSize = s.playerSize;
      if (typeof s.communityVisible === 'boolean') settings.communityVisible = s.communityVisible;
      if (typeof s.communitySharePlaylists === 'boolean') settings.communitySharePlaylists = s.communitySharePlaylists;
    }

    if (settings.persistLibrary) {
      const t = JSON.parse(localStorage.getItem(STORAGE.TRACKS) || '[]');
      state.tracks = Array.isArray(t) ? t.filter(x => x && x.path && x.name).map(x => ({
        path: x.path, name: x.name, artist: x.artist || '',
        album: x.album || '', cover: x.cover || '',
        duration: Number(x.duration) || 0, favorite: !!x.favorite,
        playCount: Number(x.playCount) || 0
      })) : [];

      const p = JSON.parse(localStorage.getItem(STORAGE.PLAYLISTS) || '[]');
      state.playlists = Array.isArray(p) ? p.filter(x => x && x.id && x.name).map(x => ({
        id: x.id, name: x.name, description: x.description || '',
        cover: x.cover || '', tracks: Array.isArray(x.tracks) ? x.tracks : [],
        isPublic: !!x.isPublic
      })) : [];
    }
  } catch (e) { console.error(e); }
}

function saveSettings() {
  try { localStorage.setItem(STORAGE.SETTINGS, JSON.stringify(settings)); } catch {}
}

function saveLibrary() {
  if (!settings.persistLibrary) return;
  try {
    localStorage.setItem(STORAGE.TRACKS, JSON.stringify(state.tracks));
    localStorage.setItem(STORAGE.PLAYLISTS, JSON.stringify(state.playlists));
  } catch {}
}

/* =========================================================
   Profile
   ========================================================= */
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE.PROFILE) || '{}');
    if (p && typeof p === 'object') {
      if (typeof p.name === 'string') state.profile.name = p.name;
      if (typeof p.avatar === 'string') state.profile.avatar = p.avatar;
      if (typeof p.totalPlays === 'number') state.profile.totalPlays = p.totalPlays;
    }
  } catch {}
}

function saveProfile() {
  try { localStorage.setItem(STORAGE.PROFILE, JSON.stringify(state.profile)); } catch {}
}

function renderProfile() {
  const nameEl = $('profileName');
  const playsEl = $('profilePlays');
  const avatarEl = $('profileAvatar');

  if (nameEl) nameEl.textContent = state.profile.name;
  if (playsEl) playsEl.textContent = `${state.profile.totalPlays} ${plural(state.profile.totalPlays, 'прослушивание', 'прослушивания', 'прослушиваний')}`;

  if (avatarEl) {
    if (state.profile.avatar) {
      avatarEl.innerHTML = `<img src="${escapeHtml(state.profile.avatar)}" alt="">`;
    } else {
      avatarEl.textContent = state.profile.name.charAt(0).toUpperCase();
    }
  }
}

function openProfileModal() {
  const modal = $('profileModal');
  if (!modal) return;

  $('profileEditName').value = state.profile.name;

  const avatarEl = $('profileEditAvatar');
  if (state.profile.avatar) {
    avatarEl.innerHTML = `<img src="${escapeHtml(state.profile.avatar)}" alt="">`;
  } else {
    avatarEl.textContent = state.profile.name.charAt(0).toUpperCase();
  }
  avatarEl.dataset.newAvatarPath = '';

  $('statTotalPlays').textContent = state.profile.totalPlays;
  $('statUniqueTracks').textContent = state.tracks.length;
  $('statFavorites').textContent = state.tracks.filter(t => t.favorite).length;

  modal.classList.remove('hidden');

  safeOn('pickProfileAvatarBtn', 'click', async () => {
    try {
      const path = await window.glasswave.pickFile('image');
      if (path) {
        const url = await window.glasswave.fileUrl(path);
        avatarEl.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
        avatarEl.dataset.newAvatarPath = path;
      }
    } catch (e) { toast(e.message, 'error'); }
  });

  safeOn('removeProfileAvatarBtn', 'click', () => {
    avatarEl.innerHTML = state.profile.name.charAt(0).toUpperCase();
    avatarEl.dataset.newAvatarPath = '';
  });

  safeOn('cancelProfileBtn', 'click', () => modal.classList.add('hidden'));

  safeOn('saveProfileBtn', 'click', async () => {
    const newName = $('profileEditName').value.trim();
    if (newName) state.profile.name = newName;

    const newAvatarPath = avatarEl.dataset.newAvatarPath;
    if (newAvatarPath !== undefined && newAvatarPath !== '') {
      try { state.profile.avatar = await window.glasswave.fileUrl(newAvatarPath); } catch {}
    } else if (newAvatarPath === '') {
      state.profile.avatar = '';
    }

    saveProfile();
    renderProfile();
    modal.classList.add('hidden');
    toast('Профиль обновлён', 'success');

    if (window.glasswave?.updateCommunityProfile) {
      window.glasswave.updateCommunityProfile({
        name: state.profile.name,
        avatar: state.profile.avatar
      });
    }
  });
}

/* =========================================================
   Navigation
   ========================================================= */
function navigate(section, push = true) {
  if (!SECTIONS.includes(section)) section = 'home';
  document.body.dataset.section = section;
  $$('.section').forEach(s => s.classList.add('hidden'));
  const target = $(`${section}Section`);
  if (target) target.classList.remove('hidden');
  $$('.nav').forEach(b => b.classList.toggle('active', b.dataset.nav === section));
  const bc = $('breadcrumbSection');
  if (bc) bc.textContent = SECTION_TITLES[section] || '';
  if (push && state.navHistory[state.navHistory.length - 1] !== section) {
    state.navHistory.push(section);
  }
  const back = $('backBtn');
  if (back) back.disabled = state.navHistory.length <= 1;

  if (section === 'library') renderLibrary();
  if (section === 'home') renderRecent();
  if (section === 'community') loadCommunityUsers();
}

function goBack() {
  if (state.navHistory.length <= 1) return;
  state.navHistory.pop();
  navigate(state.navHistory[state.navHistory.length - 1], false);
}

/* =========================================================
   Themes & Glass
   ========================================================= */
const THEME_META = {
  midnight: { name: 'Midnight', desc: 'Тёмный' },
  aurora: { name: 'Aurora', desc: 'Фиолетовый' },
  forest: { name: 'Forest', desc: 'Зелёный' },
  ember: { name: 'Ember', desc: 'Тёплый' },
  light: { name: 'Light', desc: 'Светлый' }
};

function renderThemes() {
  const wrap = $('themeOptions');
  if (!wrap) return;
  wrap.innerHTML = '';
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-choice' + (settings.theme === t ? ' selected' : '');
    b.dataset.theme = t;
    b.innerHTML = `<span class="theme-swatch ${t}-swatch"></span><b>${THEME_META[t].name}</b><small>${THEME_META[t].desc}</small>`;
    b.addEventListener('click', () => { applyTheme(t); renderThemes(); });
    wrap.appendChild(b);
  });
}

function applyTheme(t) {
  if (!THEMES.includes(t)) t = 'midnight';
  settings.theme = t;
  document.documentElement.dataset.theme = t;
  saveSettings();
}

function applyGlassSettings() {
  const root = document.documentElement;
  root.style.setProperty('--glass-opacity', (settings.glassOpacity / 100).toFixed(2));
  root.style.setProperty('--glass-blur', `${settings.glassBlur}px`);
}

function applyPlayerSize() {
  document.documentElement.dataset.playerSize = settings.playerSize;
}

/* =========================================================
   Background
   ========================================================= */
async function applyBackground() {
  const bgEl = $('appBackground');
  if (!bgEl) return;
  if (!settings.backgroundPath || settings.backgroundType === 'default') {
    bgEl.innerHTML = '';
    document.body.classList.remove('has-custom-bg');
    return;
  }
  try {
    const url = await window.glasswave.fileUrl(settings.backgroundPath);
    if (settings.backgroundType === 'image') bgEl.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
    else if (settings.backgroundType === 'video') bgEl.innerHTML = `<video src="${escapeHtml(url)}" autoplay loop muted playsinline></video>`;
    document.body.classList.add('has-custom-bg');
  } catch {
    bgEl.innerHTML = '';
    document.body.classList.remove('has-custom-bg');
  }
}

/* =========================================================
   Library
   ========================================================= */
function renderLibrary() {
  const list = $('trackList');
  if (!list) return;

  const query = state.searchQuery.trim().toLowerCase();
  let filtered = [...state.tracks];

  if (state.activeTab === 'favorites') filtered = filtered.filter(t => t.favorite);
  else if (state.activeTab === 'recent') filtered = filtered.slice(-20).reverse();

  if (query) {
    filtered = filtered.filter(t =>
      (t.name || '').toLowerCase().includes(query) ||
      (t.artist || '').toLowerCase().includes(query) ||
      (t.album || '').toLowerCase().includes(query) ||
      (t.path || '').toLowerCase().includes(query)
    );
  }

  const sub = $('librarySubtitle');
  if (sub) sub.textContent = `${state.tracks.length} ${plural(state.tracks.length, 'трек', 'трека', 'треков')}`;

  list.innerHTML = '';

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">♫</div><h3>${query ? 'Ничего не найдено' : 'Пока тихо'}</h3><p>${query ? 'Измени запрос.' : 'Добавь аудиофайлы.'}</p></div>`;
    return;
  }

  filtered.forEach(track => {
    const globalIdx = state.tracks.indexOf(track);
    const row = document.createElement('div');
    row.className = 'track-row' + (state.currentTrackIndex === globalIdx ? ' playing' : '');
    row.innerHTML = `
      <div class="track-cover">${coverFor(track)}</div>
      <div class="track-info">
        <b>${escapeHtml(track.name)}</b>
        <small>${track.artist ? escapeHtml(track.artist) : escapeHtml(track.path)}</small>
      </div>
      <div class="track-duration">${track.duration ? formatTime(track.duration) : ''}</div>
      <button type="button" class="track-action play" title="Слушать">▶</button>
      <button type="button" class="track-action fav ${track.favorite ? 'on' : ''}" title="Избранное">${track.favorite ? '★' : '☆'}</button>
      <button type="button" class="track-action add" title="В плейлист">＋</button>
      <button type="button" class="track-action remove" title="Удалить">×</button>
    `;
    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-action')) return;
      playTrack(track);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, track);
    });
    row.querySelector('.play').addEventListener('click', (e) => { e.stopPropagation(); playTrack(track); });
    row.querySelector('.fav').addEventListener('click', (e) => {
      e.stopPropagation();
      track.favorite = !track.favorite;
      saveLibrary(); renderLibrary();
      if (state.currentTrackIndex === globalIdx) updateHeartBtn(track);
    });
    row.querySelector('.add').addEventListener('click', (e) => { e.stopPropagation(); showAddToPlaylist(track); });
    row.querySelector('.remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить «${track.name}» из библиотеки?`)) return;
      state.tracks = state.tracks.filter(t => t.path !== track.path);
      state.playlists.forEach(p => p.tracks = p.tracks.filter(x => x !== track.path));
      saveLibrary(); renderLibrary(); renderRecent(); renderPlaylists();
      toast('Трек убран', 'success');
    });
    list.appendChild(row);
  });
}

function renderRecent() {
  const el = $('recentTracks');
  if (!el) return;
  const cnt = $('quickLibraryCount');
  if (cnt) cnt.textContent = `${state.tracks.length} ${plural(state.tracks.length, 'трек', 'трека', 'треков')}`;
  const recent = [...state.tracks].slice(-6).reverse();
  el.innerHTML = '';
  if (!recent.length) { el.innerHTML = '<div class="empty-state small"><p>Добавь треки.</p></div>'; return; }
  recent.forEach(t => {
    const card = document.createElement('div');
    card.className = 'recent-card';
    card.innerHTML = `<div class="recent-cover">${coverFor(t)}</div><b>${escapeHtml(t.name)}</b><small>${escapeHtml(t.artist || 'Локальный файл')}</small>`;
    card.addEventListener('click', () => playTrack(t));
    el.appendChild(card);
  });
}

/* =========================================================
   Search & Suggestions
   ========================================================= */
function bindSearch() {
  const handle = (e, isGlobal) => {
    const val = e.target.value;
    state.searchQuery = val;
    if (isGlobal && $('librarySearch')) $('librarySearch').value = val;
    if (!isGlobal && $('globalSearch')) $('globalSearch').value = val;
    if ($('clearSearchBtn')) $('clearSearchBtn').classList.toggle('hidden', !val);
    if ($('clearGlobalSearchBtn')) $('clearGlobalSearchBtn').classList.toggle('hidden', !val);
    if (document.body.dataset.section === 'library') renderLibrary();
    if (val.trim()) renderSuggestions(val); else hideSuggestions();
  };

  safeOn('globalSearch', 'input', (e) => handle(e, true));
  safeOn('librarySearch', 'input', (e) => handle(e, false));

  const clear = () => {
    state.searchQuery = '';
    if ($('librarySearch')) $('librarySearch').value = '';
    if ($('globalSearch')) $('globalSearch').value = '';
    hideSuggestions();
    if (document.body.dataset.section === 'library') renderLibrary();
  };
  safeOn('clearSearchBtn', 'click', clear);
  safeOn('clearGlobalSearchBtn', 'click', clear);

  document.addEventListener('click', (e) => {
    const wrap = $('searchWrap');
    if (wrap && !wrap.contains(e.target)) hideSuggestions();
  });

  $$('.lib-tab').forEach(tab => tab.addEventListener('click', () => {
    $$('.lib-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeTab = tab.dataset.tab;
    renderLibrary();
  }));
}

function hideSuggestions() { const b = $('searchSuggestions'); if (b) b.classList.add('hidden'); }

function renderSuggestions(query) {
  const box = $('searchSuggestions');
  if (!box) return;
  const q = query.toLowerCase().trim();
  if (!q) { hideSuggestions(); return; }

  const tracks = state.tracks.filter(t => (t.name || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q)).slice(0, 4);
  const pls = state.playlists.filter(p => p.name.toLowerCase().includes(q)).slice(0, 3);

  if (!tracks.length && !pls.length) {
    box.innerHTML = `<div class="suggestion-empty">Ничего не найдено</div>`;
    box.classList.remove('hidden');
    return;
  }

  let html = '';
  if (tracks.length) {
    html += `<div class="suggestion-group-label">Треки</div>`;
    tracks.forEach(t => {
      html += `<div class="suggestion-item" data-type="track" data-id="${escapeHtml(t.path)}"><div class="suggestion-cover">${coverFor(t)}</div><div class="suggestion-info"><b>${highlight(t.name, query)}</b><small>${escapeHtml(t.artist || 'Файл')}</small></div></div>`;
    });
  }
  if (pls.length) {
    html += `<div class="suggestion-group-label">Плейлисты</div>`;
    pls.forEach(p => {
      const av = p.cover ? `<img src="${escapeHtml(p.cover)}" alt="">` : escapeHtml(p.name.charAt(0).toUpperCase());
      html += `<div class="suggestion-item" data-type="playlist" data-id="${escapeHtml(p.id)}"><div class="suggestion-avatar playlist-avatar">${av}</div><div class="suggestion-info"><b>${highlight(p.name, query)}</b><small>Плейлист • ${p.tracks.length}</small></div></div>`;
    });
  }

  box.innerHTML = html;
  box.classList.remove('hidden');

  box.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const type = item.dataset.type, id = item.dataset.id;
      if (type === 'track') {
        const t = state.tracks.find(x => x.path === id);
        if (t) playTrack(t);
      } else if (type === 'playlist') {
        const p = state.playlists.find(x => x.id === id);
        if (p) openPlaylistPage(p);
      }
      hideSuggestions();
    });
  });
}

function highlight(text, query) {
  const s = escapeHtml(text);
  const q = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!q) return s;
  return s.replace(new RegExp(`(${q})`, 'gi'), '<mark class="search-highlight">$1</mark>');
}

/* =========================================================
   Playlists
   ========================================================= */
function renderPlaylists() {
  const el = $('playlistsList');
  if (!el) return;
  el.innerHTML = '';
  if (!state.playlists.length) {
    el.innerHTML = '<div class="playlists-empty">Нет плейлистов</div>';
    return;
  }
  state.playlists.forEach(p => {
    const item = document.createElement('div');
    item.className = 'playlist-item';
    const av = p.cover ? `<img src="${escapeHtml(p.cover)}" alt="">` : escapeHtml((p.name || '≡').charAt(0).toUpperCase());
    item.innerHTML = `
      <div class="playlist-avatar ${!p.cover ? 'playlist-avatar-fallback' : ''}">${av}</div>
      <span class="playlist-name">${escapeHtml(p.name)}</span>
      <button type="button" class="playlist-menu-btn" title="Меню">⋯</button>
    `;
    item.addEventListener('click', (e) => {
      if (e.target.closest('.playlist-menu-btn')) return;
      openPlaylistPage(p);
    });
    item.querySelector('.playlist-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openPlaylistMenu(p);
    });
    el.appendChild(item);
  });
}

function openPlaylistPage(p) {
  state.currentPlaylistId = p.id;
  if ($('playlistHeroName')) $('playlistHeroName').textContent = p.name || 'Без названия';
  if ($('playlistHeroDesc')) $('playlistHeroDesc').textContent = p.description || 'Описание отсутствует';

  const coverEl = $('playlistHeroCover');
  if (coverEl) coverEl.innerHTML = p.cover ? `<img src="${escapeHtml(p.cover)}" alt="">` : '≡';

  const list = $('playlistTrackList');
  if (!list) return;
  list.innerHTML = '';

  const tracks = p.tracks.map(path => state.tracks.find(t => t.path === path)).filter(Boolean);

  if (!tracks.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">♫</div><h3>Плейлист пуст</h3><p>Добавь треки через + в библиотеке.</p></div>`;
  } else {
    tracks.forEach(track => {
      const globalIdx = state.tracks.indexOf(track);
      const row = document.createElement('div');
      row.className = 'track-row' + (state.currentTrackIndex === globalIdx ? ' playing' : '');
      row.innerHTML = `
        <div class="track-cover">${coverFor(track)}</div>
        <div class="track-info">
          <b>${escapeHtml(track.name)}</b>
          <small>${escapeHtml(track.artist || '')}</small>
        </div>
        <div class="track-duration">${track.duration ? formatTime(track.duration) : ''}</div>
        <button type="button" class="track-action play" title="Слушать">▶</button>
        <button type="button" class="track-action fav ${track.favorite ? 'on' : ''}" title="Избранное">${track.favorite ? '★' : '☆'}</button>
        <button type="button" class="track-action remove" title="Убрать из плейлиста">×</button>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.track-action')) return;
        playTrack(track);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, track);
      });
      row.querySelector('.play').addEventListener('click', (e) => { e.stopPropagation(); playTrack(track); });
      row.querySelector('.fav').addEventListener('click', (e) => {
        e.stopPropagation();
        track.favorite = !track.favorite;
        saveLibrary(); openPlaylistPage(p);
        if (state.currentTrackIndex === globalIdx) updateHeartBtn(track);
      });
      row.querySelector('.remove').addEventListener('click', (e) => {
        e.stopPropagation();
        p.tracks = p.tracks.filter(path => path !== track.path);
        saveLibrary(); openPlaylistPage(p); renderPlaylists();
        toast(`«${track.name}» убран из плейлиста`, 'success');
      });
      list.appendChild(row);
    });
  }

  safeOn('playPlaylistBtn', 'click', () => playPlaylist(p));
  safeOn('editPlaylistFromPageBtn', 'click', () => openPlaylistMenu(p));

  navigate('playlist');
}

function openPlaylistMenu(p) {
  const modal = $('editPlaylistModal');
  if (!modal) return;
  state.editingPlaylistId = p.id;

  $('editPlaylistName').value = p.name || '';
  $('editPlaylistDesc').value = p.description || '';
  const coverEl = $('editPlaylistCover');
  if (coverEl) {
    coverEl.innerHTML = p.cover ? `<img src="${escapeHtml(p.cover)}" alt="">` : '≡';
    coverEl.dataset.newCoverPath = '';
  }

  const publicCheckbox = $('editPlaylistPublic');
  if (publicCheckbox) publicCheckbox.checked = !!p.isPublic;

  modal.classList.remove('hidden');

  safeOn('pickPlaylistCoverBtn', 'click', async () => {
    try {
      const path = await window.glasswave.pickFile('image');
      if (path) {
        const url = await window.glasswave.fileUrl(path);
        coverEl.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
        coverEl.dataset.newCoverPath = path;
      }
    } catch (e) { toast(e.message, 'error'); }
  });

  safeOn('removePlaylistCoverBtn', 'click', () => {
    coverEl.innerHTML = '≡';
    coverEl.dataset.newCoverPath = '';
  });

  safeOn('cancelPlaylistEditBtn', 'click', () => modal.classList.add('hidden'));

  safeOn('savePlaylistEditBtn', 'click', async () => {
    const pl = state.playlists.find(x => x.id === state.editingPlaylistId);
    if (!pl) return;
    const newName = $('editPlaylistName').value.trim();
    if (newName) pl.name = newName;
    pl.description = $('editPlaylistDesc').value.trim();
    pl.isPublic = !!publicCheckbox?.checked;
    const ncp = coverEl.dataset.newCoverPath;
    if (ncp !== undefined && ncp !== '') {
      try { pl.cover = await window.glasswave.fileUrl(ncp); } catch {}
    } else if (ncp === '') {
      pl.cover = '';
    }
    saveLibrary(); renderPlaylists(); modal.classList.add('hidden');
    toast('Плейлист обновлён', 'success');
    if (state.currentPlaylistId === pl.id) openPlaylistPage(pl);
  });

  safeOn('deletePlaylistBtn', 'click', () => {
    if (!confirm(`Удалить плейлист «${p.name}»?`)) return;
    state.playlists = state.playlists.filter(x => x.id !== p.id);
    saveLibrary(); renderPlaylists(); modal.classList.add('hidden');
    toast('Плейлист удалён', 'success');
    if (state.currentPlaylistId === p.id) navigate('home');
  });
}

async function showAddToPlaylist(track) {
  if (!state.playlists.length) { toast('Сначала создай плейлист', 'error'); return; }

  const overlay = $('modalOverlay');
  const title = $('modalTitle');
  const text = $('modalText');
  const inp = $('modalInput');
  const list = $('playlistSelectList');

  if (title) title.textContent = 'Добавить в плейлист';
  if (text) { text.textContent = `Трек: ${track.name}`; text.classList.remove('hidden'); }
  if (inp) inp.classList.add('hidden');
  if (!list) return;

  list.innerHTML = '';
  list.classList.remove('hidden');

  state.playlists.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'playlist-select-btn';
    btn.innerHTML = `<span>${escapeHtml(p.name)}</span><small>${p.tracks.length}</small>`;
    btn.addEventListener('click', () => {
      if (p.tracks.includes(track.path)) {
        toast('Уже в плейлисте', 'info');
      } else {
        p.tracks.push(track.path);
        saveLibrary(); renderPlaylists();
        toast(`Добавлено в «${p.name}»`, 'success');
        overlay.classList.add('hidden');
      }
    });
    list.appendChild(btn);
  });

  if ($('modalConfirm')) $('modalConfirm').classList.add('hidden');
  if ($('modalCancel')) {
    $('modalCancel').textContent = 'Закрыть';
    $('modalCancel').onclick = () => overlay.classList.add('hidden');
  }
  if (overlay) overlay.classList.remove('hidden');
}

async function playPlaylist(p) {
  const tracks = p.tracks.map(path => state.tracks.find(t => t.path === path)).filter(Boolean);
  if (!tracks.length) { toast('Плейлист пуст', 'error'); return; }
  await playTrack(tracks[0]);
  toast(`▶ Плейлист: ${p.name}`, 'info');
}

/* =========================================================
   Community
   ========================================================= */
async function loadCommunityUsers() {
  try {
    const users = await window.glasswave.getDiscoveredUsers();
    state.communityUsers = Array.isArray(users) ? users : [];
    renderCommunityUsers();
    updateLANStatus();
  } catch (e) {
    console.warn('[Community] Load failed:', e.message);
    state.communityUsers = [];
    renderCommunityUsers();
  }
}

function updateLANStatus() {
  const statusEl = $('lanStatus');
  if (!statusEl) return;
  const count = state.communityUsers.length;
  if (count === 0) {
    statusEl.innerHTML = `<span class="pulse"></span><span>В сети никого не найдено</span>`;
  } else {
    statusEl.innerHTML = `<span class="pulse"></span><span>Найдено: ${count} ${plural(count, 'пользователь', 'пользователя', 'пользователей')}</span>`;
  }
}

function renderCommunityUsers(filter = '') {
  const list = $('userList');
  if (!list) return;

  const q = filter.trim().toLowerCase();
  const filtered = state.communityUsers.filter(u =>
    !q || (u.name || '').toLowerCase().includes(q)
  );

  list.innerHTML = '';

  if (!filtered.length) {
    list.innerHTML = `
      <div class="user-list-empty">
        <div class="empty-icon">👥</div>
        <p>${q ? 'Никого не найдено по запросу.' : 'Пока никого рядом.<br>Убедись, что другие пользователи Xenox в той же Wi-Fi сети.'}</p>
      </div>`;
    return;
  }

  filtered.forEach(user => {
    const card = document.createElement('div');
    card.className = 'user-card';
    card.dataset.userId = user.id;

    const avatarHtml = user.avatar
      ? `<img src="${escapeHtml(user.avatar)}" alt="">`
      : escapeHtml((user.name || 'U').charAt(0).toUpperCase());

    card.innerHTML = `
      <div class="user-card-avatar">${avatarHtml}</div>
      <div class="user-card-info">
        <b>${escapeHtml(user.name || 'Без имени')}</b>
        <small>${user.playlistsCount || 0} ${plural(user.playlistsCount || 0, 'плейлист', 'плейлиста', 'плейлистов')}</small>
      </div>
    `;

    card.addEventListener('click', () => showUserPlaylists(user));
    list.appendChild(card);
  });
}

async function showUserPlaylists(user) {
  const panel = $('userPlaylistsPanel');
  const userName = $('selectedUserName');
  const userDesc = $('selectedUserDesc');
  const list = $('userPlaylistsList');

  if (!panel || !list) return;

  state.selectedCommunityUser = user;
  panel.classList.remove('hidden');
  userName.textContent = user.name || 'Без имени';
  userDesc.textContent = user.description || 'Публичные плейлисты';

  list.innerHTML = `<div class="user-list-empty" style="grid-column:1/-1;padding:30px;"><p>Загрузка…</p></div>`;

  try {
    const playlists = await window.glasswave.getUserPlaylists(user.id);
    renderUserPlaylists(playlists || []);
  } catch (e) {
    list.innerHTML = `<div class="user-list-empty" style="grid-column:1/-1;"><p>Не удалось загрузить плейлисты.</p></div>`;
  }
}

function renderUserPlaylists(playlists) {
  const list = $('userPlaylistsList');
  if (!list) return;
  list.innerHTML = '';

  if (!playlists.length) {
    list.innerHTML = `<div class="user-list-empty" style="grid-column:1/-1;"><p>У пользователя нет публичных плейлистов.</p></div>`;
    return;
  }

  playlists.forEach(pl => {
    const card = document.createElement('div');
    card.className = 'user-playlist-card';
    const coverHtml = pl.cover ? `<img src="${escapeHtml(pl.cover)}" alt="">` : '≡';

    card.innerHTML = `
      <div class="user-playlist-cover">${coverHtml}</div>
      <b>${escapeHtml(pl.name)}</b>
      <small>${pl.tracksCount || 0} ${plural(pl.tracksCount || 0, 'трек', 'трека', 'треков')}</small>
    `;

    card.addEventListener('click', () => {
      toast(`Плейлист «${pl.name}» — в разработке`, 'info');
    });

    list.appendChild(card);
  });
}

/* =========================================================
   Context menu
   ========================================================= */
function showContextMenu(x, y, track) {
  const menu = $('contextMenu');
  if (!menu) return;

  state.contextTrack = track;

  const favBtn = menu.querySelector('[data-action="fav"]');
  if (favBtn) {
    favBtn.textContent = track.favorite ? '★ Убрать из избранного' : '☆ В избранное';
  }

  menu.classList.remove('hidden');

  const rect = menu.getBoundingClientRect();
  const finalX = Math.min(x, window.innerWidth - rect.width - 10);
  const finalY = Math.min(y, window.innerHeight - rect.height - 10);
  menu.style.left = finalX + 'px';
  menu.style.top = finalY + 'px';
}

function hideContextMenu() {
  const menu = $('contextMenu');
  if (menu) menu.classList.add('hidden');
  state.contextTrack = null;
}

function bindContextMenu() {
  const menu = $('contextMenu');
  if (!menu) return;

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('scroll', hideContextMenu, true);
  window.addEventListener('resize', hideContextMenu);

  menu.querySelectorAll('.context-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      const track = state.contextTrack;
      if (!track) return;
      hideContextMenu();

      if (action === 'play') {
        playTrack(track);
      } else if (action === 'fav') {
        track.favorite = !track.favorite;
        saveLibrary(); renderLibrary(); renderRecent();
        toast(track.favorite ? 'Добавлено в избранное' : 'Убрано из избранного', 'success');
      } else if (action === 'playlist') {
        showAddToPlaylist(track);
      } else if (action === 'edit') {
        state.currentTrackIndex = state.tracks.findIndex(t => t.path === track.path);
        openEditTrackModal();
      } else if (action === 'remove') {
        if (!confirm(`Удалить «${track.name}» из библиотеки?`)) return;
        state.tracks = state.tracks.filter(t => t.path !== track.path);
        state.playlists.forEach(p => p.tracks = p.tracks.filter(x => x !== track.path));
        saveLibrary(); renderLibrary(); renderRecent(); renderPlaylists();
        toast('Трек убран', 'success');
      }
    });
  });
}

/* =========================================================
   Audio graph & visualizer
   ========================================================= */
const audio = $('audioPlayer');

function initAudioGraph() {
  if (audioCtx || !audio) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaElementSource(audio);
    const freqs = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
    eqFilters = freqs.map(f => {
      const filter = audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = f;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });
    let node = sourceNode;
    eqFilters.forEach(f => { node.connect(f); node = f; });

    visualizerAnalyser = audioCtx.createAnalyser();
    visualizerAnalyser.fftSize = 64;
    visualizerAnalyser.smoothingTimeConstant = 0.8;
    node.connect(visualizerAnalyser);
    visualizerAnalyser.connect(audioCtx.destination);

    visualizerData = new Uint8Array(visualizerAnalyser.frequencyBinCount);
    applyEq();
    drawVisualizer();
  } catch (e) { console.warn('Audio graph init failed', e); }
}

function applyEq() {
  if (!eqFilters.length) return;
  eqFilters.forEach((f, i) => { f.gain.value = settings.eq[i] || 0; });
}

function drawVisualizer() {
  const miniCanvas = $('miniVisualizer');
  const expandedCanvas = $('expandedVisualizer');

  if (visualizerAnalyser) {
    visualizerAnalyser.getByteFrequencyData(visualizerData);

    if (miniCanvas) {
      const ctx = miniCanvas.getContext('2d');
      const w = miniCanvas.width, h = miniCanvas.height;
      ctx.clearRect(0, 0, w, h);
      const bars = 8, barW = w / bars - 2;
      const step = Math.floor(visualizerData.length / bars);
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += visualizerData[i * step + j];
        const avg = sum / step / 255;
        const barH = Math.max(2, avg * h);
        const x = i * (barW + 2), y = h - barH;
        const grad = ctx.createLinearGradient(0, h, 0, h - barH);
        grad.addColorStop(0, '#1ed760');
        grad.addColorStop(1, '#ffffff');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);
      }
    }

    if (expandedCanvas) {
      const ctx = expandedCanvas.getContext('2d');
      const w = expandedCanvas.width, h = expandedCanvas.height;
      ctx.clearRect(0, 0, w, h);
      const bars = 32, barW = w / bars - 2;
      const step = Math.floor(visualizerData.length / bars);
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += visualizerData[i * step + j];
        const avg = sum / step / 255;
        const barH = Math.max(4, avg * h * 0.8);
        const x = i * (barW + 2), y = h / 2 - barH / 2;
        const grad = ctx.createLinearGradient(0, h / 2 - barH / 2, 0, h / 2 + barH / 2);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
        grad.addColorStop(0.5, 'rgba(30, 215, 96, 0.8)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0.1)');
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, barH);
      }
    }
  }

  requestAnimationFrame(drawVisualizer);
}

/* =========================================================
   Player
   ========================================================= */
async function playTrack(track) {
  if (!track || !audio) return;
  try {
    initAudioGraph();
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();

    playsCountedForCurrentTrack = false;

    const url = await window.glasswave.audioFileUrl(track.path);
    audio.src = url;

    if (settings.rememberPosition) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE.POSITION) || '{}');
        const pos = saved[track.path];
        if (pos && pos > 5) {
          audio.addEventListener('loadedmetadata', () => {
            if (Number.isFinite(audio.duration) && pos < audio.duration - 2) audio.currentTime = pos;
          }, { once: true });
        }
      } catch {}
    }

    if (settings.autoPlay) await audio.play();
    state.currentTrackIndex = state.tracks.findIndex(t => t.path === track.path);
    updateNowPlaying(track);
    renderLibrary();
    showPlayerBar();
    toast(`▶ ${track.name}`, 'info', 1500);

    if (window.glasswave?.updateDiscordRPC) {
      window.glasswave.updateDiscordRPC({
        name: track.name,
        artist: track.artist || '',
        startedAt: Date.now()
      });
    }
  } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
}

function updateNowPlaying(track) {
  if (!track) return;
  const name = track.name.length > 50 ? track.name.substring(0, 47) + '...' : track.name;
  if ($('nowTitle')) $('nowTitle').textContent = name;
  if ($('nowSubtitle')) $('nowSubtitle').textContent = track.artist || 'Локальная библиотека';
  if ($('miniCover')) $('miniCover').innerHTML = coverFor(track);
  if ($('expandedTitle')) $('expandedTitle').textContent = name;
  if ($('expandedSubtitle')) $('expandedSubtitle').textContent = track.artist || '';
  const pe = $('playerExpand');
  if (pe) {
    if (track.cover) {
      pe.style.setProperty('--expand-bg', `url("${track.cover}")`);
      pe.style.setProperty('--expand-bg-opacity', '0.55');
    } else {
      pe.style.removeProperty('--expand-bg');
      pe.style.removeProperty('--expand-bg-opacity');
    }
  }
  updateHeartBtn(track);
}

function updateHeartBtn(track) {
  const btn = $('nowFavBtn');
  if (!btn || !track) return;
  btn.textContent = track.favorite ? '★' : '☆';
  btn.classList.toggle('on', !!track.favorite);
}

function showPlayerBar() {
  const bar = $('playerBar');
  if (bar) bar.classList.remove('hidden');
}

async function togglePlay() {
  if (!audio) return;
  if (!audio.src) { if (state.tracks.length) await playTrack(state.tracks[0]); return; }
  try { if (audio.paused) await audio.play(); else audio.pause(); }
  catch (e) { toast('Ошибка: ' + e.message, 'error'); }
}

function stepTrack(delta) {
  if (!state.tracks.length) return;
  let idx = state.currentTrackIndex;
  if (idx < 0) idx = delta >= 0 ? -1 : 0;
  if (state.shuffle && state.tracks.length > 1) {
    let attempts = 0, next;
    do { next = Math.floor(Math.random() * state.tracks.length); attempts++; }
    while (next === idx && attempts < 10);
    idx = next;
  } else {
    idx = (idx + delta + state.tracks.length) % state.tracks.length;
  }
  playTrack(state.tracks[idx]);
}

function updatePlayIcons() {
  if (!audio) return;
  const isPaused = audio.paused;
  ['playPauseBtn', 'expandedPlayBtn'].forEach(id => {
    const btn = $(id);
    if (!btn) return;
    const ip = btn.querySelector('.icon-play');
    const ia = btn.querySelector('.icon-pause');
    if (ip && ia) {
      ip.classList.toggle('hidden', !isPaused);
      ia.classList.toggle('hidden', isPaused);
    }
  });
}

function cycleRepeat() {
  state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat];
  const isOn = state.repeat !== 'off';
  const isOne = state.repeat === 'one';
  ['repeatBtn', 'expandedRepeatBtn'].forEach(id => {
    const b = $(id);
    if (!b) return;
    b.classList.toggle('active', isOn);
    const badge = b.querySelector('.repeat-one-badge');
    if (badge) badge.style.display = isOne ? 'inline' : 'none';
  });
  toast(`Repeat: ${state.repeat}`, 'info', 1200);
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  ['shuffleBtn', 'expandedShuffleBtn'].forEach(id => {
    const b = $(id);
    if (b) b.classList.toggle('active', state.shuffle);
  });
  toast(state.shuffle ? 'Shuffle: вкл' : 'Shuffle: выкл', 'info', 1200);
}

/* =========================================================
   Equalizer
   ========================================================= */
function buildEqualizer() {
  const eq = $('equalizer');
  if (!eq) return;
  const labels = ['60', '170', '310', '600', '1k', '3k', '6k', '12k', '14k', '16k'];
  eq.innerHTML = '';
  settings.eq.forEach((v, i) => {
    const band = document.createElement('div');
    band.className = 'eq-band';
    band.innerHTML = `
      <input type="range" min="-12" max="12" step="1" value="${Number(v) || 0}" data-band="${i}" aria-label="${labels[i]} Hz">
      <span>${labels[i]}</span>
    `;
    band.querySelector('input').addEventListener('input', (e) => {
      settings.eq[i] = Number(e.target.value);
      applyEq(); saveSettings();
    });
    eq.appendChild(band);
  });
}

/* =========================================================
   Bind Player
   ========================================================= */
function bindPlayer() {
  safeOn('playPauseBtn', 'click', togglePlay);
  safeOn('expandedPlayBtn', 'click', togglePlay);
  safeOn('prevTrackBtn', 'click', () => stepTrack(-1));
  safeOn('nextTrackBtn', 'click', () => stepTrack(1));
  safeOn('expandedPrevBtn', 'click', () => stepTrack(-1));
  safeOn('expandedNextBtn', 'click', () => stepTrack(1));
  safeOn('shuffleBtn', 'click', toggleShuffle);
  safeOn('expandedShuffleBtn', 'click', toggleShuffle);
  safeOn('repeatBtn', 'click', cycleRepeat);
  safeOn('expandedRepeatBtn', 'click', cycleRepeat);

  safeOn('nowFavBtn', 'click', () => {
    const t = state.tracks[state.currentTrackIndex];
    if (!t) return;
    t.favorite = !t.favorite;
    updateHeartBtn(t); saveLibrary(); renderLibrary();
  });

  if (audio) {
    audio.addEventListener('play', updatePlayIcons);
    audio.addEventListener('pause', updatePlayIcons);
    audio.addEventListener('ended', () => {
      if (state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); }
      else if (state.repeat === 'all' || state.shuffle || state.currentTrackIndex < state.tracks.length - 1) stepTrack(1);
      else { audio.currentTime = 0; updatePlayIcons(); }
    });

    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 1000;
      if ($('seekBar')) $('seekBar').value = pct;
      if ($('expandedSeekBar')) $('expandedSeekBar').value = pct;
      const cur = formatTime(audio.currentTime);
      const dur = formatTime(audio.duration);
      if ($('currentTime')) $('currentTime').textContent = cur;
      if ($('durationTime')) $('durationTime').textContent = dur;
      if ($('expandedCurrentTime')) $('expandedCurrentTime').textContent = cur;
      if ($('expandedDurationTime')) $('expandedDurationTime').textContent = dur;

      if (!playsCountedForCurrentTrack && audio.currentTime > 5) {
        playsCountedForCurrentTrack = true;
        state.profile.totalPlays++;
        saveProfile();
        renderProfile();
        const t = state.tracks[state.currentTrackIndex];
        if (t) {
          t.playCount = (t.playCount || 0) + 1;
          saveLibrary();
        }
      }
    });

    audio.addEventListener('loadedmetadata', () => {
      if ($('durationTime')) $('durationTime').textContent = formatTime(audio.duration);
      if ($('expandedDurationTime')) $('expandedDurationTime').textContent = formatTime(audio.duration);
    });

    safeOn('seekBar', 'input', (e) => { if (audio.duration) audio.currentTime = (Number(e.target.value) / 1000) * audio.duration; });
    safeOn('expandedSeekBar', 'input', (e) => { if (audio.duration) audio.currentTime = (Number(e.target.value) / 1000) * audio.duration; });
    safeOn('volumeBar', 'input', (e) => { audio.volume = Number(e.target.value); if ($('expandedVolumeBar')) $('expandedVolumeBar').value = e.target.value; });
    safeOn('expandedVolumeBar', 'input', (e) => { audio.volume = Number(e.target.value); if ($('volumeBar')) $('volumeBar').value = e.target.value; });
    audio.volume = 0.85;

    safeOn('muteBtn', 'click', () => { audio.muted = !audio.muted; if ($('muteBtn')) $('muteBtn').textContent = audio.muted ? '🔇' : '🔊'; });
  }

  safeOn('nowPlaying', 'click', () => $('playerExpand').classList.remove('hidden'));
  safeOn('expandBtn', 'click', () => $('playerExpand').classList.remove('hidden'));
  safeOn('closeExpandedPlayer', 'click', () => $('playerExpand').classList.add('hidden'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('playerExpand').classList.add('hidden');
  });
}

/* =========================================================
   Settings Bindings
   ========================================================= */
function bindSettings() {
  const persist = $('persistLibrary');
  if (persist) {
    persist.checked = !!settings.persistLibrary;
    persist.addEventListener('change', (e) => {
      settings.persistLibrary = e.target.checked;
      if (settings.persistLibrary) saveLibrary();
      else {
        localStorage.removeItem(STORAGE.TRACKS);
        localStorage.removeItem(STORAGE.PLAYLISTS);
      }
      saveSettings();
    });
  }

  const remember = $('rememberPosition');
  if (remember) { remember.checked = !!settings.rememberPosition; remember.addEventListener('change', (e) => { settings.rememberPosition = e.target.checked; saveSettings(); }); }

  const autoPlay = $('autoPlay');
  if (autoPlay) { autoPlay.checked = !!settings.autoPlay; autoPlay.addEventListener('change', (e) => { settings.autoPlay = e.target.checked; saveSettings(); }); }

  const sizeSelect = $('playerSizeSelect');
  if (sizeSelect) {
    sizeSelect.value = settings.playerSize;
    sizeSelect.addEventListener('change', (e) => {
      settings.playerSize = e.target.value;
      applyPlayerSize(); saveSettings();
    });
  }

  const opacity = $('glassOpacity');
  if (opacity) {
    opacity.value = settings.glassOpacity;
    opacity.addEventListener('input', (e) => {
      settings.glassOpacity = Number(e.target.value);
      applyGlassSettings(); saveSettings();
    });
  }

  const blur = $('glassBlur');
  if (blur) {
    blur.value = settings.glassBlur;
    blur.addEventListener('input', (e) => {
      settings.glassBlur = Number(e.target.value);
      applyGlassSettings(); saveSettings();
    });
  }

  // Community settings
  const communityVisible = $('communityVisible');
  if (communityVisible) {
    communityVisible.checked = !!settings.communityVisible;
    communityVisible.addEventListener('change', (e) => {
      settings.communityVisible = e.target.checked;
      saveSettings();
      if (window.glasswave?.updateCommunityProfile) {
        window.glasswave.updateCommunityProfile({
          name: state.profile.name,
          avatar: state.profile.avatar,
          visible: settings.communityVisible
        });
      }
    });
  }

  const communitySharePlaylists = $('communitySharePlaylists');
  if (communitySharePlaylists) {
    communitySharePlaylists.checked = !!settings.communitySharePlaylists;
    communitySharePlaylists.addEventListener('change', (e) => {
      settings.communitySharePlaylists = e.target.checked;
      saveSettings();
    });
  }

  safeOn('setBgImageBtn', 'click', async () => {
    try {
      const p = await window.glasswave.pickFile('image');
      if (p) { settings.backgroundType = 'image'; settings.backgroundPath = p; saveSettings(); applyBackground(); toast('Фон установлен', 'success'); }
    } catch (e) { toast(e.message, 'error'); }
  });

  safeOn('setBgVideoBtn', 'click', async () => {
    try {
      const p = await window.glasswave.pickFile('video');
      if (p) { settings.backgroundType = 'video'; settings.backgroundPath = p; saveSettings(); applyBackground(); toast('Видео установлено', 'success'); }
    } catch (e) { toast(e.message, 'error'); }
  });

  safeOn('clearBgBtn', 'click', () => {
    settings.backgroundType = 'default';
    settings.backgroundPath = '';
    saveSettings(); applyBackground();
    toast('Фон сброшен', 'success');
  });

  safeOn('resetEqBtn', 'click', () => {
    settings.eq = new Array(10).fill(0);
    buildEqualizer(); applyEq(); saveSettings();
    toast('Эквалайзер сброшен', 'success');
  });

  safeOn('clearLibraryBtn', 'click', () => {
    if (!confirm('Очистить библиотеку? Файлы останутся.')) return;
    state.tracks = []; state.playlists = []; state.currentTrackIndex = -1; state.currentPlaylistId = null;
    if (audio) { audio.pause(); audio.removeAttribute('src'); }
    const bar = $('playerBar'); if (bar) bar.classList.add('hidden');
    if ($('nowTitle')) $('nowTitle').textContent = 'Ничего не играет';
    if ($('nowSubtitle')) $('nowSubtitle').textContent = 'Выбери трек';
    if ($('miniCover')) $('miniCover').innerHTML = '♫';
    saveLibrary(); renderLibrary(); renderPlaylists(); renderRecent();
    if (window.glasswave?.clearDiscordRPC) window.glasswave.clearDiscordRPC();
    toast('Библиотека очищена', 'success');
  });

  safeOn('resetAllBtn', 'click', () => {
    if (!confirm('Сбросить ВСЁ?')) return;
    localStorage.clear();
    location.reload();
  });
}

/* =========================================================
   Import / Export
   ========================================================= */
async function importFiles() {
  try {
    const files = await window.glasswave.importAudioFiles();
    if (!files || !files.length) return;
    let added = 0;
    for (const f of files) {
      if (state.tracks.some(t => t.path === f.path)) continue;
      let meta = {};
      try { meta = await window.glasswave.readMetadata(f.path) || {}; } catch {}
      state.tracks.push({
        path: f.path,
        name: meta.title || f.name.replace(/\.[^.]+$/, ''),
        artist: meta.artist || '',
        album: meta.album || '',
        cover: meta.cover || '',
        duration: meta.duration || 0,
        favorite: false,
        playCount: 0
      });
      added++;
    }
    saveLibrary(); renderLibrary(); renderRecent();
    if (added) toast(`Добавлено: ${added}`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function bindImportExport() {
  safeOn('importBtn', 'click', importFiles);
  safeOn('importBtnHome', 'click', importFiles);

  safeOn('exportLibBtn', 'click', async () => {
    const r = await window.glasswave.exportLibrary({ tracks: state.tracks, playlists: state.playlists });
    if (r && r.ok) toast('Экспортировано: ' + r.path, 'success');
    else if (r && r.error) toast(r.error, 'error');
  });

  safeOn('importLibBtn', 'click', async () => {
    const r = await window.glasswave.importLibrary();
    if (!r || !r.ok) { if (r && r.error) toast(r.error, 'error'); return; }
    if (Array.isArray(r.data.tracks)) state.tracks = r.data.tracks.filter(t => t && t.path && t.name);
    if (Array.isArray(r.data.playlists)) state.playlists = r.data.playlists.filter(p => p && p.id && p.name);
    saveLibrary(); renderLibrary(); renderPlaylists(); renderRecent();
    toast('Импортировано', 'success');
  });
}

/* =========================================================
   Drag & Drop
   ========================================================= */
let dragCounter = 0;
function bindDragDrop() {
  document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; document.body.classList.add('dragging'); });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dragCounter = 0; document.body.classList.remove('dragging'); } });
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('dragging');
    const paths = [...e.dataTransfer.files].map(f => f.path).filter(Boolean);
    if (!paths.length) return;
    const audioPaths = paths.filter(p => AUDIO_RE.test(p));
    if (!audioPaths.length) return toast('Аудиофайлы не найдены', 'error');
    let added = 0;
    for (const p of audioPaths) {
      if (state.tracks.some(t => t.path === p)) continue;
      let meta = {};
      try { meta = await window.glasswave.readMetadata(p) || {}; } catch {}
      state.tracks.push({
        path: p,
        name: meta.title || p.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
        artist: meta.artist || '',
        album: meta.album || '',
        cover: meta.cover || '',
        duration: meta.duration || 0,
        favorite: false,
        playCount: 0
      });
      added++;
    }
    saveLibrary(); renderLibrary(); renderRecent();
    if (added) toast(`Добавлено: ${added}`, 'success');
  });
}

/* =========================================================
   Downloads
   ========================================================= */
function bindDownloads() {
  safeOn('folderBtn', 'click', async () => {
    const f = await window.glasswave.chooseFolder();
    if (f) {
      state.folder = f;
      if ($('folderPath')) { $('folderPath').textContent = f; $('folderPath').title = f; }
    }
  });

  safeOn('openFolderBtn', 'click', () => {
    if (state.folder) window.glasswave.openPath(state.folder);
  });

  window.glasswave.defaultDownloadFolder().then(f => {
    if (!state.folder && f) {
      state.folder = f;
      if ($('folderPath')) { $('folderPath').textContent = f; $('folderPath').title = f; }
    }
  }).catch(() => {});

  safeOn('checkBtn', 'click', async () => {
    const url = $('trackUrl')?.value.trim();
    if (!url) return toast('Вставь ссылку', 'error');
    try { new URL(url); } catch { return toast('Некорректная ссылка', 'error'); }

    if (/^https?:\/\/(www\.|m\.)?soundcloud\.com\//i.test(url)) {
      state.lastSoundCloudUrl = url;
      if ($('soundcloudActions')) $('soundcloudActions').classList.remove('hidden');
      toast('SoundCloud: используй официальную загрузку', 'notice');
      return;
    }

    if ($('soundcloudActions')) $('soundcloudActions').classList.add('hidden');
    if (!state.folder) return toast('Выбери папку', 'error');

    const checkBtn = $('checkBtn');
    if (checkBtn) checkBtn.disabled = true;
    const progress = $('downloadProgress'), fill = $('progressFill'), text = $('progressText');
    if (progress) progress.classList.remove('hidden');
    if (fill) fill.style.width = '30%';
    if (text) text.textContent = 'Загрузка…';

    try {
      const r = await window.glasswave.downloadDirectAudio({ url, folder: state.folder });
      if (r && r.ok) {
        if (fill) fill.style.width = '100%';
        if (text) text.textContent = 'Готово: ' + r.name;
        toast('Загружено: ' + r.name, 'success');
        let meta = {};
        try { meta = await window.glasswave.readMetadata(r.path) || {}; } catch {}
        if (!state.tracks.some(t => t.path === r.path)) {
          state.tracks.push({
            path: r.path,
            name: meta.title || r.name.replace(/\.[^.]+$/, ''),
            artist: meta.artist || '',
            album: meta.album || '',
            cover: meta.cover || '',
            duration: meta.duration || 0,
            favorite: false,
            playCount: 0
          });
          saveLibrary(); renderLibrary(); renderRecent();
        }
        setTimeout(() => progress?.classList.add('hidden'), 3000);
      } else {
        toast((r && r.error) || 'Не удалось загрузить', 'error');
        if (progress) progress.classList.add('hidden');
      }
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
      if (progress) progress.classList.add('hidden');
    } finally {
      if (checkBtn) checkBtn.disabled = false;
    }
  });

  safeOn('showForHubBtn', 'click', () => $('forhubPanel')?.classList.remove('hidden'));
  safeOn('hideForHubBtn', 'click', () => $('forhubPanel')?.classList.add('hidden'));
  safeOn('externalForHubBtn', 'click', () => window.glasswave.openExternal('https://www.forhub.io/soundcloud/en/'));
  safeOn('openTrackBtn', 'click', () => { if (state.lastSoundCloudUrl) window.glasswave.openExternal(state.lastSoundCloudUrl); });
}

/* =========================================================
   Edit track modal
   ========================================================= */
function openEditTrackModal() {
  const track = state.tracks[state.currentTrackIndex];
  if (!track) { toast('Нет активного трека', 'error'); return; }
  state.editingTrackIndex = state.currentTrackIndex;
  if ($('editTrackName')) $('editTrackName').value = track.name || '';
  if ($('editTrackArtist')) $('editTrackArtist').value = track.artist || '';
  const preview = $('editCoverPreview');
  if (preview) {
    preview.innerHTML = track.cover ? `<img src="${escapeHtml(track.cover)}" alt="">` : '♫';
    preview.dataset.newCoverPath = '';
  }
  $('editTrackModal')?.classList.remove('hidden');
}

function bindEditTrack() {
  safeOn('editTrackBtn', 'click', openEditTrackModal);

  safeOn('pickCoverBtn', 'click', async () => {
    try {
      const path = await window.glasswave.pickFile('image');
      if (path) {
        const url = await window.glasswave.fileUrl(path);
        const preview = $('editCoverPreview');
        if (preview) {
          preview.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
          preview.dataset.newCoverPath = path;
        }
      }
    } catch (e) { toast(e.message, 'error'); }
  });

  safeOn('removeCoverBtn', 'click', () => {
    const preview = $('editCoverPreview');
    if (preview) { preview.innerHTML = '♫'; preview.dataset.newCoverPath = ''; }
  });

  safeOn('cancelEditBtn', 'click', () => {
    $('editTrackModal')?.classList.add('hidden');
    state.editingTrackIndex = -1;
  });

  safeOn('saveEditBtn', 'click', async () => {
    const idx = state.editingTrackIndex;
    if (idx < 0) return;
    const track = state.tracks[idx];
    if (!track) return;
    track.name = $('editTrackName')?.value.trim() || track.name;
    track.artist = $('editTrackArtist')?.value.trim() || '';
    const preview = $('editCoverPreview');
    const ncp = preview?.dataset.newCoverPath;
    if (ncp !== undefined && ncp !== '') {
      try { track.cover = await window.glasswave.fileUrl(ncp); } catch {}
    } else if (ncp === '') {
      track.cover = '';
    }
    saveLibrary(); renderLibrary(); renderRecent(); updateNowPlaying(track);
    $('editTrackModal')?.classList.add('hidden');
    state.editingTrackIndex = -1;
    toast('Трек обновлён', 'success');
  });
}

/* =========================================================
   Sidebar / Hotkeys
   ========================================================= */
function bindSidebar() {
  safeOn('sidebarToggle', 'click', () => {
    document.body.classList.toggle('sidebar-collapsed');
    const t = $('sidebarToggle');
    if (t) t.textContent = document.body.classList.contains('sidebar-collapsed') ? '›' : '‹';
  });
}

function bindHotkeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, [contenteditable="true"]')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (k === 'arrowright') { e.preventDefault(); if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
    else if (k === 'arrowleft') { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 5); }
    else if (k === 'arrowup') { e.preventDefault(); audio.volume = Math.min(1, audio.volume + 0.05); if ($('volumeBar')) $('volumeBar').value = audio.volume; }
    else if (k === 'arrowdown') { e.preventDefault(); audio.volume = Math.max(0, audio.volume - 0.05); if ($('volumeBar')) $('volumeBar').value = audio.volume; }
    else if (k === 'm') { $('muteBtn')?.click(); }
    else if (k === 's') { toggleShuffle(); }
    else if (k === 'r') { cycleRepeat(); }
    else if (k === 'escape') { $('playerExpand')?.classList.add('hidden'); hideContextMenu(); }
  });
}

/* =========================================================
   Community Bindings
   ========================================================= */
function bindCommunity() {
  safeOn('userSearchInput', 'input', (e) => {
    renderCommunityUsers(e.target.value);
  });

  safeOn('backToUsersBtn', 'click', () => {
    $('userPlaylistsPanel')?.classList.add('hidden');
    state.selectedCommunityUser = null;
  });

  // Автообновление каждые 5 секунд, если открыта вкладка Сообщество
  setInterval(() => {
    if (document.body.dataset.section === 'community') {
      loadCommunityUsers();
    }
  }, 5000);
}

/* =========================================================
   Init
   ========================================================= */
function init() {
  loadState();
  loadProfile();
  applyTheme(settings.theme);
  applyGlassSettings();
  applyPlayerSize();

  renderThemes();
  buildEqualizer();
  renderLibrary();
  renderRecent();
  renderPlaylists();
  renderProfile();

  bindSearch();
  bindPlayer();
  bindSettings();
  bindImportExport();
  bindDragDrop();
  bindDownloads();
  bindEditTrack();
  bindSidebar();
  bindHotkeys();
  bindContextMenu();
  bindCommunity();

  safeOn('profileBtn', 'click', openProfileModal);

  $$('.nav').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.nav)));
  $$('[data-nav]').forEach(el => {
    if (!el.classList.contains('nav')) el.addEventListener('click', () => navigate(el.dataset.nav));
  });
  $$('[data-open]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.open)));
  safeOn('backBtn', 'click', goBack);
  safeOn('quickSettingsBtn', 'click', () => navigate('settings'));

  safeOn('newPlaylistBtn', 'click', async () => {
    const name = prompt('Название плейлиста:');
    if (!name) return;
    if (state.playlists.some(p => p.name === name)) { toast('Уже есть', 'error'); return; }
    state.playlists.push({ id: Date.now().toString(), name, description: '', cover: '', tracks: [], isPublic: false });
    saveLibrary(); renderPlaylists();
    toast('Плейлист создан', 'success');
  });

  const view = new URLSearchParams(location.search).get('view') || 'home';
  navigate(SECTIONS.includes(view) ? view : 'home', false);

  applyBackground();
  updatePlayIcons();

  const bar = $('playerBar');
  if (bar) bar.classList.add('hidden');

  setInterval(() => {
    if (audio && audio.src && !audio.paused) {
      const t = state.tracks[state.currentTrackIndex];
      if (t && window.glasswave?.updateDiscordRPC) {
        window.glasswave.updateDiscordRPC({
          name: t.name,
          artist: t.artist || '',
          startedAt: Date.now() - audio.currentTime * 1000
        });
      }
    }
  }, 14000);

  console.log('[xenox] ready');
}

document.addEventListener('DOMContentLoaded', init);