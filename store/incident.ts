import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "调度员" | "车站值班员" | "公交接驳负责人" | "客服主管";
export type IncidentStatus = "处置中" | "控制中" | "已恢复";
export type StationStatus = "正常" | "限流" | "封闭" | "恢复中";
export type PlanStatus = "草稿" | "待确认" | "已确认" | "已执行";
export type Phase = "发现" | "响应" | "接驳" | "恢复";

/**
 * 处置流水事件类型。流水按“发生时刻”重演，是复盘时的权威记录；
 * 实时视图（stations/plans/messages）只是缓存，对不上时以流水为准。
 */
export type EventKind =
  | "station.status"
  | "plan.create"
  | "plan.submit"
  | "plan.approve"
  | "plan.execute"
  | "message.publish"
  | "action.rejected"
  | "timeline.note";

export interface FlowEvent {
  id: string;
  /** 发生时刻（动作实际发生的时间） */
  time: string;
  /** 上传时刻（补传操作网络恢复后入库的时间），仅补传事件有值 */
  recordedAt?: string;
  actor: Role;
  kind: EventKind;
  action: string;
  detail: string;
  phase: Phase;
  payload: Record<string, any>;
  /** applied=已生效并入库；rejected=越权被拒，仅留痕不改变状态 */
  result: "applied" | "rejected";
  /** 被拒原因（越权操作时填写） */
  reason?: string;
}

export interface Station {
  id: string;
  name: string;
  section: string;
  status: StationStatus;
  passengerRisk: "低" | "中" | "高";
  note: string;
  updatedAt: string;
}

export interface ShuttlePlan {
  id: string;
  stations: string[];
  vehicles: number;
  interval: number;
  operator: string;
  status: PlanStatus;
  approvals: string[];
  note: string;
}

/** 对外口径（客服主管统一发布） */
export interface Message {
  id: string;
  time: string;
  topic: string;
  stationName?: string;
  title: string;
  content: string;
  actor: Role;
}

interface PublishMessageInput {
  topic: string;
  stationName?: string;
  title: string;
  content: string;
}

interface IncidentState {
  incident: { id: string; title: string; status: IncidentStatus; startedAt: string; section: string };
  stations: Station[];
  /** 处置流水（权威），按发生时刻升序存放 */
  timeline: FlowEvent[];
  plans: ShuttlePlan[];
  messages: Message[];
  role: Role;
  online: boolean;
  /** 弱网期间积压的本地事件，网络恢复后按发生时刻合并进流水 */
  pendingActions: FlowEvent[];
  setRole: (role: Role) => void;
  setOnline: (online: boolean) => void;
  setStationStatus: (id: string, status: StationStatus, note?: string) => void;
  addTimeline: (entry: { actor?: Role; action: string; detail: string; phase: Phase; kind?: EventKind; payload?: Record<string, any> }) => void;
  addPlan: (plan: Omit<ShuttlePlan, "id" | "status" | "approvals">) => void;
  submitPlan: (id: string) => void;
  approvePlan: (id: string, approver: Role) => void;
  executePlan: (id: string) => void;
  publishMessage: (input: PublishMessageInput) => void;
  syncActions: () => void;
}

const now = () => new Date().toISOString();
const startedAt = new Date(Date.now() - 35 * 60000).toISOString();

export const seedStations: Station[] = [
  { id: "s1", name: "滨江站", section: "中心-滨江", status: "封闭", passengerRisk: "高", note: "滨江站双向入口封闭并组织乘客出站", updatedAt: startedAt },
  { id: "s2", name: "会展中心站", section: "会展-滨江", status: "限流", passengerRisk: "中", note: "出入口单向组织", updatedAt: startedAt },
  { id: "s3", name: "东港站", section: "滨江-东港", status: "正常", passengerRisk: "低", note: "做好接班车准备", updatedAt: startedAt }
];

export const seedPlans: ShuttlePlan[] = [
  { id: "p1", stations: ["滨江站", "会展中心站"], vehicles: 8, interval: 6, operator: "东城公交", status: "待确认", approvals: ["调度员"], note: "优先疏运站外滞留乘客" }
];

export const seedMessages: Message[] = [
  { id: "m1", time: new Date(Date.now() - 37 * 60000).toISOString(), topic: "运营状态", stationName: "滨江站", title: "滨江站运营正常", content: "滨江站区段运营正常，列车按图行车。", actor: "调度员" }
];

/** 复盘重演的初始种子状态 */
export const replaySeed = { stations: seedStations, plans: seedPlans, messages: seedMessages };

export const useIncidentStore = create<IncidentState>()(persist((set, get) => {
  /** 记录一条流水事件：在线直接入库，弱网进本地队列待补传 */
  const record = (partial: { kind: EventKind; action: string; detail: string; phase: Phase; payload: Record<string, any>; result?: "applied" | "rejected"; reason?: string; time?: string }) => {
    const state = get();
    const event: FlowEvent = {
      id: crypto.randomUUID(),
      time: partial.time ?? now(),
      actor: state.role,
      kind: partial.kind,
      action: partial.action,
      detail: partial.detail,
      phase: partial.phase,
      payload: partial.payload,
      result: partial.result ?? "applied",
      reason: partial.reason
    };
    if (state.online) {
      set({ timeline: [...state.timeline, event] });
    } else {
      set({ pendingActions: [event, ...state.pendingActions] });
    }
    return event;
  };

  return {
    incident: { id: "INC-20260929-03", title: "滨江站区间积水停运", status: "处置中", startedAt, section: "中心站—东港站" },
    stations: seedStations,
    timeline: [
      { id: "m1", time: new Date(Date.now() - 37 * 60000).toISOString(), actor: "调度员", kind: "message.publish", action: "发布对外口径", detail: "运营状态：滨江站运营正常", phase: "发现", payload: seedMessages[0], result: "applied" },
      { id: "e1", time: startedAt, actor: "调度员", kind: "timeline.note", action: "启动事件", detail: "监测到滨江站区间水位超限，暂停双向行车", phase: "发现", payload: {}, result: "applied" },
      { id: "e2", time: new Date(Date.now() - 27 * 60000).toISOString(), actor: "车站值班员", kind: "station.status", action: "封闭车站", detail: "滨江站 → 封闭", phase: "响应", payload: { stationId: "s1", stationName: "滨江站", status: "封闭", note: "滨江站双向入口封闭并组织乘客出站" }, result: "applied" }
    ],
    plans: seedPlans,
    messages: seedMessages,
    role: "调度员",
    online: true,
    pendingActions: [],
    setRole: (role) => set({ role }),
    setOnline: (online) => set({ online }),
    setStationStatus: (id, status, note) => {
      const state = get();
      if (state.role === "客服主管") {
        const target = state.stations.find((item) => item.id === id);
        record({ kind: "action.rejected", action: "拒绝车站状态变更", detail: `客服主管越权将${target?.name ?? id}改为${status}，已留痕但不生效`, phase: status === "恢复中" ? "恢复" : "响应", payload: { attempted: "station.status", stationId: id, stationName: target?.name, status }, result: "rejected", reason: "客服主管无车站状态变更权限，车站状态由车站值班员或调度员处置" });
        return;
      }
      set((s) => ({ stations: s.stations.map((station) => station.id === id ? { ...station, status, note: note ?? station.note, updatedAt: now() } : station) }));
      const target = get().stations.find((item) => item.id === id);
      record({ kind: "station.status", action: "更新车站状态", detail: `${target?.name ?? id} → ${status}`, phase: status === "正常" || status === "恢复中" ? "恢复" : "响应", payload: { stationId: id, stationName: target?.name, status, note: note ?? target?.note } });
    },
    addTimeline: (entry) => record({ kind: entry.kind ?? "timeline.note", action: entry.action, detail: entry.detail, phase: entry.phase, payload: entry.payload ?? {} }),
    addPlan: (plan) => {
      const newPlan: ShuttlePlan = { ...plan, id: crypto.randomUUID(), status: "草稿", approvals: [] };
      set((s) => ({ plans: [newPlan, ...s.plans] }));
      record({ kind: "plan.create", action: "创建接驳计划", detail: `${newPlan.stations.join(" → ")}，${newPlan.vehicles} 辆`, phase: "接驳", payload: { plan: newPlan } });
    },
    submitPlan: (id) => {
      set((s) => ({ plans: s.plans.map((plan) => plan.id === id ? { ...plan, status: "待确认" } : plan) }));
      record({ kind: "plan.submit", action: "提交接驳计划", detail: `接驳计划 ${id.slice(0, 6)} 已提交，等待跨岗位确认`, phase: "接驳", payload: { planId: id } });
    },
    approvePlan: (id, approver) => {
      const state = get();
      if (state.role === "客服主管") {
        record({ kind: "action.rejected", action: "拒绝接驳计划确认", detail: `客服主管越权确认接驳计划 ${id.slice(0, 6)}，已留痕但不生效`, phase: "接驳", payload: { attempted: "plan.approve", planId: id, approver: state.role }, result: "rejected", reason: "客服主管无接驳计划确认权限，需调度员与公交接驳负责人双方确认" });
        return;
      }
      set((s) => ({ plans: s.plans.map((plan) => {
        if (plan.id !== id) return plan;
        const approvals = Array.from(new Set([...plan.approvals, approver]));
        return { ...plan, approvals, status: approvals.length >= 2 ? "已确认" : "待确认" };
      }) }));
      record({ kind: "plan.approve", action: "确认接驳计划", detail: `${approver} 确认接驳计划 ${id.slice(0, 6)}`, phase: "接驳", payload: { planId: id, approver } });
    },
    executePlan: (id) => {
      const state = get();
      if (state.role === "客服主管") {
        record({ kind: "action.rejected", action: "拒绝接驳计划执行", detail: `客服主管越权执行接驳计划 ${id.slice(0, 6)}，已留痕但不生效`, phase: "接驳", payload: { attempted: "plan.execute", planId: id }, result: "rejected", reason: "客服主管无接驳计划执行权限" });
        return;
      }
      set((s) => ({ plans: s.plans.map((plan) => plan.id === id ? { ...plan, status: "已执行" } : plan) }));
      record({ kind: "plan.execute", action: "执行接驳计划", detail: `接驳计划 ${id.slice(0, 6)} 已下发执行`, phase: "接驳", payload: { planId: id } });
    },
    publishMessage: (input) => {
      const state = get();
      if (state.role !== "客服主管" && state.role !== "调度员") {
        record({ kind: "action.rejected", action: "拒绝对外口径发布", detail: `${state.role} 越权发布对外口径，已留痕但不生效`, phase: "响应", payload: { attempted: "message.publish", ...input }, result: "rejected", reason: "对外口径由客服主管统一发布" });
        return;
      }
      const message: Message = { id: crypto.randomUUID(), time: now(), actor: state.role, ...input };
      set((s) => ({ messages: [message, ...s.messages] }));
      record({ kind: "message.publish", action: "发布对外口径", detail: `${input.topic}：${input.title}`, phase: "响应", payload: message });
    },
    syncActions: () => set((state) => {
      const uploadedAt = now();
      const uploaded = state.pendingActions.map((event) => ({ ...event, recordedAt: uploadedAt }));
      const timeline = [...state.timeline, ...uploaded].sort((a, b) => a.time.localeCompare(b.time));
      return { timeline, pendingActions: [] };
    })
  };
}, { name: "pair-wise-yf-47/incident" }));
