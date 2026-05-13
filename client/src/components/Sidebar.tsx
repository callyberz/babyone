import type { Baby } from "../types";
import { formatBabyAge, formatBabyWeight } from "../utils";
import { Icon } from "./icons";
import type { View } from "./views";

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
  onEditBaby,
}: {
  view: View;
  setView: (v: View) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  baby: Baby | null;
  onEditBaby: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">c</div>
        <div>
          <div className="logo-name">clement</div>
          <div className="logo-sub">routines</div>
        </div>
      </div>

      <button
        type="button"
        className="baby-card baby-card-button"
        onClick={onEditBaby}
        aria-label="Edit baby profile"
      >
        <div className="baby-avatar">{baby?.name?.[0] ?? "C"}</div>
        <div className="baby-card-text">
          <div className="baby-name">{baby?.name ?? "Clement"}</div>
          <div className="baby-age">
            {baby
              ? `${formatBabyAge(baby.birthdate)} old · ${formatBabyWeight(baby)}`
              : "—"}
          </div>
        </div>
        <Icon.pencil className="baby-card-edit" />
      </button>

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
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
          <div className={`toggle-switch ${theme === "dark" ? "on" : ""}`} />
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
