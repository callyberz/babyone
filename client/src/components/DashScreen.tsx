import { aggregateLocalDays } from "@babyone/contracts";
import type { RoutineRecord } from "../types";
import { categories, getCategory } from "../types";
import { fmtAgo } from "../utils";
import { Icon } from "./icons";
import type { View } from "./views";

export function DashScreen({
  records,
  setView,
}: {
  records: RoutineRecord[];
  setView: (v: View) => void;
}) {
  const now = new Date();
  const today = aggregateLocalDays(records, 1, now)[0];

  const greeting = (() => {
    const h = now.getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const lastUpdate = records[0]?.at;

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

      <div className="stat-grid">
        <div className="stat-card">
          <div className="lbl">
            <span
              className="stat-swatch"
              style={{ background: categories.feed.tint }}
            />{" "}
            Feeds
          </div>
          <div className="val">{today.feeds}</div>
          <div className="sub">
            {today.ozTotal ? `${today.ozTotal.toFixed(1)} oz recorded` : "today"}
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">
            <span
              className="stat-swatch"
              style={{ background: categories.sleep.tint }}
            />{" "}
            Sleep
          </div>
          <div className="val">
            {Math.floor(today.sleepMins / 60)}
            <span className="metric-unit">h</span> {today.sleepMins % 60}
            <span className="metric-unit">m</span>
          </div>
          <div className="sub">across {today.sleepSessions} entries</div>
        </div>
        <div className="stat-card">
          <div className="lbl">
            <span
              className="stat-swatch"
              style={{ background: categories.diaper.tint }}
            />{" "}
            Diapers
          </div>
          <div className="val">{today.diapers}</div>
          <div className="sub">
            {today.diaperDirty} dirty · {today.diaperWet} wet
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">
            <span
              className="stat-swatch"
              style={{ background: categories.play.tint }}
            />{" "}
            Tummy time
          </div>
          <div className="val">
            {today.playMins}
            <span className="metric-unit">m</span>
          </div>
          <div className="sub">recorded today</div>
        </div>
      </div>

      <div className="cards-row">
        <div className="panel activity-panel">
          <div className="panel-h">
            <h3>Last activity</h3>
            <button className="btn btn-ghost" onClick={() => setView("today")}>
              View all <Icon.fwd />
            </button>
          </div>
          <div className="next-up">
            {records.slice(0, 5).map((rec) => {
              const cat = getCategory(rec.type);
              return (
                <div className="next-up-row" key={rec.id}>
                  <div
                    className="next-up-ico"
                    style={{ background: `${cat.tint}22`, color: cat.tint }}
                  >
                    {cat.icon}
                  </div>
                  <div className="next-up-body">
                    <div className="next-up-title">{rec.title}</div>
                    <div className="next-up-sub">{cat.label}</div>
                  </div>
                  <div className="next-up-when">{fmtAgo(rec.at)}</div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
