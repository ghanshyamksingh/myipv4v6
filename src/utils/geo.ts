/**
 * Converts a 2-letter ISO 3166-1 alpha-2 country code to a Unicode flag emoji.
 */
export function countryCodeToEmoji(code?: string): string {
  if (!code || code.length !== 2) return '🌐';
  const upper = code.toUpperCase();
  const first = upper.codePointAt(0);
  const second = upper.codePointAt(1);
  if (!first || !second) return '🌐';
  if (first < 65 || first > 90 || second < 65 || second > 90) return '🌐';
  // Regional indicator symbols start at 0x1F1E6 for 'A'
  return String.fromCodePoint(first + 127397, second + 127397);
}

/**
 * Formats coordinates into standard decimal string.
 */
export function formatCoordinates(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined || isNaN(lat) || isNaN(lon)) {
    return 'Unavailable';
  }
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lon).toFixed(4)}° ${lonDir}`;
}

/**
 * Returns formatted local time string for a given IANA timezone.
 */
export function getLocalTime(timezone?: string): string {
  if (!timezone) return 'Unavailable';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    return formatter.format(new Date());
  } catch {
    return 'Unavailable';
  }
}
