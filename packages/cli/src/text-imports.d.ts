// Bun embeds files imported with `with { type: "text" }` into the compiled
// binary; this keeps tsc happy about the module shape.
declare module "*.md" {
  const text: string
  export default text
}
