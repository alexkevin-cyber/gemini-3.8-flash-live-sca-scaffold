/**
 * AudioWorkletProcessor for smooth 24kHz 16-bit PCM playback with instant
 * buffer flush on user interruption (barge-in).
 */
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Ring buffer holding up to 12 seconds of 24kHz mono audio
    this.capacity = 24000 * 12;
    this.ringBuffer = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.bufferedSamples = 0;
    this.isPlaying = false;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === "clear") {
        // Instant barge-in flush
        this.readIndex = 0;
        this.writeIndex = 0;
        this.bufferedSamples = 0;
        if (this.isPlaying) {
          this.isPlaying = false;
          this.port.postMessage({ type: "speaking", active: false });
        }
        return;
      }

      if (data.type === "pcm" && data.buffer) {
        const int16 = new Int16Array(data.buffer);
        for (let i = 0; i < int16.length; i++) {
          if (this.bufferedSamples >= this.capacity) {
            // Drop oldest sample if buffer overflows
            this.readIndex = (this.readIndex + 1) % this.capacity;
            this.bufferedSamples--;
          }
          this.ringBuffer[this.writeIndex] = int16[i] / 32768.0;
          this.writeIndex = (this.writeIndex + 1) % this.capacity;
          this.bufferedSamples++;
        }
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const channel = output[0];

    if (this.bufferedSamples > 0) {
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.port.postMessage({ type: "speaking", active: true });
      }
      for (let i = 0; i < channel.length; i++) {
        if (this.bufferedSamples > 0) {
          channel[i] = this.ringBuffer[this.readIndex];
          this.readIndex = (this.readIndex + 1) % this.capacity;
          this.bufferedSamples--;
        } else {
          channel[i] = 0;
        }
      }
    } else {
      channel.fill(0);
      if (this.isPlaying) {
        this.isPlaying = false;
        this.port.postMessage({ type: "speaking", active: false });
      }
    }

    return true;
  }
}

registerProcessor("pcm-player-processor", PcmPlayerProcessor);
