import { aggregateLocalDays } from "@babyone/contracts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Baby, RoutineRecord, User } from "../types";
import { categories, getCategory } from "../types";
import {
  fmtAgo,
  fmtTime,
  formatBabyAge,
  getBabyDisplayName,
} from "../utils";
import { Icon } from "./icons";
import { QuickLog } from "./QuickLog";
import type { View } from "./views";

const HANDOFF_PREVIEW_LIMIT = 6;

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function caregiverAttribution(record: RoutineRecord) {
  return compactText(record.user?.displayName ?? "") || "caregiver not recorded";
}

function handoffDateTime(value: string | number | Date) {
  const date = new Date(value);
  return `${date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} at ${fmtTime(date)}`;
}

export function buildHandoffSummary({
  records,
  babyName,
  since,
}: {
  records: RoutineRecord[];
  babyName: string;
  since: number;
}) {
  const activity = records
    .filter((record) => !Number.isNaN(new Date(record.at).getTime()))
    .sort(
      (a, b) =>
        new Date(a.at).getTime() - new Date(b.at).getTime() || a.id - b.id,
    );
  const countLabel = `${activity.length} new ${
    activity.length === 1 ? "record" : "records"
  }`;
  const lines = activity.map((record) => {
    const category = getCategory(record.type);
    return `• ${handoffDateTime(record.at)} · ${category.label} · ${compactText(
      record.title,
    )} · logged by ${caregiverAttribution(record)}`;
  });

  return [
    `${compactText(babyName)} caregiver handoff`,
    `Since ${handoffDateTime(since)}`,
    countLabel,
    "",
    ...(lines.length ? lines : ["No new activity."]),
  ].join("\n");
}

export function DashScreen({
  records,
  baby,
  user,
  setView,
  onEditBaby,
  openRecord,
}: {
  records: RoutineRecord[];
  baby: Baby | null;
  user: User;
  setView: (view: View) => void;
  onEditBaby: () => void;
  openRecord: (record: RoutineRecord) => void;
}) {
  const now = new Date();
  const babyName = getBabyDisplayName(baby);
  const today = aggregateLocalDays(records, 1, now)[0];
  const [handoffFeedback, setHandoffFeedback] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [handoffSince] = useState(() => {
    const stored =
      localStorage.getItem(`babyone.handoff.${user.id}`) ??
      localStorage.getItem(`clement.handoff.${user.id}`);
    const parsed = stored ? Date.parse(stored) : Number.NaN;
    return Number.isNaN(parsed) ? Date.now() - 8 * 60 * 60 * 1000 : parsed;
  });

  useEffect(() => {
    localStorage.setItem(
      `babyone.handoff.${user.id}`,
      new Date().toISOString(),
    );
  }, [user.id]);

  const greeting = (() => {
    const hour = now.getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  })();

  const lastUpdate = records[0]?.at;
  const latest = useMemo(() => {
    const byType = new Map<string, RoutineRecord>();
    for (const record of records) {
      if (!byType.has(record.type)) byType.set(record.type, record);
    }
    return ["feed", "sleep", "diaper", "meds"]
      .map((type) => byType.get(type))
      .filter((record): record is RoutineRecord => Boolean(record));
  }, [records]);
  const handoff = useMemo(
    () =>
      records
        .filter((record) => new Date(record.at).getTime() > handoffSince)
        .sort(
          (a, b) =>
            new Date(b.at).getTime() - new Date(a.at).getTime() || b.id - a.id,
        ),
    [handoffSince, records],
  );
  const handoffSummary = useMemo(
    () => buildHandoffSummary({ records: handoff, babyName, since: handoffSince }),
    [babyName, handoff, handoffSince],
  );

  const copyHandoff = async () => {
    setHandoffFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(handoffSummary);
      setHandoffFeedback({ message: "Handoff copied." });
    } catch {
      setHandoffFeedback({
        message: "Could not copy the handoff. Try again.",
        error: true,
      });
    }
  };

  const shareHandoff = async () => {
    setHandoffFeedback(null);
    try {
      await navigator.share({
        title: `${babyName} caregiver handoff`,
        text: handoffSummary,
      });
      setHandoffFeedback({ message: "Handoff shared." });
    } catch (error) {
      setHandoffFeedback({
        message:
          error instanceof Error && error.name === "AbortError"
            ? "Sharing canceled."
            : "Could not share the handoff. Try again.",
        error: !(error instanceof Error && error.name === "AbortError"),
      });
    }
  };

  return (
    <div className="content-pad">
      <div className="hero-strip">
        <div>
          <div className="hero-greet">{greeting}.</div>
          <div className="hero-sub">
            Here is what caregivers have recorded for {babyName} today.
            {lastUpdate && <> Last update {fmtAgo(lastUpdate)}.</>}
          </div>
        </div>
        <div className="hero-stat">
          <div className="num">
            {(today.sleepMins / 60).toFixed(1)}
            <span className="metric-unit metric-unit-lg">h</span>
          </div>
          <div className="lbl">sleep so far today</div>
        </div>
      </div>

      <section className="now-panel" aria-label="Baby right now">
        <div className="now-heading">
          <div>
            <div className="eyebrow">Right now</div>
            <h2>{babyName}</h2>
            {baby && (
              <div className="now-age">
                {formatBabyAge(baby.birthdate)} old
              </div>
            )}
          </div>
          <button className="btn btn-ghost" onClick={onEditBaby}>
            Edit profile
          </button>
        </div>
        <div className="now-grid">
          {latest.map((record) => {
            const category = getCategory(record.type);
            return (
              <div className="now-item" key={record.type}>
                <div
                  className="now-icon"
                  style={{
                    background: `${category.tint}22`,
                    color: category.tint,
                  }}
                >
                  {category.icon}
                </div>
                <div>
                  <div className="now-label">
                    Last {category.label.toLowerCase()}
                  </div>
                  <div className="now-title">{record.title}</div>
                  <div className="now-meta">
                    {fmtAgo(record.at)}
                    {record.user?.displayName
                      ? ` · ${record.user.displayName}`
                      : ""}
                  </div>
                </div>
              </div>
            );
          })}
          {!latest.length && (
            <div className="empty compact-empty">No activity recorded yet.</div>
          )}
        </div>
      </section>

      <div className="stat-grid">
        <Stat
          label="Feeds"
          color={categories.feed.tint}
          value={today.feeds}
          sub={
            today.ozTotal ? `${today.ozTotal.toFixed(1)} oz recorded` : "today"
          }
        />
        <Stat
          label="Sleep"
          color={categories.sleep.tint}
          value={
            <>
              {Math.floor(today.sleepMins / 60)}
              <span className="metric-unit">h</span> {today.sleepMins % 60}
              <span className="metric-unit">m</span>
            </>
          }
          sub={`across ${today.sleepSessions} entries`}
        />
        <Stat
          label="Diapers"
          color={categories.diaper.tint}
          value={today.diapers}
          sub={`${today.diaperDirty} dirty · ${today.diaperWet} wet`}
        />
        <Stat
          label="Tummy time"
          color={categories.play.tint}
          value={
            <>
              {today.playMins}
              <span className="metric-unit">m</span>
            </>
          }
          sub="recorded today"
        />
      </div>

      <div className="cards-row handoff-row">
        <QuickLog babyName={babyName} />
        <section className="panel handoff-panel" aria-labelledby="handoff-heading">
          <div className="panel-h handoff-header">
            <div>
              <h3 id="handoff-heading">Since you last checked</h3>
              <div className="panel-sub">
                New activity from this device&apos;s last dashboard visit.
                {handoff.length > HANDOFF_PREVIEW_LIMIT && (
                  <> Showing the latest {HANDOFF_PREVIEW_LIMIT} below.</>
                )}
              </div>
            </div>
            {handoff.length > 0 && (
              <div className="handoff-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void copyHandoff()}
                >
                  Copy handoff
                </button>
                {typeof navigator.share === "function" && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void shareHandoff()}
                  >
                    Share handoff
                  </button>
                )}
              </div>
            )}
          </div>
          {handoffFeedback && (
            <div
              className={`handoff-feedback ${
                handoffFeedback.error ? "is-error" : ""
              }`}
              role="status"
              aria-live="polite"
            >
              {handoffFeedback.message}
            </div>
          )}
          <RecordRows
            records={handoff.slice(0, HANDOFF_PREVIEW_LIMIT)}
            empty="You're caught up."
            openRecord={openRecord}
          />
        </section>
      </div>

      <div className="cards-row">
        <div className="panel activity-panel">
          <div className="panel-h">
            <h3>Recent activity</h3>
            <button className="btn btn-ghost" onClick={() => setView("today")}>
              View all <Icon.fwd aria-hidden="true" />
            </button>
          </div>
          <RecordRows
            records={records.slice(0, 5)}
            empty="No records yet."
            openRecord={openRecord}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  color,
  value,
  sub,
}: {
  label: string;
  color: string;
  value: ReactNode;
  sub: string;
}) {
  return (
    <div className="stat-card">
      <div className="lbl">
        <span className="stat-swatch" style={{ background: color }} /> {label}
      </div>
      <div className="val">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function RecordRows({
  records,
  empty,
  openRecord,
}: {
  records: RoutineRecord[];
  empty: string;
  openRecord: (record: RoutineRecord) => void;
}) {
  if (!records.length) {
    return <div className="empty compact-empty">{empty}</div>;
  }
  return (
    <div className="next-up">
      {records.map((record) => {
        const category = getCategory(record.type);
        const attribution = caregiverAttribution(record);
        return (
          <button
            type="button"
            className="next-up-row"
            key={record.id}
            aria-label={`Edit ${compactText(record.title)}, ${
              category.label
            }, ${fmtTime(record.at)}, logged by ${attribution}`}
            onClick={() => openRecord(record)}
          >
            <span
              className="next-up-ico"
              style={{
                background: `${category.tint}22`,
                color: category.tint,
              }}
              aria-hidden="true"
            >
              {category.icon}
            </span>
            <span className="next-up-body">
              <span className="next-up-title">{record.title}</span>
              <span className="next-up-sub">
                {category.label}
                {record.user?.displayName
                  ? ` · ${record.user.displayName}`
                  : ""}
              </span>
            </span>
            <span className="next-up-when">{fmtAgo(record.at)}</span>
          </button>
        );
      })}
    </div>
  );
}
