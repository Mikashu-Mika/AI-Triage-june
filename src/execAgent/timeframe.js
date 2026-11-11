/**
 * Single source of truth for executive-bot time periods (Thailand time, UTC+7).
 * The LLM router only produces a structured period spec; all date math happens here.
 */

const TZ = 'Asia/Bangkok';
const DAY_MS = 24 * 60 * 60 * 1000;

export const PERIOD_TYPES = [
  'today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month',
  'last_n_days', 'month', 'date_range', 'all_time'
];

/** "YYYY-MM-DD" of a Date in Thailand time */
function thaiDateString(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

/** Date at 00:00 Thailand time of a "YYYY-MM-DD" string */
function thaiMidnight(dateStr) {
  return new Date(`${dateStr}T00:00:00+07:00`);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Thai label of a date, e.g. "23 ต.ค. 2569" */
export function formatThaiDate(date) {
  return date.toLocaleDateString('th-TH', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}

/** Thai label of a date-time, e.g. "23 ต.ค. 2569 14:05 น." */
export function formatThaiDateTime(date) {
  const d = new Date(date);
  return `${formatThaiDate(d)} ${d.toLocaleTimeString('th-TH', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })} น.`;
}

/** Hour of day (0-23) in Thailand time */
export function thaiHour(date) {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(date)), 10);
}

/** "YYYY-MM-DD" in Thailand time */
export function thaiDay(date) {
  return thaiDateString(new Date(date));
}

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/**
 * Resolve a period spec into an absolute [start, end) window.
 * @param {object} spec - { type, n?, month?, year?, start_date?, end_date?, start_hour?, end_hour? }
 * @param {Date} [now]
 * @returns {{ type: string, start: Date, end: Date, label: string, days: number, isPartial: boolean, hourFrom: number|null, hourTo: number|null }}
 */
export function resolvePeriod(spec, now = new Date()) {
  const type = spec && PERIOD_TYPES.includes(spec.type) ? spec.type : 'last_n_days';
  const today = thaiDateString(now);
  const todayStart = thaiMidnight(today);
  const [curYear, curMonth] = today.split('-').map(Number); // curMonth: 1-12
  let start;
  let end = addDays(todayStart, 1);
  let label;

  switch (type) {
    case 'today':
      start = todayStart;
      label = `วันนี้ (${formatThaiDate(start)})`;
      break;
    case 'yesterday':
      start = addDays(todayStart, -1);
      end = todayStart;
      label = `เมื่อวาน (${formatThaiDate(start)})`;
      break;
    case 'this_week': {
      // Weeks start on Monday (0 = Monday)
      const thaiWeekday = (new Date(today + 'T12:00:00+07:00').getUTCDay() + 6) % 7;
      start = addDays(todayStart, -thaiWeekday);
      label = `สัปดาห์นี้ (${formatThaiDate(start)} - ปัจจุบัน)`;
      break;
    }
    case 'last_week': {
      const thaiWeekday = (new Date(today + 'T12:00:00+07:00').getUTCDay() + 6) % 7;
      end = addDays(todayStart, -thaiWeekday);
      start = addDays(end, -7);
      label = `สัปดาห์ที่แล้ว (${formatThaiDate(start)} - ${formatThaiDate(addDays(end, -1))})`;
      break;
    }
    case 'this_month':
      start = thaiMidnight(`${curYear}-${String(curMonth).padStart(2, '0')}-01`);
      label = `เดือนนี้ (${THAI_MONTHS[curMonth - 1]} ${curYear + 543})`;
      break;
    case 'last_month': {
      const y = curMonth === 1 ? curYear - 1 : curYear;
      const m = curMonth === 1 ? 12 : curMonth - 1;
      start = thaiMidnight(`${y}-${String(m).padStart(2, '0')}-01`);
      end = thaiMidnight(`${curYear}-${String(curMonth).padStart(2, '0')}-01`);
      label = `เดือนที่แล้ว (${THAI_MONTHS[m - 1]} ${y + 543})`;
      break;
    }
    case 'month': {
      const m = Math.min(12, Math.max(1, parseInt(spec.month, 10) || curMonth));
      let y = parseInt(spec.year, 10) || (m > curMonth ? curYear - 1 : curYear);
      if (y > 2400) y -= 543; // Buddhist year given
      start = thaiMidnight(`${y}-${String(m).padStart(2, '0')}-01`);
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      end = thaiMidnight(`${ny}-${String(nm).padStart(2, '0')}-01`);
      label = `เดือน${THAI_MONTHS[m - 1]} ${y + 543}`;
      break;
    }
    case 'date_range': {
      const s = /^\d{4}-\d{2}-\d{2}$/.test(spec.start_date || '') ? spec.start_date : today;
      const e = /^\d{4}-\d{2}-\d{2}$/.test(spec.end_date || '') ? spec.end_date : s;
      start = thaiMidnight(s <= e ? s : e);
      end = addDays(thaiMidnight(s <= e ? e : s), 1);
      label = s === e ? formatThaiDate(start) : `${formatThaiDate(start)} - ${formatThaiDate(addDays(end, -1))}`;
      break;
    }
    case 'all_time':
      start = new Date('2000-01-01T00:00:00+07:00');
      label = 'ทั้งหมดที่มีในระบบ';
      break;
    case 'last_n_days':
    default: {
      const n = Math.min(366, Math.max(1, parseInt(spec?.n, 10) || 7));
      start = addDays(todayStart, -(n - 1));
      label = `ย้อนหลัง ${n} วัน (${formatThaiDate(start)} - วันนี้)`;
      break;
    }
  }

  // Optional time-of-day filter, e.g. "12.00-18.00"
  const hourFrom = Number.isInteger(spec?.start_hour) && spec.start_hour >= 0 && spec.start_hour <= 23 ? spec.start_hour : null;
  const hourTo = Number.isInteger(spec?.end_hour) && spec.end_hour >= 1 && spec.end_hour <= 24 ? spec.end_hour : null;
  if (hourFrom !== null || hourTo !== null) {
    label += ` เวลา ${String(hourFrom ?? 0).padStart(2, '0')}:00-${String(hourTo ?? 24).padStart(2, '0')}:00 น.`;
  }

  const effectiveEnd = end > now ? now : end;
  return {
    type,
    start,
    end,
    label,
    days: Math.max(1, Math.round((effectiveEnd - start) / DAY_MS)),
    isPartial: end > now && type !== 'all_time',
    hourFrom,
    hourTo
  };
}

/** Whether a timestamp falls inside the resolved period (including the optional hour filter) */
export function inPeriod(timestamp, period) {
  const t = new Date(timestamp);
  if (t < period.start || t >= period.end) return false;
  if (period.hourFrom === null && period.hourTo === null) return true;
  const h = thaiHour(t);
  return h >= (period.hourFrom ?? 0) && h < (period.hourTo ?? 24);
}

/** The period of equal length right before the given one (for trend comparisons) */
export function previousPeriod(period) {
  const length = period.end - period.start;
  const start = new Date(period.start.getTime() - length);
  return {
    ...period,
    type: 'date_range',
    start,
    end: period.start,
    label: `ช่วงก่อนหน้า (${formatThaiDate(start)} - ${formatThaiDate(addDays(period.start, -1))})`,
    isPartial: false
  };
}

/** Today's date in Thailand time, for prompts */
export function todayContext(now = new Date()) {
  const today = thaiDateString(now);
  const weekday = new Date(today + 'T12:00:00+07:00').toLocaleDateString('th-TH', { timeZone: TZ, weekday: 'long' });
  return { iso: today, thai: `${weekday} ${formatThaiDate(now)}` };
}
