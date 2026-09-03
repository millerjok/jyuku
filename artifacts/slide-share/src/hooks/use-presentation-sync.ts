import { useState, useEffect, useRef, useCallback } from 'react';

export function usePresentationSync(presentationId?: string, initialMaxRevealedSlide = -1, initialCurrentSlide = 0) {
  const [currentSlide, setCurrentSlide] = useState(initialCurrentSlide);
  const [maxRevealedSlide, setMaxRevealedSlide] = useState(initialMaxRevealedSlide);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const connect = useCallback(() => {
    if (!presentationId) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/api/ws/presentations/${presentationId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string) as {
          type: string;
          slideIndex?: number;
          maxRevealedSlide?: number;
        };
        if (message.type === 'slide' && typeof message.slideIndex === 'number') {
          setCurrentSlide(message.slideIndex);
          if (typeof message.maxRevealedSlide === 'number') {
            setMaxRevealedSlide(message.maxRevealedSlide);
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [presentationId]);

  useEffect(() => {
    setCurrentSlide(initialCurrentSlide);
    setMaxRevealedSlide(initialMaxRevealedSlide);
  }, [presentationId]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect loop on unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendSlideUpdate = useCallback((slideIndex: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'slide', slideIndex }));
    }
  }, []);

  return { currentSlide, setCurrentSlide, maxRevealedSlide, setMaxRevealedSlide, isConnected, sendSlideUpdate };
}
