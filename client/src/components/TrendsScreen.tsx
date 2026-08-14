import { useState } from "react";
import {
  aggregateLocalDays,
  type AggregateBucket,
} from "@babyone/contracts";
import type { RoutineRecord } from "../types";
import { categories } from "../types";

type RangeDays = 7 | 14 | 30;
type MetricKey = "feeds" | "sleepMins" | "diapers" | "playMins";

interface Metric {
  key: MetricKey;
  title: string;
  subtitle: string;
  emptyText: string;
  color: string;
  format: (value: number) => string;
  formatAverage: (value: number) => string;
}

const ranges: RangeDays[] = [7, 14, 30];
const count = (value: number, singular: string) =>
  `${value} ${value === 1 ? singular : `${singular}s`}`;

const metrics: Metric[] = [
  {
    key: "sleepMins",
    title: "Sleep",
    subtitle: "Total sleep logged each day",
    emptyText: "No sleep logged in this range.",
    color: categories.sleep.tint,
    format: (value) => `${(value / 60).toFixed(1)} hr`,
    formatAverage: (value) => `${(value / 60).toFixed(1)} hr/day`,
  },
  {
    key: "feeds",
    title: "Feeds",
    subtitle: "Number of feeds logged each day",
    emptyText: "No feeds logged in this range.",
    color: categories.feed.tint,
    format: (value) => count(value, "feed"),
    formatAverage: (value) => `${value.toFixed(1)}/day`,
  },
  {
    key: "diapers",
    title: "Diapers",
    subtitle: "Wet and dirty diapers logged each day",
    emptyText: "No diapers logged in this range.",
    color: categories.diaper.tint,
    format: (value) => count(value, "diaper"),
    formatAverage: (value) => `${value.toFixed(1)}/day`,
  },
  {
    key: "playMins",
    title: "Tummy time",
    subtitle: "Minutes of tummy time logged each day",
    emptyText: "No tummy time logged in this range.",
    color: categories.play.tint,
    format: (value) => `${value} min`,
    formatAverage: (value) => `${value.toFixed(1)} min/day`,
  },
];

function formatDate(date: Date, options: Intl.DateTimeFormatOptions) {
  return date.toLocaleDateString([], options);
}

function dateRangeLabel(buckets: AggregateBucket[]) {
  const first = buckets[0]!.start;
  const last = buckets[buckets.length - 1]!.start;
  const firstLabel = formatDate(first, { month: "short", day: "numeric" });
  const lastLabel = formatDate(last, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${firstLabel} – ${lastLabel}`;
}

function dateLabel(date: Date) {
  return formatDate(date, { month: "short", day: "numeric" });
}

function fullDateLabel(date: Date) {
  return formatDate(date, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function MetricChart({
  buckets,
  metric,
}: {
  buckets: AggregateBucket[];
  metric: Metric;
}) {
  const values = buckets.map((bucket) => bucket[metric.key]);
  const total = values.reduce((sum, value) => sum + value, 0);
  const dailyAverage = total / buckets.length;
  const today = values[values.length - 1]!;
  const peakIndex = values.reduce(
    (best, value, index) => (value > values[best]! ? index : best),
    0,
  );
  const peak = buckets[peakIndex]!;
  const max = Math.max(...values, 1);
  const width = 600;
  const height = 140;
  const padding = 8;
  const barWidth = (width - padding * 2) / buckets.length;
  const headingId = `trend-${metric.key}-heading`;

  return (
    <section className="chart-card" aria-labelledby={headingId}>
      <div className="chart-hd">
        <div>
          <h3 id={headingId}>{metric.title}</h3>
          <div className="sub">{metric.subtitle}</div>
        </div>
        <div className="trend-today">
          <span>Today</span>
          <div className="big">{metric.format(today)}</div>
        </div>
      </div>

      <dl className="trend-stats">
        <div>
          <dt>Daily average</dt>
          <dd>{metric.formatAverage(dailyAverage)}</dd>
        </div>
        <div>
          <dt>Range total</dt>
          <dd>{metric.format(total)}</dd>
        </div>
        {total > 0 && (
          <div>
            <dt>Highest day</dt>
            <dd>
              {dateLabel(peak.start)} · {metric.format(peak[metric.key])}
            </dd>
          </div>
        )}
      </dl>

      {total === 0 ? (
        <div className="trend-metric-empty">{metric.emptyText}</div>
      ) : (
        <>
          <svg
            className="trend-chart"
            viewBox={`0 0 ${width} ${height + 28}`}
            aria-hidden="true"
            focusable="false"
          >
            {buckets.map((bucket, index) => {
              const value = bucket[metric.key];
              const barHeight = (value / max) * height;
              const x = padding + index * barWidth;
              const isToday = index === buckets.length - 1;
              const showLabel =
                buckets.length === 7 ||
                index === buckets.length - 1 ||
                index % (buckets.length === 14 ? 2 : 5) === 0;
              return (
                <g key={bucket.start.toISOString()}>
                  <title>{`${fullDateLabel(bucket.start)}: ${metric.format(value)}`}</title>
                  <rect
                    x={x + 3}
                    y={height - barHeight}
                    width={Math.max(barWidth - 6, 2)}
                    height={barHeight}
                    rx={4}
                    fill={metric.color}
                    opacity={isToday ? 1 : 0.55}
                  />
                  {showLabel && (
                    <text
                      x={x + barWidth / 2}
                      y={height + 17}
                      fontSize="10"
                      textAnchor="middle"
                      fill="var(--ink-3)"
                    >
                      {dateLabel(bucket.start)}
                    </text>
                  )}
                  {value > 0 && buckets.length === 7 && (
                    <text
                      x={x + barWidth / 2}
                      y={Math.max(height - barHeight - 5, 10)}
                      fontSize="10"
                      textAnchor="middle"
                      fill="var(--ink-2)"
                    >
                      {metric.format(value)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <table className="sr-only">
            <caption>{metric.title} daily values</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.start.toISOString()}>
                  <th scope="row">{fullDateLabel(bucket.start)}</th>
                  <td>{metric.format(bucket[metric.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function TrendsScreen({ records }: { records: RoutineRecord[] }) {
  const [days, setDays] = useState<RangeDays>(7);
  const buckets = aggregateLocalDays(records, days);
  const totalRecords = buckets.reduce(
    (sum, bucket) => sum + bucket.totalRecords,
    0,
  );
  const activeDays = buckets.filter((bucket) => bucket.totalRecords > 0).length;

  return (
    <div className="content-pad trends-screen">
      <div className="trends-controls">
        <div>
          <h2>Explore routines</h2>
          <p>Compare daily patterns across a recent window.</p>
        </div>
        <div className="chart-tabs" role="group" aria-label="Trend range">
          {ranges.map((range) => (
            <button
              key={range}
              type="button"
              className={`chart-tab ${days === range ? "active" : ""}`}
              aria-pressed={days === range}
              onClick={() => setDays(range)}
            >
              {range} days
            </button>
          ))}
        </div>
      </div>

      <section
        className="trends-overview"
        aria-labelledby="trends-summary-heading"
        aria-live="polite"
      >
        <div>
          <h3 id="trends-summary-heading">{days}-day summary</h3>
          <p>{dateRangeLabel(buckets)}</p>
        </div>
        <dl>
          <div>
            <dt>Activity logs</dt>
            <dd>{totalRecords}</dd>
          </div>
          <div>
            <dt>Active days</dt>
            <dd>
              {activeDays} of {days}
            </dd>
          </div>
        </dl>
      </section>

      {totalRecords === 0 ? (
        <section className="trends-empty" role="status">
          <h3>No activity in the last {days} days</h3>
          <p>
            {days < 30
              ? "Try a longer range to find earlier routines."
              : "New logs will appear here as daily patterns take shape."}
          </p>
        </section>
      ) : (
        <div className="trends-grid">
          {metrics.map((metric) => (
            <MetricChart key={metric.key} buckets={buckets} metric={metric} />
          ))}
        </div>
      )}
    </div>
  );
}
