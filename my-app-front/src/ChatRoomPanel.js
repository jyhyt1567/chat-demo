import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BACKEND_BASE_URL } from './config';
import { fetchChatRooms, fetchMessages, getOrCreateChatRoom } from './api';
import { SimpleStompClient } from './simpleStompClient';

const ROOM_TOKEN_STORAGE_KEY = 'festapick_room_tokens';

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

function readStoredRoomTokens() {
  try {
    const raw = sessionStorage.getItem(ROOM_TOKEN_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    console.warn('Failed to read stored room tokens', error);
  }
  return {};
}

function formatTokenPreview(token) {
  if (token === null || token === undefined) {
    return '저장된 토큰이 없습니다.';
  }
  if (token === '') {
    return '빈 문자열 (토큰 없이 전송)';
  }
  if (token.length <= 20) {
    return token;
  }
  return `${token.slice(0, 20)}...${token.slice(-10)}`;
}

export default function ChatRoomPanel({ accessToken, onLogout }) {
  const [festivalIdInput, setFestivalIdInput] = useState('');
  const [connectionContext, setConnectionContext] = useState({ roomId: null, token: null });
  const [messages, setMessages] = useState([]);
  const [messagePage, setMessagePage] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [newMessage, setNewMessage] = useState('');
  const [chatRooms, setChatRooms] = useState([]);
  const [chatRoomsMessage, setChatRoomsMessage] = useState('');
  const [isLoadingChatRooms, setIsLoadingChatRooms] = useState(false);
  const [validationErrors, setValidationErrors] = useState(null);
  const [roomTokens, setRoomTokens] = useState(() => readStoredRoomTokens());
  const [activeTokenEditorRoomId, setActiveTokenEditorRoomId] = useState(null);
  const [tokenEditorDraft, setTokenEditorDraft] = useState('');
  const clientRef = useRef(null);
  const subscriptionRef = useRef(null);
  const errorSubscriptionRef = useRef(null);

  const websocketUrlRef = useRef(buildWebSocketUrl());
  const websocketUrl = websocketUrlRef.current;

  const chatRoomId = connectionContext.roomId;
  const connectionToken = connectionContext.token;

  useEffect(() => {
    try {
      if (roomTokens && Object.keys(roomTokens).length > 0) {
        sessionStorage.setItem(ROOM_TOKEN_STORAGE_KEY, JSON.stringify(roomTokens));
      } else {
        sessionStorage.removeItem(ROOM_TOKEN_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Failed to persist room tokens', error);
    }
  }, [roomTokens]);

  useEffect(() => {
    if (!accessToken) {
      setRoomTokens({});
      setActiveTokenEditorRoomId(null);
      setTokenEditorDraft('');
      setConnectionContext({ roomId: null, token: null });
    }
  }, [accessToken]);

  const getRoomToken = useCallback(
    (roomId) => {
      if (!roomId) {
        return null;
      }
      const key = String(roomId);
      if (Object.prototype.hasOwnProperty.call(roomTokens, key)) {
        return roomTokens[key] ?? '';
      }
      return accessToken ?? null;
    },
    [roomTokens, accessToken],
  );

  const applyRoomTokenOverride = useCallback((roomId, tokenValue) => {
    if (!roomId) {
      return;
    }
    const key = String(roomId);
    setRoomTokens((prev) => {
      const next = { ...prev };
      if (tokenValue === null) {
        delete next[key];
      } else {
        next[key] = tokenValue;
      }
      return next;
    });
  }, [setRoomTokens]);

  const beginRoomTokenEdit = (roomId) => {
    if (!roomId) {
      return;
    }
    if (roomId === chatRoomId && connectionStatus === 'connected') {
      return;
    }
    const key = String(roomId);
    const stored = Object.prototype.hasOwnProperty.call(roomTokens, key) ? roomTokens[key] ?? '' : '';
    setActiveTokenEditorRoomId(roomId);
    setTokenEditorDraft(stored);
  };

  const cancelRoomTokenEdit = () => {
    setActiveTokenEditorRoomId(null);
    setTokenEditorDraft('');
  };

  const saveRoomTokenOverride = (roomId) => {
    if (!roomId) {
      return;
    }
    applyRoomTokenOverride(roomId, tokenEditorDraft ?? '');
    cancelRoomTokenEdit();
  };

  const clearRoomTokenOverride = (roomId) => {
    if (!roomId) {
      return;
    }
    applyRoomTokenOverride(roomId, null);
    if (activeTokenEditorRoomId === roomId) {
      cancelRoomTokenEdit();
    }
  };

  const handleApplyTokenAndEnter = async (event, roomId) => {
    event.preventDefault();
    if (!roomId) {
      return;
    }
    const nextToken = tokenEditorDraft ?? '';
    applyRoomTokenOverride(roomId, nextToken);
    cancelRoomTokenEdit();
    await openChatRoom(roomId, { tokenOverride: nextToken });
  };

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
      setConnectionContext({ roomId: null, token: null });
      setMessages([]);
      setMessagePage(0);
      setStatusMessage('');
      return;
    }

    refreshChatRooms();
  }, [accessToken, refreshChatRooms]);

  useEffect(() => {
    if (!chatRoomId) {
      return undefined;
    }

    const client = new SimpleStompClient(websocketUrl);
    clientRef.current = client;
    setConnectionStatus('connecting');

    const headers = connectionToken ? { Authorization: `Bearer ${connectionToken}` } : {};

    client.connect(
      headers,
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
            setValidationErrors(
              messagesToShow.length > 0
                ? messagesToShow
                : ['알 수 없는 오류가 발생했습니다. 다시 시도해주세요.'],
            );
          } catch (error) {
            console.warn('Failed to parse validation error payload', error);
            setValidationErrors([
              '서버에서 전달된 오류 메시지를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
            ]);
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
      setValidationErrors(null);
    };
  }, [chatRoomId, websocketUrl, connectionToken]);

  const openChatRoom = useCallback(
    async (roomId, options = {}) => {
      if (!roomId) {
        return;
      }

      setValidationErrors(null);
      setConnectionContext((prev) => {
        if (prev.roomId === roomId || prev.roomId === null) {
          return prev;
        }
        return { roomId: null, token: null };
      });
      setStatusMessage('채팅 메시지를 불러오는 중입니다...');
      setMessages([]);
      setMessagePage(0);

      try {
        const hasExplicitOverride = Object.prototype.hasOwnProperty.call(options, 'tokenOverride');
        const tokenForRoom = hasExplicitOverride ? options.tokenOverride : getRoomToken(roomId);
        const normalizedToken = tokenForRoom ?? null;
        const payloads = await fetchMessages({
          chatRoomId: roomId,
          page: 0,
          size: DEFAULT_MESSAGE_PAGE_SIZE,
          accessToken: normalizedToken ?? '',
        });
        setConnectionContext({ roomId, token: normalizedToken });
        setMessages(mergeMessagesById([], payloads));
        setMessagePage(1);
        setStatusMessage(`채팅방 #${roomId}을 열었습니다. 최근 ${payloads.length}개의 메시지를 확인했습니다.`);
      } catch (error) {
        setStatusMessage(error.message);
      }
    },
    [getRoomToken],
  );

  const handleSelectChatRoom = async (roomId) => {
    if (roomId === chatRoomId) {
      return;
    }
    cancelRoomTokenEdit();
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
      const tokenForRoom = connectionToken;
      const payloads = await fetchMessages({
        chatRoomId,
        page: nextPage,
        size: DEFAULT_MESSAGE_PAGE_SIZE,
        accessToken: tokenForRoom ?? '',
      });
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
      const tokenForRoom = connectionToken;
      clientRef.current.send(
        `/pub/${chatRoomId}/messages`,
        JSON.stringify({ content: newMessage }),
        {
          ...(tokenForRoom ? { Authorization: `Bearer ${tokenForRoom}` } : {}),
        },
      );
      setNewMessage('');
    } catch (error) {
      setStatusMessage('메시지 전송에 실패했습니다. 연결 상태를 확인해주세요.');
      console.error(error);
    }
  };

  const dismissValidationModal = () => {
    setValidationErrors(null);
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
          {chatRooms.map((room) => {
            const roomKey = String(room.roomId);
            const hasOverride = Object.prototype.hasOwnProperty.call(roomTokens, roomKey);
            const storedToken = hasOverride ? roomTokens[roomKey] ?? '' : null;
            const previewText = hasOverride
              ? formatTokenPreview(storedToken)
              : accessToken
              ? formatTokenPreview(accessToken)
              : '전역 토큰이 설정되지 않았습니다.';
            const usageHint = hasOverride
              ? storedToken === ''
                ? '저장된 토큰이 비어 있어 Authorization 헤더 없이 연결됩니다.'
                : '이 채팅방은 저장된 토큰으로 연결됩니다.'
              : accessToken
              ? '이 채팅방은 전역 토큰으로 연결됩니다.'
              : '전역 토큰이 없어 Authorization 헤더 없이 연결을 시도합니다.';
            const isActiveConnection = room.roomId === chatRoomId && connectionStatus === 'connected';
            const isEditorOpen = activeTokenEditorRoomId === room.roomId;

            return (
              <li key={room.roomId} className={`chat-room-item${hasOverride ? ' chat-room-item--override' : ''}`}>
                <div className="chat-room-item__row">
                  <button
                    type="button"
                    className={`chat-room-button ${room.roomId === chatRoomId ? 'active' : ''}`}
                    onClick={() => handleSelectChatRoom(room.roomId)}
                  >
                    <span className="chat-room-title">{room.roomName || `채팅방 #${room.roomId}`}</span>
                    <span className="chat-room-meta">축제 ID: {room.festivalId ?? '정보 없음'}</span>
                  </button>
                  <div className="chat-room-item__controls">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => beginRoomTokenEdit(room.roomId)}
                      disabled={isActiveConnection}
                    >
                      다른 토큰으로 입장
                    </button>
                    {hasOverride && (
                      <button
                        type="button"
                        className="destructive"
                        onClick={() => clearRoomTokenOverride(room.roomId)}
                        disabled={isActiveConnection}
                      >
                        전역 토큰 사용
                      </button>
                    )}
                  </div>
                </div>
                <div className="chat-room-item__token">
                  <span className="chat-room-item__token-label">연결에 사용할 토큰</span>
                  <span className="chat-room-item__token-preview">{previewText}</span>
                </div>
                <p className="chat-room-item__hint">{usageHint}</p>
                {isActiveConnection && (
                  <p className="chat-room-item__warning">이미 이 채팅방에 연결되어 있어 토큰을 변경할 수 없습니다.</p>
                )}
                {isEditorOpen && (
                  <form
                    className="chat-room-token-editor"
                    onSubmit={(event) => handleApplyTokenAndEnter(event, room.roomId)}
                  >
                    <label htmlFor={`room-token-${room.roomId}`}>채팅방에서 사용할 토큰</label>
                    <textarea
                      id={`room-token-${room.roomId}`}
                      rows={3}
                      value={tokenEditorDraft}
                      onChange={(event) => setTokenEditorDraft(event.target.value)}
                      placeholder="이 채팅방에서 사용할 액세스 토큰을 입력하세요."
                    />
                    <div className="chat-room-token-editor__actions">
                      <button type="button" className="secondary" onClick={cancelRoomTokenEdit}>
                        취소
                      </button>
                      <button type="button" onClick={() => saveRoomTokenOverride(room.roomId)}>
                        토큰만 저장
                      </button>
                      <button type="submit" className="primary">
                        저장 후 입장
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
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

      {Array.isArray(validationErrors) && validationErrors.length > 0 && (
        <div className="validation-modal" role="alertdialog" aria-modal="true">
          <div className="validation-modal__backdrop" />
          <div className="validation-modal__dialog" role="document">
            <div className="validation-modal__header">
              <h3 className="validation-modal__title">메시지 전송에 실패했어요</h3>
              <button
                type="button"
                className="validation-modal__close"
                onClick={dismissValidationModal}
                aria-label="경고 닫기"
              >
                ×
              </button>
            </div>
            <p className="validation-modal__description">서버에서 다음과 같은 오류를 전달했습니다:</p>
            <ul className="validation-modal__list">
              {validationErrors.map((message, index) => (
                <li key={`${message}-${index}`}>{message}</li>
              ))}
            </ul>
            <div className="validation-modal__actions">
              <button type="button" className="primary" onClick={dismissValidationModal}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
