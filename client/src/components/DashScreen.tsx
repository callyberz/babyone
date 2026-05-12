import type { RecordType, RoutineRecord } from "../types";
import { categories } from "../types";
import { fmtAgo, fmtTime } from "../utils";
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
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayRecs = records.filter((r) => new Date(r.at) >= todayStart);

  const last = (type: RecordType) => records.find((r) => r.type === type);
  const lastFeed = last("feed");
  const lastSleep = last("sleep");
  const lastDiaper = last("diaper");

  const feedsToday = todayRecs.filter((r) => r.type === "feed").length;
  const sleepMinsToday = todayRecs
    .filter((r) => r.type === "sleep")
    .reduce((s, r) => s + (r.meta?.mins ?? 0), 0);
  const diapersToday = todayRecs.filter((r) => r.type === "diaper").length;
  const ozToday = todayRecs
    .filter((r) => r.type === "feed" && typeof r.meta?.volume_oz === "number")
    .reduce((s, r) => s + (r.meta.volume_oz as number), 0);

  const nextFeed = lastFeed
    ? new Date(new Date(lastFeed.at).getTime() + 2.5 * 3600 * 1000)
    : null;
  const nextNap = lastSleep ? new Date(now.getTime() + 45 * 60 * 1000) : null;

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
            Clement is doing well today — feeds and sleep are tracking on
            rhythm.
            {lastUpdate && <> Last update {fmtAgo(lastUpdate)}.</>}
          </div>
        </div>
        <div className="hero-stat">
          <div className="num">
            {(sleepMinsToday / 60).toFixed(1)}
            <span style={{ fontSize: 18 }}>h</span>
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
          <div className="val">{feedsToday}</div>
          <div className="sub">
            {ozToday ? `~${ozToday.toFixed(1)} oz total` : "today"}
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
            {Math.floor(sleepMinsToday / 60)}
            <span style={{ fontSize: 16 }}>h</span> {sleepMinsToday % 60}
            <span style={{ fontSize: 16 }}>m</span>
          </div>
          <div className="sub">
            across {todayRecs.filter((r) => r.type === "sleep").length}{" "}
            stretches
          </div>
        </div>
        <div className="stat-card">
          <div className="lbl">
            <span
              className="stat-swatch"
              style={{ background: categories.diaper.tint }}
            />{" "}
            Diapers
          </div>
          <div className="val">{diapersToday}</div>
          <div className="sub">
            {
              todayRecs.filter(
                (r) => r.type === "diaper" && r.meta?.kind === "dirty",
              ).length
            }{" "}
            dirty ·{" "}
            {
              todayRecs.filter(
                (r) => r.type === "diaper" && r.meta?.kind === "wet",
              ).length
            }{" "}
            wet
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
            {todayRecs
              .filter((r) => r.type === "play")
              .reduce((s, r) => s + (r.meta?.mins ?? 0), 0)}
            <span style={{ fontSize: 16 }}>m</span>
          </div>
          <div className="sub">target: 15 min/day</div>
        </div>
      </div>

      <div className="cards-row">
        <div className="panel">
          <div className="panel-h">
            <h3>Last activity</h3>
            <button className="btn btn-ghost" onClick={() => setView("today")}>
              View all <Icon.fwd />
            </button>
          </div>
          <div className="next-up">
            {[lastFeed, lastSleep, lastDiaper].filter(Boolean).map((r) => {
              const rec = r as RoutineRecord;
              const cat = categories[rec.type];
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

        <div className="panel">
          <div className="panel-h">
            <h3>Coming up</h3>
            <Icon.sparkle
              style={{ width: 16, height: 16, color: "var(--accent)" }}
            />
          </div>
          <div className="next-up">
            {nextFeed && (
              <div className="next-up-row">
                <div
                  className="next-up-ico"
                  style={{
                    background: `${categories.feed.tint}22`,
                    color: categories.feed.tint,
                  }}
                >
                  🍼
                </div>
                <div className="next-up-body">
                  <div className="next-up-title">Next feed</div>
                  <div className="next-up-sub">
                    based on {feedsToday}-feed cadence
                  </div>
                </div>
                <div className="next-up-when">{fmtTime(nextFeed)}</div>
              </div>
            )}
            {nextNap && (
              <div className="next-up-row">
                <div
                  className="next-up-ico"
                  style={{
                    background: `${categories.sleep.tint}22`,
                    color: categories.sleep.tint,
                  }}
                >
                  🌙
                </div>
                <div className="next-up-body">
                  <div className="next-up-title">Next nap window</div>
                  <div className="next-up-sub">~45 min wake window</div>
                </div>
                <div className="next-up-when">{fmtTime(nextNap)}</div>
              </div>
            )}
            <div className="next-up-row">
              <div
                className="next-up-ico"
                style={{
                  background: `${categories.meds.tint}22`,
                  color: categories.meds.tint,
                }}
              >
                💊
              </div>
              <div className="next-up-body">
                <div className="next-up-title">Vitamin D drops</div>
                <div className="next-up-sub">daily, around morning feed</div>
              </div>
              <div className="next-up-when">tomorrow</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
