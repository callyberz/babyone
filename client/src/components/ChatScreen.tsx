import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, RoutineRecord } from "../types";
import { useBrief, useChat, useMessages } from "../queries";
import { fmtAgo, fmtDay, fmtTime, formatTimezone } from "../utils";
import { Icon } from "./icons";
import { RecordIcon } from "./RecordIcon";
import { createRequestId } from "../requestId";

const suggestionsFor = (babyName: string) => [
  "Bottle 3 oz",
  "Nursed 20 min both",
  "Wet diaper",
  "Nap 45 min",
  "Vitamin D drops",
  `How much sleep has ${babyName} had today?`,
];

type LocalChatMessage = ChatMessage & {
  requestId: string;
  sendState: "sending" | "failed";
  error?: string;
};

export function ChatScreen({
  records,
  babyName = "your baby",
}: {
  records: RoutineRecord[];
  babyName?: string;
}) {
  const { data: messages = [] } = useMessages();
  const { data: briefData } = useBrief();
  const chatMutation = useChat();
  const [extras, setExtras] = useState<LocalChatMessage[]>([]);
  const nextTempId = useRef(-1);
  const briefMsg = briefData?.message ?? null;
  const chat = useMemo(() => {
    // The brief is also persisted server-side: same session it shows via the
    // brief query; after a reload it arrives in `messages` and the brief query
    // returns null — dedup by id keeps it from appearing twice.
    const base =
      briefMsg && !messages.some((m) => m.id === briefMsg.id)
        ? [...messages, briefMsg]
        : messages;
    return [...base, ...extras];
  }, [messages, briefMsg, extras]);
  const typing = chatMutation.isPending;
  const [draft, setDraft] = useState("");
  const [pillLabel, setPillLabel] = useState<string | null>(null);
  const [pillVisible, setPillVisible] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollStopRef = useRef<number | null>(null);
  const activeIsTodayRef = useRef(true);

  useEffect(() => {
    if (streamRef.current)
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [chat, typing]);

  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const isSameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    const onScroll = () => {
      const streamTop = stream.getBoundingClientRect().top;
      const nodes = stream.querySelectorAll<HTMLElement>("[data-at]");
      let activeAt: string | null = null;
      for (const node of nodes) {
        if (node.getBoundingClientRect().bottom > streamTop) {
          activeAt = node.dataset.at ?? null;
          break;
        }
      }
      if (!activeAt && nodes.length > 0) {
        activeAt = nodes[nodes.length - 1]!.dataset.at ?? null;
      }
      if (!activeAt) return;

      const d = new Date(activeAt);
      activeIsTodayRef.current = isSameDay(d, new Date());
      setPillLabel(`${fmtDay(activeAt)} · ${formatTimezone(activeAt)}`);
      setPillVisible(true);

      if (scrollStopRef.current !== null) {
        window.clearTimeout(scrollStopRef.current);
      }
      scrollStopRef.current = window.setTimeout(() => {
        if (activeIsTodayRef.current) setPillVisible(false);
      }, 1200);
    };

    stream.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      stream.removeEventListener("scroll", onScroll);
      if (scrollStopRef.current !== null) {
        window.clearTimeout(scrollStopRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = "auto";
      taRef.current.style.height =
        Math.min(160, taRef.current.scrollHeight) + "px";
    }
  }, [draft]);

  const recById = useMemo(() => {
    const m = new Map<number, RoutineRecord>();
    records.forEach((r) => m.set(r.id, r));
    return m;
  }, [records]);

  const submit = (local: LocalChatMessage) => {
    setExtras((current) => {
      const exists = current.some(
        (message) => message.requestId === local.requestId,
      );
      if (!exists) return [...current, local];
      return current.map((message) =>
        message.requestId === local.requestId
          ? { ...message, sendState: "sending", error: undefined }
          : message,
      );
    });

    chatMutation.mutate(
      { text: local.text, requestId: local.requestId },
      {
        onSuccess: () => {
          setExtras((current) =>
            current.filter(
              (message) => message.requestId !== local.requestId,
            ),
          );
        },
        onError: (err) => {
          setExtras((current) =>
            current.map((message) =>
              message.requestId === local.requestId
                ? {
                    ...message,
                    sendState: "failed",
                    error:
                      err instanceof Error
                        ? err.message
                        : "Could not reach the server",
                  }
                : message,
            ),
          );
        },
      },
    );
  };

  const send = (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || typing) return;
    setDraft("");

    const tempUser: LocalChatMessage = {
      id: nextTempId.current--,
      from: "user",
      at: new Date().toISOString(),
      text,
      recordIds: [],
      requestId: createRequestId(),
      sendState: "sending",
    };
    submit(tempUser);
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const grouped: (
    | { kind: "day"; key: string; label: string }
    | { kind: "msg"; key: string; msg: ChatMessage }
  )[] = [];
  let lastDay: string | null = null;
  chat.forEach((m) => {
    const day = new Date(m.at).toDateString();
    if (day !== lastDay) {
      grouped.push({ kind: "day", key: "d-" + day, label: fmtDay(m.at) });
      lastDay = day;
    }
    grouped.push({ kind: "msg", key: "m-" + m.id, msg: m });
  });

  return (
    <div className="chat-wrap">
      <div
        className={`chat-date-pill${pillVisible ? " is-visible" : ""}`}
        aria-hidden={!pillVisible}
      >
        {pillLabel ?? ""}
      </div>
      <div
        className="chat-stream"
        ref={streamRef}
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {grouped.map((g) =>
          g.kind === "day" ? (
            <div className="day-break" key={g.key}>
              {g.label}
            </div>
          ) : (
            <ChatBubble
              key={g.key}
              m={g.msg}
              recById={recById}
              retryDisabled={typing}
              onRetry={(message) => submit(message)}
              onDiscard={(requestId) =>
                setExtras((current) =>
                  current.filter((message) => message.requestId !== requestId),
                )
              }
            />
          ),
        )}
        {typing && (
          <div
            className="msg bot"
            role="status"
            aria-label="babyone is responding"
          >
            <div className="msg-avatar bot">b</div>
            <div className="msg-bubble">
              <div className="typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="suggest-row">
        {suggestionsFor(babyName).map((s) => (
          <button key={s} className="suggest-chip" onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={taRef}
            aria-label={`Message about ${babyName}`}
            placeholder={`Tell me what happened with ${babyName} — e.g. 'fed 3oz at 2pm' or 'nap for 45 min'`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
          />
          <button
            className="composer-send"
            aria-label="Send message"
            disabled={!draft.trim() || typing}
            onClick={() => void send()}
          >
            <Icon.send />
          </button>
        </div>
        <div className="composer-hint">
          Talk naturally — I'll log it for you. <span className="mono">⏎</span>{" "}
          to send
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  m,
  recById,
  retryDisabled,
  onRetry,
  onDiscard,
}: {
  m: ChatMessage | LocalChatMessage;
  recById: Map<number, RoutineRecord>;
  retryDisabled: boolean;
  onRetry: (message: LocalChatMessage) => void;
  onDiscard: (requestId: string) => void;
}) {
  const local = "requestId" in m ? m : null;
  const failed = local?.sendState === "failed";
  return (
    <div
      className={`msg ${m.from}${failed ? " send-failed" : ""}`}
      data-at={m.at}
    >
      <div className={`msg-avatar ${m.from}`}>
        {m.from === "bot" ? "b" : "M"}
      </div>
      <div>
        <div className="msg-bubble">{m.text}</div>
        {m.recordIds.map((id) => {
          const r = recById.get(id);
          if (!r) return null;
          return (
            <div className="record-card" key={id}>
              <RecordIcon type={r.type} />
              <div className="record-body">
                <div className="record-title">{r.title}</div>
                {r.detail && <div className="record-detail">{r.detail}</div>}
                <div className="record-time">
                  {fmtTime(r.at)} · {fmtAgo(r.at)}
                </div>
              </div>
            </div>
          );
        })}
        <div className="msg-time">
          {fmtTime(m.at)}
          {local?.sendState === "sending" && " · Sending…"}
        </div>
        {failed && local && (
          <div className="send-failure" role="alert">
            <span>Not sent{local.error ? ` — ${local.error}` : ""}</span>
            <div className="send-failure-actions">
              <button
                type="button"
                className="send-failure-action"
                disabled={retryDisabled}
                onClick={() => onRetry(local)}
              >
                Retry
              </button>
              <button
                type="button"
                className="send-failure-action"
                onClick={() => onDiscard(local.requestId)}
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
