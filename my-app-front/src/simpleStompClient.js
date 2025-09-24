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
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.subscriptionId = 0;
    this.subscriptions = new Map();
    this.connected = false;
    this.onConnect = () => {};
    this.onError = () => {};
  }

  connect(headers = {}, onConnect = () => {}, onError = () => {}) {
    if (this.socket) {
      this.disconnect();
    }

    this.onConnect = onConnect;
    this.onError = onError;
    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      const frame = serializeFrame('CONNECT', {
        'accept-version': '1.2',
        'heart-beat': '0,0',
        ...headers,
      });
      this.socket.send(frame);
    };

    this.socket.onmessage = (event) => {
      parseFrames(event.data).forEach((frame) => {
        if (frame.command === 'CONNECTED') {
          this.connected = true;
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
    };
  }

  subscribe(destination, callback) {
    if (!this.socket) {
      throw new Error('WebSocket is not connected');
    }
    const id = `sub-${this.subscriptionId += 1}`;
    const frame = serializeFrame('SUBSCRIBE', {
      id,
      destination,
      ack: 'auto',
    });
    this.socket.send(frame);
    this.subscriptions.set(id, callback);
    return id;
  }

  unsubscribe(id) {
    if (!this.socket || !this.subscriptions.has(id)) {
      return;
    }
    const frame = serializeFrame('UNSUBSCRIBE', { id });
    this.socket.send(frame);
    this.subscriptions.delete(id);
  }

  send(destination, body, headers = {}) {
    if (!this.socket) {
      throw new Error('WebSocket is not connected');
    }
    const frame = serializeFrame('SEND', {
      destination,
      'content-type': 'application/json',
      ...headers,
    }, body);
    this.socket.send(frame);
  }

  disconnect() {
    if (this.socket) {
      try {
        const frame = serializeFrame('DISCONNECT');
        this.socket.send(frame);
      } catch (error) {
        // ignore errors during disconnect
      }
      this.socket.close();
      this.socket = null;
      this.connected = false;
      this.subscriptions.clear();
    }
  }
}
