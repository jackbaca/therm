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
