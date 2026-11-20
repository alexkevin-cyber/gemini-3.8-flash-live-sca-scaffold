/**
 * AudioManager — Manages full-duplex microphone capture (16kHz PCM) and
 * assistant audio playback (24kHz PCM) with echo cancellation and instant barge-in flush.
 */
export class AudioManager {
  constructor({ inputSampleRate = 16000, outputSampleRate = 24000, onMicData, onMicLevel, onSpeakingChange }) {
    this.inputSampleRate = inputSampleRate;
    this.outputSampleRate = outputSampleRate;
    this.onMicData = onMicData;
    this.onMicLevel = onMicLevel;
    this.onSpeakingChange = onSpeakingChange;

    this.captureContext = null;
    this.playbackContext = null;
    this.mediaStream = null;
    this.recorderNode = null;
    this.playerNode = null;
    this.muted = false;
  }

  async start() {
    // 1. Setup 24kHz playback context first (unlocked by user click gesture)
    this.playbackContext = new AudioContext({ sampleRate: this.outputSampleRate });
    await this.playbackContext.audioWorklet.addModule("/js/audio/pcm-player.worklet.js");
    this.playerNode = new AudioWorkletNode(this.playbackContext, "pcm-player-processor");
    this.playerNode.connect(this.playbackContext.destination);

    this.playerNode.port.onmessage = (event) => {
      if (event.data?.type === "speaking" && this.onSpeakingChange) {
        this.onSpeakingChange(Boolean(event.data.active));
      }
    };

    if (this.playbackContext.state === "suspended") {
      await this.playbackContext.resume();
    }

    // 2. Request microphone with echo cancellation enabled (essential for natural barge-in)
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    this.captureContext = new AudioContext({ sampleRate: this.inputSampleRate });
    await this.captureContext.audioWorklet.addModule("/js/audio/pcm-recorder.worklet.js");

    const source = this.captureContext.createMediaStreamSource(this.mediaStream);
    this.recorderNode = new AudioWorkletNode(this.captureContext, "pcm-recorder-processor", {
      processorOptions: { targetSampleRate: this.inputSampleRate },
    });

    this.recorderNode.port.onmessage = (event) => {
      const { pcm, rms } = event.data || {};
      if (pcm && this.onMicData) {
        this.onMicData(pcm);
      }
      if (typeof rms === "number" && this.onMicLevel) {
        this.onMicLevel(rms);
      }
    };

    source.connect(this.recorderNode);
    // Keep graph active without routing mic back to speakers
    const silentGain = this.captureContext.createGain();
    silentGain.gain.value = 0;
    this.recorderNode.connect(silentGain);
    silentGain.connect(this.captureContext.destination);

    if (this.captureContext.state === "suspended") {
      await this.captureContext.resume();
    }
  }

  playPcmChunk(arrayBuffer) {
    if (!this.playerNode) return;
    if (this.playbackContext?.state === "suspended") {
      this.playbackContext.resume();
    }
    this.playerNode.port.postMessage({ type: "pcm", buffer: arrayBuffer }, [arrayBuffer]);
  }

  /** Immediately stop current AI speech playback (used on barge-in interruption). */
  flushPlayback() {
    if (!this.playerNode) return;
    this.playerNode.port.postMessage({ type: "clear" });
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.recorderNode) {
      this.recorderNode.port.postMessage({ muted: this.muted });
    }
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.muted;
      });
    }
  }

  async stop() {
    this.flushPlayback();

    if (this.recorderNode) {
      this.recorderNode.disconnect();
      this.recorderNode = null;
    }
    if (this.playerNode) {
      this.playerNode.disconnect();
      this.playerNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    if (this.captureContext) {
      await this.captureContext.close().catch(() => {});
      this.captureContext = null;
    }
    if (this.playbackContext) {
      await this.playbackContext.close().catch(() => {});
      this.playbackContext = null;
    }
    this.muted = false;
  }
}
