import { useEffect, useRef, useState } from "react";
import type { Baby, User } from "../types";
import { Icon } from "./icons";
import type { View } from "./views";
import { InvitePanel } from "../auth/InvitePanel";
import { CaregiverAccessPanel } from "../auth/CaregiverAccessPanel";
import { SessionPanel } from "../auth/SessionPanel";
import { ProfilePanel } from "../auth/ProfilePanel";
import { PasswordPanel } from "../auth/PasswordPanel";
import { useLogout } from "../auth/useAuth";
import { api } from "../api";
import {
  formatBabyAge,
  formatBabyWeight,
  getBabyDisplayName,
  getBabyInitial,
} from "../utils";

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
  onEditBaby,
}: {
  view: View;
  setView: (v: View) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  baby: Baby | null;
  user: User;
  onEditBaby: () => void;
}) {
  const babyName = getBabyDisplayName(baby);
  return (
    <aside className="sidebar">
      <div
        className="logo"
        aria-label={baby ? `${babyName}'s babyone routines` : "babyone routines"}
      >
        <div className="logo-mark" aria-hidden="true">
          {baby ? getBabyInitial(baby) : "b"}
        </div>
        <div>
          <div className="logo-name">{baby ? babyName : "babyone"}</div>
          <div className="logo-sub">babyone · routines</div>
        </div>
      </div>

      <BabyProfileButton baby={baby} onClick={onEditBaby} />

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
        <CaregiverControls theme={theme} setTheme={setTheme} user={user} />
      </div>
    </aside>
  );
}

function BabyProfileButton({
  baby,
  onClick,
}: {
  baby: Baby | null;
  onClick: () => void;
}) {
  const weight = baby ? formatBabyWeight(baby) : null;
  const babyName = getBabyDisplayName(baby);
  return (
    <button
      className="baby-card baby-card-button"
      onClick={onClick}
      disabled={!baby}
      aria-label={baby ? `Edit ${babyName}'s profile` : "Baby profile loading"}
    >
      <div className="baby-avatar" aria-hidden="true">
        {getBabyInitial(baby)}
      </div>
      <div>
        <div className="baby-name">{baby ? babyName : "Baby"}</div>
        <div className="baby-age">
          {baby
            ? `${formatBabyAge(baby.birthdate)} old${weight ? ` · ${weight}` : ""}`
            : "—"}
        </div>
      </div>
      <span className="baby-edit" aria-hidden="true">Edit</span>
    </button>
  );
}

function CaregiverControls({
  theme,
  setTheme,
  user,
}: {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  user: User;
}) {
  const logout = useLogout();
  const dark = theme === "dark";
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<
    { kind: "success" | "error"; message: string } | undefined
  >();

  const downloadExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportStatus(undefined);
    try {
      await api.downloadExport();
      setExportStatus({
        kind: "success",
        message: "Household data export downloaded.",
      });
    } catch (error) {
      setExportStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not export household data",
      });
    } finally {
      setExporting(false);
    }
  };
  return (
    <>
      <div className="me-card">
        Signed in as <strong>{user.displayName}</strong>
      </div>
      <ProfilePanel user={user} />
      <PasswordPanel />
      {user.isAdmin && <InvitePanel />}
      <SessionPanel />
      {user.isAdmin && <CaregiverAccessPanel currentUserId={user.id} />}
      {user.isAdmin && (
        <div className="export-control">
          <button
            className="btn btn-small"
            type="button"
            onClick={() => void downloadExport()}
            disabled={exporting}
          >
            {exporting ? "Preparing export…" : "Export household data"}
          </button>
          {exportStatus && (
            <div
              className={
                exportStatus.kind === "error"
                  ? "auth-error export-feedback"
                  : "export-feedback export-success"
              }
              role={exportStatus.kind === "error" ? "alert" : "status"}
            >
              {exportStatus.message}
            </div>
          )}
        </div>
      )}
      <button
        className="theme-toggle"
        type="button"
        role="switch"
        aria-checked={dark}
        onClick={() => setTheme(dark ? "light" : "dark")}
      >
        <span>{dark ? "Dark mode" : "Light mode"}</span>
        <span
          className={`toggle-switch ${dark ? "on" : ""}`}
          aria-hidden="true"
        />
      </button>
      <button
        className="btn btn-small"
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        {logout.isPending ? "Signing out…" : "Sign out"}
      </button>
      {logout.error && (
        <div className="auth-error" role="alert">
          {(logout.error as Error).message}
        </div>
      )}
    </>
  );
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function MobileAccountMenu({
  theme,
  setTheme,
  baby,
  user,
  onEditBaby,
}: {
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
  baby: Baby | null;
  user: User;
  onEditBaby: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = [
        ...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        className="mobile-account-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Caregiver settings for ${user.displayName}`}
        onClick={() => setOpen(true)}
      >
        {user.displayName.trim().charAt(0).toUpperCase() || "?"}
      </button>
      {open && (
        <div
          className="mobile-account-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={sheetRef}
            className="mobile-account-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-account-title"
          >
            <div className="mobile-account-heading">
              <div>
                <div className="eyebrow">Caregiver account</div>
                <h2 id="mobile-account-title">Settings</h2>
              </div>
              <button
                className="modal-close"
                type="button"
                aria-label="Close caregiver settings"
                onClick={() => setOpen(false)}
              >
                <Icon.close />
              </button>
            </div>
            <BabyProfileButton
              baby={baby}
              onClick={() => {
                setOpen(false);
                onEditBaby();
              }}
            />
            <div className="mobile-account-controls">
              <CaregiverControls
                theme={theme}
                setTheme={setTheme}
                user={user}
              />
            </div>
          </section>
        </div>
      )}
    </>
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
