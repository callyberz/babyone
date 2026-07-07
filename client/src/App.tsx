import { useEffect, useState } from "react";
import type { RoutineRecord, User } from "./types";
import { CalendarScreen } from "./components/CalendarScreen";
import { ChatScreen } from "./components/ChatScreen";
import { DashScreen } from "./components/DashScreen";
import { Icon } from "./components/icons";
import { RecordModal } from "./components/RecordModal";
import { Sidebar, TabBar } from "./components/Sidebar";
import { TodayScreen } from "./components/TodayScreen";
import { TrendsScreen } from "./components/TrendsScreen";
import type { View } from "./components/views";
import {
  useBaby,
  useBulkDeleteRecords,
  useDeleteRecord,
  useRecords,
  useUpdateRecord,
} from "./queries";
import { useMe } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { SignupPage } from "./auth/SignupPage";
import { Splash } from "./auth/Splash";

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

export function App() {
  const me = useMe();
  if (me.isLoading) return <Splash />;
  if (!me.data) {
    if (window.location.pathname === "/signup") return <SignupPage />;
    return <LoginPage />;
  }
  return <AuthenticatedApp user={me.data} />;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [view, setView] = useState<View>(readView);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);
  const [editing, setEditing] = useState<RoutineRecord | null>(null);

  const recordsQuery = useRecords();
  const babyQuery = useBaby();
  const updateRecordMut = useUpdateRecord();
  const deleteRecordMut = useDeleteRecord();
  const bulkDeleteRecordsMut = useBulkDeleteRecords();

  const records = recordsQuery.data ?? [];
  const baby = babyQuery.data ?? null;
  const loadError = recordsQuery.error ?? babyQuery.error;
  const loadErr = loadError instanceof Error ? loadError.message : null;

  useEffect(() => {
    localStorage.setItem("clement.view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("clement.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const updateRecord = (r: RoutineRecord) => updateRecordMut.mutate(r);
  const deleteRecord = (id: number) =>
    deleteRecordMut.mutate(id, { onSuccess: () => setEditing(null) });
  const bulkDeleteRecords = (ids: number[]) => bulkDeleteRecordsMut.mutate(ids);

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={setView}
        theme={theme}
        setTheme={setTheme}
        baby={baby}
        user={user}
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
          {view === "chat" && <ChatScreen records={records} />}
          {view === "today" && (
            <TodayScreen
              records={records}
              openRecord={setEditing}
              isAdmin={user.isAdmin}
              onBulkDelete={bulkDeleteRecords}
            />
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
