"use client";

import { useEffect, useMemo, useState } from "react";
import { App as AntApp, Badge, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Select, Segmented, Slider, Space, Statistic, Table, Tag, Timeline } from "antd";
import { format } from "date-fns";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ColumnsType } from "antd/es/table";
import { fetchStations } from "../lib/query";
import { replay } from "../lib/replay";
import { MapPanel } from "../components/MapPanel";
import { replaySeed, useIncidentStore, type FlowEvent, type Role, type ShuttlePlan, type Station, type StationStatus } from "../store/incident";

const planSchema = z.object({ stations: z.array(z.string()).min(1, "至少选择两个接驳站"), vehicles: z.number().min(1).max(80), interval: z.number().min(2).max(30), operator: z.string().min(2), note: z.string().min(2) });
type PlanForm = z.infer<typeof planSchema>;

function Dashboard() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const state = useIncidentStore();
  const { data: cachedStations } = useQuery({ queryKey: ["stations"], queryFn: fetchStations, enabled: state.online });
  const [modalOpen, setModalOpen] = useState(false);
  const [panel, setPanel] = useState<string>("总览");
  const { control, handleSubmit, reset, formState: { errors } } = useForm<PlanForm>({ defaultValues: { stations: ["滨江站", "会展中心站"], vehicles: 8, interval: 6, operator: "东城公交", note: "优先疏运站外滞留乘客" } });

  useEffect(() => { if (!state.online) queryClient.cancelQueries({ queryKey: ["stations"] }); }, [state.online, queryClient]);

  const stationColumns: ColumnsType<Station> = [
    { title: "车站", dataIndex: "name" },
    { title: "区段", dataIndex: "section" },
    { title: "状态", dataIndex: "status", render: (value: StationStatus) => <Tag color={value === "封闭" ? "red" : value === "限流" ? "orange" : value === "恢复中" ? "blue" : "green"}>{value}</Tag> },
    { title: "滞留风险", dataIndex: "passengerRisk", render: (value) => <Badge status={value === "高" ? "error" : value === "中" ? "warning" : "success"} text={value} /> },
    { title: "现场说明", dataIndex: "note" },
    { title: "更新时间", dataIndex: "updatedAt", render: (value: string) => format(new Date(value), "HH:mm:ss") },
    { title: "处置", render: (_, record) => <Space><Button size="small" onClick={() => state.setStationStatus(record.id, "限流")}>限流</Button><Button size="small" danger={record.status !== "封闭"} onClick={() => state.setStationStatus(record.id, record.status === "封闭" ? "恢复中" : "封闭")}>{record.status === "封闭" ? "恢复中" : "封闭"}</Button></Space> }
  ];

  const submitPlan = (values: PlanForm) => { const parsed = planSchema.safeParse(values); if (!parsed.success) return; state.addPlan(parsed.data); setModalOpen(false); reset(); };

  // 复盘重演：以处置流水为权威，按发生时刻还原现场
  const [replayAtMs, setReplayAtMs] = useState<number | null>(null);
  const [msgTopic, setMsgTopic] = useState("运营状态");
  const [msgStation, setMsgStation] = useState<string | undefined>("滨江站");
  const [msgTitle, setMsgTitle] = useState("");
  const [msgContent, setMsgContent] = useState("");

  const eventTimes = state.timeline.map((event) => new Date(event.time).getTime());
  const minMs = eventTimes.length ? Math.min(...eventTimes) : Date.now() - 35 * 60000;
  const maxMs = eventTimes.length ? Math.max(...eventTimes) : Date.now();
  const effectiveAtMs = replayAtMs ?? maxMs;
  const atIso = new Date(effectiveAtMs).toISOString();
  const replayResult = useMemo(() => replay(state.timeline, atIso, replaySeed), [state.timeline, atIso]);
  const eventById = useMemo(() => new Map(state.timeline.map((event) => [event.id, event])), [state.timeline]);
  const flowEvents = state.timeline
    .filter((event) => event.time <= atIso)
    .sort((a, b) => a.time.localeCompare(b.time));
  const replayMarks = useMemo(() => {
    const marks: Record<number, string> = {};
    state.timeline.forEach((event) => { marks[new Date(event.time).getTime()] = format(new Date(event.time), "HH:mm"); });
    return marks;
  }, [state.timeline]);

  const publishMessage = () => {
    if (!msgTitle.trim() || !msgContent.trim()) return;
    state.publishMessage({ topic: msgTopic, stationName: msgTopic === "运营状态" ? msgStation : undefined, title: msgTitle.trim(), content: msgContent.trim() });
    setMsgTitle(""); setMsgContent("");
  };

  return <div className="shell">
    <aside className="side">
      <div className="brand"><b>RAIL OPS</b><span>应急协同</span></div>
      <nav>{["总览", "事件时间线", "接驳计划", "确认中心", "复盘重演"].map((item) => <button className={panel === item ? "active" : ""} key={item} onClick={() => setPanel(item)}>{item}</button>)}</nav>
      <div className="side-status"><small>系统连接</small><b className={state.online ? "ok" : "warn"}>{state.online ? "在线" : "弱网降级"}</b><span>最近缓存 32 秒前</span></div>
    </aside>
    <main>
      <header><div><small>{state.incident.id} · 启动于 {format(new Date(state.incident.startedAt), "HH:mm")}</small><h1>{t("title")}</h1><p>{t("subtitle")}</p></div><Space><Segmented value={state.online} onChange={(value) => state.setOnline(Boolean(value))} options={[{ label: "在线", value: true }, { label: "弱网", value: false }]} /><Select<Role> value={state.role} onChange={state.setRole} options={["调度员", "车站值班员", "公交接驳负责人", "客服主管"].map((value) => ({ value: value as Role, label: `角色：${value}` }))} /></Space></header>
      <section className="metrics"><Card><Statistic title="事件状态" value={state.incident.status} /></Card><Card><Statistic title="受影响车站" value={state.stations.filter((item) => item.status !== "正常").length} suffix="座" /></Card><Card><Statistic title="待确认计划" value={state.plans.filter((item) => item.status === "待确认").length} /></Card><Card><Statistic title="待同步操作" value={state.pendingActions.length} /></Card></section>
      {!state.online && <div className="degrade">当前处于弱网降级模式，显示最近缓存数据。关键处置会进入本地队列，恢复连接后需人工确认提交。</div>}
      {panel === "总览" && <section className="overview">
        <Card title={t("stations")} className="wide"><Table rowKey="id" dataSource={state.online && cachedStations?.length ? cachedStations : state.stations} columns={stationColumns} pagination={false} size="small" scroll={{ x: 760 }} /></Card>
        <Card title="受影响区段" className="map-card"><MapPanel stations={state.stations} plans={state.plans.filter((plan) => plan.status !== "草稿")} /></Card>
      </section>}
      {panel === "事件时间线" && <Card title="处置时间线" extra={<Space><Select value="响应" options={[{value:"响应"},{value:"接驳"},{value:"恢复"}]} /><Button type="primary" onClick={() => state.addTimeline({ actor: state.role, action: "更新处置", detail: "现场处置信息已同步至协同工作台", phase: "响应" })}>添加处置记录</Button></Space>}><div className="timeline-grid"><Timeline items={state.timeline.map((item) => ({ color: item.phase === "恢复" ? "green" : item.phase === "接驳" ? "blue" : "red", children: <div><b>{item.action}</b><Tag>{item.actor}</Tag><p>{item.detail}</p><small>{format(new Date(item.time), "MM-DD HH:mm:ss")} · {item.phase}</small></div> }))} /><Card size="small" title="处置检查"><p>车站封闭与广播口径已确认。</p><p>接驳车辆到场后需调度员和公交负责人双方确认。</p><p>恢复行车前检查区间水位和站台安全。</p></Card></div></Card>}
      {panel === "接驳计划" && <Card title="公交接驳计划" extra={<Button type="primary" disabled={state.role !== "公交接驳负责人" && state.role !== "调度员"} onClick={() => setModalOpen(true)}>新建计划</Button>}><Table rowKey="id" pagination={false} dataSource={state.plans} columns={[{title:"接驳站",dataIndex:"stations",render:(v:string[])=>v.join(" → ")},{title:"车辆",dataIndex:"vehicles"},{title:"间隔",dataIndex:"interval",render:(v:number)=>`${v} 分钟`},{title:"运营方",dataIndex:"operator"},{title:"确认",dataIndex:"approvals",render:(v:string[])=>v.length? v.map((x)=><Tag key={x} color="green">{x}</Tag>) : <Tag>未确认</Tag>},{title:"状态",dataIndex:"status",render:(v)=> <Tag color={v==="已确认"||v==="已执行"?"green":v==="待确认"?"orange":"default"}>{v}</Tag>},{title:"操作",render:(_,record:ShuttlePlan)=><Space><Button size="small" disabled={record.status!=="草稿"} onClick={()=>state.submitPlan(record.id)}>提交确认</Button><Button size="small" disabled={record.status!=="待确认"} onClick={()=>state.approvePlan(record.id,state.role)}>确认</Button><Button size="small" type="primary" disabled={record.status!=="已确认"} onClick={()=>state.executePlan(record.id)}>执行</Button></Space>}]} /></Card>}
      {panel === "确认中心" && <Card title="跨岗位确认中心"><Timeline items={state.plans.map((plan) => ({ children: <div className="approval"><b>{plan.stations.join(" → ")}</b><Tag>{plan.status}</Tag><p>{plan.vehicles} 辆，间隔 {plan.interval} 分钟，{plan.note}</p><small>已确认：{plan.approvals.join("、") || "暂无"}</small></div> }))} /><Button disabled={state.online || !state.pendingActions.length} onClick={state.syncActions}>人工确认并同步本地队列</Button></Card>}
      {panel === "复盘重演" && <Card title="复盘重演" extra={<Space><Tag color="blue">以处置流水为准</Tag><Button size="small" onClick={() => setReplayAtMs(null)}>回到最新</Button></Space>}>
        <div className="replay-scrub">
          <Slider min={minMs} max={maxMs} step={1000} value={effectiveAtMs} onChange={setReplayAtMs} marks={replayMarks} tooltip={{ formatter: (value) => value == null ? "" : format(new Date(value), "MM-DD HH:mm:ss") }} />
          <div className="replay-at">重演时刻：<b>{format(new Date(effectiveAtMs), "MM-DD HH:mm:ss")}</b>{replayAtMs === null && <Tag color="green">最新</Tag>}<span className="replay-hint">断网补传的操作在网络恢复后按发生时刻合并入库；重演与实时视图对不上以流水为准。</span></div>
        </div>
        <div className="replay-grid">
          <Card size="small" title="车站状态（重演）">
            <Table rowKey="id" size="small" pagination={false} dataSource={replayResult.stations} columns={[
              { title: "车站", dataIndex: "name" },
              { title: "区段", dataIndex: "section" },
              { title: "状态", dataIndex: "status", render: (value: StationStatus) => <Tag color={value === "封闭" ? "red" : value === "限流" ? "orange" : value === "恢复中" ? "blue" : "green"}>{value}</Tag> },
              { title: "滞留风险", dataIndex: "passengerRisk", render: (value) => <Badge status={value === "高" ? "error" : value === "中" ? "warning" : "success"} text={value} /> },
              { title: "现场说明", dataIndex: "note" }
            ]} />
          </Card>
          <Card size="small" title="接驳计划确认进度（重演）">
            <Table rowKey="id" size="small" pagination={false} dataSource={replayResult.plans} columns={[
              { title: "接驳站", dataIndex: "stations", render: (v: string[]) => v.join(" → ") },
              { title: "车辆", dataIndex: "vehicles" },
              { title: "确认进度", dataIndex: "approvals", render: (v: string[]) => v.length ? v.map((x) => <Tag key={x} color="green">{x}</Tag>) : <Tag>未确认</Tag> },
              { title: "状态", dataIndex: "status", render: (v) => <Tag color={v === "已确认" || v === "已执行" ? "green" : v === "待确认" ? "orange" : "default"}>{v}</Tag> }
            ]} />
          </Card>
          <Card size="small" title="对外口径（重演）" extra={state.role === "客服主管" || state.role === "调度员" ? <Tag color="gold">可发布</Tag> : <Tag>仅客服主管发布</Tag>}>
            <div className="msg-list">
              {replayResult.messages.length === 0 && <p className="replay-empty">暂无对外口径</p>}
              {replayResult.messages.map((message) => {
                const invalidBy = replayResult.invalid.get(message.id);
                return <div key={message.id} className={`msg-item${invalidBy ? "invalid" : ""}`}>
                  <div className="msg-head"><Tag>{message.topic}</Tag>{message.stationName && <Tag color="blue">{message.stationName}</Tag>}{invalidBy ? <Tag color="orange">已失效 · 被「{eventById.get(invalidBy)?.action ?? invalidBy}」推翻</Tag> : <Tag color="green">有效</Tag>}<small>{message.actor} · {format(new Date(message.time), "MM-DD HH:mm:ss")}</small></div>
                  <b>{message.title}</b>
                  <p>{message.content}</p>
                </div>;
              })}
            </div>
            {(state.role === "客服主管" || state.role === "调度员") && <div className="msg-composer">
              <Space wrap>
                <Select value={msgTopic} onChange={setMsgTopic} style={{ width: 120 }} options={["运营状态", "接驳安排", "客流引导"].map((value) => ({ value, label: value }))} />
                {msgTopic === "运营状态" && <Select value={msgStation} onChange={setMsgStation} style={{ width: 120 }} options={state.stations.map((s) => ({ value: s.name, label: s.name }))} />}
                <Input value={msgTitle} onChange={(e) => setMsgTitle(e.target.value)} placeholder="口径标题" style={{ width: 160 }} />
                <Input value={msgContent} onChange={(e) => setMsgContent(e.target.value)} placeholder="对外口径内容" style={{ width: 260 }} />
                <Button type="primary" onClick={publishMessage}>发布</Button>
              </Space>
            </div>}
          </Card>
        </div>
        <Card size="small" title="处置流水（权威记录 · 按发生时刻重演）" className="flow-card">
          <Table rowKey="id" size="small" pagination={false} dataSource={flowEvents} columns={[
            { title: "发生时刻", dataIndex: "time", width: 150, render: (value: string) => format(new Date(value), "MM-DD HH:mm:ss") },
            { title: "上传时刻", width: 170, render: (_, record: FlowEvent) => record.recordedAt ? <Space><Tag color="blue">补传</Tag><small>{format(new Date(record.recordedAt), "HH:mm:ss")}</small></Space> : <small className="replay-hint">实时</small> },
            { title: "岗位", dataIndex: "actor", width: 110 },
            { title: "动作", render: (_, record: FlowEvent) => <div><b>{record.action}</b><p className="flow-detail">{record.detail}</p></div> },
            { title: "结果 / 备注", width: 280, render: (_, record: FlowEvent) => {
              if (record.result === "rejected") return <div><Tag color="red">已拒绝</Tag><p className="flow-reason">{record.reason}</p></div>;
              if (record.kind === "message.publish" && replayResult.invalid.has(record.payload.id)) {
                const by = replayResult.invalid.get(record.payload.id)!;
                return <Tag color="orange">已失效 · 被「{eventById.get(by)?.action ?? by}」推翻</Tag>;
              }
              return <Tag color="green">已记录</Tag>;
            } }
          ]} />
        </Card>
      </Card>}
    </main>
    <Modal title="新建接驳计划" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={handleSubmit(submitPlan)} okText="保存草稿"><Form layout="vertical"><Form.Item label="接驳站" validateStatus={errors.stations ? "error" : ""} help={errors.stations?.message}><Controller name="stations" control={control} render={({ field }) => <Select mode="multiple" {...field} options={state.stations.map((item) => ({ value: item.name, label: item.name }))} />} /></Form.Item><Space><Form.Item label="车辆数"><Controller name="vehicles" control={control} render={({ field }) => <InputNumber {...field} min={1} />} /></Form.Item><Form.Item label="发车间隔"><Controller name="interval" control={control} render={({ field }) => <InputNumber {...field} min={2} addonAfter="分钟" />} /></Form.Item></Space><Form.Item label="运营方"><Controller name="operator" control={control} render={({ field }) => <Input {...field} />} /></Form.Item><Form.Item label="计划说明"><Controller name="note" control={control} render={({ field }) => <Input.TextArea {...field} />} /></Form.Item></Form></Modal>
  </div>;
}

export default function Page() { return <AntApp><Dashboard /></AntApp>; }
