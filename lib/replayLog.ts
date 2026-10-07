// 停运处置复盘流水（原始记录，按"上传时间"排列）
// 断网期间本地缓存的操作，uploadedAt（上传时刻）晚于 occurredAt（动作发生时刻），
// 网络恢复后才补传到协同工作台。原记录一律保留，不删除、不改写。
import type { ReplayEvent } from "./replay";

export const REPLAY_LOG: ReplayEvent[] = [
  { id: "L01", occurredAt: "2026-09-29T09:12:00+08:00", uploadedAt: "2026-09-29T09:12:10+08:00", actor: "调度员", type: "事件启动", detail: "监测到滨江站区间水位超限，中心站—东港站上下行暂停行车，启动突发停运应急响应", phase: "发现" },
  { id: "L02", occurredAt: "2026-09-29T09:14:00+08:00", uploadedAt: "2026-09-29T09:14:20+08:00", actor: "车站值班员", type: "车站状态变更", station: "滨江站", to: "封闭", detail: "滨江站双向入口封闭，广播引导站内乘客出站", phase: "响应" },
  { id: "L03", occurredAt: "2026-09-29T09:16:00+08:00", uploadedAt: "2026-09-29T09:16:30+08:00", actor: "调度员", type: "研判结论", stations: ["滨江站"], basis: "L02", conclusion: "滨江站封闭、站内清客，站外滞留风险高，立即组织公交接驳疏运", phase: "响应" },
  { id: "L04", occurredAt: "2026-09-29T09:19:00+08:00", uploadedAt: "2026-09-29T09:19:40+08:00", actor: "公交接驳负责人", type: "接驳计划", planId: "J1", action: "create", stations: ["滨江站", "会展中心站"], vehicles: 8, interval: 6, operator: "东城公交", note: "优先疏运站外滞留乘客", detail: "草拟接驳计划 J1：滨江站⇄会展中心站，8 辆车、间隔 6 分钟，东城公交承运", phase: "接驳" },
  { id: "L05", occurredAt: "2026-09-29T09:21:00+08:00", uploadedAt: "2026-09-29T09:21:30+08:00", actor: "公交接驳负责人", type: "接驳计划", planId: "J1", action: "submit", detail: "提交 J1 进入跨岗位确认，需调度员与公交接驳负责人双方确认", phase: "接驳" },
  { id: "L06", occurredAt: "2026-09-29T09:23:00+08:00", uploadedAt: "2026-09-29T09:23:20+08:00", actor: "调度员", type: "接驳计划", planId: "J1", action: "approve", approver: "调度员", detail: "调度员确认 J1（1/2）", phase: "接驳" },
  { id: "L07", occurredAt: "2026-09-29T09:25:00+08:00", uploadedAt: "2026-09-29T09:25:40+08:00", actor: "车站值班员", type: "车站状态变更", station: "会展中心站", to: "限流", detail: "会展中心站出入口单向限流，控制进站人数", phase: "响应" },
  { id: "L08", occurredAt: "2026-09-29T09:26:00+08:00", uploadedAt: "2026-09-29T09:26:20+08:00", actor: "调度员", type: "研判结论", stations: ["滨江站", "会展中心站"], basis: "L07", conclusion: "两站均处于异常状态，会展中心站限流后站外排队增长，滞留风险中高", phase: "响应" },
  { id: "L09", occurredAt: "2026-09-29T09:28:00+08:00", uploadedAt: "2026-09-29T09:28:30+08:00", actor: "客服主管", type: "越权操作", detail: "在协同台直接将滨江站状态由「封闭」改为「限流」", intended: { type: "车站状态变更", station: "滨江站", to: "限流" }, phase: "响应" },
  { id: "L10", occurredAt: "2026-09-29T09:29:00+08:00", uploadedAt: "2026-09-29T09:29:20+08:00", actor: "客服主管", type: "对外口径", scope: ["滨江站"], version: "口径①", title: "运营信息（9:29）", content: "受区间积水影响，滨江站封闭，列车双向停运，会展中心站限流；公交接驳正在安排，请乘客改乘地面交通", phase: "响应" },
  { id: "L11", occurredAt: "2026-09-29T09:32:00+08:00", uploadedAt: "2026-09-29T09:32:20+08:00", actor: "公交接驳负责人", type: "接驳计划", planId: "J1", action: "approve", approver: "公交接驳负责人", detail: "公交接驳负责人确认 J1（2/2），J1 跨岗位确认完成", phase: "接驳" },
  { id: "L12", occurredAt: "2026-09-29T09:36:00+08:00", uploadedAt: "2026-09-29T09:36:30+08:00", actor: "调度员", type: "接驳计划", planId: "J1", action: "execute", detail: "J1 执行：车辆与站点岗位收到调度指令，滨江站⇄会展中心站穿梭巴士上线", phase: "接驳" },
  // —— 09:40 起区间基站中断，协同台进入弱网/断网降级，以下操作先入本地队列 ——
  { id: "L13", occurredAt: "2026-09-29T09:42:00+08:00", uploadedAt: "2026-09-29T09:54:20+08:00", actor: "车站值班员", type: "车站状态变更", station: "东港站", to: "限流", queued: true, detail: "东港站出站客流积压，启动限流（断网，本地队列缓存）", phase: "响应" },
  { id: "L14", occurredAt: "2026-09-29T09:44:00+08:00", uploadedAt: "2026-09-29T09:54:40+08:00", actor: "调度员", type: "研判结论", stations: ["东港站"], basis: "L13", queued: true, conclusion: "东港站限流，到站客流受停运影响持续积压，滞留风险中", phase: "响应" },
  { id: "L15", occurredAt: "2026-09-29T09:47:00+08:00", uploadedAt: "2026-09-29T09:55:00+08:00", actor: "公交接驳负责人", type: "接驳计划", planId: "J2", action: "create", stations: ["会展中心站", "东港站"], vehicles: 6, interval: 8, operator: "东城公交", queued: true, note: "向东延伸接驳东港站", detail: "草拟接驳计划 J2：会展中心站⇄东港站，6 辆车、间隔 8 分钟（断网，本地离线起草）", phase: "接驳" },
  { id: "L16", occurredAt: "2026-09-29T09:48:00+08:00", uploadedAt: "2026-09-29T09:55:10+08:00", actor: "客服主管", type: "越权操作", queued: true, detail: "在断网站点客户端直接将 J1 确认为「已确认」（当时 J1 已执行，且客服无确认权限）", intended: { type: "接驳计划", planId: "J1", action: "approve", approver: "客服主管" }, phase: "接驳" },
  { id: "L17", occurredAt: "2026-09-29T09:51:00+08:00", uploadedAt: "2026-09-29T09:51:30+08:00", actor: "客服主管", type: "对外口径", scope: ["滨江站", "会展中心站"], version: "口径②", title: "运营信息（9:51）", content: "公交接驳已开通：滨江站⇄会展中心站，约 6 分钟一班；两站乘客请至站外接驳点候车", phase: "接驳" },
  { id: "L18", occurredAt: "2026-09-29T09:52:00+08:00", uploadedAt: "2026-09-29T09:55:30+08:00", actor: "公交接驳负责人", type: "接驳计划", planId: "J2", action: "submit", queued: true, detail: "提交 J2 进入跨岗位确认（断网，本地队列缓存）", phase: "接驳" },
  // —— 09:52 网络恢复，本地队列按发生时刻补传合并 ——
  { id: "L19", occurredAt: "2026-09-29T09:56:00+08:00", uploadedAt: "2026-09-29T09:56:20+08:00", actor: "调度员", type: "接驳计划", planId: "J2", action: "approve", approver: "调度员", detail: "调度员确认 J2（1/2）", phase: "接驳" },
  { id: "L20", occurredAt: "2026-09-29T09:58:00+08:00", uploadedAt: "2026-09-29T09:58:20+08:00", actor: "公交接驳负责人", type: "接驳计划", planId: "J2", action: "approve", approver: "公交接驳负责人", detail: "公交接驳负责人确认 J2（2/2），J2 跨岗位确认完成", phase: "接驳" },
  { id: "L21", occurredAt: "2026-09-29T10:02:00+08:00", uploadedAt: "2026-09-29T10:02:20+08:00", actor: "调度员", type: "接驳计划", planId: "J2", action: "execute", detail: "J2 执行：会展中心站⇄东港站穿梭巴士上线", phase: "接驳" },
  { id: "L22", occurredAt: "2026-09-29T10:06:00+08:00", uploadedAt: "2026-09-29T10:06:20+08:00", actor: "车站值班员", type: "车站状态变更", station: "滨江站", to: "恢复中", detail: "区间水位回落，滨江站转入恢复中，开始行车前设备检查", phase: "恢复" },
  { id: "L23", occurredAt: "2026-09-29T10:07:00+08:00", uploadedAt: "2026-09-29T10:07:20+08:00", actor: "客服主管", type: "对外口径", scope: ["滨江站"], version: "口径③", title: "运营信息（10:07）", content: "滨江站区间水位回落，正在检查设备，暂未恢复乘车；接驳巴士维持运行", phase: "恢复" },
  { id: "L24", occurredAt: "2026-09-29T10:10:00+08:00", uploadedAt: "2026-09-29T10:10:20+08:00", actor: "客服主管", type: "越权操作", detail: "跳过跨岗位确认，直接在协同台把 J2 状态点为「已执行」", intended: { type: "接驳计划", planId: "J2", action: "execute" }, phase: "接驳" },
  { id: "L25", occurredAt: "2026-09-29T10:14:00+08:00", uploadedAt: "2026-09-29T10:14:20+08:00", actor: "车站值班员", type: "车站状态变更", station: "会展中心站", to: "恢复中", detail: "会展中心站解除限流，转入恢复中组织进站", phase: "恢复" },
  { id: "L26", occurredAt: "2026-09-29T10:16:00+08:00", uploadedAt: "2026-09-29T10:16:20+08:00", actor: "调度员", type: "接驳计划", planId: "J3", action: "submit", detail: "对尚未创建的 J3 直接点提交（系统中无此计划草稿）", phase: "接驳" },
  { id: "L27", occurredAt: "2026-09-29T10:18:00+08:00", uploadedAt: "2026-09-29T10:18:20+08:00", actor: "车站值班员", type: "车站状态变更", station: "东港站", to: "正常", detail: "东港站客流恢复正常，解除限流", phase: "恢复" },
  { id: "L28", occurredAt: "2026-09-29T10:21:00+08:00", uploadedAt: "2026-09-29T10:21:20+08:00", actor: "客服主管", type: "对外口径", scope: ["东港站"], version: "口径④", title: "运营信息（10:21）", content: "东港站已恢复正常运营，会展中心站方向接驳维持", phase: "恢复" },
  { id: "L29", occurredAt: "2026-09-29T10:25:00+08:00", uploadedAt: "2026-09-29T10:25:20+08:00", actor: "车站值班员", type: "车站状态变更", station: "会展中心站", to: "正常", detail: "会展中心站检查完毕，恢复正常运营", phase: "恢复" },
  { id: "L30", occurredAt: "2026-09-29T10:30:00+08:00", uploadedAt: "2026-09-29T10:30:20+08:00", actor: "车站值班员", type: "车站状态变更", station: "滨江站", to: "正常", detail: "滨江站设备复检通过，恢复正常运营，上下行逐步恢复行车", phase: "恢复" },
  { id: "L31", occurredAt: "2026-09-29T10:33:00+08:00", uploadedAt: "2026-09-29T10:33:20+08:00", actor: "客服主管", type: "对外口径", scope: ["滨江站"], version: "口径⑤", title: "运营信息（10:33）", content: "滨江站已恢复运营，全线车站恢复正常；接驳巴士将于 11:00 收班", phase: "恢复" },
  { id: "L32", occurredAt: "2026-09-29T10:37:00+08:00", uploadedAt: "2026-09-29T10:37:20+08:00", actor: "调度员", type: "事件关闭", detail: "全线恢复行车，接驳转入收尾，突发停运事件关闭，转入复盘", phase: "恢复" },
  { id: "L33", occurredAt: "2026-09-29T10:40:00+08:00", uploadedAt: "2026-09-29T10:40:20+08:00", actor: "客服主管", type: "对外口径", scope: ["全线"], version: "口径⑥", title: "恢复运营通告（10:40）", content: "中心站—东港站区间积水已排除，全线恢复正常运营，感谢乘客配合", phase: "恢复" },
  { id: "L34", occurredAt: "2026-09-29T10:45:00+08:00", uploadedAt: "2026-09-29T10:45:20+08:00", actor: "调度员", type: "研判结论", stations: ["滨江站", "会展中心站", "东港站"], basis: "L30", conclusion: "三站全部恢复正常、事件已关闭，本次停运处置结束，无遗留滞留风险", phase: "恢复" }
];

// 断网窗口：动作已发生但协同台收不到，恢复后批量补传
export const OUTAGE_START = "2026-09-29T09:40:00+08:00";
export const OUTAGE_END = "2026-09-29T09:53:00+08:00";
