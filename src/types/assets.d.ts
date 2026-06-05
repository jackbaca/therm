// Bun loads these via `with { type: "text" }` at both runtime and
// `bun build`; this is only here to satisfy `bunx tsc --noEmit`.
declare module "*.eikon" {
  const text: string;
  export default text;
}
