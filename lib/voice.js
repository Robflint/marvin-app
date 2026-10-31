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

let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice = voices.find((v) => v.lang === "en-GB" && /male|daniel|george|uk/i.test(v.name)) ||
    voices.find((v) => v.lang === "en-GB") || null;
}
if ("speechSynthesis" in w) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

export function speak(md) {
  if (!("speechSynthesis" in w)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(speakable(md));
  u.lang = "en-GB";
  if (voice) u.voice = voice;
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ("speechSynthesis" in w) speechSynthesis.cancel();
}
