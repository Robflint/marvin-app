// Speech in (Web Speech API recognition, Chrome on Android) and speech out (speechSynthesis).

const w = typeof window === "undefined" ? {} : window;
const Recognition = w.SpeechRecognition || w.webkitSpeechRecognition;

export const canListen = Boolean(Recognition);

export function listen({ onInterim, onFinal, onEnd, onError }) {
  const rec = new Recognition();
  rec.lang = "en-GB";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim(finalText + interim);
  };
  rec.onerror = (e) => onError(e.error);
  rec.onend = () => {
    if (finalText.trim()) onFinal(finalText.trim());
    onEnd();
  };
  rec.start();
  return () => rec.stop();
}

// Plain text for speaking: drop Markdown, links, paths in backticks, emoji-heavy noise.
export function speakable(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/[*_~|>]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

// Voice character: a slow, low, weary British male suits Marvin. Rob can pick the device voice,
// pitch and speed in Settings; "auto" prefers a British male voice.
export function englishVoices() {
  if (!("speechSynthesis" in w)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
}

function pickVoice(name) {
  const voices = englishVoices();
  if (name && name !== "auto") {
    const chosen = voices.find((v) => v.name === name);
    if (chosen) return chosen;
  }
  const gb = voices.filter((v) => v.lang.replace("_", "-") === "en-GB");
  return gb.find((v) => /male|daniel|george|arthur|rocko|reed|-gbd|-gbb|-rjs/i.test(v.name) && !/female/i.test(v.name)) ||
    gb[0] || voices[0] || null;
}

// A beat of silence after sentences makes the sighing land.
function withPauses(text) {
  return text.replace(/([.!?])\s+/g, "$1  ... ");
}

export function speak(md, { voiceName = "auto", pitch = 0.7, rate = 0.85 } = {}) {
  if (!("speechSynthesis" in w)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(withPauses(speakable(md)));
  const voice = pickVoice(voiceName);
  u.lang = voice?.lang || "en-GB";
  if (voice) u.voice = voice;
  u.pitch = Number(pitch);
  u.rate = Number(rate);
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ("speechSynthesis" in w) speechSynthesis.cancel();
}
