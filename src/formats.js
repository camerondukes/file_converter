// Register working conversions here. The dropdowns and file rules use this list.
export const formats = {
  webm: { label: 'WebM', extension: '.webm', mime: 'video/webm' },
  mp4: { label: 'MP4', extension: '.mp4', mime: 'video/mp4' },
};

export const conversions = [
  {
    from: 'webm',
    to: 'mp4',
    maxSize: 250 * 1024 * 1024,
    description: 'Video · H.264 + AAC',
    note: 'Video conversion loads a ~31 MB engine. Larger files take longer; keep this tab open.',
    // Load the video engine only when this conversion is used.
    convert: async (file, options) => {
      const { convertWebmToMp4 } = await import('./converter.js');
      return convertWebmToMp4(file, options);
    },
  },
];
