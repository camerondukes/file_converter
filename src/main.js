import './style.css';
import { formats, conversions } from './formats.js';

const $ = id => document.getElementById(id);
const entries = [];
let batchController;
let dragDepth = 0;

function size(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(text, callback) {
  const element = node('button', 'btn', text);
  element.type = 'button';
  element.addEventListener('click', callback);
  return element;
}

function showError(message = '') {
  $('globalError').textContent = message;
  $('globalError').hidden = !message;
}

function selectedConversion() {
  return conversions.find(item => item.from === $('fromFormat').value && item.to === $('toFormat').value);
}

function setOptions(select, keys) {
  const previous = select.value;
  select.replaceChildren(...[...new Set(keys)].map(key => new Option(formats[key].label, key)));
  if (keys.includes(previous)) select.value = previous;
}

function updateOutputOptions() {
  const outputs = conversions.filter(item => item.from === $('fromFormat').value).map(item => item.to);
  setOptions($('toFormat'), outputs);
}

function validationMessage(file, conversion) {
  const input = formats[conversion.from];
  if (!file.name.toLowerCase().endsWith(input.extension)) return `Unsupported file. Choose a ${input.extension} file.`;
  if (!file.size) return 'This file is empty.';
  if (file.size > conversion.maxSize) return `File exceeds the ${size(conversion.maxSize)} limit for this conversion.`;
  return '';
}

function updateSelection() {
  const conversion = selectedConversion();
  const input = formats[conversion.from];
  const output = formats[conversion.to];
  $('fileInput').accept = `${input.extension},${input.mime}`;
  $('dropTitle').textContent = `Drop your ${input.label} files here`;
  $('fileHint').textContent = `${input.label} files · Up to ${size(conversion.maxSize)} per file`;
  $('formatDetail').textContent = conversion.description || '';
  $('conversionNote').textContent = conversion.note || 'Files are converted on your device. Keep this tab open.';
  $('convert').textContent = `Convert to ${output.label} →`;

  // Keep completed downloads; revalidate unfinished files for the new selection.
  for (const entry of entries) {
    if (entry.state === 'done') continue;
    const message = validationMessage(entry.file, conversion);
    entry.state = message ? 'invalid' : 'ready';
    entry.message = message || 'Ready to convert';
  }
  showError();
  $('batchStatus').textContent = 'Ready when you are.';
  render();
}

function preview(entry) {
  $('previewTitle').textContent = entry.outputName;
  $('previewVideo').src = entry.url;
  $('previewDialog').showModal();
}

function removeEntry(entry) {
  if (entry.url) URL.revokeObjectURL(entry.url);
  entries.splice(entries.indexOf(entry), 1);
  render();
}

function renderEntry(entry) {
  const row = node('li', '');
  const detail = node('div', '');
  const statusClass = ['error', 'invalid'].includes(entry.state) ? 'error' : entry.state === 'done' ? 'done' : '';
  detail.append(
    node('span', 'filename', entry.file.name),
    node('span', `file-status ${statusClass}`, `${size(entry.file.size)} · ${entry.message}`),
  );
  if (entry.state === 'converting') {
    const progress = node('progress', '');
    progress.max = 100;
    progress.value = entry.progress;
    progress.setAttribute('aria-label', `Conversion progress for ${entry.file.name}`);
    detail.append(progress);
  }

  const actions = node('div', 'row-actions');
  if (entry.url) {
    if (entry.outputMime.startsWith('video/')) actions.append(button('Preview', () => preview(entry)));
    const download = node('a', 'btn primary', `Download ${entry.outputLabel}`);
    download.href = entry.url;
    download.download = entry.outputName;
    actions.append(download);
  }
  const remove = button('Remove', () => removeEntry(entry));
  remove.disabled = Boolean(batchController);
  remove.setAttribute('aria-label', `Remove ${entry.file.name}`);
  actions.append(remove);

  const extension = entry.file.name.split('.').pop().toUpperCase().slice(0, 5);
  row.append(node('span', 'file-icon', extension), detail, actions);
  return row;
}

function render() {
  const busy = Boolean(batchController);
  $('fileCount').textContent = entries.length;
  $('queueSize').textContent = entries.length
    ? `${size(entries.reduce((sum, entry) => sum + entry.file.size, 0))} total`
    : 'No files added';
  $('empty').hidden = entries.length > 0;
  $('convert').disabled = busy || !entries.some(entry => ['ready', 'error', 'cancelled'].includes(entry.state));
  $('clear').disabled = busy || !entries.length;
  $('cancel').hidden = !busy;
  $('cancel').disabled = batchController?.signal.aborted || false;
  for (const id of ['browse', 'fileInput', 'fromFormat', 'toFormat']) $(id).disabled = busy;
  $('fileList').replaceChildren(...entries.map(renderEntry));
}

function addFiles(files) {
  if (batchController) return;
  showError();
  for (const file of files) {
    const duplicate = entries.some(entry => entry.file.name === file.name
      && entry.file.size === file.size && entry.file.lastModified === file.lastModified);
    if (duplicate) continue;
    const message = validationMessage(file, selectedConversion());
    entries.push({ file, state: message ? 'invalid' : 'ready', message: message || 'Ready to convert', progress: 0 });
  }
  render();
}

async function convertBatch() {
  if (batchController) return;
  const queue = entries.filter(entry => ['ready', 'error', 'cancelled'].includes(entry.state));
  if (!queue.length) return;

  const conversion = selectedConversion();
  const output = formats[conversion.to];
  const input = formats[conversion.from];
  batchController = new AbortController();
  const { signal } = batchController;
  let completed = 0;
  let failed = 0;
  showError();
  render();

  try {
    for (const [index, entry] of queue.entries()) {
      if (signal.aborted) break;
      entry.state = 'converting';
      entry.progress = 0;
      entry.message = 'Preparing file…';
      $('batchStatus').textContent = `File ${index + 1} of ${queue.length} · Keep this tab open.`;
      render();
      try {
        const blob = await conversion.convert(entry.file, {
          signal,
          onProgress({ percent, message }) {
            if (signal.aborted) return;
            if (Number.isFinite(percent)) {
              entry.progress = Math.max(entry.progress, Math.min(99, percent));
              entry.message = `Converting… ${entry.progress}% (approximate)`;
            } else if (message) entry.message = message;
            render();
          },
        });
        signal.throwIfAborted();
        if (!blob.size) throw new Error('The converted file was empty. Please retry.');
        entry.url = URL.createObjectURL(blob);
        entry.outputName = entry.file.name.slice(0, -input.extension.length) + output.extension;
        entry.outputLabel = output.label;
        entry.outputMime = output.mime;
        entry.state = 'done';
        entry.message = `Complete · ${output.label} ${size(blob.size)}`;
        completed++;
      } catch (error) {
        if (signal.aborted) break;
        entry.state = 'error';
        entry.message = error.message || 'Could not convert this file. Please retry.';
        failed++;
      }
      render();
    }
  } finally {
    if (signal.aborted) {
      for (const entry of queue) {
        if (['done', 'error'].includes(entry.state)) continue;
        entry.state = 'cancelled';
        entry.message = 'Cancelled · Ready to retry';
      }
    }
    batchController = undefined;
    $('batchStatus').textContent = signal.aborted
      ? `Batch cancelled. ${completed} file(s) completed.`
      : `${completed} converted${failed ? ` · ${failed} failed` : ''}. Downloads are ready below each file.`;
    if (failed) showError(`Some files could not be converted. See their messages below and click Convert to ${output.label} to retry.`);
    render();
  }
}

$('fromFormat').addEventListener('change', () => {
  updateOutputOptions();
  updateSelection();
});
$('toFormat').addEventListener('change', updateSelection);
$('browse').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', event => {
  addFiles(event.target.files);
  event.target.value = '';
});
$('dropZone').addEventListener('dragenter', event => {
  event.preventDefault();
  if (!batchController) {
    dragDepth++;
    $('dropZone').classList.add('dragover');
  }
});
$('dropZone').addEventListener('dragover', event => event.preventDefault());
$('dropZone').addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('dropZone').classList.remove('dragover');
});
$('dropZone').addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  $('dropZone').classList.remove('dragover');
  addFiles(event.dataTransfer.files);
});
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('convert').addEventListener('click', convertBatch);
$('cancel').addEventListener('click', () => {
  batchController?.abort();
  $('batchStatus').textContent = 'Cancelling batch…';
  render();
});
$('clear').addEventListener('click', () => {
  for (const entry of entries) if (entry.url) URL.revokeObjectURL(entry.url);
  entries.length = 0;
  showError();
  $('batchStatus').textContent = 'Ready when you are.';
  render();
});
$('closePreview').addEventListener('click', () => $('previewDialog').close());
$('previewDialog').addEventListener('close', () => {
  $('previewVideo').pause();
  $('previewVideo').removeAttribute('src');
  $('previewVideo').load();
});
window.addEventListener('beforeunload', event => {
  if (batchController) {
    event.preventDefault();
    event.returnValue = '';
  }
});

setOptions($('fromFormat'), conversions.map(item => item.from));
updateOutputOptions();
updateSelection();
