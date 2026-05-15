import { useEffect, useState } from "react";
import { api, type ChatResult } from "./api";
import type { Baby, ChatMessage, RoutineRecord } from "./types";
import { CalendarScreen } from "./components/CalendarScreen";
import { ChatScreen } from "./components/ChatScreen";
import { DashScreen } from "./components/DashScreen";
import { Icon } from "./components/icons";
import { RecordModal } from "./components/RecordModal";
import { Sidebar, TabBar } from "./components/Sidebar";
import { TodayScreen } from "./components/TodayScreen";
import { TrendsScreen } from "./components/TrendsScreen";
import type { View } from "./components/views";

const titles: Record<View, { t: string; s: string }> = {
  chat: {
    t: "Chat with Clement",
    s: "Tell me what just happened — I'll log it.",
  },
  today: { t: "Today's timeline", s: "Everything that happened, in order." },
  dash: { t: "Dashboard", s: "Today at a glance." },
  trends: { t: "Trends", s: "Patterns over the last week or two." },
  calendar: { t: "Calendar", s: "Browse history by day." },
};

const readView = (): View => {
  const v = localStorage.getItem("clement.view");
  return (["chat", "today", "dash", "trends", "calendar"] as View[]).includes(
    v as View,
  )
    ? (v as View)
    : "chat";
};
const readTheme = (): "light" | "dark" =>
  localStorage.getItem("clement.theme") === "dark" ? "dark" : "light";

const sortRecords = (rs: RoutineRecord[]) =>
  [...rs].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

export function App() {
  const [view, setView] = useState<View>(readView);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);
  const [records, setRecords] = useState<RoutineRecord[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [baby, setBaby] = useState<Baby | null>(null);
  const [editing, setEditing] = useState<RoutineRecord | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("clement.view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("clement.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancel = false;
    Promise.all([api.listRecords(), api.listMessages(), api.baby()])
      .then(([rs, ms, b]) => {
        if (cancel) return;
        setRecords(sortRecords(rs));
        setChat(ms);
        setBaby(b);
        // Best-effort daily brief — runs after the initial chat load so it
        // appends rather than racing the setChat(ms) above. Never blocks the app.
        api
          .brief()
          .then((res) => {
            if (!cancel && res.message) {
              const m = res.message;
              setChat((c) => [...c, m]);
            }
          })
          .catch(() => {});
      })
      .catch((err) => !cancel && setLoadErr((err as Error).message));
    return () => {
      cancel = true;
    };
  }, []);

  const applyChatResult = ({ created, updated, deleted }: ChatResult) => {
    if (!created.length && !updated.length && !deleted.length) return;
    setRecords((rs) => {
      const updatedById = new Map(updated.map((r) => [r.id, r]));
      const deletedSet = new Set(deleted);
      const next = rs
        .filter((r) => !deletedSet.has(r.id))
        .map((r) => updatedById.get(r.id) ?? r);
      return sortRecords([...created, ...next]);
    });
  };
  const updateRecord = async (r: RoutineRecord) => {
    const saved = await api.updateRecord(r);
    setRecords((rs) =>
      sortRecords(rs.map((x) => (x.id === saved.id ? saved : x))),
    );
  };
  const deleteRecord = async (id: number) => {
    await api.deleteRecord(id);
    setRecords((rs) => rs.filter((r) => r.id !== id));
    setEditing(null);
  };

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={setView}
        theme={theme}
        setTheme={setTheme}
        baby={baby}
      />
      <main className="main">
        <header className="topbar">
          <div>
            <h1>{titles[view].t}</h1>
            <div className="topbar-sub">
              {loadErr ? `Server offline: ${loadErr}` : titles[view].s}
            </div>
          </div>
          <div className="topbar-actions">
            {view !== "chat" && (
              <button
                className="btn btn-primary"
                onClick={() => setView("chat")}
              >
                <Icon.plus /> Log via chat
              </button>
            )}
          </div>
        </header>
        <div className="screen">
          {view === "chat" && (
            <ChatScreen
              records={records}
              chat={chat}
              setChat={setChat}
              onChatResult={applyChatResult}
            />
          )}
          {view === "today" && (
            <TodayScreen records={records} openRecord={setEditing} />
          )}
          {view === "dash" && (
            <DashScreen records={records} setView={setView} />
          )}
          {view === "trends" && <TrendsScreen records={records} />}
          {view === "calendar" && (
            <CalendarScreen records={records} openRecord={setEditing} />
          )}
        </div>
      </main>
      <TabBar view={view} setView={setView} />
      {editing && (
        <RecordModal
          record={editing}
          onClose={() => setEditing(null)}
          onSave={updateRecord}
          onDelete={deleteRecord}
        />
      )}
    </div>
  );
}
