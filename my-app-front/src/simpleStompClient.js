const FRAME_DELIMITER = '\0';

function serializeFrame(command, headers = {}, body = '') {
  const lines = [command];
  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      lines.push(`${key}:${value}`);
    }
  });
  lines.push('', body);
  return lines.join('\n') + FRAME_DELIMITER;
}

function parseFrames(raw) {
  return raw
    .split(FRAME_DELIMITER)
    .map((frame) => frame.trimStart())
    .filter((frame) => frame.length > 0)
    .map((frame) => {
      const [headerSection, ...bodyParts] = frame.split('\n\n');
      const headerLines = headerSection.split('\n');
      const command = headerLines.shift();
      const headers = {};
      headerLines.forEach((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex !== -1) {
          const key = line.slice(0, separatorIndex);
          const value = line.slice(separatorIndex + 1);
          headers[key] = value;
        }
      });
      const body = bodyParts.join('\n\n');
      return { command, headers, body };
    });
}

export class SimpleStompClient {
  constructor(url, options = {}) {
    this.url = url;
    this.socket = null;
    this.subscriptionId = 0;
    this.subscriptions = new Map();
    this.connected = false;
    this.pendingFrames = [];
    this.onConnect = () => {};
    this.onError = () => {};
    this.onFrameSent = typeof options.onFrameSent === 'function' ? options.onFrameSent : null;
  }

  setFrameSentListener(listener) {
    this.onFrameSent = typeof listener === 'function' ? listener : null;
  }

  reportFrameSent(command, headers, body, raw) {
    const payload = {
      command,
      headers: { ...headers },
      body,
      raw,
      timestamp: Date.now(),
    };

    try {
      // eslint-disable-next-line no-console
      console.log(`[STOMP >>>] ${command}`, { headers: payload.headers, body: payload.body });
    } catch (error) {
      // ignore logging errors
    }

    if (typeof this.onFrameSent === 'function') {
      try {
        this.onFrameSent(payload);
      } catch (error) {
        console.warn('Failed to notify frame listener', error);
      }
    }
  }

  canSendFrames() {
    return (
      this.socket &&
      this.socket.readyState === WebSocket.OPEN &&
      this.connected === true
    );
  }

  flushPendingFrames() {
    if (!this.canSendFrames()) {
      return;
    }

    while (this.pendingFrames.length > 0) {
      const { command, headers, body } = this.pendingFrames.shift();
      this.transmitFrame(command, headers, body);
    }
  }

  queueFrame(command, headers = {}, body = '') {
    if (this.canSendFrames()) {
      this.transmitFrame(command, headers, body);
      return;
    }

    this.pendingFrames.push({ command, headers: { ...headers }, body });
  }

  transmitFrame(command, headers = {}, body = '') {
    if (!this.socket) {
      throw new Error('WebSocket is not connected');
    }

    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket connection is not open');
    }

    const frame = serializeFrame(command, headers, body);

    try {
      this.socket.send(frame);
    } finally {
      this.reportFrameSent(command, headers, body, frame);
    }

    return frame;
  }

  connect(headers = {}, onConnect = () => {}, onError = () => {}) {
    if (this.socket) {
      this.disconnect();
    }

    this.onConnect = onConnect;
    this.onError = onError;
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      const frameHeaders = {
        'accept-version': '1.2',
        'heart-beat': '0,0',
        ...headers,
      };
      try {
        this.transmitFrame('CONNECT', frameHeaders);
      } catch (error) {
        console.error('Failed to send CONNECT frame', error);
      }
    };

    this.socket.onmessage = (event) => {
      parseFrames(event.data).forEach((frame) => {
        if (frame.command === 'CONNECTED') {
          this.connected = true;
          this.flushPendingFrames();
          this.onConnect(frame);
        } else if (frame.command === 'MESSAGE') {
          const subscription = frame.headers.subscription;
          const handler = this.subscriptions.get(subscription);
          if (handler) {
            handler(frame.body, frame);
          }
        } else if (frame.command === 'ERROR') {
          this.onError(frame);
        }
      });
    };

    this.socket.onerror = (event) => {
      this.onError(event);
    };

    this.socket.onclose = () => {
      this.connected = false;
      this.subscriptions.clear();
      this.pendingFrames = [];
    };
  }

  subscribe(destination, callback) {
    if (!this.socket) {
      throw new Error('WebSocket is not connected');
    }
    const id = `sub-${this.subscriptionId += 1}`;
    this.queueFrame('SUBSCRIBE', {
      id,
      destination,
      ack: 'auto',
    });
    this.subscriptions.set(id, callback);
    return id;
  }

  unsubscribe(id) {
    if (!this.socket || !this.subscriptions.has(id)) {
      return;
    }
    this.queueFrame('UNSUBSCRIBE', { id });
    this.subscriptions.delete(id);
  }

  send(destination, body, headers = {}) {
    if (!this.socket) {
      throw new Error('WebSocket is not connected');
    }
    this.queueFrame(
      'SEND',
      {
        destination,
        'content-type': 'application/json',
        ...headers,
      },
      body,
    );
  }

  disconnect() {
    if (this.socket) {
      try {
        if (this.socket.readyState === WebSocket.OPEN && this.connected) {
          this.transmitFrame('DISCONNECT');
        }
      } catch (error) {
        // ignore errors during disconnect
      }
      this.socket.close();
      this.socket = null;
      this.connected = false;
      this.subscriptions.clear();
      this.pendingFrames = [];
    }
  }
}
