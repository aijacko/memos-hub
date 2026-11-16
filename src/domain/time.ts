/**
 * Time helpers. Pure: no Obsidian or moment import so the module can be unit
 * tested in node. Supports the subset of moment tokens the plugin uses.
 */

const pad2 = (value: number): string => String(value).padStart(2, '0');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function timezoneOffset(date: Date): string {
  // getTimezoneOffset() returns minutes behind UTC (positive west of UTC).
  const total = -date.getTimezoneOffset();
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** Format a unix-second timestamp with moment-style tokens. */
export function formatDate(timestamp: number, pattern: string): string {
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return pattern.replace(
    /YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|SSS|ZZ|Z/g,
    (token) => {
      const month = date.getMonth();
      const day = date.getDate();
      const hour = date.getHours();
      switch (token) {
        case 'YYYY': return String(date.getFullYear());
        case 'YY': return pad2(date.getFullYear() % 100);
        case 'MMMM': return MONTHS[month];
        case 'MMM': return MONTHS[month].slice(0, 3);
        case 'MM': return pad2(month + 1);
        case 'M': return String(month + 1);
        case 'DD': return pad2(day);
        case 'D': return String(day);
        case 'dddd': return WEEKDAYS[date.getDay()];
        case 'ddd': return WEEKDAYS[date.getDay()].slice(0, 3);
        case 'HH': return pad2(hour);
        case 'H': return String(hour);
        case 'hh': return pad2(hour % 12 === 0 ? 12 : hour % 12);
        case 'h': return String(hour % 12 === 0 ? 12 : hour % 12);
        case 'mm': return pad2(date.getMinutes());
        case 'm': return String(date.getMinutes());
        case 'ss': return pad2(date.getSeconds());
        case 's': return String(date.getSeconds());
        case 'SSS': return String(date.getMilliseconds()).padStart(3, '0');
        case 'ZZ': return timezoneOffset(date).replace(':', '');
        case 'Z': return timezoneOffset(date);
        default: return token;
      }
    },
  );
}

/** Local ISO-like timestamp used by the `created` property. */
export function formatLocalIso(timestamp: number): string {
  return formatDate(timestamp, 'YYYY-MM-DDTHH:mm:ssZ');
}

export function toDayKey(timestamp: number): string {
  return formatDate(timestamp, 'YYYY-MM-DD');
}

export function toTimeLabel(timestamp: number): string {
  return formatDate(timestamp, 'HH:mm');
}

/** Parse an ISO timestamp into unix seconds, or null when invalid. */
export function parseIsoSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.floor(parsed / 1000);
}

export function isValidTimestamp(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function getTimeEmoji(hour: number): string {
  if (hour >= 5 && hour < 12) return '🌅';
  if (hour >= 12 && hour < 17) return '☀️';
  if (hour >= 17 && hour < 21) return '🌆';
  return '🌙';
}

export function getTimePeriod(hour: number): string {
  if (hour >= 5 && hour < 12) return '早晨';
  if (hour >= 12 && hour < 17) return '中午';
  if (hour >= 17 && hour < 21) return '傍晚';
  return '夜晚';
}

export function getCalloutType(hour: number): string {
  if (hour >= 5 && hour < 12) return 'info';
  if (hour >= 12 && hour < 17) return 'tip';
  if (hour >= 17 && hour < 21) return 'warning';
  return 'note';
}

export function getHour(timestamp: number): number {
  return new Date(timestamp * 1000).getHours();
}
