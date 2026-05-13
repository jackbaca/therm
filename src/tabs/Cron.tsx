import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useGateway } from "../context/gateway";
import { useListKeys, useFollow } from "../keys";
import { useTheme } from "../theme";
import { useDialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { openConfirm } from "../dialogs/confirm";
import { TabShell } from "../ui/shell";
import { HintBar } from "../ui/hint";
import { KVBlock } from "../ui/kv";
import { Col, Hdr, VBAR } from "../ui/table";
import { openTextPrompt } from "../dialogs/text-prompt";
import { ago, until } from "../ui/fmt";
import { readCronOutput, type CronOutput } from "../service/hermes-home";

type CronJob = {
  id: string
  name: string
  prompt: string
  schedule: string
  enabled: boolean
  state: string
  deliver: string
  repeat?: string
  last_run?: string
  next_run?: string
  last_status?: "ok" | "error"
  last_error?: string
  paused_reason?: string
  model?: string
  skills?: string[]
  workdir?: string
  script?: string
}

type RawJob = {
  job_id?: string
  id?: string
  name?: string
  prompt_preview?: string
  prompt?: string
  schedule?: string
  enabled?: boolean
  state?: string
  deliver?: string
  repeat?: string
  last_run_at?: string
  next_run_at?: string
  last_status?: string
  last_delivery_error?: string
  paused_reason?: string
  model?: string
  skills?: string[]
  workdir?: string
  script?: string
}

const normalize = (j: RawJob): CronJob => ({
  id: j.job_id ?? j.id ?? "",
  name: j.name ?? "",
  prompt: j.prompt ?? j.prompt_preview ?? "",
  schedule: j.schedule ?? "",
  enabled: j.enabled ?? true,
  state: j.state ?? "scheduled",
  deliver: j.deliver ?? "local",
  repeat: j.repeat,
  last_run: j.last_run_at,
  next_run: j.next_run_at,
  last_status: j.last_status === "ok" || j.last_status === "error" ? j.last_status : undefined,
  last_error: j.last_delivery_error,
  paused_reason: j.paused_reason,
  model: j.model,
  skills: j.skills,
  workdir: j.workdir,
  script: j.script,
})

// gateway returns ISO timestamps; shared `ago`/`until` want unix seconds
const sec = (iso?: string) => iso ? new Date(iso).getTime() / 1000 : null
const last = (iso?: string) => { const t = sec(iso); return t ? ago(t) : "—" }
const next = (iso?: string) => { const t = sec(iso); return t ? until(t) : "—" }

const JobRow = memo((props: {
  id: string;
  job: CronJob;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) => {
  const theme = useTheme().theme;
  const j = props.job;
  const bg = props.selected ? theme.backgroundElement : undefined;
  // ●/○ encodes enabled; color encodes last-run outcome.
  const glyph = j.enabled ? "●" : "○";
  const glyphColor = !j.enabled ? theme.textMuted
    : j.last_status === "error" ? theme.error
    : j.last_status === "ok" ? theme.success
    : theme.textMuted;

  return (
    <box id={props.id} flexDirection="row" height={1} backgroundColor={bg}
         onMouseDown={props.onSelect} onMouseMove={props.onHover}>
      <Col w={2} fg={props.selected ? theme.primary : theme.text}>{props.selected ? "▸ " : "  "}</Col>
      <Col w={2} fg={glyphColor}>{`${glyph} `}</Col>
      <Col grow fg={props.selected ? theme.accent : theme.text}>{j.name || j.id}</Col>
      <Col w={18} fg={theme.textMuted}>{j.schedule || "—"}</Col>
      <Col w={16} fg={theme.textMuted}>{`last: ${last(j.last_run)}`}</Col>
      <Col w={16} fg={j.enabled ? theme.text : theme.textMuted}>
        {`next: ${j.enabled ? next(j.next_run) : "paused"}`}
      </Col>
    </box>
  );
});

const DetailPanel = memo((props: { job: CronJob; reloadKey: number }) => {
  const theme = useTheme().theme;
  const j = props.job;
  const [output, setOutput] = useState<CronOutput | null>(null);

  useEffect(() => {
    let live = true;
    readCronOutput(j.id, 30).then(o => { if (live) setOutput(o) });
    return () => { live = false };
  }, [j.id, props.reloadKey]);

  return (
    <TabShell title="Job Detail" grow={2}>
      <scrollbox scrollY flexGrow={1}>
        <box flexDirection="column" width="100%">
          <box minHeight={1}>
            <text wrapMode="word"><span fg={theme.accent}><strong>{j.name || j.id}</strong></span></text>
          </box>
          <box height={1} />
          <KVBlock rows={[
            ["ID", j.id],
            ["State", j.enabled ? "active" : "paused", j.enabled ? theme.success : theme.warning],
            ["Schedule", j.schedule || "—"],
            ["Repeat", j.repeat],
            ["Deliver", j.deliver ?? "local"],
            ["Last Run", j.last_run ? `${last(j.last_run)}  ·  ${j.last_status ?? "?"}` : "never",
              j.last_status === "error" ? theme.error : undefined],
            ["Next Run", j.enabled ? next(j.next_run) : "paused"],
            ["Model", j.model],
            ["Skills", j.skills?.length ? j.skills.join(", ") : undefined],
            ["Workdir", j.workdir],
            ["Script", j.script],
            ["Paused", j.paused_reason],
            ["Error", j.last_error, theme.error],
          ]} />
          <box height={1} />
          <box height={1}><text fg={theme.textMuted}>Prompt</text></box>
          <text wrapMode="word"><span fg={theme.text}>{j.prompt}</span></text>
          <box height={1} />
          <box height={1}>
            <text fg={theme.textMuted}>Last Output{output ? `  ·  ${ago(output.at.getTime() / 1000)}` : ""}</text>
          </box>
          {output
            ? <text wrapMode="word"><span fg={theme.text}>{output.text}</span></text>
            : <text fg={theme.textMuted}>(none yet)</text>}
        </box>
      </scrollbox>
    </TabShell>
  );
});

export const Cron = memo((props: { focused?: boolean }) => {
  const theme = useTheme().theme;
  const gw = useGateway();
  const dialog = useDialog();
  const toast = useToast();
  const dims = useTerminalDimensions();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [sel, setSel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const live = useRef({ jobs, sel });
  live.current = { jobs, sel };

  const load = useCallback(() => {
    gw.request<{ jobs?: RawJob[] }>("cron.manage", { action: "list" })
      .then(res => {
        setJobs((res.jobs ?? []).map(normalize));
        setErr(null);
        setReloadKey(k => k + 1);
      })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)));
  }, [gw]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    const schedule = await openTextPrompt(dialog, {
      title: "New Cron Job", label: "Schedule (cron expr or 'every 30m')",
    });
    if (schedule === null) return;
    const prompt = await openTextPrompt(dialog, {
      title: "New Cron Job", label: "Prompt",
    });
    if (prompt === null) return;
    // name left blank — server derives one from the prompt text.
    gw.request("cron.manage", { action: "add", name: "", schedule, prompt })
      .then(() => { toast.show({ variant: "success", message: "Job created" }); load(); })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }));
  }, [gw, dialog, toast, load]);

  const toggle = useCallback(() => {
    const j = live.current.jobs[live.current.sel];
    if (!j) return;
    const action = j.enabled ? "pause" : "resume";
    gw.request("cron.manage", { action, name: j.id })
      .then(() => { toast.show({ variant: "success", message: j.enabled ? "Paused" : "Resumed" }); load(); })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }));
  }, [gw, toast, load]);

  const remove = useCallback(async () => {
    const j = live.current.jobs[live.current.sel];
    if (!j) return;
    const ok = await openConfirm(dialog, {
      title: "Delete Job?",
      body: `Delete "${j.name || j.id}"? This cannot be undone.`,
      yes: "delete", danger: true,
    });
    if (!ok) return;
    gw.request("cron.manage", { action: "remove", name: j.id })
      .then(() => {
        toast.show({ variant: "success", message: "Deleted" });
        setSel(s => Math.max(0, Math.min(s, live.current.jobs.length - 2)));
        load();
      })
      .catch((e: Error) => toast.show({ variant: "error", message: e.message }));
  }, [gw, dialog, toast, load]);

  const follow = useFollow("cron");
  const keys = useListKeys({
    active: () => !!props.focused && !dialog.open(),
    count: jobs.length, setSel, ...follow.opts,
    onToggle: toggle,
    onDelete: remove,
    onNew: create,
    onRefresh: () => { load(); toast.show({ variant: "info", message: "Reloaded", duration: 1000 }) },
  });

  const job = jobs[sel] ?? null;
  const showDetail = dims.width >= 120 && job !== null;

  return (
    <box flexDirection="column" flexGrow={1} minWidth={0}>
    <box flexDirection="row" flexGrow={1}>
      <TabShell title={`Cron Jobs (${jobs.length})`} error={err} grow={3}>
        {jobs.length === 0 ? (
          <box key="empty" flexGrow={1}>
            <text fg={theme.textMuted}>No cron jobs. Press n to create one.</text>
          </box>
        ) : (
          <box key="table" flexDirection="column" flexGrow={1} minWidth={0}>
            <Hdr>
              <Col w={4} fg={theme.textMuted}>{""}</Col>
              <Col grow fg={theme.textMuted} bold>Name</Col>
              <Col w={18} fg={theme.textMuted} bold>Schedule</Col>
              <Col w={16} fg={theme.textMuted} bold>Last</Col>
              <Col w={16} fg={theme.textMuted} bold>Next</Col>
            </Hdr>
            <box height={1} />
            <scrollbox ref={follow.ref} scrollY flexGrow={1} verticalScrollbarOptions={VBAR}>
              {jobs.map((j, i) => (
                <JobRow
                  key={j.id}
                  id={follow.id(i)}
                  job={j}
                  selected={i === sel}
                  onSelect={() => setSel(i)}
                  onHover={() => setSel(i)}
                />
              ))}
            </scrollbox>
          </box>
        )}
      </TabShell>

      {showDetail ? <DetailPanel job={job} reloadKey={reloadKey} /> : null}
    </box>
    <HintBar pairs={[
      ["↑↓", "nav"],
      [keys.print("list.new"), "new"],
      [keys.print("list.toggle"), "pause/resume"],
      [keys.print("list.delete"), "delete"],
      [keys.print("list.refresh"), "refresh"],
    ]} />
    </box>
  );
});
