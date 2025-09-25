import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BACKEND_BASE_URL } from './config';
import { fetchChatRooms, fetchMessages, getOrCreateChatRoom } from './api';
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

const DEFAULT_MESSAGE_PAGE_SIZE = 30;

function coerceMessageId(message) {
  if (!message || message.id === undefined || message.id === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (typeof message.id === 'number' && Number.isFinite(message.id)) {
    return message.id;
  }
  const parsed = Number(message.id);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function sortMessagesById(messages) {
  return [...messages].sort((a, b) => coerceMessageId(a) - coerceMessageId(b));
}

function mergeMessagesById(existing, incoming) {
  const map = new Map();

  existing.forEach((message, index) => {
    if (!message) {
      return;
    }
    const key = message.id ?? `existing-${index}`;
    map.set(String(key), message);
  });

  incoming.forEach((message, index) => {
    if (!message) {
      return;
    }
    const key = message.id ?? `incoming-${index}`;
    map.set(String(key), message);
  });

  return sortMessagesById(Array.from(map.values()));
}

export default function ChatRoomPanel({ accessToken, onLogout }) {
  const [festivalIdInput, setFestivalIdInput] = useState('');
  const [chatRoomId, setChatRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagePage, setMessagePage] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [newMessage, setNewMessage] = useState('');
  const [chatRooms, setChatRooms] = useState([]);
  const [chatRoomsMessage, setChatRoomsMessage] = useState('');
  const [isLoadingChatRooms, setIsLoadingChatRooms] = useState(false);
  const [errorPopup, setErrorPopup] = useState(null);
  const clientRef = useRef(null);
  const subscriptionRef = useRef(null);
  const errorSubscriptionRef = useRef(null);

  const websocketUrl = useMemo(() => buildWebSocketUrl(), []);

  const refreshChatRooms = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    setIsLoadingChatRooms(true);
    setChatRoomsMessage('채팅방 목록을 불러오는 중입니다...');
    try {
      const data = await fetchChatRooms({ page: 0, size: 15, accessToken });
      const rooms = Array.isArray(data?.content)
        ? [...data.content].sort((a, b) => {
            const idA = typeof a?.roomId === 'number' ? a.roomId : Number(a?.roomId);
            const idB = typeof b?.roomId === 'number' ? b.roomId : Number(b?.roomId);
            if (Number.isFinite(idA) && Number.isFinite(idB)) {
              return idA - idB;
            }
            return 0;
          })
        : [];
      setChatRooms(rooms);
      if (rooms.length === 0) {
        setChatRoomsMessage('현재 참여 중인 채팅방이 없습니다. 축제 ID로 새 채팅방을 만들어보세요.');
      } else {
        setChatRoomsMessage(`총 ${rooms.length}개의 채팅방을 확인했습니다. 목록에서 대화를 시작할 방을 선택하세요.`);
      }
    } catch (error) {
      setChatRooms([]);
      setChatRoomsMessage(error.message);
    } finally {
      setIsLoadingChatRooms(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setChatRooms([]);
      setChatRoomsMessage('');
      setChatRoomId(null);
      setMessages([]);
      setMessagePage(0);
      setStatusMessage('');
      return;
    }

    refreshChatRooms();
  }, [accessToken, refreshChatRooms]);

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
        subscriptionRef.current = client.subscribe(`/sub/${chatRoomId}/messages`, (body) => {
          try {
            const payload = JSON.parse(body);
            setMessages((prev) => mergeMessagesById(prev, [payload]));
          } catch (error) {
            console.warn('Failed to parse incoming message', error);
          }
        });
        errorSubscriptionRef.current = client.subscribe('/user/queue/errors', (body) => {
          try {
            const payload = JSON.parse(body);
            const fieldErrors = Array.isArray(payload?.fieldErrors)
              ? payload.fieldErrors.flatMap((item) =>
                  Object.entries(item || {}).map(([field, message]) => `${field}: ${message || 'Invalid value'}`),
                )
              : [];
            const globalErrors = Array.isArray(payload?.globalErrors)
              ? payload.globalErrors.flatMap((item) =>
                  Object.entries(item || {}).map(([, message]) => message || 'Invalid value'),
                )
              : [];
            const messagesToShow = [...globalErrors, ...fieldErrors];
            setErrorPopup({
              title: '메시지 전송에 실패했어요',
              messages:
                messagesToShow.length > 0
                  ? messagesToShow
                  : ['알 수 없는 오류가 발생했습니다. 다시 시도해주세요.'],
            });
          } catch (error) {
            console.warn('Failed to parse validation error payload', error);
            setErrorPopup({
              title: '메시지 전송에 실패했어요',
              messages: ['서버에서 전달된 오류 메시지를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'],
            });
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
      if (errorSubscriptionRef.current) {
        client.unsubscribe(errorSubscriptionRef.current);
        errorSubscriptionRef.current = null;
      }
      client.disconnect();
      clientRef.current = null;
      setConnectionStatus('disconnected');
      setErrorPopup(null);
    };
  }, [chatRoomId, accessToken, websocketUrl]);

  const openChatRoom = useCallback(async (roomId) => {
    if (!roomId || !accessToken) {
      return;
    }

    setErrorPopup(null);
    setChatRoomId((prev) => {
      if (prev === roomId) {
        return prev;
      }
      return null;
    });
    setStatusMessage('채팅 메시지를 불러오는 중입니다...');
    setMessages([]);
    setMessagePage(0);

    try {
      const payloads = await fetchMessages({ chatRoomId: roomId, page: 0, size: DEFAULT_MESSAGE_PAGE_SIZE, accessToken });
      setChatRoomId(roomId);
      setMessages(mergeMessagesById([], payloads));
      setMessagePage(1);
      setStatusMessage(`채팅방 #${roomId}을 열었습니다. 최근 ${payloads.length}개의 메시지를 확인했습니다.`);
    } catch (error) {
      setStatusMessage(error.message);
    }
  }, [accessToken]);

  const handleSelectChatRoom = async (roomId) => {
    if (roomId === chatRoomId) {
      return;
    }
    await openChatRoom(roomId);
  };

  const handleCreateRoom = async (event) => {
    event.preventDefault();
    if (!festivalIdInput.trim()) {
      setStatusMessage('축제 ID를 입력해주세요.');
      return;
    }

    try {
      setStatusMessage('채팅방을 준비하는 중입니다...');
      const roomId = await getOrCreateChatRoom({ festivalId: festivalIdInput.trim(), accessToken });
      await refreshChatRooms();
      await openChatRoom(roomId);
      setStatusMessage((prev) => prev || `채팅방 #${roomId} 준비가 완료되었습니다.`);
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
      const nextPage = messagePage;
      const payloads = await fetchMessages({ chatRoomId, page: nextPage, size: DEFAULT_MESSAGE_PAGE_SIZE, accessToken });
      setMessages((prev) => mergeMessagesById(prev, payloads));
      setMessagePage(nextPage + 1);
      setStatusMessage(`${payloads.length}개의 메시지를 불러왔습니다.`);
    } catch (error) {
      setStatusMessage(error.message);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!clientRef.current || !chatRoomId) {
      return;
    }

    try {
      clientRef.current.send(
        `/pub/${chatRoomId}/messages`,
        JSON.stringify({ content: newMessage }),
        {
          Authorization: `Bearer ${accessToken}`,
        },
      );
      setNewMessage('');
    } catch (error) {
      setStatusMessage('메시지 전송에 실패했습니다. 연결 상태를 확인해주세요.');
      console.error(error);
    }
  };

  const closeErrorPopup = () => {
    setErrorPopup(null);
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

      <div className="chat-room-section">
        <div className="chat-room-section-header">
          <h3>열려 있는 채팅방</h3>
          <button type="button" className="secondary" onClick={refreshChatRooms} disabled={isLoadingChatRooms}>
            목록 새로고침
          </button>
        </div>
        {chatRoomsMessage && <p className="chat-room-status">{chatRoomsMessage}</p>}
        <ul className="chat-room-list">
          {chatRooms.map((room) => (
            <li key={room.roomId} className="chat-room-item">
              <button
                type="button"
                className={`chat-room-button ${room.roomId === chatRoomId ? 'active' : ''}`}
                onClick={() => handleSelectChatRoom(room.roomId)}
              >
                <span className="chat-room-title">{room.roomName || `채팅방 #${room.roomId}`}</span>
                <span className="chat-room-meta">축제 ID: {room.festivalId ?? '정보 없음'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

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
        <button type="submit" className="primary" disabled={connectionStatus !== 'connected'}>
          전송
        </button>
      </form>

      <div className="message-list">
        {messages.length === 0 && <p className="empty-state">표시할 메시지가 없습니다. 먼저 불러오기 버튼을 눌러보세요.</p>}
        {messages.map((message, index) => (
          <div key={message.id ?? `${message.senderName ?? 'unknown'}-${index}`} className="message-item">
            <div className="message-header">
              <span className="sender">{message.senderName || '알 수 없음'}</span>
              {message.profileImgUrl && <img src={message.profileImgUrl} alt={message.senderName} className="avatar" />}
            </div>
            <p className="message-body">{message.content}</p>
          </div>
        ))}
      </div>

      {errorPopup && (
        <div className="error-popup-backdrop" role="alertdialog" aria-modal="true">
          <div className="error-popup">
            <h3>{errorPopup.title}</h3>
            <p>서버에서 다음과 같은 오류를 전달했습니다:</p>
            <ul>
              {errorPopup.messages.map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
            <button type="button" className="primary" onClick={closeErrorPopup}>
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
