export function backupBytes(n: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return `${i ? n.toFixed(1) : n} ${units[i]}`;
}
