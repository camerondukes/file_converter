import { FFmpeg } from '@ffmpeg/ffmpeg';

// Converters accept a File and { signal, onProgress }, and return a Blob.
// Keep FFmpeg here so future text/image converters don't depend on it.
export async function convertWebmToMp4(file, { signal, onProgress }) {
  signal.throwIfAborted();
  const engine = new FFmpeg();
  const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, document.baseURI);
  let timer;
  let loading = true;
  let timedOut = false;
  const logs = [];
  const stop = () => engine.terminate();

  signal.addEventListener('abort', stop, { once: true });
  engine.on('log', ({ message }) => {
    logs.push(message);
    if (logs.length > 30) logs.shift();
  });
  engine.on('progress', ({ progress }) => {
    if (Number.isFinite(progress)) {
      onProgress({ percent: Math.max(0, Math.min(99, Math.round(progress * 100))) });
    }
  });

  try {
    onProgress({ message: 'Loading conversion engine (~31 MB)…' });
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, 90000);
    await engine.load({
      coreURL: new URL('ffmpeg-core.js', base).href,
      wasmURL: new URL('ffmpeg-core.wasm', base).href,
    });
    clearTimeout(timer);
    loading = false;
    signal.throwIfAborted();

    onProgress({ message: 'Preparing file…' });
    const data = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    await engine.writeFile('input.webm', data);
    onProgress({ message: 'Converting…' });
    const code = await engine.exec([
      '-y', '-i', 'input.webm', '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'output.mp4',
    ]);
    signal.throwIfAborted();
    if (code !== 0) throw new Error('Conversion failed');

    onProgress({ message: 'Preparing download…' });
    const output = await engine.readFile('output.mp4');
    signal.throwIfAborted();
    if (!output.length) throw new Error('Empty output');
    return new Blob([output], { type: 'video/mp4' });
  } catch (error) {
    signal.throwIfAborted();
    if (timedOut) throw new Error('The conversion engine took too long to load. Please retry.');
    if (loading) throw new Error('Could not load the video engine. Refresh and try again.');
    if (/memory access|out of memory|Aborted/i.test(logs.join('\n'))) {
      throw new Error('Browser memory limit reached. Try a smaller video or close other tabs.');
    }
    throw new Error('Could not convert this video. It may be damaged, unsupported, or too large for browser memory.');
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    // Release the worker, its virtual files, and WebAssembly memory after each file.
    engine.terminate();
  }
}
