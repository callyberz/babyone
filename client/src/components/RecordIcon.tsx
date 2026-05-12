import type { RecordType } from "../types";
import { categories } from "../types";

export function RecordIcon({
  type,
  size = 36,
}: {
  type: RecordType;
  size?: number;
}) {
  const cat = categories[type];
  return (
    <div
      className="record-icon"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: "var(--bg)",
        boxShadow: `inset 0 0 0 1px ${cat.tint}33`,
      }}
    >
      <span>{cat.icon}</span>
    </div>
  );
}
