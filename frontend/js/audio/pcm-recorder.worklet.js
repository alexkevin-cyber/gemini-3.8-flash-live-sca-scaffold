/**
 * AudioWorkletProcessor for capturing microphone audio and downsampling to
 * 16kHz, 16-bit signed PCM (mono, little-endian) required by Gemini 3.8 Live.
 */
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetSampleRate = options?.processorOptions?.targetSampleRate || 16000;
    this.chunkSize = 1024; // ~64ms at 16kHz for low-latency streaming & fast barge-in
    this.buffer = new Int16Array(this.chunkSize);
    this.bufferIndex = 0;
    this.resamplePhase = 0;
    this.muted = false;

    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.muted === "boolean") {
        this.muted = event.data.muted;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || this.muted) {
      return true;
    }

    const channelData = input[0];
    const ratio = sampleRate / this.targetSampleRate;

    let sumSquares = 0;
    for (let i = 0; i < channelData.length; i++) {
      sumSquares += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sumSquares / channelData.length);

    if (Math.abs(ratio - 1) < 0.001) {
      for (let i = 0; i < channelData.length; i++) {
        this._pushSample(channelData[i], rms);
      }
    } else {
      // Linear interpolation resampling when hardware AudioContext sampleRate != 16kHz
      while (this.resamplePhase < channelData.length) {
        const idx = Math.floor(this.resamplePhase);
        const frac = this.resamplePhase - idx;
        const s0 = channelData[idx];
        const s1 = idx + 1 < channelData.length ? channelData[idx + 1] : s0;
        const interpolated = s0 + (s1 - s0) * frac;
        this._pushSample(interpolated, rms);
        this.resamplePhase += ratio;
      }
      this.resamplePhase -= channelData.length;
    }

    return true;
  }

  _pushSample(floatSample, rms) {
    const clamped = Math.max(-1, Math.min(1, floatSample));
    this.buffer[this.bufferIndex++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

    if (this.bufferIndex >= this.chunkSize) {
      const out = this.buffer.slice(0);
      this.port.postMessage({ pcm: out.buffer, rms }, [out.buffer]);
      this.bufferIndex = 0;
    }
  }
}

registerProcessor("pcm-recorder-processor", PcmRecorderProcessor);
