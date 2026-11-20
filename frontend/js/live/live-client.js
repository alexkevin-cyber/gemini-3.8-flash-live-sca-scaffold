/**
 * LiveClient — WebSocket client bridging the browser to the FastAPI `/ws/live` endpoint.
 */
export class LiveClient {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.ws = null;
    this.heartbeatTimer = null;
  }

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/live`;

    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this._startHeartbeat();
      this.handlers.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.handlers.onAudio?.(event.data);
        return;
      }

      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          this._dispatch(msg);
        } catch (err) {
          console.warn("Invalid JSON message from server:", err);
        }
      }
    };

    this.ws.onerror = (event) => {
      this.handlers.onError?.(event);
    };

    this.ws.onclose = (event) => {
      this._stopHeartbeat();
      this.handlers.onClose?.(event);
    };
  }

  _dispatch(msg) {
    switch (msg.type) {
      case "status":
        this.handlers.onStatus?.(msg);
        break;
      case "transcript":
        this.handlers.onTranscript?.(msg);
        break;
      case "interrupted":
        this.handlers.onInterrupted?.();
        break;
      case "turn_complete":
        this.handlers.onTurnComplete?.();
        break;
      case "tool_status":
        this.handlers.onToolStatus?.(msg);
        break;
      case "canvas_update":
        this.handlers.onCanvasUpdate?.(msg.payload);
        break;
      case "pong":
        break;
      default:
        console.debug("Unhandled live event:", msg);
    }
  }

  sendAudio(arrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(arrayBuffer);
    }
  }

  sendText(text) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }

  disconnect() {
    this._stopHeartbeat();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, "User closed assistant");
      this.ws = null;
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25000);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
