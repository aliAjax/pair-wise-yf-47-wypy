import type { FlowEvent, Message, ShuttlePlan, Station, StationStatus } from "../store/incident";

export interface ReplaySeed {
  stations: Station[];
  plans: ShuttlePlan[];
  messages: Message[];
}

export interface ReplayResult {
  stations: Station[];
  plans: ShuttlePlan[];
  messages: Message[];
  /** 失效口径：message.publish 事件 id -> 推翻它的事件 id */
  invalid: Map<string, string>;
}

const cloneStation = (s: Station): Station => ({ ...s });
const clonePlan = (p: ShuttlePlan): ShuttlePlan => ({ ...p, approvals: [...p.approvals] });

/**
 * 按发生时刻重演流水，还原截至 at 时刻的车站状态、接驳计划确认进度与对外口径。
 * 流水是权威记录：弱网补传事件已按发生时刻插入，被拒事件不改变状态，
 * 车站状态一变，旧的运营口径即失效并重算，原记录照旧保留。
 */
export function replay(events: FlowEvent[], at: string, seed: ReplaySeed): ReplayResult {
  const stations = seed.stations.map(cloneStation);
  const plans = seed.plans.map(clonePlan);
  const messages: Message[] = [];
  const invalid = new Map<string, string>();

  const ordered = events
    .filter((event) => event.time <= at)
    .sort((a, b) => a.time.localeCompare(b.time));

  for (const event of ordered) {
    if (event.result === "rejected") continue;
    switch (event.kind) {
      case "station.status": {
        const payload = event.payload as { stationId?: string; stationName?: string; status: StationStatus; note?: string };
        const idx = stations.findIndex((s) => s.id === payload.stationId || s.name === payload.stationName);
        if (idx >= 0) {
          stations[idx] = { ...stations[idx], status: payload.status, note: payload.note ?? stations[idx].note, updatedAt: event.time };
          // 车站状态一变，旧的运营状态口径失效，记录被哪条推翻
          for (const message of messages) {
            if (message.topic === "运营状态" && !invalid.has(message.id)) {
              if (!message.stationName || message.stationName === payload.stationName) {
                invalid.set(message.id, event.id);
              }
            }
          }
        }
        break;
      }
      case "plan.create": {
        const plan = (event.payload as { plan: ShuttlePlan }).plan;
        plans.push(clonePlan(plan));
        break;
      }
      case "plan.submit": {
        const plan = plans.find((item) => item.id === (event.payload as { planId: string }).planId);
        if (plan) plan.status = "待确认";
        break;
      }
      case "plan.approve": {
        const payload = event.payload as { planId: string; approver: string };
        const plan = plans.find((item) => item.id === payload.planId);
        if (plan) {
          if (!plan.approvals.includes(payload.approver)) plan.approvals.push(payload.approver);
          plan.status = plan.approvals.length >= 2 ? "已确认" : "待确认";
        }
        break;
      }
      case "plan.execute": {
        const plan = plans.find((item) => item.id === (event.payload as { planId: string }).planId);
        if (plan) plan.status = "已执行";
        break;
      }
      case "message.publish": {
        const message = event.payload as Message;
        // 同主题口径迭代，旧口径失效并标注推翻来源
        for (const prev of messages) {
          if (prev.topic === message.topic && !invalid.has(prev.id)) invalid.set(prev.id, event.id);
        }
        messages.push({ ...message });
        break;
      }
      case "timeline.note":
      case "action.rejected":
        break;
    }
  }

  return { stations, plans, messages, invalid };
}
