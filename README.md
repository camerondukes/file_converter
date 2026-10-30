# File Converter

A private, browser-based file converter. Choose **From** and **To**, add files,
then convert and download. Currently supports **WebM → MP4**. The To dropdown
only lists conversions implemented for the selected input type.

## Run and build

Use Node.js 22.12+:

```sh
npm ci
npm run dev
```

To update the ready-to-serve site:

```sh
npm run build
```

Serve `dist/` with VS Code Live Server or `npm run preview`. If you already
have `http://127.0.0.1:5500/dist/index.html` open, refresh it after building.
Workers need HTTP/HTTPS; double-clicking the HTML file won't work.

## GitHub Pages deployment

Live site: https://camerondukes.github.io/file_converter/

Push source changes to `main` to publish the site automatically. The workflow in
`.github/workflows/deploy.yml` installs dependencies, builds the app, runs the
browser tests, and deploys `dist/` only after the tests pass. You can also run
it manually from the repository's Actions tab.

Repository settings: **Settings → Pages → Build and deployment → Source →
GitHub Actions**. This is a one-time setting.

To publish a local change:

```sh
git add .
git commit -m "Describe your change"
git push
```

Keep editing the root `index.html` and `src/`. Generated folders such as
`dist/`, `node_modules/`, and `public/ffmpeg/` stay out of Git. The build copies
the FFmpeg engine and third-party license notices into the published site.
Relative asset paths support the `/file_converter/` repository subdirectory.
No CDN or server-side conversion service is needed.

## Where to make changes

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and controls |
| `src/style.css` | Appearance and responsive layout |
| `src/main.js` | Dropdowns, file queue, progress, and downloads |
| `src/formats.js` | Supported file types and conversion pairs |
| `src/converter.js` | WebM → MP4 implementation using FFmpeg |
| `public/` | Static assets and third-party licenses copied into the build |
| `scripts/copy-engine.mjs` | Copies the installed FFmpeg engine before dev/build |
| `tests/` | Browser tests and small video fixtures |

`dist/`, `node_modules/`, and `public/ffmpeg/` are generated. Edit the source
files above, then build; don't maintain a separate copy of the app in `dist/`.

## Add another conversion

1. Add the input/output metadata to `formats` in `src/formats.js`.
2. Implement a converter that accepts `(file, { signal, onProgress })` and
   returns a `Blob`. Respect `signal` for cancellation. Report progress using
   `onProgress({ percent: 50 })` or `onProgress({ message: 'Preparing…' })`.
3. Add a pair to `conversions`, specifying `from`, `to`, `maxSize` (bytes),
   `convert`, and optional `description`/`note` text.

The dropdowns, file picker, validation, filenames, and download labels all
follow this list. No HTML or queue changes are needed. A file type can have
multiple output types; unrelated formats aren't offered as compatible targets.
Changing formats revalidates unfinished files and preserves completed downloads.

For example, a **future** TXT → PDF pair would look like this:

```js
// Add to formats:
txt: { label: 'TXT', extension: '.txt', mime: 'text/plain' },
pdf: { label: 'PDF', extension: '.pdf', mime: 'application/pdf' },

// Add to conversions after implementing a real text-to-PDF converter:
{
  from: 'txt',
  to: 'pdf',
  maxSize: 10 * 1024 * 1024,
  convert: async (file, options) => {
    const { convertTextToPdf } = await import('./text-to-pdf.js');
    return convertTextToPdf(file, options);
  },
},
```

TXT → PDF is not implemented yet. Different file families can use different
libraries; they don't need to go through FFmpeg. Video previews are shown for
video outputs; other outputs get a download link.

## WebM → MP4 limits

- Converts sequentially to H.264 video and AAC audio (when present).
- Re-encodes at CRF 23 / veryfast; output is lossy and its size can vary.
- Pads odd frame dimensions for H.264 compatibility. Converts only the first
  video/audio tracks; extra tracks, subtitles, and transparency aren't preserved.
- Allows up to 250 MB per input. Browser memory can impose a smaller limit.
- Loads a ~31 MB local engine when needed; the browser may cache its files.
  Each conversion releases its worker and engine memory after finishing.
- Progress percentages are approximate. Keep the tab open while converting.
- Cancel stops the batch; unfinished or failed files can be retried. Downloads
  remain until their rows are removed, the queue is cleared, or the tab closes.
- Current desktop browsers are recommended for large files; mobile/Safari
  support depends on available memory and browser capabilities.

## Tests

```sh
npx playwright install chromium
npm test
```

The test command builds the app and serves it with Vite; no Python is required.
Tests cover both dropdowns, real conversions with/without audio, invalid files,
cancellation/retry, and mobile layout. Downloaded MP4s are checked with the
browser's video player, so a system FFmpeg installation is not needed.

Third-party attribution and license text live in
`public/THIRD_PARTY_NOTICES.txt` and `public/LICENSES/`, and are included in
every build. Preserve these when distributing the app.
