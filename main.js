import { Agent } from "./lib/agent.js";
import { Repo } from "./lib/github.js";
import { connectGoogle, createEvent, googleToken } from "./lib/google.js";
import { renderMarkdown, escapeHtml } from "./lib/md.js";
import { canListen, englishVoices, listen, speak, stopSpeaking } from "./lib/voice.js";

const $ = (id) => document.getElementById(id);
const chat = $("chat");
const input = $("input");
const mic = $("mic");
const status = $("status");

export const VERSION = "7";

const DEFAULTS = {
  anthropicKey: "",
  githubToken: "",
  repo: "Robflint/marvin",
  model: "claude-opus-5-5",
  effort: "low",
  googleClientId: "",
  calendarIds: "primary",
  speak: true,
  voiceName: "auto",
  pitch: "0.7",
  rate: "0.85",
  autoSend: true,
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

let settings = { ...DEFAULTS, ...load("marvin.settings", {}) };
let agent = null;
let log = load("marvin.log", []); // [{who: "me"|"marvin"|"error"|"draft"|"event", text|draft|event}]
let busy = false;

function configured() {
  return settings.anthropicKey && settings.githubToken && settings.repo;
}

function newAgent(messages = []) {
  const repo = new Repo({ token: settings.githubToken, repo: settings.repo });
  agent = new Agent({
    settings,
    repo,
    ui: {
      onText: (t) => updateLive(t),
      onStatus: (s) => (status.textContent = s),
      onEvent: (ev) => {
        const item = { who: "event", event: ev, added: false };
        log.push(item);
        addEventCard(item);
        save();
      },
      onDraft: (d) => {
        log.push({ who: "draft", draft: d });
        addDraft(d);
        save();
      },
    },
  });
  agent.messages = messages;
}

function save() {
  store("marvin.log", log);
  store("marvin.messages", agent ? agent.messages : []);
}

// ---------- rendering ----------

function scrollDown() {
  chat.scrollTop = chat.scrollHeight;
}

function addBubble(who, text) {
  chat.querySelector(".empty")?.remove();
  const div = document.createElement("div");
  div.className = `msg ${who === "me" ? "me" : who === "error" ? "error" : ""}`;
  if (who === "me") div.textContent = text;
  else div.innerHTML = renderMarkdown(text);
  chat.appendChild(div);
  scrollDown();
  return div;
}

function draftLink(d) {
  const phone = (d.to || "").replace(/[^\d+]/g, "");
  const isPhone = phone.replace("+", "").length >= 7;
  const body = encodeURIComponent(d.body);
  if (d.channel === "whatsapp") return isPhone ? `https://wa.me/${phone.replace("+", "")}?text=${body}` : `https://wa.me/?text=${body}`;
  if (d.channel === "sms") return `sms:${isPhone ? phone : ""}?body=${body}`;
  const to = d.to && d.to.includes("@") ? encodeURIComponent(d.to) : "";
  return `mailto:${to}?subject=${encodeURIComponent(d.subject || "")}&body=${body}`;
}

function addDraft(d) {
  chat.querySelector(".empty")?.remove();
  const node = $("draft-card").content.firstElementChild.cloneNode(true);
  const label = { whatsapp: "WhatsApp", sms: "Text", email: "Email" }[d.channel] || d.channel;
  node.querySelector(".draft-head").textContent =
    `${label} draft${d.to ? ` to ${d.to}` : ""}${d.subject ? ` · ${d.subject}` : ""}`;
  node.querySelector(".draft-body").textContent = d.body;
  node.querySelector(".copy").onclick = async (e) => {
    await navigator.clipboard.writeText(d.channel === "email" && d.subject ? `${d.subject}\n\n${d.body}` : d.body);
    e.target.textContent = "Copied";
  };
  const open = node.querySelector(".open");
  open.href = draftLink(d);
  open.textContent = `Open in ${label}`;
  chat.appendChild(node);
  scrollDown();
}

function calendarFor(which) {
  const ids = settings.calendarIds.split(",").map((c) => c.trim()).filter(Boolean);
  const shared = ids.find((i) => i.includes("group.calendar.google.com"));
  if (which === "family" && shared) return { id: shared, label: "Family calendar" };
  return { id: ids.find((i) => !i.includes("group.calendar.google.com")) || "primary", label: "Main calendar" };
}

function describeEvent(ev) {
  const day = new Date(`${ev.date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
  const until = ev.end_date && ev.end_date !== ev.date ? ` – ${ev.end_date}` : "";
  const time = ev.start_time ? `, ${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : " (all day)";
  return `${day}${until}${time}`;
}

function addEventCard(item) {
  chat.querySelector(".empty")?.remove();
  const ev = item.event;
  const cal = calendarFor(ev.calendar);
  const node = $("event-card").content.firstElementChild.cloneNode(true);
  node.querySelector(".draft-head").textContent = `Calendar event · ${cal.label}`;
  node.querySelector(".event-title").textContent = ev.title;
  node.querySelector(".event-when").textContent =
    [describeEvent(ev), ev.location, ev.reminder_minutes != null ? `reminder ${ev.reminder_minutes} min before` : ""]
      .filter(Boolean).join(" · ");
  const btn = node.querySelector(".add");
  const done = () => {
    btn.textContent = "Added ✓";
    btn.disabled = true;
  };
  if (item.added) done();
  btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      if (!googleToken()) await connectGoogle(settings.googleClientId);
      await createEvent(cal.id, ev);
      item.added = true;
      save();
      done();
      status.textContent = `Added to ${cal.label}`;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Add to calendar";
      status.textContent = `Not added: ${e.message}`;
    }
    refreshGoogleChip();
  };
  chat.appendChild(node);
  scrollDown();
}

function renderLog() {
  chat.innerHTML = "";
  if (!log.length) {
    chat.innerHTML = `<div class="empty">${
      configured()
        ? "Tap the microphone and talk. Not that anyone listens to me."
        : "Open Settings (⚙) and add your API key and GitHub token."
    }</div>`;
    return;
  }
  for (const item of log) {
    if (item.who === "draft") addDraft(item.draft);
    else if (item.who === "event") addEventCard(item);
    else addBubble(item.who, item.text);
  }
}

let live = null;
function updateLive(text) {
  if (!live) live = addBubble("marvin", "");
  live.innerHTML = renderMarkdown(text);
  scrollDown();
}

function refreshGoogleChip() {
  $("google").hidden = !settings.googleClientId || Boolean(googleToken());
}

// ---------- sending ----------

async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  if (!configured()) {
    $("settings").showModal();
    return;
  }
  busy = true;
  mic.disabled = true;
  stopSpeaking();
  input.value = "";
  input.style.height = "auto";
  log.push({ who: "me", text });
  addBubble("me", text);
  live = null;
  try {
    const reply = await agent.send(text);
    if (reply.trim()) {
      log.push({ who: "marvin", text: reply });
      if (settings.speak) speak(reply, settings);
    }
    status.textContent = "";
  } catch (e) {
    live?.remove();
    const msg = `Something went wrong: ${e.message}`;
    log.push({ who: "error", text: msg });
    addBubble("error", msg);
    status.textContent = "";
  } finally {
    live = null;
    busy = false;
    mic.disabled = false;
    save();
    refreshGoogleChip();
  }
}

$("composer").onsubmit = (e) => {
  e.preventDefault();
  send(input.value);
};
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send(input.value);
  }
});
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
});

// ---------- voice ----------

let stopListening = null;
function toggleMic() {
  if (stopListening) {
    stopListening();
    return;
  }
  stopSpeaking();
  mic.classList.add("listening");
  status.textContent = "Listening…";
  stopListening = listen({
    onInterim: (t) => (input.value = t),
    onFinal: (t) => {
      input.value = t;
      if (settings.autoSend) send(t);
    },
    onEnd: () => {
      mic.classList.remove("listening");
      stopListening = null;
      if (status.textContent === "Listening…") status.textContent = "";
    },
    onError: (err) => {
      status.textContent = err === "not-allowed" ? "Microphone blocked: allow it in Chrome site settings" : `Mic: ${err}`;
    },
  });
}
if (canListen) mic.onclick = toggleMic;
else {
  mic.disabled = true;
  mic.title = "Speech recognition isn't available in this browser";
}

// ---------- header buttons ----------

$("new").onclick = () => {
  if (busy) return;
  log = [];
  newAgent([]);
  save();
  renderLog();
};

$("google").onclick = async () => {
  try {
    await connectGoogle(settings.googleClientId);
    status.textContent = "Google connected";
  } catch (e) {
    status.textContent = `Google: ${e.message}`;
  }
  refreshGoogleChip();
};

const form = $("settings-form");
$("open-settings").onclick = () => {
  for (const [k, v] of Object.entries(settings)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(v);
    else el.value = v;
  }
  $("version").textContent = `App version ${VERSION}`;
  const select = form.elements.voiceName;
  select.innerHTML = '<option value="auto">Auto (British male)</option>' +
    englishVoices().map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.name)} (${v.lang})</option>`).join("");
  select.value = settings.voiceName;
  $("settings").showModal();
};
$("test-voice").onclick = () =>
  speak("Twenty-eight things on your todo list. I have calculated the odds of you finishing them. You do not want to know.", {
    voiceName: form.elements.voiceName.value,
    pitch: form.elements.pitch.value,
    rate: form.elements.rate.value,
  });

$("settings").addEventListener("close", () => {
  if ($("settings").returnValue !== "save") return;
  for (const k of Object.keys(DEFAULTS)) {
    const el = form.elements[k];
    if (!el) continue;
    settings[k] = el.type === "checkbox" ? el.checked : el.value.trim();
  }
  store("marvin.settings", settings);
  newAgent(agent ? agent.messages : []);
  renderLog();
  refreshGoogleChip();
});

// ---------- start ----------

newAgent(load("marvin.messages", []));
renderLog();
refreshGoogleChip();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});

// Home-screen shortcut "Talk to Marvin" opens with ?listen=1.
if (new URLSearchParams(location.search).has("listen") && canListen && configured()) {
  try {
    toggleMic();
  } catch {
    status.textContent = "Tap the microphone to talk";
  }
}

// Exposed for debugging only.
window.marvin = { get agent() { return agent; }, escapeHtml };
