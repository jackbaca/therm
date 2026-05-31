import { previewReviewBundle, submitForReview, type ReviewBundle, type ReviewFailure, type SubmitResult } from "eikon"
export type { SubmitResult } from "eikon"
import { file } from "./eikon"

const TOKEN = /(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+[A-Za-z0-9._~+/=-]+|token\s+[A-Za-z0-9._~+/=-]+)/gi

export type SubmitInput = {
  path: string
  license: string
  provenance: string
}

export type SubmitPreview = {
  name: string
  files: { path: string; bytes: number }[]
  license: string
  provenance: string
}

export type SubmitReview = (input: SubmitInput) => Promise<SubmitResult>

export function submitPath(name: string) {
  return file(name)
}

export function redact(message: string) {
  return message.replace(TOKEN, "[redacted]")
}

export function failureText(xs: ReviewFailure[]) {
  return xs.map(x => redact(x.message)).join("\n")
}

export async function preview(input: SubmitInput): Promise<SubmitPreview> {
  const b = await previewReviewBundle(input) as ReviewBundle
  return {
    name: b.meta.name,
    files: b.files.map((f: { path: string; bytes: number }) => ({ path: f.path, bytes: f.bytes })),
    license: b.license,
    provenance: b.provenance,
  }
}

export async function submit(input: SubmitInput) {
  return submitForReview(input)
}
