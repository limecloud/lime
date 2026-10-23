export function formatStorageBytes(bytes: number, locale: string) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit =
    bytes > 0
      ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
      : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}
