import type { RoutineRecord } from "../types";
import { categories } from "../types";

interface Bucket {
  day: Date;
  label: string;
  feeds: number;
  ozTotal: number;
  sleepMins: number;
  diapers: number;
  playMins: number;
}

export function TrendsScreen({ records }: { records: RoutineRecord[] }) {
  const days = 7;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets: Bucket[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.push({
      day: d,
      label: d.toLocaleDateString([], { weekday: "short" }),
      feeds: 0,
      ozTotal: 0,
      sleepMins: 0,
      diapers: 0,
      playMins: 0,
    });
  }
  records.forEach((r) => {
    const dStart = new Date(r.at);
    dStart.setHours(0, 0, 0, 0);
    const idx = buckets.findIndex((b) => b.day.getTime() === dStart.getTime());
    if (idx === -1) return;
    const b = buckets[idx];
    if (r.type === "feed") {
      b.feeds++;
      b.ozTotal += (r.meta?.volume_oz as number) ?? 0;
    }
    if (r.type === "sleep") b.sleepMins += (r.meta?.mins as number) ?? 0;
    if (r.type === "diaper") b.diapers++;
    if (r.type === "play") b.playMins += (r.meta?.mins as number) ?? 0;
  });

  type Key = "feeds" | "sleepMins" | "diapers" | "playMins";
  const max = (key: Key) => Math.max(...buckets.map((b) => b[key]), 1);

  const Chart = ({
    title,
    sub,
    big,
    bigSub,
    dataKey,
    color,
    format,
  }: {
    title: string;
    sub: string;
    big: string | number;
    bigSub: string;
    dataKey: Key;
    color: string;
    format?: (v: number) => string;
  }) => {
    const m = max(dataKey);
    const W = 600;
    const H = 140;
    const pad = 8;
    const bw = (W - pad * 2) / buckets.length;
    return (
      <div className="chart-card">
        <div className="chart-hd">
          <div>
            <h3>{title}</h3>
            <div className="sub">{sub}</div>
          </div>
          <div>
            <div className="big">{big}</div>
            <div className="bigsub">{bigSub}</div>
          </div>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H + 24}`}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          {buckets.map((b, i) => {
            const v = b[dataKey];
            const h = m > 0 ? (v / m) * H : 0;
            const x = pad + i * bw;
            const isToday = i === buckets.length - 1;
            return (
              <g key={i}>
                <rect
                  x={x + 3}
                  y={H - h}
                  width={bw - 6}
                  height={h}
                  rx={4}
                  fill={color}
                  opacity={isToday ? 1 : 0.55}
                />
                <text
                  x={x + bw / 2}
                  y={H + 14}
                  fontSize="10"
                  textAnchor="middle"
                  fill="var(--ink-3)"
                >
                  {b.label}
                </text>
                {v > 0 && (
                  <text
                    x={x + bw / 2}
                    y={H - h - 4}
                    fontSize="10"
                    textAnchor="middle"
                    fill="var(--ink-2)"
                  >
                    {format ? format(v) : v}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  const todayB = buckets[buckets.length - 1];
  const avg = (key: Key) =>
    (buckets.reduce((s, b) => s + b[key], 0) / buckets.length).toFixed(1);

  return (
    <div className="content-pad">
      <Chart
        title="Sleep"
        sub="Total minutes per day"
        big={`${(todayB.sleepMins / 60).toFixed(1)}h`}
        bigSub={`avg ${(Number(avg("sleepMins")) / 60).toFixed(1)}h`}
        dataKey="sleepMins"
        color={categories.sleep.tint}
        format={(v) => `${(v / 60).toFixed(1)}h`}
      />
      <Chart
        title="Feeds"
        sub="Number of feeds per day"
        big={todayB.feeds}
        bigSub={`avg ${avg("feeds")}/day`}
        dataKey="feeds"
        color={categories.feed.tint}
      />
      <Chart
        title="Diapers"
        sub="Wet + dirty per day"
        big={todayB.diapers}
        bigSub={`avg ${avg("diapers")}/day`}
        dataKey="diapers"
        color={categories.diaper.tint}
      />
      <Chart
        title="Tummy time"
        sub="Minutes per day"
        big={`${todayB.playMins}m`}
        bigSub={`avg ${avg("playMins")}m`}
        dataKey="playMins"
        color={categories.play.tint}
        format={(v) => `${v}m`}
      />
    </div>
  );
}
