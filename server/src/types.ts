export * from "@babyone/contracts";

import type { RoutineRecord } from "@babyone/contracts";

export interface ParseResult {
  replyText: string;
  created: RoutineRecord[];
  updated: RoutineRecord[];
  deleted: number[];
}
