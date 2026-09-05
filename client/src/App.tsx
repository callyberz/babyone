import { useEffect, useState } from "react";
import type { Baby, RoutineRecord, User } from "./types";
import { BabyProfileModal } from "./components/BabyProfileModal";
import { CalendarScreen } from "./components/CalendarScreen";
import { ChatScreen } from "./components/ChatScreen";
import { DashScreen } from "./components/DashScreen";
import { HouseholdSyncStatus } from "./components/HouseholdSyncStatus";
import { Icon } from "./components/icons";
import { RecordModal } from "./components/RecordModal";
import { MobileAccountMenu, Sidebar, TabBar } from "./components/Sidebar";
import { TodayScreen } from "./components/TodayScreen";
import { TrendsScreen } from "./components/TrendsScreen";
import type { View } from "./components/views";
import {
  useBaby,
  useBulkDeleteRecords,
  useDeleteRecord,
  useHouseholdSync,
  useRecords,
  useUpdateBaby,
  useUpdateRecord,
} from "./queries";
import { useMe } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { SignupPage } from "./auth/SignupPage";
import { ResetPasswordPage } from "./auth/ResetPasswordPage";
import { Splash } from "./auth/Splash";
import { getBabyDisplayName } from "./utils";

const titles: Record<View, { t: (babyName: string) => string; s: string }> = {
  chat: {
    t: (babyName) => `Chat about ${babyName}`,
    s: "Tell me what just happened — I'll log it.",
  },
  today: {
    t: (babyName) => `${babyName}'s timeline`,
    s: "Everything that happened, in order.",
  },
  dash: { t: () => "Dashboard", s: "Today at a glance." },
  trends: { t: () => "Trends", s: "Patterns over the last week or two." },
  calendar: { t: () => "Calendar", s: "Browse history by day." },
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
    if (window.location.pathname === "/reset-password") {
      return <ResetPasswordPage />;
    }
    return <LoginPage />;
  }
  return <AuthenticatedApp user={me.data} />;
}

function AuthenticatedApp({ user }: { user: User }) {
  const [view, setView] = useState<View>(readView);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);
  const [editing, setEditing] = useState<RoutineRecord | null>(null);
  const [editingBaby, setEditingBaby] = useState(false);

  const recordsQuery = useRecords();
  const syncQuery = useHouseholdSync();
  const babyQuery = useBaby();
  const updateRecordMut = useUpdateRecord();
  const updateBabyMut = useUpdateBaby();
  const deleteRecordMut = useDeleteRecord();
  const bulkDeleteRecordsMut = useBulkDeleteRecords();

  const records = recordsQuery.data ?? [];
  const baby = babyQuery.data ?? null;
  const babyName = getBabyDisplayName(baby);
  const loadError = recordsQuery.error ?? babyQuery.error;
  const loadErr = loadError instanceof Error ? loadError.message : null;

  useEffect(() => {
    localStorage.setItem("clement.view", view);
  }, [view]);
  useEffect(() => {
    localStorage.setItem("clement.theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => {
    document.title = baby
      ? `${babyName} — babyone`
      : "babyone — Baby Routines";
    return () => {
      document.title = "babyone — Baby Routines";
    };
  }, [baby, babyName]);

  const updateRecord = async (record: RoutineRecord): Promise<void> => {
    await updateRecordMut.mutateAsync(record);
  };
  const deleteRecord = async (id: number): Promise<void> => {
    await deleteRecordMut.mutateAsync(id);
  };
  const bulkDeleteRecords = async (ids: number[]): Promise<void> => {
    await bulkDeleteRecordsMut.mutateAsync(ids);
  };

  return (
    <div className="app">
      <Sidebar
        view={view}
        setView={setView}
        theme={theme}
        setTheme={setTheme}
        baby={baby}
        user={user}
        onEditBaby={() => setEditingBaby(true)}
      />
      <main className="main">
        <header className="topbar">
          <div>
            <h1>{titles[view].t(babyName)}</h1>
            <div className="topbar-sub">
              {loadErr ? `Server offline: ${loadErr}` : titles[view].s}
            </div>
            <HouseholdSyncStatus
              hasSynced={syncQuery.data !== undefined}
              isFetching={syncQuery.isFetching}
              isError={syncQuery.isError}
              error={syncQuery.error}
              updatedAt={syncQuery.dataUpdatedAt}
              onRetry={syncQuery.refetch}
            />
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
            <MobileAccountMenu
              theme={theme}
              setTheme={setTheme}
              baby={baby}
              user={user}
              onEditBaby={() => setEditingBaby(true)}
            />
          </div>
        </header>
        <div className="screen">
          {view === "chat" && (
            <ChatScreen records={records} babyName={babyName} />
          )}
          {view === "today" && (
            <TodayScreen
              records={records}
              openRecord={setEditing}
              isAdmin={user.isAdmin}
              onBulkDelete={bulkDeleteRecords}
              babyName={babyName}
            />
          )}
          {view === "dash" && (
            <DashScreen
              records={records}
              baby={baby}
              user={user}
              setView={setView}
              onEditBaby={() => setEditingBaby(true)}
              openRecord={setEditing}
            />
          )}
          {view === "trends" && <TrendsScreen records={records} />}
          {view === "calendar" && (
            <CalendarScreen
              records={records}
              openRecord={setEditing}
              babyName={babyName}
            />
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
      {editingBaby && baby && (
        <BabyProfileModal
          baby={baby}
          onClose={() => setEditingBaby(false)}
          onSave={async (nextBaby: Baby) => {
            await updateBabyMut.mutateAsync(nextBaby);
          }}
        />
      )}
    </div>
  );
}
