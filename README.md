# Glasswave v0.15.0

Windows Electron prototype with:
- Glassmorphism UI
- Direct download of publicly accessible audio-file URLs
- SoundCloud URL detection, a ForHub external downloader button, and a button to open the track in SoundCloud
- Download destination folder picker
- Safe Electron boundary: context isolation, no Node integration in renderer

## Run
1. Install Node.js LTS.
2. In this folder run `npm install`
3. Run `npm start`

## Build portable Windows app
Run `npm run dist`. The portable executable is produced under `dist/`.

## SoundCloud behavior
A SoundCloud track URL is a webpage, not a direct audio-file URL. The app does not extract streams or bypass creator/platform restrictions. It opens the official track page so the user can use SoundCloud's own **Download file** control when the uploader has enabled it. Availability and placement of that control depend on the track and SoundCloud's current UI.

## Direct audio links
The downloader accepts HTTP(S) URLs that return an audio MIME type (or a recognized audio extension with an audio MIME type). It rejects HTML pages, including ordinary track pages. Downloads use Node/Electron's built-in fetch and are saved to the selected folder.


## ForHub integration
The app includes an embedded Electron webview panel for ForHub and an external-browser fallback. Favorites are session-only in this prototype; they reset when the app restarts.

## ForHub integration
The app opens the ForHub SoundCloud downloader in the default browser. It does not assume an undocumented URL parameter or scrape the service. Paste the SoundCloud URL into ForHub yourself; site behavior and availability may change. Downloaded files can then be kept in the selected folder and added to the local library manually.

## v0.15.0 updates
- Added settings with five color themes, including a light background.
- Library search, remove-from-library control, and automatic persistence of tracks/favorites.
- Opening local folders and audio files now uses a dedicated local-path handler.
- Downloaded audio is added to the library automatically.


## Новое в 0.14
- Автоматическая папка загрузок `Music/SoundCloud` (можно выбрать другую).
- Встроенный плеер с воспроизведением, паузой, перемоткой, громкостью и переключением треков.
- Отдельные окна обзора, библиотеки, загрузок и настроек через боковое меню.


## v0.15.0
- Обновлено оформление всех окон в едином Spotify-inspired стиле: чёрные панели, зелёные акценты, скруглённые элементы и нижняя панель плеера.
- Одинаковый визуальный язык для обзора, библиотеки, загрузок и настроек.


## v0.18.0
- Исправлено вертикальное расположение элементов во вкладках загрузок и настроек.
- Добавлено стеклянное оформление панелей (glassmorphism).
- Удалена вкладка «Избранное» из бокового меню.
- Добавлен раскрывающийся полноэкранный плеер с управлением, перемоткой и громкостью.
