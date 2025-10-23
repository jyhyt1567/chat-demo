import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BACKEND_BASE_URL } from './config';
import {
  fetchChatRooms,
  fetchMessages,
  fetchMyChatRoomsReadStatus,
  getOrCreateChatRoom,
  requestImageUploadSlot,
} from './api';
import { SimpleStompClient } from './simpleStompClient';

const ROOM_TOKEN_STORAGE_KEY = 'festapick_room_tokens';

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** exponent;
  const formatted = size >= 10 || exponent === 0 ? size.toFixed(0) : size.toFixed(1);
  return `${formatted} ${units[exponent]}`;
}

function extractUploadUrl(slot) {
  if (!slot || typeof slot !== 'object') {
    return null;
  }
  return slot.presignedUrl || slot.uploadUrl || slot.url;
}

function extractUploadMethod(slot) {
  if (!slot || typeof slot !== 'object') {
    return 'PUT';
  }
  const method = slot.method || slot.httpMethod;
  if (!method || typeof method !== 'string') {
    return 'PUT';
  }
  return method.toUpperCase();
}

function stripUrlQueryParameters(url) {
  if (typeof url !== 'string') {
    return url;
  }

  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    const queryIndex = url.indexOf('?');
    const hashIndex = url.indexOf('#');
    const cutIndex = [queryIndex, hashIndex]
      .filter((index) => index !== -1)
      .reduce((minIndex, index) => (minIndex === -1 ? index : Math.min(minIndex, index)), -1);

    if (cutIndex === -1) {
      return url;
    }

    return url.slice(0, cutIndex);
  }
}

async function uploadFileUsingSlot(slot, file) {
  const uploadUrl = extractUploadUrl(slot);
  if (!uploadUrl) {
    throw new Error('업로드 URL을 확인할 수 없습니다.');
  }

  const method = extractUploadMethod(slot);

  if (method === 'POST' && slot && typeof slot.fields === 'object' && slot.fields !== null) {
    const formData = new FormData();
    Object.entries(slot.fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });
    formData.append('file', file);
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || '이미지 업로드에 실패했습니다.');
    }
    return;
  }

  const headers = {};
  if (file.type) {
    headers['Content-Type'] = file.type;
  }

  const response = await fetch(uploadUrl, {
    method: method || 'PUT',
    headers,
    body: file,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || '이미지 업로드에 실패했습니다.');
  }
}

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

function formatTimestamp(ms) {
  if (ms === undefined || ms === null) {
    return '';
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    return date.toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch (error) {
    return date.toLocaleTimeString();
  }
}

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

function getMessageImageUrls(message) {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const urlSet = new Set();

  if (Array.isArray(message.imageUrls)) {
    message.imageUrls.forEach((url) => {
      if (typeof url === 'string' && url.trim()) {
        urlSet.add(url);
      }
    });
  }

  if (typeof message.imageUrl === 'string' && message.imageUrl.trim()) {
    urlSet.add(message.imageUrl);
  }

  if (Array.isArray(message.imageInfos)) {
    message.imageInfos.forEach((info) => {
      if (info && typeof info === 'object') {
        const candidate = info.url || info.presignedUrl;
        if (typeof candidate === 'string' && candidate.trim()) {
          urlSet.add(candidate);
        }
      }
    });
  }

  return Array.from(urlSet);
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
  if (!token) {
    return '이 채팅방에서는 전역 토큰이 사용됩니다.';
  }
  if (token.length <= 20) {
    return token;
  }
  return `${token.slice(0, 20)}...${token.slice(-10)}`;
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
  const [validationErrors, setValidationErrors] = useState(null);
  const [roomTokens, setRoomTokens] = useState(() => readStoredRoomTokens());
  const [isEditingRoomToken, setIsEditingRoomToken] = useState(false);
  const [roomTokenDraft, setRoomTokenDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [outgoingFrames, setOutgoingFrames] = useState([]);
  const [expandedFrameIds, setExpandedFrameIds] = useState([]);
  const [frameLogStatus, setFrameLogStatus] = useState('');
  const [activeMainTab, setActiveMainTab] = useState('chat');
  const [connectionToken, setConnectionToken] = useState(() => accessToken ?? null);
  const clientRef = useRef(null);
  const subscriptionRef = useRef(null);
  const errorSubscriptionRef = useRef(null);
  const unreadSubscriptionRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachmentsRef = useRef([]);
  const frameCounterRef = useRef(0);

  const websocketUrl = useMemo(() => buildWebSocketUrl(), []);

  const chatRoomKey = chatRoomId ? String(chatRoomId) : null;
  const isUploadingAttachments = useMemo(
    () => attachments.some((attachment) => attachment.status === 'preparing' || attachment.status === 'uploading'),
    [attachments],
  );
  const hasAttachmentErrors = useMemo(
    () => attachments.some((attachment) => attachment.status === 'error'),
    [attachments],
  );

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (!frameLogStatus) {
      return undefined;
    }

    const timeoutId = setTimeout(() => setFrameLogStatus(''), 2500);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [frameLogStatus]);

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => {
        if (attachment?.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, []);

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
      setIsEditingRoomToken(false);
      setRoomTokenDraft('');
    }
  }, [accessToken]);

  useEffect(() => {
    if (!chatRoomKey) {
      setIsEditingRoomToken(false);
      setRoomTokenDraft('');
      return;
    }
    if (!isEditingRoomToken) {
      const stored = Object.prototype.hasOwnProperty.call(roomTokens, chatRoomKey)
        ? roomTokens[chatRoomKey] ?? ''
        : '';
      setRoomTokenDraft(stored);
    }
  }, [chatRoomKey, roomTokens, isEditingRoomToken]);

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

  useEffect(() => {
    if (!accessToken) {
      setConnectionToken(null);
      return;
    }

    if (!chatRoomId) {
      setConnectionToken(accessToken);
      return;
    }

    const tokenForRoom = getRoomToken(chatRoomId);
    if (typeof tokenForRoom === 'string' && tokenForRoom.trim().length > 0) {
      setConnectionToken(tokenForRoom.trim());
    } else {
      setConnectionToken(accessToken);
    }
  }, [accessToken, chatRoomId, getRoomToken]);

  const updateAttachment = useCallback((localId, updater) => {
    setAttachments((prev) =>
      prev.map((attachment) => {
        if (attachment.localId !== localId) {
          return attachment;
        }
        const updates = typeof updater === 'function' ? updater(attachment) : updater;
        if (!updates || typeof updates !== 'object') {
          return attachment;
        }
        return { ...attachment, ...updates };
      }),
    );
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      prev.forEach((attachment) => {
        if (attachment?.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      return [];
    });
  }, []);

  const clearFrameLog = useCallback(() => {
    setOutgoingFrames([]);
    setExpandedFrameIds([]);
    setFrameLogStatus('');
    frameCounterRef.current = 0;
  }, []);

  const handleFrameSent = useCallback((frame) => {
    frameCounterRef.current += 1;
    const entry = {
      id: `frame-${frameCounterRef.current}`,
      command: frame?.command || 'UNKNOWN',
      headers: frame?.headers || {},
      body: frame?.body ?? '',
      raw: frame?.raw ?? '',
      timestamp: frame?.timestamp ?? Date.now(),
    };
    setOutgoingFrames((prev) => [entry, ...prev].slice(0, 100));
  }, []);

  const toggleFrameExpansion = useCallback((frameId) => {
    setExpandedFrameIds((prev) => {
      if (prev.includes(frameId)) {
        return prev.filter((id) => id !== frameId);
      }
      return [...prev, frameId];
    });
  }, []);

  const handleCopyFrame = useCallback(async (rawFrame) => {
    if (!rawFrame) {
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(rawFrame);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = rawFrame;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setFrameLogStatus('프레임을 클립보드에 복사했습니다.');
    } catch (error) {
      console.error('Failed to copy STOMP frame', error);
      setFrameLogStatus('프레임을 복사하지 못했습니다. 브라우저 권한을 확인해주세요.');
    }
  }, []);

  useEffect(() => {
    clearAttachments();
  }, [chatRoomId, clearAttachments]);

  const removeAttachment = useCallback((localId) => {
    setAttachments((prev) => {
      const target = prev.find((attachment) => attachment.localId === localId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((attachment) => attachment.localId !== localId);
    });
  }, []);

  const handleImageSelection = useCallback(
    async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';

      if (!chatRoomId) {
        setStatusMessage('먼저 채팅방을 준비해주세요.');
        return;
      }

      if (files.length === 0) {
        return;
      }

      if (attachmentsRef.current.length >= 1) {
        setStatusMessage('메시지에는 이미지를 하나만 첨부할 수 있습니다. 기존 이미지를 제거해주세요.');
        return;
      }

      const [file] = files;

      if (!file) {
        return;
      }

      const tokenForRoom = getRoomToken(chatRoomId);

      const localId = `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const previewUrl = URL.createObjectURL(file);
      setAttachments((prev) => [
        ...prev,
        {
          localId,
          fileName: file.name,
          fileSize: file.size,
          previewUrl,
          status: 'preparing',
          errorMessage: null,
          uploadInfo: null,
        },
      ]);

      try {
        const slot = await requestImageUploadSlot({ accessToken: tokenForRoom });
        const uploadUrl = extractUploadUrl(slot);
        const slotId =
          slot && typeof slot === 'object'
            ? slot.id ?? slot.fileId ?? slot.temporalFileId ?? slot.temporaryFileId
            : null;
        if (slotId === undefined || slotId === null || !uploadUrl) {
          throw new Error('업로드 정보를 확인할 수 없습니다.');
        }

        updateAttachment(localId, {
          status: 'uploading',
          errorMessage: null,
        });

        await uploadFileUsingSlot(slot, file);

        updateAttachment(localId, {
          status: 'uploaded',
          uploadInfo: {
            id: slotId,
            presignedUrl: uploadUrl,
            url: stripUrlQueryParameters(uploadUrl),
          },
        });
      } catch (error) {
        console.error('이미지 업로드에 실패했습니다.', error);
        updateAttachment(localId, {
          status: 'error',
          errorMessage: error?.message || '이미지 업로드에 실패했습니다.',
          uploadInfo: null,
        });
      }
    },
    [chatRoomId, getRoomToken, updateAttachment, setStatusMessage],
  );

  const handleOpenFilePicker = useCallback(() => {
    if (attachmentsRef.current.length >= 1) {
      setStatusMessage('메시지에는 이미지를 하나만 첨부할 수 있습니다. 기존 이미지를 제거해주세요.');
      return;
    }
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, [setStatusMessage]);

  const sendReadReceipt = useCallback((roomId) => {
    const client = clientRef.current;
    if (!client || !roomId) {
      return;
    }
    try {
      client.send(`/pub/${roomId}/read`, JSON.stringify({}));
    } catch (error) {
      console.warn('Failed to send read receipt', error);
    }
  }, []);

  const refreshChatRooms = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    setIsLoadingChatRooms(true);
    setChatRoomsMessage('채팅방 목록을 불러오는 중입니다...');

    const sortByRoomId = (items) =>
      [...items].sort((a, b) => {
        const idA = typeof a?.roomId === 'number' ? a.roomId : Number(a?.roomId);
        const idB = typeof b?.roomId === 'number' ? b.roomId : Number(b?.roomId);
        if (Number.isFinite(idA) && Number.isFinite(idB)) {
          return idA - idB;
        }
        return 0;
      });

    try {
      const page = await fetchMyChatRoomsReadStatus({ page: 0, size: 15, accessToken });
      const rooms = Array.isArray(page?.content)
        ? sortByRoomId(
            page.content.map((room) => ({
              roomId: room?.roomId ?? room?.id ?? null,
              roomName: room?.roomName,
              festivalId: room?.festivalId,
              posterInfo: room?.posterInfo,
              existNewMessage: Boolean(room?.existNewMessage),
            })),
          )
        : [];
      setChatRooms(rooms);
      if (rooms.length === 0) {
        setChatRoomsMessage('현재 참여 중인 채팅방이 없습니다. 축제 ID로 새 채팅방을 만들어보세요.');
      } else {
        setChatRoomsMessage(`총 ${rooms.length}개의 채팅방을 확인했습니다. 목록에서 대화를 시작할 방을 선택하세요.`);
      }
    } catch (primaryError) {
      try {
        const data = await fetchChatRooms({ page: 0, size: 15, accessToken });
        const rooms = Array.isArray(data?.content)
          ? sortByRoomId(
              data.content.map((room) => ({
                ...room,
                existNewMessage: Boolean(room?.existNewMessage),
              })),
            )
          : [];
        setChatRooms(rooms);
        if (rooms.length === 0) {
          setChatRoomsMessage('현재 참여 중인 채팅방이 없습니다. 축제 ID로 새 채팅방을 만들어보세요.');
        } else {
          setChatRoomsMessage(`총 ${rooms.length}개의 채팅방을 확인했습니다. 목록에서 대화를 시작할 방을 선택하세요.`);
        }
      } catch (fallbackError) {
        setChatRooms([]);
        setChatRoomsMessage(fallbackError?.message || primaryError?.message || '채팅방 목록을 불러오지 못했습니다.');
      }
    } finally {
      setIsLoadingChatRooms(false);
    }
  }, [accessToken]);

  const handleValidationPayload = useCallback((body) => {
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
  }, []);

  const handleUnreadNotification = useCallback(
    (body) => {
      try {
        const payload = JSON.parse(body);
        const notifiedRoomId = payload?.chatRoomId ?? payload?.roomId;
        if (notifiedRoomId === undefined || notifiedRoomId === null) {
          return;
        }

        const numericRoomId = Number(notifiedRoomId);
        const normalizedRoomId = Number.isFinite(numericRoomId) ? numericRoomId : notifiedRoomId;

        if (chatRoomId && Number(chatRoomId) === numericRoomId) {
          setChatRooms((prev) =>
            prev.map((room) => {
              const current = Number(room?.roomId);
              if (Number.isFinite(current) && Number.isFinite(numericRoomId) && current === numericRoomId) {
                return { ...room, existNewMessage: false };
              }
              if (!Number.isFinite(current) && room?.roomId === normalizedRoomId) {
                return { ...room, existNewMessage: false };
              }
              return room;
            }),
          );
          sendReadReceipt(notifiedRoomId);
          setStatusMessage(`채팅방 #${notifiedRoomId}에서 들어온 새 메시지를 읽음 처리했습니다.`);
          return;
        }

        let shouldRefresh = false;
        setChatRooms((prev) => {
          let found = false;
          const next = prev.map((room) => {
            const current = Number(room?.roomId);
            const isSame = Number.isFinite(numericRoomId)
              ? Number.isFinite(current) && current === numericRoomId
              : room?.roomId === normalizedRoomId;
            if (isSame) {
              found = true;
              return { ...room, existNewMessage: true };
            }
            return room;
          });
          if (!found) {
            shouldRefresh = true;
            return prev;
          }
          return next;
        });
        if (shouldRefresh) {
          refreshChatRooms();
        }
        setStatusMessage(`채팅방 #${notifiedRoomId}에 새 메시지가 도착했습니다.`);
      } catch (error) {
        console.warn('Failed to process unread notification', error);
      }
    },
    [chatRoomId, refreshChatRooms, sendReadReceipt],
  );

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
    clearFrameLog();

    const existingClient = clientRef.current;
    if (!connectionToken) {
      if (subscriptionRef.current && existingClient) {
        existingClient.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
      if (errorSubscriptionRef.current && existingClient) {
        existingClient.unsubscribe(errorSubscriptionRef.current);
        errorSubscriptionRef.current = null;
      }
      if (unreadSubscriptionRef.current && existingClient) {
        existingClient.unsubscribe(unreadSubscriptionRef.current);
        unreadSubscriptionRef.current = null;
      }
      if (existingClient) {
        existingClient.disconnect();
        clientRef.current = null;
      }
      setConnectionStatus('disconnected');
      setValidationErrors(null);
      return undefined;
    }

    const client = new SimpleStompClient(websocketUrl, { onFrameSent: handleFrameSent });
    clientRef.current = client;
    setConnectionStatus('connecting');

    const headers = connectionToken ? { Authorization: `Bearer ${connectionToken}` } : {};
    let isActive = true;

    client.connect(
      headers,
      () => {
        if (!isActive) {
          return;
        }
        setConnectionStatus('connected');
        if (errorSubscriptionRef.current) {
          client.unsubscribe(errorSubscriptionRef.current);
        }
        if (unreadSubscriptionRef.current) {
          client.unsubscribe(unreadSubscriptionRef.current);
        }
        errorSubscriptionRef.current = client.subscribe('/user/queue/errors', (body) => {
          handleValidationPayload(body);
        });
        unreadSubscriptionRef.current = client.subscribe('/user/unreads', (body) => {
          handleUnreadNotification(body);
        });
        setStatusMessage('실시간 알림 채널에 연결되었습니다.');
      },
      () => {
        if (!isActive) {
          return;
        }
        setConnectionStatus('error');
      },
    );

    return () => {
      isActive = false;
      if (subscriptionRef.current) {
        client.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
      if (errorSubscriptionRef.current) {
        client.unsubscribe(errorSubscriptionRef.current);
        errorSubscriptionRef.current = null;
      }
      if (unreadSubscriptionRef.current) {
        client.unsubscribe(unreadSubscriptionRef.current);
        unreadSubscriptionRef.current = null;
      }
      client.disconnect();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
      setConnectionStatus('disconnected');
      setValidationErrors(null);
    };
  }, [
    connectionToken,
    websocketUrl,
    clearFrameLog,
    handleFrameSent,
    handleUnreadNotification,
    handleValidationPayload,
  ]);

  useEffect(() => {
    const client = clientRef.current;
    if (!client || connectionStatus !== 'connected') {
      if (subscriptionRef.current && client) {
        client.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
      return undefined;
    }

    if (!chatRoomId) {
      if (subscriptionRef.current) {
        client.unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
      return undefined;
    }

    if (subscriptionRef.current) {
      client.unsubscribe(subscriptionRef.current);
      subscriptionRef.current = null;
    }

    const subscriptionId = client.subscribe(`/sub/${chatRoomId}/messages`, (body) => {
      try {
        const payload = JSON.parse(body);
        setMessages((prev) => mergeMessagesById(prev, [payload]));
      } catch (error) {
        console.warn('Failed to parse incoming message', error);
      }
    });
    subscriptionRef.current = subscriptionId;

    return () => {
      if (subscriptionId && client) {
        client.unsubscribe(subscriptionId);
      }
      if (subscriptionRef.current === subscriptionId) {
        subscriptionRef.current = null;
      }
    };
  }, [chatRoomId, connectionStatus]);

  const openChatRoom = useCallback(async (roomId) => {
    if (!roomId) {
      return;
    }

    setValidationErrors(null);
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
      const tokenForRoom = getRoomToken(roomId);
      const payloads = await fetchMessages({
        chatRoomId: roomId,
        page: 0,
        size: DEFAULT_MESSAGE_PAGE_SIZE,
        accessToken: tokenForRoom,
      });
      setChatRoomId(roomId);
      setMessages(mergeMessagesById([], payloads));
      setMessagePage(1);
      setChatRooms((prev) =>
        prev.map((room) => {
          const numericRoomId = Number(room?.roomId);
          const targetId = Number(roomId);
          if (Number.isFinite(numericRoomId) && Number.isFinite(targetId) && numericRoomId === targetId) {
            return { ...room, existNewMessage: false };
          }
          if (!Number.isFinite(numericRoomId) && room?.roomId === roomId) {
            return { ...room, existNewMessage: false };
          }
          return room;
        }),
      );
      sendReadReceipt(roomId);
      setStatusMessage(`채팅방 #${roomId}을 열었습니다. 최근 ${payloads.length}개의 메시지를 확인했습니다.`);
    } catch (error) {
      setStatusMessage(error.message);
    }
  }, [getRoomToken, sendReadReceipt]);

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
      const chatRoom = await getOrCreateChatRoom({ festivalId: festivalIdInput.trim(), accessToken });
      const roomId = chatRoom?.roomId;

      if (!roomId) {
        throw new Error('채팅방 정보를 불러오지 못했습니다.');
      }

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
      const tokenForRoom = getRoomToken(chatRoomId);
      const payloads = await fetchMessages({
        chatRoomId,
        page: nextPage,
        size: DEFAULT_MESSAGE_PAGE_SIZE,
        accessToken: tokenForRoom,
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
      if (isUploadingAttachments) {
        setStatusMessage('이미지 업로드가 완료될 때까지 기다려주세요.');
        return;
      }

      if (hasAttachmentErrors) {
        setStatusMessage('업로드에 실패한 이미지를 제거하거나 다시 시도해주세요.');
        return;
      }

      const uploadedAttachment = attachments.find(
        (attachment) => attachment.status === 'uploaded' && attachment.uploadInfo,
      );
      const attachmentPayload = uploadedAttachment
        ? {
            id: uploadedAttachment.uploadInfo.id,
            presignedUrl:
              uploadedAttachment.uploadInfo.url ||
              stripUrlQueryParameters(uploadedAttachment.uploadInfo.presignedUrl),
          }
        : null;

      const tokenForRoom = getRoomToken(chatRoomId);
      const payload = { content: newMessage };
      if (attachmentPayload) {
        payload.imageInfo = attachmentPayload;
      }
      clientRef.current.send(
        `/pub/${chatRoomId}/messages`,
        JSON.stringify(payload),
        {
          ...(tokenForRoom ? { Authorization: `Bearer ${tokenForRoom}` } : {}),
        },
      );
      setNewMessage('');
      if (attachments.length > 0) {
        clearAttachments();
      }
    } catch (error) {
      setStatusMessage('메시지 전송에 실패했습니다. 연결 상태를 확인해주세요.');
      console.error(error);
    }
  };

  const dismissValidationModal = () => {
    setValidationErrors(null);
  };

  const beginRoomTokenEdit = () => {
    if (!chatRoomKey) {
      return;
    }
    const stored = Object.prototype.hasOwnProperty.call(roomTokens, chatRoomKey)
      ? roomTokens[chatRoomKey] ?? ''
      : '';
    setRoomTokenDraft(stored);
    setIsEditingRoomToken(true);
  };

  const cancelRoomTokenEdit = () => {
    if (!chatRoomKey) {
      setIsEditingRoomToken(false);
      setRoomTokenDraft('');
      return;
    }
    const stored = Object.prototype.hasOwnProperty.call(roomTokens, chatRoomKey)
      ? roomTokens[chatRoomKey] ?? ''
      : '';
    setRoomTokenDraft(stored);
    setIsEditingRoomToken(false);
  };

  const handleRoomTokenSubmit = (event) => {
    event.preventDefault();
    if (!chatRoomKey) {
      return;
    }
    setRoomTokens((prev) => ({
      ...prev,
      [chatRoomKey]: roomTokenDraft ?? '',
    }));
    setIsEditingRoomToken(false);
  };

  const clearRoomToken = () => {
    if (!chatRoomKey) {
      return;
    }
    setRoomTokens((prev) => {
      const next = { ...prev };
      delete next[chatRoomKey];
      return next;
    });
    setRoomTokenDraft('');
    setIsEditingRoomToken(false);
  };

  const hasRoomTokenOverride = chatRoomKey
    ? Object.prototype.hasOwnProperty.call(roomTokens, chatRoomKey)
    : false;

  const effectiveRoomToken = chatRoomId ? getRoomToken(chatRoomId) : null;

  return (
    <div className="chat-panel-wrapper">
      <div className="card chat-panel-main">
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

        <div className="chat-panel-tabs" role="tablist" aria-label="채팅 도구 보기 선택">
          <button
            type="button"
            role="tab"
            id="chat-panel-tab-chat"
            aria-controls="chat-panel-tabpanel-chat"
            aria-selected={activeMainTab === 'chat'}
            className={`chat-panel-tab ${activeMainTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveMainTab('chat')}
          >
            채팅
          </button>
          <button
            type="button"
            role="tab"
            id="chat-panel-tab-frames"
            aria-controls="chat-panel-tabpanel-frames"
            aria-selected={activeMainTab === 'frames'}
            className={`chat-panel-tab ${activeMainTab === 'frames' ? 'active' : ''}`}
            onClick={() => setActiveMainTab('frames')}
          >
            STOMP 프레임
          </button>
        </div>

        <div
          id="chat-panel-tabpanel-chat"
          role="tabpanel"
          aria-labelledby="chat-panel-tab-chat"
          className={`chat-panel-tabpanel ${activeMainTab === 'chat' ? 'active' : ''}`}
          hidden={activeMainTab !== 'chat'}
        >
          {chatRoomId && (
            <section className="room-token-panel">
              <div className="room-token-panel__header">
                <h3>채팅방 전용 토큰</h3>
                <p className="room-token-panel__description">
                  이 채팅방에서 사용할 토큰을 직접 지정할 수 있습니다. 토큰을 비워두면 현재 로그인한 계정의 토큰이 사용됩니다.
                </p>
              </div>
              {!isEditingRoomToken ? (
                <>
                  <p className="token-preview room-token-panel__preview">{formatTokenPreview(effectiveRoomToken)}</p>
                  <div className="token-actions room-token-panel__actions">
                    <button type="button" className="secondary" onClick={beginRoomTokenEdit}>
                      채팅방 토큰 설정
                    </button>
                    {hasRoomTokenOverride && (
                      <button type="button" className="destructive" onClick={clearRoomToken}>
                        채팅방 토큰 삭제
                      </button>
                    )}
                  </div>
                  {hasRoomTokenOverride && (
                    <p className="room-token-panel__hint">전역 토큰 대신 채팅방 전용 토큰이 적용된 상태입니다.</p>
                  )}
                </>
              ) : (
                <form className="form token-editor room-token-editor" onSubmit={handleRoomTokenSubmit}>
                  <label htmlFor="room-token-editor">채팅방에서 사용할 토큰</label>
                  <textarea
                    id="room-token-editor"
                    rows={4}
                    value={roomTokenDraft}
                    onChange={(event) => setRoomTokenDraft(event.target.value)}
                    placeholder="이 채팅방에서 사용할 액세스 토큰을 입력하세요."
                  />
                  <div className="token-editor__actions">
                    <button type="button" className="secondary" onClick={cancelRoomTokenEdit}>
                      취소
                    </button>
                    <button type="submit" className="primary">
                      저장
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

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

          <section className="chat-session">
            <div className="message-list-container">
              {messages.length === 0 ? (
                <p className="empty-state">표시할 메시지가 없습니다. 먼저 불러오기 버튼을 눌러보세요.</p>
              ) : (
                <div className="message-list">
                  {messages.map((message, index) => {
                    const imageUrls = getMessageImageUrls(message);
                    return (
                      <div
                        key={message.id ?? `${message.senderName ?? 'unknown'}-${index}`}
                        className="message-item"
                      >
                        <div className="message-header">
                          <span className="sender">{message.senderName || '알 수 없음'}</span>
                          {message.profileImgUrl && (
                            <img src={message.profileImgUrl} alt={message.senderName} className="avatar" />
                          )}
                        </div>
                        {message.content && <p className="message-body">{message.content}</p>}
                        {imageUrls.length > 0 && (
                          <div className="message-images">
                            {imageUrls.map((imageUrl, imageIndex) => (
                              <a
                                key={`${message.id ?? index}-image-${imageIndex}`}
                                className="message-image-wrapper"
                                href={imageUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img src={imageUrl} alt={`메시지 이미지 ${imageIndex + 1}`} className="message-image" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <form className="form message-composer" onSubmit={handleSendMessage}>
              <label htmlFor="newMessage">메시지 보내기</label>
              <textarea
                id="newMessage"
                rows={3}
                value={newMessage}
                onChange={(event) => setNewMessage(event.target.value)}
                placeholder="전송할 메시지를 입력하세요."
                disabled={connectionStatus !== 'connected'}
              />
              <div className="attachment-toolbar">
                <input
                  ref={fileInputRef}
                  className="attachment-input"
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelection}
                  disabled={connectionStatus !== 'connected' || attachments.length >= 1}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={handleOpenFilePicker}
                  disabled={connectionStatus !== 'connected' || attachments.length >= 1}
                >
                  이미지 추가
                </button>
                {isUploadingAttachments && <span className="attachment-hint">이미지를 업로드하는 중입니다...</span>}
              </div>
              {attachments.length > 0 && (
                <ul className="attachment-list">
                  {attachments.map((attachment) => {
                    let statusLabel = '';
                    if (attachment.status === 'preparing') {
                      statusLabel = '업로드 준비 중';
                    } else if (attachment.status === 'uploading') {
                      statusLabel = '업로드 중';
                    } else if (attachment.status === 'uploaded') {
                      statusLabel = '업로드 완료';
                    } else if (attachment.status === 'error') {
                      statusLabel = attachment.errorMessage || '업로드 실패';
                    }

                    return (
                      <li key={attachment.localId} className={`attachment-item attachment-item--${attachment.status}`}>
                        <div className="attachment-preview">
                          {attachment.previewUrl ? (
                            <img src={attachment.previewUrl} alt={`${attachment.fileName} 미리보기`} />
                          ) : (
                            <div className="attachment-placeholder" aria-hidden="true" />
                          )}
                        </div>
                        <div className="attachment-info">
                          <span className="attachment-name">{attachment.fileName}</span>
                          <span className="attachment-meta">{formatFileSize(attachment.fileSize)}</span>
                          <span className="attachment-status">{statusLabel}</span>
                        </div>
                        <button
                          type="button"
                          className="attachment-remove"
                          onClick={() => removeAttachment(attachment.localId)}
                          aria-label={`${attachment.fileName} 제거`}
                        >
                          ×
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <button
                type="submit"
                className="primary"
                disabled={connectionStatus !== 'connected' || isUploadingAttachments || hasAttachmentErrors}
              >
                전송
              </button>
            </form>
          </section>
        </div>

        <div
          id="chat-panel-tabpanel-frames"
          role="tabpanel"
          aria-labelledby="chat-panel-tab-frames"
          className={`chat-panel-tabpanel chat-panel-tabpanel--frames ${activeMainTab === 'frames' ? 'active' : ''}`}
          hidden={activeMainTab !== 'frames'}
        >
          <section className="frame-log-panel" aria-labelledby="frame-log-title">
            <div className="frame-log-header">
              <h3 id="frame-log-title">전송한 STOMP 프레임</h3>
              <button
                type="button"
                className="secondary frame-log-clear"
                onClick={clearFrameLog}
                disabled={outgoingFrames.length === 0}
              >
                로그 비우기
              </button>
            </div>
            <p className="frame-log-description">
              현재 세션에서 전송한 모든 채팅방의 STOMP 프레임을 시간 순으로 모아서 보여줍니다.
            </p>
            {frameLogStatus && (
              <p className="frame-log-status" role="status">{frameLogStatus}</p>
            )}
            <div className="frame-log-content">
              {outgoingFrames.length === 0 ? (
                <p className="frame-log-empty">
                  아직 전송한 프레임이 없습니다. 채팅을 시작하면 여기에서 확인할 수 있습니다.
                </p>
              ) : (
                <ul className="frame-log-list">
                  {outgoingFrames.map((frame) => {
                    const isExpanded = expandedFrameIds.includes(frame.id);
                    const displayRaw = (frame.raw || '').split('\u0000').join('␀');
                    return (
                      <li key={frame.id} className={`frame-log-item ${isExpanded ? 'expanded' : ''}`}>
                        <button
                          type="button"
                          className="frame-log-toggle"
                          onClick={() => toggleFrameExpansion(frame.id)}
                          aria-expanded={isExpanded}
                        >
                          <span className="frame-log-command">{frame.command}</span>
                          <span className="frame-log-meta">
                            <span className="frame-log-time">{formatTimestamp(frame.timestamp)}</span>
                            <span className="frame-log-chevron" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
                          </span>
                        </button>
                        {isExpanded && (
                          <div className="frame-log-details">
                            <pre className="frame-log-raw">{displayRaw}</pre>
                            <button
                              type="button"
                              className="secondary frame-log-copy"
                              onClick={() => handleCopyFrame(frame.raw)}
                            >
                              프레임 복사
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>
      <aside className="chat-panel-sidebar" aria-label="채팅방 목록">
        <div className="card chat-room-panel" aria-labelledby="chat-room-panel-title">
          <div className="chat-room-section-header">
            <h3 id="chat-room-panel-title">열려 있는 채팅방</h3>
            <button type="button" className="secondary" onClick={refreshChatRooms} disabled={isLoadingChatRooms}>
              목록 새로고침
            </button>
          </div>
          {chatRoomsMessage && <p className="chat-room-status">{chatRoomsMessage}</p>}
          <div className="chat-room-list-container">
            <ul className="chat-room-list">
              {chatRooms.map((room) => (
                <li key={room.roomId} className="chat-room-item">
                  <button
                    type="button"
                    className={`chat-room-button ${room.roomId === chatRoomId ? 'active' : ''}`}
                    onClick={() => handleSelectChatRoom(room.roomId)}
                  >
                    <div className="chat-room-button__header">
                      <span className="chat-room-title">{room.roomName || `채팅방 #${room.roomId}`}</span>
                      {room.existNewMessage && <span className="chat-room-badge">새 메시지</span>}
                    </div>
                    <span className="chat-room-meta">축제 ID: {room.festivalId ?? '정보 없음'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
