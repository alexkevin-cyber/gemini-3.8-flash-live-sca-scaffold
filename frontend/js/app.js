/**
 * Main Application Controller for Gemini 3.8 Live Scaffold.
 * Coordinates Landing -> Full-Screen Split Assistant, AudioManager, LiveClient,
 * Left Transcript Panel, and Right Dynamic Canvas Panel.
 */
import { AudioManager } from "./audio/audio-manager.js";
import { LiveClient } from "./live/live-client.js";
import { TranscriptPanel } from "./ui/transcript-panel.js";
import { CanvasPanel } from "./ui/canvas-panel.js";

const elements = {
  landingView: document.getElementById("landing-view"),
  openAssistantBtn: document.getElementById("open-assistant-btn"),
  assistantOverlay: document.getElementById("assistant-overlay"),
  closeAssistantBtn: document.getElementById("close-assistant-btn"),
  muteBtn: document.getElementById("mute-btn"),
  muteLabel: document.getElementById("mute-label"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  voiceBadge: document.getElementById("voice-badge"),
  transcriptList: document.getElementById("transcript-list"),
  micMeterFill: document.getElementById("mic-meter-fill"),
  textForm: document.getElementById("text-input-form"),
  textInput: document.getElementById("text-input"),
  canvasContent: document.getElementById("canvas-content"),
  canvasBadge: document.getElementById("canvas-badge"),
  canvasResetBtn: document.getElementById("canvas-reset-btn"),
};

let audioManager = null;
let liveClient = null;
let isSessionActive = false;
let isMuted = false;
let isAiSpeaking = false;

const transcriptPanel = new TranscriptPanel(elements.transcriptList);
const canvasPanel = new CanvasPanel(
  elements.canvasContent,
  elements.canvasBadge,
  elements.canvasResetBtn,
  {
    onSuggestionClick: (text) => {
      if (!isSessionActive || !liveClient) return;
      audioManager?.flushPlayback();
      transcriptPanel.addUserTextMessage(text);
      liveClient.sendText(text);
    },
  }
);

function setStatus(state, label) {
  elements.statusDot.dataset.state = state;
  elements.statusText.textContent = label;
}

async function fetchPublicConfig() {
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function openAssistant() {
  if (isSessionActive) return;

  // Transition UI to full-screen 2-panel assistant
  elements.landingView.hidden = true;
  elements.assistantOverlay.hidden = false;
  document.body.classList.add("assistant-open");

  transcriptPanel.reset();
  canvasPanel.renderWelcome();
  setStatus("connecting", "Meminta izin mikrofon...");

  const cfg = (await fetchPublicConfig()) || {
    input_sample_rate: 16000,
    output_sample_rate: 24000,
    voice: "Aoede",
    language: "id-ID",
  };
  elements.voiceBadge.textContent = `${cfg.voice} • ${cfg.language}`;

  liveClient = new LiveClient({
    onOpen: () => {
      setStatus("connecting", "Menghubungkan ke Gemini 3.8 Live...");
    },
    onStatus: (msg) => {
      if (msg.status === "connected") {
        setStatus("listening", "Mendengarkan");
      } else if (msg.status === "error") {
        setStatus("error", "Gangguan Koneksi");
        transcriptPanel.addSystemNote(msg.message || "Terjadi kesalahan koneksi.", "error");
      } else if (msg.status === "warning") {
        transcriptPanel.addSystemNote(msg.message, "info");
      }
    },
    onAudio: (pcmArrayBuffer) => {
      audioManager?.playPcmChunk(pcmArrayBuffer);
    },
    onTranscript: (msg) => {
      transcriptPanel.appendTranscript(msg.role, msg.text, msg.finished);
    },
    onInterrupted: () => {
      // Natural barge-in: immediately clear audio buffer so user takes the floor
      audioManager?.flushPlayback();
      transcriptPanel.markInterrupted();
      setStatus("listening", "Mendengarkan");
    },
    onTurnComplete: () => {
      transcriptPanel.finalizeTurn();
      if (!isAiSpeaking) {
        setStatus(isMuted ? "muted" : "listening", isMuted ? "Mikrofon Bisukan" : "Mendengarkan");
      }
    },
    onToolStatus: (msg) => {
      if (msg.status === "running" && msg.tool === "search_web") {
        setStatus("thinking", "Mencari informasi...");
        transcriptPanel.addSystemNote(`Mencari: “${msg.query}”`, "tool");
      }
    },
    onCanvasUpdate: (payload) => {
      canvasPanel.render(payload);
    },
    onClose: () => {
      if (isSessionActive) {
        setStatus("disconnected", "Sesi Berakhir");
        transcriptPanel.addSystemNote("Koneksi sesi telah terputus.", "info");
      }
    },
    onError: () => {
      setStatus("error", "Koneksi Gagal");
    },
  });

  audioManager = new AudioManager({
    inputSampleRate: cfg.input_sample_rate,
    outputSampleRate: cfg.output_sample_rate,
    onMicData: (pcmBuffer) => {
      liveClient?.sendAudio(pcmBuffer);
    },
    onMicLevel: (rms) => {
      const pct = Math.min(100, Math.round(rms * 380));
      elements.micMeterFill.style.width = `${isMuted ? 0 : pct}%`;
    },
    onSpeakingChange: (speaking) => {
      isAiSpeaking = speaking;
      if (!isSessionActive) return;
      if (speaking) {
        setStatus("speaking", "Asisten Berbicara");
      } else {
        setStatus(isMuted ? "muted" : "listening", isMuted ? "Mikrofon Bisukan" : "Mendengarkan");
      }
    },
  });

  try {
    await audioManager.start();
    isSessionActive = true;
    isMuted = false;
    updateMuteButton();
    liveClient.connect();
  } catch (err) {
    console.error("Audio initialization failed:", err);
    setStatus("error", "Mikrofon Tidak Tersedia");
    transcriptPanel.addSystemNote(
      "Gagal mengakses mikrofon. Pastikan izin mikrofon diberikan dan aplikasi diakses melalui HTTPS atau localhost.",
      "error"
    );
  }
}

async function closeAssistant() {
  isSessionActive = false;
  isAiSpeaking = false;
  isMuted = false;

  liveClient?.disconnect();
  liveClient = null;

  await audioManager?.stop();
  audioManager = null;

  elements.micMeterFill.style.width = "0%";
  elements.assistantOverlay.hidden = true;
  elements.landingView.hidden = false;
  document.body.classList.remove("assistant-open");
}

function toggleMute() {
  if (!audioManager) return;
  isMuted = !isMuted;
  audioManager.setMuted(isMuted);
  updateMuteButton();
  if (!isAiSpeaking) {
    setStatus(isMuted ? "muted" : "listening", isMuted ? "Mikrofon Bisukan" : "Mendengarkan");
  }
}

function updateMuteButton() {
  elements.muteBtn.classList.toggle("is-muted", isMuted);
  elements.muteBtn.setAttribute("aria-pressed", String(isMuted));
  elements.muteLabel.textContent = isMuted ? "Aktifkan Mic" : "Bisukan";
}

// Event listeners
elements.openAssistantBtn.addEventListener("click", openAssistant);
elements.closeAssistantBtn.addEventListener("click", closeAssistant);
elements.muteBtn.addEventListener("click", toggleMute);

elements.textForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = elements.textInput.value.trim();
  if (!value || !liveClient || !isSessionActive) return;

  // Sending text interrupts current AI audio cleanly
  audioManager?.flushPlayback();
  transcriptPanel.addUserTextMessage(value);
  liveClient.sendText(value);
  elements.textInput.value = "";
});

// Allow Escape key to close assistant if user wants
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isSessionActive) {
    closeAssistant();
  }
});
