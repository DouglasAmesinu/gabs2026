# Text-safety audit (index.html)

Where data from users or Firestore reaches the page, and what was done about it.
Line numbers refer to `index.html` at main `22b97bc`, before the fixes.

## Gaps found and fixed

| # | Location | Source | Risk | Fix |
|---|----------|--------|------|-----|
| 1 | `renderSchedule` calendar buttons (L1712-1714) | `meeting.day`, `meeting.start` (set by whoever proposes the meeting; the rules don't validate `meeting`), other participant's `name`, message id | **High.** Values are interpolated into inline `onclick="window.open('…')"` JavaScript. `day`/`start` are not URL-encoded, and `encodeURIComponent` leaves `'` alone, so a crafted meeting or name runs script when the recipient taps the button. A name like O'Brien also breaks the button. | Inline handlers removed. The buttons now carry `data-cal` and `data-id` (passed through `safeId`). One delegated document listener builds the URLs at click time. |
| 2 | Calendar URL and ICS builders (L657-730) | `meeting.day/start/dur/loc/dayLabel`, names | **Medium.** `day`/`start` are not encoded into the Google/Outlook URLs (parameter injection). A non-string `start` throws and breaks the Schedule render. The ICS escaper keeps CR, so a value can add ICS lines. | `calParts()` validates `day` (8 digits), `start` (H:MM) and `dur` (1-600) and falls back to the old defaults. `esc2` also strips CR. |
| 3 | `avHTML` (L475-478), used by cards, profile sheet, inbox, thread, schedule, AI match, admin and profile bar | `photoURL`, `av` | **Medium.** Any URL is accepted as `<img src>`: a tracking pixel or IP leak to any host, or `data:` URIs. `av` has no length limit. | `safePhoto()` allows only https on firebasestorage hosts, otherwise initials are shown. `av` goes through `clip(av,3)`. |
| 4 | Edit Profile avatar (L874-876) | `me.photoURL`, initials of `me.name` | **Medium.** Photo from any host; initials not escaped. | `safePhoto()` plus `esc(initials(…))`. |
| 5 | LinkedIn links (L1137, L1284) | `linkedin` | **Medium.** Only the scheme is forced, so `linkedin.com@evil.com` (credentials) points elsewhere. A non-string value throws in `.replace` and breaks Discover for everyone. | `safeLinkedInURL()` built on `safeUrl` (https only, no credentials); `String()` for the shown text. |
| 6 | Profile field types (participants listener L772, admin load L2471) | `name`, `company`, `title`, `bio`, `sector`, `country`, `ptype`, `salutation`, `interests`, `av`, `photoURL`, `website`, `linkedin`, `phone` | **Medium (denial of service).** The rules only type-check `name` on create. A delegate can update their own profile with e.g. `interests: "x"` or `name: 5`; `.map`/`.toLowerCase`/`.split`/`.trim` then throw and Discover, AI match, inbox and schedule stop rendering for every delegate. | `normParticipant()` coerces text fields to strings and `interests` to an array of strings, at both load points. |
| 7 | `esc()` (L406) | everything rendered | **Low.** Does not escape `'` or `` ` ``, so it is only safe inside double-quoted attributes. | Replaced by the safe-helpers `esc`, which escapes `& < > " ' `` ` `` and maps null/undefined to "". |
| 8 | Website links (L1138, L1283) | `website` | **Low.** `safeWebsiteURL` checks with a regex only and never parses. The shown text throws on a non-string. | `safeWebsiteURL` now goes through `safeUrl` (http/https, parsed and normalised). |
| 9 | `pCardHTML` (L1119, L1141-1142), `renderInbox` (L1353) | participant `id` | **Low.** Interpolated unescaped into `data-pid`/`data-id` (ids are server-generated, but admin CSV writes participant docs). | `safeId()`. |
| 10 | `renderInbox` preview (L1361) | last message text | **Low.** Up to 2000 characters rendered per row. | `clip(text,200)`. CSS ellipsis already hides the rest, so nothing visible changes. |
| 11 | `renderMsgs` (L1550-1562) | message `id`, `resp` | **Low**, since the rules limit `resp` to accepted/declined/busy. Ids go unescaped into `data-mid/-ics/-gcal/-outlook`. An unknown `resp` is rendered unescaped (`r.txt`) and looked up on the prototype. | `safeId()`; own-property lookup and `esc(r.txt)`. |
| 12 | Admin pending list (L2522-2528) | participant `id` | **Low** (admin only). Interpolated unescaped into `id`/`data-id` and into the `getElementById` template. | Buttons carry `data-act` plus a list index and are bound from the rendered list; no id in the markup. |
| 13 | Notification banner (L1387) | message text | **Info.** Already set with `textContent`, but `slice(0,40)` can split an emoji (surrogate pair). | `clip(t,40)`. |

## Already safe (no change)

| Location | Source | Why it's fine |
|----------|--------|---------------|
| Discover cards, profile sheet, thread header, inbox rows, My Meetings, AI match, admin lists | `name`, `company`, `title`, `bio`, `sector` (incl. Other text), `country`, `ptype` (incl. Other text), `salutation`, `interests` | `esc()` in text content |
| Thread bubbles, meeting pill, My Meetings | message `text`, `fromName`, meeting `loc`, `dayLabel`, `start`, `dur` | `esc()` |
| Search box, sector chips, country filter and picker | search input, `sector`, `country` | `esc()` in `value` / `data-*`; read back via `.value` / `dataset` |
| Edit Profile form | name, company, website, title, email, linkedin, bio, ptype Other text | `esc()` in `value` and `<textarea>` |
| Ticket entry, admin, reset and CSV feedback | ticket input, error codes/messages, reset counts | constants or `esc()` |
| Notification banner, update banner, STAGING badge, profile bar refresh, photo status | names, message text | `textContent` |
| `confirm()` on name/company change | name, company | plain-text dialog |
| `window.open` Google/Outlook, `/ics?…`, `data:text/calendar` | meeting fields, names | fixed https origins with encoded params, a same-origin path with `URLSearchParams`, a locally built file |
| Claim-form photo preview | `FileReader` data URL | our own canvas JPEG, not stored data |
| Edit Profile preview right after upload | `getDownloadURL()` result | comes straight from the Storage SDK |
| AI "Close" button, loader "Retry" button | none | inline handlers with no interpolated values |
| `fromAvatar` | message field | written but never rendered |

## Follow-ups (outside this change)

- CSV export: cells starting with `= + - @` are formula injection in Excel or Sheets; prefix them with `'`.
- Logging: the staging `sendConfirmationEmail` logs name, email and company. Photo upload and remove, slot fetch and EmailJS failures log full error objects.
- EmailJS template: check it uses `{{var}}` (escaped) and not `{{{var}}}`.
- CSP: the QR library loads from `cdnjs.cloudflare.com`, which the Report-Only `script-src` doesn't list, so it will show up in reports. Add it before enforcing.
