import { expect, test } from "bun:test"
import { act } from "react"
import { mountNode } from "./harness"
import { useVoice, type VoiceApi } from "../src/voice/useVoice"

test("failed voice stop restores recording state", async () => {
  let api: VoiceApi | undefined
  const messages: string[] = []
  const rpc = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    if (method === "voice.toggle") return { enabled: true, tts: false, record_key: "ctrl+b" } as T
    if (method === "voice.record" && params.action === "start") return { status: "recording" } as T
    if (method === "voice.record" && params.action === "stop") throw new Error("stop exploded")
    throw new Error(`unexpected ${method}`)
  }
  const Probe = () => {
    api = useVoice(rpc, text => messages.push(text))
    return <text>{`recording:${api.state.recording}`}</text>
  }
  await using t = await mountNode(<Probe />)

  await act(async () => { await api!.toggle("on", "sid") })
  await t.settle()
  await act(async () => { await api!.record("sid") })
  await t.settle()
  expect(t.frame()).toContain("recording:true")
  await act(async () => { await api!.record("sid") })
  await t.settle()

  expect(t.frame()).toContain("recording:true")
  expect(messages.at(-1)).toBe("voice error: stop exploded")
})

test("turning voice off clears the active recording state", async () => {
  let api: VoiceApi | undefined
  const rpc = async <T,>(method: string, params: Record<string, unknown>): Promise<T> => {
    if (method === "voice.toggle")
      return { enabled: params.action !== "off", tts: false, record_key: "ctrl+b" } as T
    if (method === "voice.record") return { status: "recording" } as T
    throw new Error(`unexpected ${method}`)
  }
  const Probe = () => {
    api = useVoice(rpc, () => {})
    return <text>{`enabled:${api.state.enabled} recording:${api.state.recording}`}</text>
  }
  await using t = await mountNode(<Probe />)

  await act(async () => { await api!.toggle("on", "sid") })
  await t.settle()
  await act(async () => { await api!.record("sid") })
  await t.settle()
  expect(t.frame()).toContain("enabled:true recording:true")

  await act(async () => { await api!.toggle("off", "sid") })
  await t.settle()
  expect(t.frame()).toContain("enabled:false recording:false")
})

test("record presses serialize while the gateway request is pending", async () => {
  let api: VoiceApi | undefined
  let release!: () => void
  let records = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const rpc = async <T,>(method: string): Promise<T> => {
    if (method === "voice.toggle") return { enabled: true, record_key: "ctrl+b" } as T
    if (method === "voice.record") {
      records++
      await gate
      return { status: "recording" } as T
    }
    throw new Error(`unexpected ${method}`)
  }
  const Probe = () => {
    api = useVoice(rpc, () => {})
    return <text>{`recording:${api.state.recording}`}</text>
  }
  await using t = await mountNode(<Probe />)
  await act(async () => { await api!.toggle("on", "sid") })
  await t.settle()

  act(() => {
    void api!.record("sid")
    void api!.record("sid")
  })
  expect(records).toBe(1)
  release()
  await t.settle()
})

test("out-of-order voice toggles keep the latest action", async () => {
  let api: VoiceApi | undefined
  let on!: (value: unknown) => void
  let off!: (value: unknown) => void
  const enabled = new Promise(resolve => { on = resolve })
  const disabled = new Promise(resolve => { off = resolve })
  const rpc = async <T,>(_method: string, params: Record<string, unknown>): Promise<T> =>
    (params.action === "on" ? enabled : disabled) as Promise<T>
  const Probe = () => {
    api = useVoice(rpc, () => {})
    return <text>{`enabled:${api.state.enabled}`}</text>
  }
  await using t = await mountNode(<Probe />)

  act(() => {
    void api!.toggle("on", "sid")
    void api!.toggle("off", "sid")
  })
  off({ enabled: false, record_key: "ctrl+b" })
  await act(async () => { await disabled })
  on({ enabled: true, record_key: "ctrl+b" })
  await act(async () => { await enabled })
  await t.settle()

  expect(t.frame()).toContain("enabled:false")
})
