import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BACKEND_BASE_URL } from './config';
import { fetchMessages, getOrCreateChatRoom } from './api';
import { SimpleStompClient } from './simpleStompClient';

function buildWebSocketUrl() {
  try {
    const url = new URL(BACKEND_BASE_URL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/stomp';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    console.warn('Failed to build WebSocket URL', error);
    return 'ws://localhost:8080/stomp';
  }
}

export default function ChatRoomPanel({ accessToken, onLogout }) {
  const [festivalIdInput, setFestivalIdInput] = useState('');
  const [chatRoomId, setChatRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [newMessage, setNewMessage] = useState('');
  const clientRef = useRef(null);
  const subscriptionRef = useRef(null);

  const websocketUrl = useMemo(() => buildWebSocketUrl(), []);

  useEffect(() => {
    if (!chatRoomId || !accessToken) {
      return undefined;
    }

    const client = new SimpleStompClient(websocketUrl);
    clientRef.current = client;
    setConnectionStatus('connecting');

    client.connect(
      { Authorization: `Bearer ${accessToken}` },
      () => {
        setConnectionStatus('connected');
        subscriptionRef.current = client.subscribe(`/sub/messages/${chatRoomId}`, (body) => {
          try {
            const payload = JSON.parse(body);
            setMessages((prev) => [payload, ...prev]);
          } catch (error) {
            console.warn('Failed to parse incoming message', error);
          }
        });
      },
      () => {
        setConnectionStatus('error');
      },
    );

    return () => {
      if (subscriptionRef.current) {
        client.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
      client.disconnect();
      setConnectionStatus('disconnected');
    };
  }, [chatRoomId, accessToken, websocketUrl]);

  const handleCreateRoom = async (event) => {
    event.preventDefault();
    if (!festivalIdInput.trim()) {
      setStatusMessage('축제 ID를 입력해주세요.');
      return;
    }

    try {
      setStatusMessage('채팅방을 준비하는 중입니다...');
      const roomId = await getOrCreateChatRoom({ festivalId: festivalIdInput.trim(), accessToken });
      setChatRoomId(roomId);
      const payloads = await fetchMessages({ chatRoomId: roomId, page: 0, size: 30, accessToken });
      setMessages(payloads);
      setPage(1);
      setStatusMessage(`채팅방 #${roomId} 준비가 완료되었습니다. 최근 ${payloads.length}개의 메시지를 불러왔습니다.`);
    } catch (error) {
      setStatusMessage(error.message);
    }
  };

  const handleLoadMessages = async () => {
    if (!chatRoomId) {
      setStatusMessage('먼저 채팅방을 준비해주세요.');
      return;
    }

    try {
      setStatusMessage('이전 메시지를 불러오는 중입니다...');
      const nextPage = page;
      const payloads = await fetchMessages({ chatRoomId, page: nextPage, size: 30, accessToken });
      setMessages((prev) => [...prev, ...payloads]);
      setPage(nextPage + 1);
      setStatusMessage(`${payloads.length}개의 메시지를 불러왔습니다.`);
    } catch (error) {
      setStatusMessage(error.message);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!newMessage.trim() || !clientRef.current || !chatRoomId) {
      return;
    }

    try {
      clientRef.current.send(`/pub/messages/${chatRoomId}`, JSON.stringify({ chatRoomId, content: newMessage.trim() }), {
        Authorization: `Bearer ${accessToken}`,
      });
      setNewMessage('');
    } catch (error) {
      setStatusMessage('메시지 전송에 실패했습니다. 연결 상태를 확인해주세요.');
      console.error(error);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>실시간 채팅 도구</h2>
        <span className={`status-indicator ${connectionStatus}`}>{connectionStatus}</span>
      </div>
      <p className="card-description">
        축제 ID로 채팅방을 생성하거나 기존 방을 찾아 메시지를 주고받을 수 있습니다. 실시간 통신은 WebSocket과 STOMP 프로토콜을 사용합니다.
      </p>

      <form className="form" onSubmit={handleCreateRoom}>
        <label htmlFor="festivalId">축제 ID</label>
        <input
          id="festivalId"
          type="text"
          value={festivalIdInput}
          onChange={(event) => setFestivalIdInput(event.target.value)}
          placeholder="예: 1"
        />
        <button type="submit" className="primary">채팅방 열기</button>
      </form>

      <div className="button-group">
        <button type="button" onClick={handleLoadMessages} disabled={!chatRoomId}>
          이전 메시지 불러오기
        </button>
        <button type="button" className="secondary" onClick={onLogout}>
          로그아웃
        </button>
      </div>

      {statusMessage && <p className="status-message">{statusMessage}</p>}

      <form className="form" onSubmit={handleSendMessage}>
        <label htmlFor="newMessage">메시지 보내기</label>
        <textarea
          id="newMessage"
          rows={3}
          value={newMessage}
          onChange={(event) => setNewMessage(event.target.value)}
          placeholder="전송할 메시지를 입력하세요."
          disabled={connectionStatus !== 'connected'}
        />
        <button type="submit" className="primary" disabled={connectionStatus !== 'connected' || !newMessage.trim()}>
          전송
        </button>
      </form>

      <div className="message-list">
        {messages.length === 0 && <p className="empty-state">표시할 메시지가 없습니다. 먼저 불러오기 버튼을 눌러보세요.</p>}
        {messages.map((message, index) => (
          <div key={`${message.senderName}-${index}`} className="message-item">
            <div className="message-header">
              <span className="sender">{message.senderName || '알 수 없음'}</span>
              {message.profileImgUrl && <img src={message.profileImgUrl} alt={message.senderName} className="avatar" />}
            </div>
            <p className="message-body">{message.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
