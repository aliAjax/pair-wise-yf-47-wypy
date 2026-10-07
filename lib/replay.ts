// 复盘重演引擎
// 规则：
// 1. 流水原始按上传时间排列；重演按"动作发生时刻"排序，同一时刻按上传先后（流水序）排。
// 2. 断网补传（queued）的操作，网络恢复后仍按发生时刻合并进时间线，不按补传时刻插队。
// 3. 车站状态一旦变更，基于旧状态的研判结论立即失效并重算；失效动作写明被哪条推翻，原记录保留。
// 4. 客服主管越权改车站/计划照常进入重演，但判定被拒并写明原因，不产生任何状态变更。
// 5. 对外口径按发布时刻生效，新口径覆盖其作用域内仍在执行的旧口径。
import { REPLAY_LOG, OUTAGE_START, OUTAGE_END } from "./replayLog";

export type Role = "调度员" | "车站值班员" | "公交接驳负责人" | "客服主管";
export type StationStatus = "正常" | "限流" | "封闭" | "恢复中";
export type Phase = "发现" | "响应" | "接驳" | "恢复";
export type PlanAction = "create" | "submit" | "approve" | "execute";
export type PlanStatus = "草稿" | "待确认" | "已确认" | "已执行";
export type EventType = "事件启动" | "事件关闭" | "车站状态变更" | "研判结论" | "接驳计划" | "对外口径" | "越权操作";

export interface ReplayEvent {
  id: string;
  occurredAt: string;   // 动作发生时刻
  uploadedAt: string;   // 上传/补传时刻
  actor: Role;
  type: EventType;
  detail?: string;
  phase: Phase;
  // 车站状态变更
  station?: string;
  to?: StationStatus;
  // 研判结论
  stations?: string[];
  basis?: string;
  conclusion?: string;
  // 接驳计划
  planId?: string;
  action?: PlanAction;
  approver?: Role;
  vehicles?: number;
  interval?: number;
  operator?: string;
  note?: string;
  // 对外口径
  scope?: string[];     // ["全线"] 或车站名列表
  version?: string;
  title?: string;
  content?: string;
  // 断网本地队列补传
  queued?: boolean;
  // 越权操作的本意（被拒后不生效）
  intended?: Partial<ReplayEvent>;
}

export interface PlanRuntime {
  id: string;
  stations: string[];
  vehicles: number;
  interval: number;
  operator: string;
  note: string;
  status: PlanStatus;
  approvals: Role[];
  createdAt: string;
}

export interface ConclusionState {
  eventId: string;
  stations: string[];
  conclusion: string;
  issuedAt: string;
  overturnedBy?: string; // 推翻该结论的车站状态变更流水号
}

export interface AnnouncementState {
  eventId: string;
  scope: string[];
  version: string;
  title: string;
  content: string;
  issuedAt: string;
  supersededBy?: string; // 替代该口径的新口径流水号
}

export interface RejectedState {
  eventId: string;
  reason: string;
}

export interface StationSnapshot {
  name: string;
  status: StationStatus;
  risk: "低" | "中" | "高";
  since: string;
  sinceEvent: string;
}

export interface Snapshot {
  cursor: number; // 已并入的（按发生时刻排序）事件条数
  at: string;
  online: boolean;
  incidentOpen: boolean;
  stations: StationSnapshot[];
  abnormal: StationSnapshot[];
  plans: PlanRuntime[];
  activeConclusions: ConclusionState[];
  activeAnnouncements: AnnouncementState[];
  rejected: RejectedState[];
  invalidatedHere: ConclusionState[];   // 本时刻刚失效的结论
  recomputed: string[];                // 状态变更后的系统重算结果
  mergedHere: ReplayEvent[];            // 本时刻随网络恢复合并的断网补传操作
}

export const BASELINE_STATIONS = ["滨江站", "会展中心站", "东港站"];
const RISK: Record<StationStatus, "低" | "中" | "高"> = { 封闭: "高", 限流: "中", 恢复中: "低", 正常: "低" };

// 时间戳固定为东八区记录，直接截取本地部分展示，避免运行环境时区漂移
export const fmtClock = (iso: string) => iso.slice(11, 19);
export const fmtFull = (iso: string) => `${iso.slice(5, 10)} ${fmtClock(iso)}`;
export const t = (iso: string) => new Date(iso).getTime();

/** 按发生时刻重演排序（断网补传按发生时刻归位；同刻按上传先后） */
export function orderByOccurred(events: ReplayEvent[] = REPLAY_LOG): ReplayEvent[] {
  return [...events].sort((a, b) => t(a.occurredAt) - t(b.occurredAt) || t(a.uploadedAt) - t(b.uploadedAt) || a.id.localeCompare(b.id));
}

/** 原始流水视角：按上传/补传时刻排列 */
export function orderByUploaded(events: ReplayEvent[] = REPLAY_LOG): ReplayEvent[] {
  return [...events].sort((a, b) => t(a.uploadedAt) - t(b.uploadedAt) || a.id.localeCompare(b.id));
}

const STATION_AUTHORITY: Role[] = ["车站值班员", "调度员"];
const PLAN_AUTHORITY: Role[] = ["公交接驳负责人", "调度员"];
const PLAN_APPROVERS: Role[] = ["调度员", "公交接驳负责人"];

function rejectReason(ev: ReplayEvent, plans: Map<string, PlanRuntime>): string | null {
  if (ev.type === "车站状态变更") {
    if (!STATION_AUTHORITY.includes(ev.actor)) {
      return `客服主管无权变更车站状态（车站状态仅由车站值班员/调度员发布），维持「${ev.station}」原状态`;
    }
  }
  if (ev.type === "接驳计划" && ev.action) {
    const plan = ev.planId ? plans.get(ev.planId) : undefined;
    if (ev.action === "submit" && !plan) {
      return `接驳计划 ${ev.planId} 尚未创建草稿，无计划主体可提交；且计划提交应由公交接驳负责人发起`;
    }
    if (ev.action !== "create" && ev.planId && !plan) {
      return `接驳计划 ${ev.planId} 不存在，操作无对象`;
    }
    if (ev.action === "approve") {
      if (!PLAN_APPROVERS.includes(ev.actor)) {
        const tail = plan?.status === "已执行" ? "；且该计划已执行，确认已无意义" : "";
        return `客服主管无接驳计划确认权，确认须调度员、公交接驳负责人双签${tail}`;
      }
      if (plan && (plan.status === "已确认" || plan.status === "已执行")) {
        return `计划 ${ev.planId} 已${plan.status}，无需重复确认`;
      }
    }
    if (ev.action === "execute") {
      if (!PLAN_AUTHORITY.includes(ev.actor)) {
        return `客服主管无权执行接驳计划（执行由调度员下达），且 J2 已由调度员在 L21 执行，属重复越权操作`;
      }
      if (plan && plan.status !== "已确认") {
        return `计划 ${ev.planId} 当前为「${plan.status}」，须双方确认后才能执行`;
      }
    }
    if ((ev.action === "create" || ev.action === "submit") && !PLAN_AUTHORITY.includes(ev.actor)) {
      return `客服主管无权编排/提交接驳计划`;
    }
  }
  return null;
}

interface GlobalAnnotation {
  conclusions: Map<string, ConclusionState>;
  announcements: AnnouncementState[];
  rejected: Map<string, RejectedState>;
}

/** 全量预扫：得到每条结论/口径在完整时间线上的最终命运与越权拒绝原因 */
function annotate(ordered: ReplayEvent[]): GlobalAnnotation {
  const conclusions = new Map<string, ConclusionState>();
  const announcements: AnnouncementState[] = [];
  const rejected = new Map<string, RejectedState>();
  const plans = new Map<string, PlanRuntime>();

  // 第一遍：越权判定需要计划当时状态，按发生时刻顺序走
  for (const ev of ordered) {
    if (ev.type === "越权操作") {
      rejected.set(ev.id, { eventId: ev.id, reason: rejectOverreach(ev) });
      continue;
    }
    const reason = rejectReason(ev, plans);
    if (reason) {
      rejected.set(ev.id, { eventId: ev.id, reason });
      continue;
    }
    if (ev.type === "接驳计划" && ev.action) applyPlan(plans, ev);
  }

  function rejectOverreach(ev: ReplayEvent): string {
  const aim = ev.intended ?? {};
    if (aim.type === "车站状态变更") {
      return `客服主管无权变更车站状态（仅车站值班员/调度员可发布），${aim.station} 状态不变，仍以现场发布为准`;
    }
    if (aim.type === "接驳计划" && aim.action === "approve") {
      const plan = plans.get(aim.planId ?? "");
      const tail = plan?.status === "已执行" ? "；该计划当时已执行，确认无意义" : "";
      return `客服主管无接驳计划确认权，确认须调度员、公交接驳负责人双签${tail}`;
    }
    if (aim.type === "接驳计划" && aim.action === "execute") {
      return `客服主管无权执行接驳计划（执行须调度员下达指令），计划状态不变`;
    }
    return "客服主管无该项处置权限，操作被拒，状态不变";
  }

  // 第二遍：结论登记 + 被后续车站状态变更推翻
  const stationChanges = ordered.filter((e) => e.type === "车站状态变更" && !rejected.has(e.id));
  for (const ev of ordered) {
    if (ev.type === "研判结论" && !rejected.has(ev.id) && ev.conclusion) {
      const c: ConclusionState = { eventId: ev.id, stations: ev.stations ?? [], conclusion: ev.conclusion, issuedAt: ev.occurredAt };
      const overturn = stationChanges.find((ch) =>
        t(ch.occurredAt) > t(ev.occurredAt) && (ch.station && c.stations.includes(ch.station)));
      if (overturn) c.overturnedBy = overturn.id;
      conclusions.set(ev.id, c);
    }
  }

  // 第三遍：对外口径登记 + 新口径覆盖作用域内旧口径
  for (const ev of ordered) {
    if (ev.type === "对外口径" && ev.content) {
      announcements.push({ eventId: ev.id, scope: ev.scope ?? ["全线"], version: ev.version ?? "", title: ev.title ?? "", content: ev.content, issuedAt: ev.occurredAt });
    }
  }
  for (let i = 0; i < announcements.length; i++) {
    const older = announcements[i];
    const cover = announcements.slice(i + 1).find((n) => t(n.issuedAt) > t(older.issuedAt) && covers(n.scope, older.scope));
    if (cover) older.supersededBy = cover.eventId;
  }

  return { conclusions, announcements, rejected };
}

function covers(sup: string[], sub: string[]): boolean {
  if (sup.includes("全线")) return true;
  return sub.every((s) => s === "全线" ? false : sup.includes(s));
}

function applyPlan(plans: Map<string, PlanRuntime>, ev: ReplayEvent): void {
  const id = ev.planId!;
  switch (ev.action) {
    case "create":
      plans.set(id, { id, stations: ev.stations ?? [], vehicles: ev.vehicles ?? 0, interval: ev.interval ?? 0, operator: ev.operator ?? "", note: ev.note ?? "", status: "草稿", approvals: [], createdAt: ev.occurredAt });
      break;
    case "submit": {
      const p = plans.get(id)!;
      if (p.status === "草稿") p.status = "待确认";
      break;
    }
    case "approve": {
      const p = plans.get(id)!;
      if (ev.approver && !p.approvals.includes(ev.approver)) p.approvals.push(ev.approver);
      if (PLAN_APPROVERS.every((r) => p.approvals.includes(r))) p.status = "已确认";
      break;
    }
    case "execute": {
      const p = plans.get(id)!;
      if (p.status === "已确认") p.status = "已执行";
      break;
    }
  }
}

let memo: { ordered: ReplayEvent[]; annotation: GlobalAnnotation } | null = null;
function getMemo() {
  if (!memo) {
    const ordered = orderByOccurred();
    memo = { ordered, annotation: annotate(ordered) };
  }
  return memo;
}

/** 还原某一时刻（前 cursor 条已发生事件合并后）的现场状态 */
export function snapshotAt(cursor: number): Snapshot {
  const { ordered, annotation } = getMemo();
  const applied = ordered.slice(0, cursor);
  const last = applied[applied.length - 1];

  // —— 车站状态：以该时刻前最后一条生效的状态变更为准 ——
  const statusMap = new Map<string, { status: StationStatus; at: string; by: string }>();
  for (const name of BASELINE_STATIONS) statusMap.set(name, { status: "正常", at: "2026-09-29T09:12:00+08:00", by: "L00" });
  for (const ev of applied) {
    if (ev.type === "车站状态变更" && !annotation.rejected.has(ev.id) && ev.station && ev.to) {
      statusMap.set(ev.station, { status: ev.to, at: ev.occurredAt, by: ev.id });
    }
  }
  const stations: StationSnapshot[] = BASELINE_STATIONS.map((name) => {
    const s = statusMap.get(name)!;
    return { name, status: s.status, risk: RISK[s.status], since: s.at, sinceEvent: s.by };
  });
  const abnormal = stations.filter((s) => s.status !== "正常");

  // —— 接驳计划：重放到该时刻 ——
  const plans = new Map<string, PlanRuntime>();
  for (const ev of applied) {
    if (ev.type === "接驳计划" && ev.action && !annotation.rejected.has(ev.id)) applyPlan(plans, ev);
  }

  // —— 研判结论 / 口径：截至该时刻仍有效 ——
  const activeConclusions = [...annotation.conclusions.values()]
    .filter((c) => t(c.issuedAt) <= (last ? t(last.occurredAt) : -1))
    .filter((c) => !c.overturnedBy || t(ordered.find((e) => e.id === c.overturnedBy)!.occurredAt) > t(last.occurredAt));

  const activeAnnouncements = annotation.announcements
    .filter((a) => t(a.issuedAt) <= (last ? t(last.occurredAt) : -1))
    .filter((a) => !a.supersededBy || t(ordered.find((e) => e.id === a.supersededBy)!.occurredAt) > t(last.occurredAt));

  const rejected = [...annotation.rejected.values()].filter((r) => {
    const ev = ordered.find((e) => e.id === r.eventId)!;
    return last && t(ev.occurredAt) <= t(last.occurredAt);
  });

  // 本时刻刚被推翻的结论
  const invalidatedHere = last
    ? [...annotation.conclusions.values()].filter((c) => c.overturnedBy === last.id)
    : [];

  // 系统重算（车站状态一变即重算，不写入原始流水）
  const recomputed: string[] = [];
  if (last?.type === "车站状态变更" && !annotation.rejected.has(last.id)) {
    recomputed.push(`受影响车站 ${abnormal.length} 座（${abnormal.map((s) => `${s.name}·${s.status}·滞留风险${s.risk}`).join("；") || "无"}）`);
    for (const c of invalidatedHere) {
      recomputed.push(`结论 ${c.eventId} 依据的车站状态已变，自动重算并标记失效（被 ${c.overturnedBy} 推翻）`);
    }
    const running = [...plans.values()].filter((p) => p.status === "已执行").map((p) => p.id);
    recomputed.push(`在跑接驳：${running.length ? running.join("、") : "暂无"}；现场滞留风险按最新车站状态重新核定`);
  }

  // 断网补传：网络恢复后第一条在线动作处，本地队列按发生时刻一次性归并
  const queuedApplied = applied.filter((e) => e.queued);
  const firstOnlineAfterOutage = ordered.find((e) => !e.queued && t(e.occurredAt) >= t(OUTAGE_END));
  const mergedHere = last && firstOnlineAfterOutage && last.id === firstOnlineAfterOutage.id ? queuedApplied : [];

  const at = last ? last.occurredAt : ordered[0].occurredAt;
  const online = t(at) < t(OUTAGE_START) || t(at) >= t(OUTAGE_END);
  const incidentOpen = !applied.some((e) => e.type === "事件关闭");

  return { cursor, at, online, incidentOpen, stations, abnormal, plans: [...plans.values()], activeConclusions, activeAnnouncements, rejected, invalidatedHere, recomputed, mergedHere };
}

export type EventFate = "future" | "rejected" | "conclusion-active" | "conclusion-dead" | "announcement-active" | "announcement-superseded" | "applied";

/** 某条流水在指定时刻的重演状态（用于流水表逐行标注） */
export function fateAt(ev: ReplayEvent, cursor: number): { fate: EventFate; by?: string; reason?: string } {
  const { ordered, annotation } = getMemo();
  const idx = ordered.findIndex((e) => e.id === ev.id);
  const current = ordered[Math.min(Math.max(cursor - 1, 0), ordered.length - 1)];
  if (!current || idx >= cursor) return { fate: "future" };
  const nowTs = t(current.occurredAt);

  const rej = annotation.rejected.get(ev.id);
  if (rej) return { fate: "rejected", reason: rej.reason };
  if (ev.type === "研判结论") {
    const c = annotation.conclusions.get(ev.id)!;
    if (c.overturnedBy && t(ordered.find((e) => e.id === c.overturnedBy)!.occurredAt) <= nowTs) {
      return { fate: "conclusion-dead", by: c.overturnedBy };
    }
    return { fate: "conclusion-active" };
  }
  if (ev.type === "对外口径") {
    const a = annotation.announcements.find((x) => x.eventId === ev.id)!;
    if (a.supersededBy && t(ordered.find((e) => e.id === a.supersededBy)!.occurredAt) <= nowTs) {
      return { fate: "announcement-superseded", by: a.supersededBy };
    }
    return { fate: "announcement-active" };
  }
  return { fate: "applied" };
}

export function getOrdered() {
  return getMemo().ordered;
}
