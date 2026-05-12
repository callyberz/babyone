import { useEffect, useMemo, useRef, useState } from "react";
import { api, type ChatResult } from "../api";
import type { ChatMessage, RoutineRecord } from "../types";
import { fmtAgo, fmtDay, fmtTime } from "../utils";
import { Icon } from "./icons";
import { RecordIcon } from "./RecordIcon";

const SUGGESTIONS = [
  "Bottle 3 oz",
  "Nursed 20 min both",
  "Wet diaper",
  "Nap 45 min",
  "Vitamin D drops",
  "How much sleep today?",
];

export function ChatScreen({
  records,
  chat,
  setChat,
  onChatResult,
}: {
  records: RoutineRecord[];
  chat: ChatMessage[];
  setChat: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  onChatResult: (r: ChatResult) => void;
}) {
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (streamRef.current)
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [chat, typing]);

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

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || typing) return;
    setDraft("");
    setTyping(true);

    const tempId = -Date.now();
    const tempUser: ChatMessage = {
      id: tempId,
      from: "user",
      at: new Date().toISOString(),
      text,
      recordIds: [],
    };
    setChat((c) => [...c, tempUser]);

    try {
      const res = await api.chat(text);
      onChatResult({
        created: res.created,
        updated: res.updated,
        deleted: res.deleted,
      });
      setChat((c) => [
        ...c.filter((m) => m.id !== tempId),
        res.userMsg,
        res.botMsg,
      ]);
    } catch (err) {
      setChat((c) => [
        ...c,
        {
          id: Date.now(),
          from: "bot",
          at: new Date().toISOString(),
          text: `Couldn't reach the server — ${(err as Error).message}`,
          recordIds: [],
        },
      ]);
    } finally {
      setTyping(false);
    }
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
      <div className="chat-stream" ref={streamRef}>
        {grouped.map((g) =>
          g.kind === "day" ? (
            <div className="day-break" key={g.key}>
              {g.label}
            </div>
          ) : (
            <ChatBubble key={g.key} m={g.msg} recById={recById} />
          ),
        )}
        {typing && (
          <div className="msg bot">
            <div className="msg-avatar bot">c</div>
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
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggest-chip" onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={taRef}
            placeholder="Tell me what just happened — e.g. 'fed 3oz at 2pm' or 'nap for 45 min'"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
          />
          <button
            className="composer-send"
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
}: {
  m: ChatMessage;
  recById: Map<number, RoutineRecord>;
}) {
  return (
    <div className={`msg ${m.from}`}>
      <div className={`msg-avatar ${m.from}`}>
        {m.from === "bot" ? "c" : "M"}
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
        <div className="msg-time">{fmtTime(m.at)}</div>
      </div>
    </div>
  );
}
