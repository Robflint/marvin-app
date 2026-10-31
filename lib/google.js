// Google Calendar (read-only) through Google Identity Services in the browser.
// The access token lasts about an hour; signing in again needs a tap, so tools report
// "not connected" and the UI shows a Connect button.

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
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
    return t && t.expires > Date.now() + 60_000 ? t.token : null;
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
            JSON.stringify({ token: resp.access_token, expires: Date.now() + resp.expires_in * 1000 }),
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
