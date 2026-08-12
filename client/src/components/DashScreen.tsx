import { useEffect, useMemo, useState } from "react";
import { aggregateLocalDays } from "@babyone/contracts";
import type { Baby, RoutineRecord, User } from "../types";
import { categories, getCategory } from "../types";
import { fmtAgo, formatBabyAge } from "../utils";
import { Icon } from "./icons";
import { QuickLog } from "./QuickLog";
import type { View } from "./views";

export function DashScreen({
  records,
  baby,
  user,
  setView,
  onEditBaby,
}: {
  records: RoutineRecord[];
  baby: Baby | null;
  user: User;
  setView: (view: View) => void;
  onEditBaby: () => void;
}) {
  const now = new Date();
  const today = aggregateLocalDays(records, 1, now)[0];
  const [handoffSince] = useState(() => {
    const stored = localStorage.getItem(`clement.handoff.${user.id}`);
    const parsed = stored ? Date.parse(stored) : Number.NaN;
    return Number.isNaN(parsed) ? Date.now() - 8 * 60 * 60 * 1000 : parsed;
  });

  useEffect(() => {
    localStorage.setItem(`clement.handoff.${user.id}`, new Date().toISOString());
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
  const handoff = records
    .filter((record) => new Date(record.at).getTime() > handoffSince)
    .slice(0, 6);

  return (
    <div className="content-pad">
      <div className="hero-strip">
        <div>
          <div className="hero-greet">{greeting}.</div>
          <div className="hero-sub">
            Here is what caregivers have recorded today.
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
            <h2>{baby?.name ?? "Baby"}</h2>
            {baby && <div className="now-age">{formatBabyAge(baby.birthdate)} old</div>}
          </div>
          <button className="btn btn-ghost" onClick={onEditBaby}>Edit profile</button>
        </div>
        <div className="now-grid">
          {latest.map((record) => {
            const category = getCategory(record.type);
            return (
              <div className="now-item" key={record.type}>
                <div className="now-icon" style={{ background: `${category.tint}22`, color: category.tint }}>
                  {category.icon}
                </div>
                <div>
                  <div className="now-label">Last {category.label.toLowerCase()}</div>
                  <div className="now-title">{record.title}</div>
                  <div className="now-meta">
                    {fmtAgo(record.at)}
                    {record.user?.displayName ? ` · ${record.user.displayName}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
          {!latest.length && <div className="empty compact-empty">No activity recorded yet.</div>}
        </div>
      </section>

      <div className="stat-grid">
        <Stat label="Feeds" color={categories.feed.tint} value={today.feeds} sub={today.ozTotal ? `${today.ozTotal.toFixed(1)} oz recorded` : "today"} />
        <Stat
          label="Sleep"
          color={categories.sleep.tint}
          value={<>{Math.floor(today.sleepMins / 60)}<span className="metric-unit">h</span> {today.sleepMins % 60}<span className="metric-unit">m</span></>}
          sub={`across ${today.sleepSessions} entries`}
        />
        <Stat label="Diapers" color={categories.diaper.tint} value={today.diapers} sub={`${today.diaperDirty} dirty · ${today.diaperWet} wet`} />
        <Stat label="Tummy time" color={categories.play.tint} value={<>{today.playMins}<span className="metric-unit">m</span></>} sub="recorded today" />
      </div>

      <div className="cards-row handoff-row">
        <QuickLog babyName={baby?.name ?? "baby"} />
        <div className="panel">
          <div className="panel-h">
            <div>
              <h3>Since you last checked</h3>
              <div className="panel-sub">New activity from this device's last dashboard visit.</div>
            </div>
          </div>
          <RecordRows records={handoff} empty="You're caught up." />
        </div>
      </div>

      <div className="cards-row">
        <div className="panel activity-panel">
          <div className="panel-h">
            <h3>Recent activity</h3>
            <button className="btn btn-ghost" onClick={() => setView("today")}>
              View all <Icon.fwd />
            </button>
          </div>
          <RecordRows records={records.slice(0, 5)} empty="No records yet." />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, color, value, sub }: { label: string; color: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="stat-card">
      <div className="lbl"><span className="stat-swatch" style={{ background: color }} /> {label}</div>
      <div className="val">{value}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function RecordRows({ records, empty }: { records: RoutineRecord[]; empty: string }) {
  if (!records.length) return <div className="empty compact-empty">{empty}</div>;
  return (
    <div className="next-up">
      {records.map((record) => {
        const category = getCategory(record.type);
        return (
          <div className="next-up-row" key={record.id}>
            <div className="next-up-ico" style={{ background: `${category.tint}22`, color: category.tint }}>{category.icon}</div>
            <div className="next-up-body">
              <div className="next-up-title">{record.title}</div>
              <div className="next-up-sub">
                {category.label}{record.user?.displayName ? ` · ${record.user.displayName}` : ""}
              </div>
            </div>
            <div className="next-up-when">{fmtAgo(record.at)}</div>
          </div>
        );
      })}
    </div>
  );
}
