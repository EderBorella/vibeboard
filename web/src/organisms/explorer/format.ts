// Byte sizes for the tree. Base 1024 with KB/MB labels, which is what every file manager shows —
// pedantically those are KiB and MiB, and nobody reading a file list wants to be told so.
const KB = 1024;
const MB = KB * 1024;

export function formatBytes(size: number | undefined): string {
  if (size === undefined) return '';
  // Not "0.0 KB": an empty file is worth saying plainly, since it is usually a mistake.
  if (size < KB) return `${size} B`;
  if (size < MB) return `${round(size / KB)} KB`;
  return `${round(size / MB)} MB`;
}

// One decimal below ten, none above: "1.4 MB" is useful, "847.3 KB" is noise.
function round(n: number): string {
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}
