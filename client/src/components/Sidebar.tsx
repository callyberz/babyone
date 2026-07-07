import type { Baby, User } from "../types";
import { Icon } from "./icons";
import type { View } from "./views";
import { InvitePanel } from "../auth/InvitePanel";
import { useLogout } from "../auth/useAuth";

const navItems: {
  id: View;
  label: string;
  icon: (p: React.SVGProps<SVGSVGElement>) => JSX.Element;
}[] = [
  { id: "chat", label: "Chat", icon: Icon.chat },
  { id: "today", label: "Today", icon: Icon.list },
  { id: "dash", label: "Dashboard", icon: Icon.dash },
  { id: "trends", label: "Trends", icon: Icon.trend },
  { id: "calendar", label: "Calendar", icon: Icon.cal },
];

export function Sidebar({
  view,
  setView,
  theme,
  setTheme,
  baby,
  user,
}: {
  view: View;
  setView: (v: View) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  baby: Baby | null;
  user: User;
}) {
  const logout = useLogout();
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">c</div>
        <div>
          <div className="logo-name">clement</div>
          <div className="logo-sub">routines</div>
        </div>
      </div>

      <div className="baby-card">
        <div className="baby-avatar">{baby?.name?.[0] ?? "C"}</div>
        <div>
          <div className="baby-name">{baby?.name ?? "Clement"}</div>
          <div className="baby-age">
            {baby
              ? baby.weight
                ? `${baby.age} old · ${baby.weight}`
                : `${baby.age} old`
              : "—"}
          </div>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-label">Workspace</div>
        {navItems.map((n) => {
          const Ico = n.icon;
          return (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              onClick={() => setView(n.id)}
            >
              <Ico /> <span>{n.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="me-card">
          Signed in as <strong>{user.displayName}</strong>
        </div>
        <InvitePanel />
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
          <div className={`toggle-switch ${theme === "dark" ? "on" : ""}`} />
        </button>
        <button
          className="btn btn-small"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

export function TabBar({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  const tabs: {
    id: View;
    label: string;
    icon: (p: React.SVGProps<SVGSVGElement>) => JSX.Element;
  }[] = [
    { id: "chat", label: "Chat", icon: Icon.chat },
    { id: "today", label: "Today", icon: Icon.list },
    { id: "dash", label: "Stats", icon: Icon.dash },
    { id: "trends", label: "Trends", icon: Icon.trend },
    { id: "calendar", label: "Calendar", icon: Icon.cal },
  ];
  return (
    <nav className="tabbar">
      {tabs.map((t) => {
        const Ico = t.icon;
        return (
          <button
            key={t.id}
            className={`tab ${view === t.id ? "active" : ""}`}
            onClick={() => setView(t.id)}
          >
            <Ico /> <span>{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
