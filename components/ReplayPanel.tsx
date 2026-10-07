"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Segmented, Slider, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PauseCircleOutlined, PlayCircleOutlined } from "@ant-design/icons";
import {
  orderByOccurred, orderByUploaded, snapshotAt, fateAt, fmtClock, fmtFull, t,
  type ReplayEvent, type StationSnapshot, type PlanRuntime
} from "../lib/replay";
import { useIncidentStore } from "../store/incident";

const { Text, Paragraph } = Typography;

const statusColor: Record<string, string> = { 封闭: "red", 限流: "orange", 恢复中: "blue", 正常: "green" };
const riskStatus = { 高: "error", 中: "warning", 低: "success" } as const;
const planColor: Record<string, string> = { 草稿: "default", 待确认: "orange", 已确认: "blue", 已执行: "green" };
const phaseColor: Record<string, string> = { 发现: "red", 响应: "volcano", 接驳: "blue", 恢复: "green" };

export function ReplayPanel() {
  const occurred = useMemo(() => orderByOccurred(), []);
  const uploaded = useMemo(() => orderByUploaded(), []);
  const uploadRank = useMemo(() => new Map<string, number>(uploaded.map((e, i) => [e.id, i + 1])), [uploaded]);
  const total = occurred.length;

  const [cursor, setCursor] = useState(total);
  const [playing, setPlaying] = useState(false);
  const [order, setOrder] = useState<"occurred" | "uploaded">("occurred");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setCursor((c) => {
        if (c >= total) { setPlaying(false); return c; }
        return c + 1;
      });
    }, 1500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, total]);

  const snap = useMemo(() => snapshotAt(cursor), [cursor]);
  const current = occurred[cursor - 1];
  const rows = order === "occurred" ? occurred : uploaded;
  const live = useIncidentStore();

  // 重演视图与实时工作台视图对不上时：以处置流水（重演结果）为准
  const liveStationDiverge = cursor === total && (
    live.stations.some((s) => snap.stations.find((x) => x.name === s.name)?.status !== s.status)
  );
  const liveDiverge = liveStationDiverge;

  const sliderMarks: Record<number, { label: string; style?: React.CSSProperties }> = {
    0: { label: "处置前" },
    [total]: { label: "10:45 收尾" }
  };
  for (const ev of occurred) {
    const i = occurred.indexOf(ev) + 1;
    if (ev.type === "事件启动" || ev.type === "事件关闭") sliderMarks[i] = { label: fmtClock(ev.occurredAt) };
  }

  return <div className="replay">
    <Alert className="replay-note" type="info" showIcon
      message="复盘重演：一切以处置流水为准"
      description="按动作【发生时刻】重演；断网期间本地队列操作在网络恢复后按发生时刻合并，不按补传时刻插队。车站状态一变，旧研判结论立即失效重算；客服主管越权改车站/计划照常重演但判定被拒。重演视图与实时工作台对不上时，以本流水重演结果为准。" />

    <Card size="small" className="replay-controls">
      <Space size="large" wrap align="center">
        <Button icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />} type={playing ? "default" : "primary"}
          onClick={() => { if (cursor >= total) setCursor(0); setPlaying(!playing); }}>
          {playing ? "暂停重演" : cursor === 0 || cursor === total ? "从头重演" : "继续重演"}
        </Button>
        <Button disabled={cursor === total} onClick={() => { setPlaying(false); setCursor(total); }}>跳到收尾时刻</Button>
        <div className="clock-readout">
          <b>{fmtFull(snap.at)}</b>
          <Tag color={snap.online ? "green" : "red"}>{snap.online ? "网络在线" : "断网降级 · 操作入本地队列"}</Tag>
          <Tag color={snap.incidentOpen ? "volcano" : "default"}>{snap.incidentOpen ? "事件处置中" : "事件已关闭"}</Tag>
          <Text type="secondary">已并入 {cursor}/{total} 条发生动作</Text>
        </div>
      </Space>
      <Slider min={0} max={total} value={cursor} onChange={(v) => { setPlaying(false); setCursor(v); }} marks={sliderMarks}
        tooltip={{ formatter: (v) => v && v > 0 ? `${occurred[v - 1].id} · ${fmtClock(occurred[v - 1].occurredAt)}` : "处置前" }} />
    </Card>

    {snap.mergedHere.length > 0 && (
      <Alert className="replay-note" type="success" showIcon
        message={`网络恢复，本地队列 ${snap.mergedHere.length} 条断网操作已按发生时刻合并`}
        description={<Space wrap>{snap.mergedHere.map((e) => <Tag key={e.id} color="cyan">{e.id} · {fmtClock(e.occurredAt)} 发生 / {fmtClock(e.uploadedAt)} 补传</Tag>)}</Space>} />
    )}

    {liveDiverge && (
      <Alert className="replay-note" type="warning" showIcon
        message="重演结果与实时工作台视图不一致，以处置流水为准"
        description="实时工作台（缓存/越权改动残留）显示的车站或计划状态，与流水重演最终状态不符；复盘结论一律采用右侧重演结果，实时视图数据应按流水校正。" />
    )}

    <section className="replay-metrics">
      <Card size="small"><Statistic title="事件状态" value={snap.incidentOpen ? "处置中" : "已关闭"} /></Card>
      <Card size="small"><Statistic title="异常车站" value={snap.abnormal.length} suffix="座" /></Card>
      <Card size="small"><Statistic title="执行中接驳" value={snap.plans.filter((p) => p.status === "已执行").length} suffix="个" /></Card>
      <Card size="small"><Statistic title="有效口径 / 失效与被拒" value={`${snap.activeAnnouncements.length} / ${snap.rejected.length + total - cursor}`} /></Card>
    </section>

    <section className="replay-grid">
      <Card size="small" title="车站状态（该时刻还原）">
        <Space direction="vertical" style={{ width: "100%" }}>
          {snap.stations.map((s) => <StationRow key={s.name} s={s} dim={false} />)}
        </Space>
      </Card>

      <Card size="small" title="接驳计划确认进度">
        {snap.plans.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无接驳计划" /> : (
          <Space direction="vertical" style={{ width: "100%" }}>
            {snap.plans.map((p) => <PlanRow key={p.id} p={p} />)}
          </Space>
        )}
      </Card>
    </section>

    {snap.invalidatedHere.length > 0 && (
      <Alert className="replay-note" type="error" showIcon
        message={`车站状态变更（${current?.id}）：${snap.invalidatedHere.length} 条旧研判结论失效，已按新状态重算`}
        description={<Space direction="vertical" style={{ width: "100%" }}>
          {snap.invalidatedHere.map((c) => <Text key={c.eventId}>结论 {c.eventId}「{c.conclusion}」<Tag color="red">失效</Tag>被 <b>{c.overturnedBy}</b> 推翻，原记录保留</Text>)}
          {snap.recomputed.map((r, i) => <Text key={i} type="secondary">↳ 系统重算：{r}</Text>)}
        </Space>} />
    )}

    <section className="replay-grid">
      <Card size="small" title="对外口径（截至该时刻仍在执行）">
        {snap.activeAnnouncements.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未发布对外口径" /> : (
          <Space direction="vertical" style={{ width: "100%" }}>
            {snap.activeAnnouncements.map((a) => (
              <div key={a.eventId} className="voice-card">
                <Space wrap><Tag color="purple">{a.version}</Tag><b>{a.title}</b>
                  <Text type="secondary">{fmtClock(a.issuedAt)} · {a.eventId}</Text>
                  <Tag>{a.scope.includes("全线") ? "全线" : a.scope.join("、")}</Tag></Space>
                <Paragraph style={{ margin: "6px 0 0" }}>{a.content}</Paragraph>
              </div>
            ))}
          </Space>
        )}
      </Card>

      <Card size="small" title="有效研判结论（旧结论失效留痕）">
        <Space direction="vertical" style={{ width: "100%" }}>
          {snap.activeConclusions.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无有效结论" />}
          {snap.activeConclusions.map((c) => (
            <div key={c.eventId} className="conclusion-card">
              <Space wrap><Tag color="green">有效</Tag><b>{c.eventId}</b><Text type="secondary">{fmtClock(c.issuedAt)}</Text>
                <Tag>{c.stations.join("、")}</Tag></Space>
              <Paragraph style={{ margin: "6px 0 0" }}>{c.conclusion}</Paragraph>
            </div>
          ))}
          {snap.rejected.length > 0 && (
            <div className="reject-box">
              <b>越权 / 无效操作（照常重演、被拒留痕）</b>
              {snap.rejected.map((r) => {
                const ev = occurred.find((e) => e.id === r.eventId)!;
                return <div key={r.eventId} className="reject-row">
                  <Tag color="red">被拒</Tag><b>{r.eventId}</b><Text type="secondary"> {ev.actor} · {fmtClock(ev.occurredAt)}</Text>
                  <div>{ev.detail}</div>
                  <Text type="danger">拒绝原因：{r.reason}</Text>
                </div>;
              })}
            </div>
          )}
        </Space>
      </Card>
    </section>

    <Card size="small" title="处置流水重演（原记录一律保留；灰行为尚未发生）"
      extra={<Segmented value={order} onChange={(v) => setOrder(v as typeof order)}
        options={[{ label: "按发生时刻", value: "occurred" }, { label: "按上传时间（原始流水）", value: "uploaded" }]} />}>
      <Table<ReplayEvent> rowKey="id" size="small" pagination={false} dataSource={rows}
        rowClassName={(ev) => {
          if (order === "occurred") {
            const idx = occurred.findIndex((e) => e.id === ev.id) + 1;
            return idx > cursor ? "future-row" : "";
          }
          return t(ev.occurredAt) > t(current?.occurredAt ?? "") ? "future-row" : "";
        }}
        columns={columns(cursor, uploadRank, occurred)}
        onRow={(ev) => ({ onClick: () => { if (order === "occurred") { setPlaying(false); setCursor(occurred.findIndex((e) => e.id === ev.id) + 1); } } })} />
      {order === "uploaded" && <Text type="secondary"><br />注：断网补传记录（L13–L16、L18）在原始流水中排在 09:54 之后，但重演时按发生时刻回到 09:42–09:52 的位置。</Text>}
    </Card>
  </div>;
}

function StationRow({ s, dim }: { s: StationSnapshot; dim: boolean }) {
  return <div className={`station-row ${dim ? "dim" : ""}`}>
    <Space style={{ justifyContent: "space-between", width: "100%" }}>
      <b>{s.name}</b>
      <Space>
        <Tag color={statusColor[s.status]}>{s.status}</Tag>
        <Badge status={riskStatus[s.risk]} text={`滞留风险${s.risk}`} />
      </Space>
    </Space>
    <small>自 {fmtClock(s.since)}（{s.sinceEvent === "L00" ? "处置前基线" : s.sinceEvent}）起未再变更</small>
  </div>;
}

function PlanRow({ p }: { p: PlanRuntime }) {
  const need: Array<"调度员" | "公交接驳负责人"> = ["调度员", "公交接驳负责人"];
  return <div className="plan-row">
    <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
      <b>{p.id}</b>
      <Tag color={planColor[p.status]}>{p.status}</Tag>
    </Space>
    <div>{p.stations.join(" → ")} · {p.vehicles} 辆 · 间隔 {p.interval} 分钟 · {p.operator}</div>
    <small>{p.note}</small>
    <Space wrap style={{ marginTop: 4 }}>
      {need.map((r) => <Tag key={r} color={p.approvals.includes(r) ? "green" : "default"}>
        {p.approvals.includes(r) ? "✓" : "○"} {r}
      </Tag>)}
    </Space>
  </div>;
}

function columns(cursor: number, uploadRank: Map<string, number>, occurred: ReplayEvent[]): ColumnsType<ReplayEvent> {
  return [
    {
      title: "序", dataIndex: "id", width: 70, render: (id: string, _ev, i) => {
        const occIdx = occurred.findIndex((e) => e.id === id) + 1;
        const upIdx = uploadRank.get(id)!;
        return <Space direction="vertical" size={0}><b>#{occIdx}</b>
          <Tooltip title="该记录在原始（按上传时间）流水中的位置"><Text type="secondary" style={{ fontSize: 11 }}>传#{upIdx}{occIdx !== upIdx && <Tag color="cyan" style={{ marginInlineStart: 2, fontSize: 10 }}>补传错位</Tag>}</Text></Tooltip>
        </Space>;
      }
    },
    {
      title: "发生时刻", dataIndex: "occurredAt", width: 150,
      render: (v: string, ev) => <Space direction="vertical" size={0}><b>{fmtFull(v)}</b>
        <Text type="secondary" style={{ fontSize: 11 }}>上传 {fmtClock(ev.uploadedAt)}{ev.queued && <Tag color="cyan" style={{ marginInlineStart: 2 }}>断网补传</Tag>}</Text></Space>
    },
    { title: "岗位", dataIndex: "actor", width: 110, render: (v: string) => <Tag>{v}</Tag> },
    {
      title: "动作 / 重演结论", width: 430, render: (_, ev) => {
        const f = fateAt(ev, cursor);
        return <div className="log-cell">
          <Space wrap size={4}>
            <Tag color={phaseColor[ev.phase]}>{ev.type}</Tag>
            {ev.planId && <Tag color="geekblue">{ev.planId}{ev.action ? `·${ev.action}` : ""}</Tag>}
            {ev.station && <Tag>{ev.station}{ev.to ? `→${ev.to}` : ""}</Tag>}
            {ev.version && <Tag color="purple">{ev.version}</Tag>}
            {f.fate === "rejected" && <Tag color="red">越权被拒</Tag>}
            {f.fate === "conclusion-dead" && <Tag color="red">结论失效 · 被 {f.by} 推翻</Tag>}
            {f.fate === "conclusion-active" && <Tag color="green">结论有效</Tag>}
            {f.fate === "announcement-superseded" && <Tag color="orange">口径已被 {f.by} 覆盖</Tag>}
            {f.fate === "announcement-active" && <Tag color="green">口径执行中</Tag>}
            {f.fate === "applied" && (ev.type === "车站状态变更" || ev.type === "接驳计划" || ev.type === "事件启动" || ev.type === "事件关闭") && <Tag color="blue">已生效</Tag>}
          </Space>
          <div className="log-detail">{ev.detail}</div>
          {ev.conclusion && <div className="log-detail">研判：{ev.conclusion}</div>}
          {ev.content && <div className="log-detail">口径：{ev.content}</div>}
          {f.fate === "rejected" && <Text type="danger" style={{ fontSize: 12 }}>↳ {f.reason}</Text>}
          {f.fate === "future" && <Text type="secondary" style={{ fontSize: 12 }}>（该时刻之后发生，重演至此不可见）</Text>}
        </div>;
      }
    }
  ];
}
