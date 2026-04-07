import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { ActiveStreamState } from "./agentStreamSubmissionLifecycle";

interface UseAgentStreamControllerOptions {
  currentAssistantMsgIdRef: MutableRefObject<string | null>;
  currentStreamingSessionIdRef: MutableRefObject<string | null>;
  currentStreamingEventNameRef: MutableRefObject<string | null>;
}

export function useAgentStreamController(
  options: UseAgentStreamControllerOptions,
) {
  const {
    currentAssistantMsgIdRef,
    currentStreamingSessionIdRef,
    currentStreamingEventNameRef,
  } = options;
  const [isSending, setIsSending] = useState(false);
  const listenerMapRef = useRef(new Map<string, () => void>());
  const activeStreamRef = useRef<ActiveStreamState | null>(null);

  const setActiveStream = useCallback(
    (nextActive: ActiveStreamState | null) => {
      activeStreamRef.current = nextActive;
      currentAssistantMsgIdRef.current = nextActive?.assistantMsgId ?? null;
      currentStreamingSessionIdRef.current = nextActive?.sessionId ?? null;
      currentStreamingEventNameRef.current = nextActive?.eventName ?? null;
      setIsSending(Boolean(nextActive));
    },
    [
      currentAssistantMsgIdRef,
      currentStreamingEventNameRef,
      currentStreamingSessionIdRef,
    ],
  );

  const clearActiveStreamIfMatch = useCallback(
    (eventName: string) => {
      if (activeStreamRef.current?.eventName !== eventName) {
        return false;
      }
      setActiveStream(null);
      return true;
    },
    [setActiveStream],
  );

  const replaceStreamListener = useCallback(
    (eventName: string, nextUnlisten: (() => void) | null | undefined) => {
      const previous = listenerMapRef.current.get(eventName);
      if (previous) {
        previous();
        listenerMapRef.current.delete(eventName);
      }
      if (nextUnlisten) {
        listenerMapRef.current.set(eventName, nextUnlisten);
      }
    },
    [],
  );

  const removeStreamListener = useCallback((eventName: string) => {
    const existing = listenerMapRef.current.get(eventName);
    if (!existing) {
      return false;
    }
    existing();
    listenerMapRef.current.delete(eventName);
    return true;
  }, []);

  useEffect(() => {
    const listenerMap = listenerMapRef.current;
    return () => {
      for (const unlisten of listenerMap.values()) {
        unlisten();
      }
      listenerMap.clear();
    };
  }, []);

  return {
    isSending,
    setIsSending,
    listenerMapRef,
    activeStreamRef,
    setActiveStream,
    clearActiveStreamIfMatch,
    replaceStreamListener,
    removeStreamListener,
  };
}
