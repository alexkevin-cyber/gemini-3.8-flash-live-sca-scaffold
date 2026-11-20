/**
 * TranscriptPanel — Renders the left-hand real-time conversation transcript
 * for both user speech (input_transcription) and AI speech (output_transcription).
 */
export class TranscriptPanel {
  constructor(containerEl) {
    this.container = containerEl;
    this.activeBubble = {
      user: null,
      assistant: null,
    };
  }

  reset() {
    this.container.innerHTML = "";
    this.activeBubble.user = null;
    this.activeBubble.assistant = null;
  }

  /**
   * Append streaming transcript chunk for 'user' or 'assistant'.
   */
  appendTranscript(role, textChunk, finished = false) {
    if (!textChunk) return;

    // When the other party starts speaking, finalize the previous active bubble
    const otherRole = role === "user" ? "assistant" : "user";
    this.finalizeRole(otherRole);

    let bubble = this.activeBubble[role];
    if (!bubble) {
      bubble = this._createBubble(role);
      this.activeBubble[role] = bubble;
      this.container.appendChild(bubble.wrapper);
    }

    // Smoothly append incremental transcription chunk
    bubble.textEl.textContent = this._mergeChunk(bubble.textEl.textContent, textChunk);
    this._scrollToBottom();

    if (finished) {
      this.finalizeRole(role);
    }
  }

  /**
   * Immediately render a typed user message.
   */
  addUserTextMessage(text) {
    this.finalizeRole("assistant");
    this.finalizeRole("user");
    const bubble = this._createBubble("user");
    bubble.textEl.textContent = text;
    bubble.wrapper.classList.remove("is-streaming");
    this.container.appendChild(bubble.wrapper);
    this._scrollToBottom();
  }

  /**
   * Show a lightweight inline system/tool note inside the transcript stream.
   */
  addSystemNote(message, kind = "info") {
    const note = document.createElement("div");
    note.className = `transcript-note transcript-note--${kind}`;
    note.textContent = message;
    this.container.appendChild(note);
    this._scrollToBottom();
  }

  markInterrupted() {
    const aiBubble = this.activeBubble.assistant;
    if (aiBubble) {
      const badge = document.createElement("span");
      badge.className = "interrupted-tag";
      badge.textContent = "Diinterupsi";
      aiBubble.metaEl.appendChild(badge);
      this.finalizeRole("assistant");
    }
  }

  finalizeTurn() {
    this.finalizeRole("assistant");
    this.finalizeRole("user");
  }

  finalizeRole(role) {
    const bubble = this.activeBubble[role];
    if (!bubble) return;
    bubble.wrapper.classList.remove("is-streaming");
    this.activeBubble[role] = null;
  }

  _createBubble(role) {
    const wrapper = document.createElement("article");
    wrapper.className = `message message--${role} is-streaming`;

    const metaEl = document.createElement("div");
    metaEl.className = "message__meta";

    const author = document.createElement("span");
    author.className = "message__author";
    author.textContent = role === "user" ? "Anda" : "Asisten AI";

    const time = document.createElement("span");
    time.className = "message__time";
    time.textContent = new Date().toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });

    metaEl.appendChild(author);
    metaEl.appendChild(time);

    const textEl = document.createElement("div");
    textEl.className = "message__text";

    wrapper.appendChild(metaEl);
    wrapper.appendChild(textEl);

    return { wrapper, metaEl, textEl };
  }

  _mergeChunk(existing, incoming) {
    if (!existing) return incoming.trimStart();
    // Avoid duplicating spacing if Gemini sends leading spaces or punctuation
    if (/^[.,!?;:]/.test(incoming) || existing.endsWith(" ") || incoming.startsWith(" ")) {
      return existing + incoming;
    }
    return `${existing}${incoming}`;
  }

  _scrollToBottom() {
    this.container.scrollTop = this.container.scrollHeight;
  }
}
