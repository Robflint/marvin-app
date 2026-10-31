// Google Calendar (read events, add events Rob approved) through Google Identity Services in the browser.
// The access token lasts about an hour; signing in again needs a tap, so tools report
// "not connected" and the UI shows a Connect button.

const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const KEY = "marvin.google";

let tokenClient = null;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
}

export function googleToken() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || "null");
    // Tokens from the old read-only scope can't add events: treat them as disconnected.
    return t && t.scope === SCOPE && t.expires > Date.now() + 60_000 ? t.token : null;
  } catch {
    return null;
  }
}

// Must be called from a tap (it opens Google's sign-in popup).
export async function connectGoogle(clientId) {
  if (!clientId) throw new Error("Add a Google OAuth client ID in Settings first");
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) return reject(new Error(resp.error));
        try {
          localStorage.setItem(
            KEY,
            JSON.stringify({ token: resp.access_token, scope: SCOPE, expires: Date.now() + resp.expires_in * 1000 }),
          );
        } catch {}
        resolve();
      },
    });
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

export async function calendarEvents({ calendars, start, end, query }) {
  const token = googleToken();
  if (!token) throw new Error("Google Calendar is not connected. Ask Rob to tap 'Connect Google' in the app.");
  const out = [];
  for (const id of calendars) {
    const params = new URLSearchParams({
      timeMin: new Date(`${start}T00:00:00`).toISOString(),
      timeMax: new Date(`${end}T23:59:59`).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      timeZone: "Europe/London",
      maxResults: "250",
    });
    if (query) params.set("q", query);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Calendar ${id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const e of data.items || []) {
      out.push({
        calendar: data.summary,
        title: e.summary || "(no title)",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        allDay: !e.start?.dateTime,
        location: e.location || undefined,
        description: e.description ? e.description.slice(0, 300) : undefined,
      });
    }
  }
  out.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return out;
}

// Turn a proposed event into a Calendar API body (UK time).
export function eventBody(e) {
  const body = { summary: e.title };
  if (e.location) body.location = e.location;
  if (e.description) body.description = e.description;
  if (!e.start_time) {
    const end = new Date(`${e.end_date || e.date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1); // all-day end date is exclusive
    body.start = { date: e.date };
    body.end = { date: end.toISOString().slice(0, 10) };
  } else {
    const endTime = e.end_time || addMinutes(e.start_time, 60);
    body.start = { dateTime: `${e.date}T${e.start_time}:00`, timeZone: "Europe/London" };
    body.end = { dateTime: `${e.end_date || e.date}T${endTime}:00`, timeZone: "Europe/London" };
  }
  if (e.reminder_minutes != null) {
    body.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: Number(e.reminder_minutes) }] };
  }
  return body;
}

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export async function createEvent(calendarId, e) {
  const token = googleToken();
  if (!token) throw new Error("Google Calendar is not connected");
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventBody(e)),
  });
  if (!res.ok) throw new Error(`Calendar: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
