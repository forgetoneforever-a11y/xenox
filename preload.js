const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('glasswave', {
  /* =========================================================
     Папки и пути
     ========================================================= */
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  defaultDownloadFolder: () => ipcRenderer.invoke('default-download-folder'),
  openWindow: (view) => ipcRenderer.invoke('open-window', view),

  /* =========================================================
     Файлы — URL и метаданные
     ========================================================= */
  audioFileUrl: (filePath) => ipcRenderer.invoke('audio-file-url', filePath),
  fileUrl: (filePath) => ipcRenderer.invoke('file-url', filePath),
  pickFile: (type) => ipcRenderer.invoke('pick-file', type),
  importAudioFiles: () => ipcRenderer.invoke('import-audio-file'),
  readMetadata: (filePath) => ipcRenderer.invoke('read-metadata', filePath),

  /* =========================================================
     Системные действия
     ========================================================= */
  openPath: (targetPath) => ipcRenderer.invoke('open-path', targetPath),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  /* =========================================================
     Загрузка и библиотека
     ========================================================= */
  downloadDirectAudio: (payload) => ipcRenderer.invoke('download-direct-audio', payload),
  exportLibrary: (data) => ipcRenderer.invoke('export-library', data),
  importLibrary: () => ipcRenderer.invoke('import-library'),

  /* =========================================================
     Discord Rich Presence
     ========================================================= */
  updateDiscordRPC: (track) => ipcRenderer.send('discord-rpc-update', track),
  clearDiscordRPC: () => ipcRenderer.send('discord-rpc-clear'),

  /* =========================================================
     Community (UDP-discovery + HTTP)
     ========================================================= */
  getDiscoveredUsers: () => ipcRenderer.invoke('get-discovered-users'),
  getUserPlaylists: (userId) => ipcRenderer.invoke('get-user-playlists', userId),
  updateCommunityProfile: (profile) => ipcRenderer.send('update-community-profile', profile),
  updatePublicPlaylists: (playlists) => ipcRenderer.send('update-public-playlists', playlists)
});