// Cloudflare Pages Function -> served at https://gabsconnect.com/ics
// Returns a single-event .ics file so iPhone (Safari) opens the "Add to Calendar" screen
// and Android hands the file to the calendar app.
// Nothing is stored. The event is built only from the link's query string.

const clean = (v, max) => String(v || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
const pad = (n) => String(n).padStart(2, '0');

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams;
  const day = clean(q.get('d'), 8);
  const start = clean(q.get('s'), 5);
  let dur = parseInt(clean(q.get('u'), 4), 10);
  if (!/^\d{8}$/.test(day) || !/^\d{2}:\d{2}$/.test(start)) {
    return new Response('Bad request', { status: 400 });
  }
  if (!(dur >= 5 && dur <= 240)) dur = 30;

  const loc = clean(q.get('l'), 120) || 'GABS 2026 Venue, Accra';
  const a = clean(q.get('a'), 80);
  const b = clean(q.get('b'), 80);
  const label = clean(q.get('t'), 60);

  const [h, m] = start.split(':').map(Number);
  const endMins = h * 60 + m + dur;
  const dtStart = `${day}T${pad(h)}${pad(m)}00Z`;
  const dtEnd = `${day}T${pad(Math.floor(endMins / 60) % 24)}${pad(endMins % 60)}00Z`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const uid = `gabs2026-${day}-${pad(h)}${pad(m)}-${[slug(a), slug(b)].sort().join('-')}@gabsconnect.com`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GABS 2026//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(`GABS 2026 B2B Meeting: ${a} & ${b}`)}`,
    `LOCATION:${esc(loc)}`,
    `DESCRIPTION:${esc(`B2B Meeting at GABS 2026`)}\\n${esc(`Date: ${label}`)}\\n${esc(`Time: ${start} (${dur} min)`)}\\n${esc(`Venue: ${loc}`)}\\nAll times GMT (Accra time)`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="GABS2026_Meeting.ics"',
      'Cache-Control': 'no-store',
    },
  });
}
