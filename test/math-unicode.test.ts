import { describe, expect, test } from "bun:test"
import { mathify, texToUnicode } from "../src/utils/math-unicode"

// Imported from Hermes Agent v2026.4.30:
// ui-tui/src/{lib/mathUnicode.ts,__tests__/mathUnicode.test.ts} at
// c3d39feb3ab8f0b2e891f1fd6f3bc0476a9845d8 / cb039ac000ed2c1ff00e18a2d9fc40a62673b531.
// Herm ports ea431664 (core) and e11ebf69 (delimiter gating) shipped in v1.0.0.
// Deliberate divergence: `\boxed` / `\fbox` emit
// markdown-level `**X**` instead of U+0001/U+0002 sentinels, because
// herm feeds the output directly to OpenTUI's <markdown> component
// which has no split-and-style hook. Boxed tests assert the `**X**`
// form. These are imported direct utility contracts, not compatibility fixtures.

describe("texToUnicode — symbols", () => {
  test("substitutes lowercase Greek", () => {
    expect(texToUnicode("\\alpha + \\beta + \\pi")).toBe("α + β + π")
    expect(texToUnicode("\\omega")).toBe("ω")
  })

  test("substitutes uppercase Greek", () => {
    expect(texToUnicode("\\Sigma \\Omega \\Pi")).toBe("Σ Ω Π")
  })

  test("substitutes set theory and logic operators", () => {
    expect(texToUnicode("A \\cup B \\cap C")).toBe("A ∪ B ∩ C")
    expect(texToUnicode("\\forall x \\in \\emptyset")).toBe("∀ x ∈ ∅")
    expect(texToUnicode("p \\implies q \\iff r")).toBe("p ⟹ q ⟺ r")
  })

  test("substitutes relations and arrows", () => {
    expect(texToUnicode("a \\le b \\ge c \\ne d")).toBe("a ≤ b ≥ c ≠ d")
    expect(texToUnicode("f: A \\to B")).toBe("f: A → B")
  })

  test("uses longest-match-first so \\leq beats \\le", () => {
    expect(texToUnicode("\\leq")).toBe("≤")
  })

  test("preserves unknown commands that share a prefix with known ones", () => {
    // `\leqq` is a real LaTeX command (≦) we don't have in our table.
    // The word-boundary lookahead prevents `\le` from matching, so the
    // whole thing is preserved verbatim — much better than `≤qq`.
    expect(texToUnicode("\\leqq")).toBe("\\leqq")
  })

  test("refuses to substitute a partial command (word boundary)", () => {
    expect(texToUnicode("\\alphabet")).toBe("\\alphabet")
    expect(texToUnicode("\\pin")).toBe("\\pin")
  })
})

describe("texToUnicode — blackboard / calligraphic / fraktur", () => {
  test("renders \\mathbb capitals", () => {
    expect(texToUnicode("\\mathbb{R}")).toBe("ℝ")
    expect(texToUnicode("\\mathbb{N} \\subset \\mathbb{Z} \\subset \\mathbb{Q} \\subset \\mathbb{R}"))
      .toBe("ℕ ⊂ ℤ ⊂ ℚ ⊂ ℝ")
  })

  test("renders \\mathcal and \\mathfrak", () => {
    expect(texToUnicode("\\mathcal{F} \\subset \\mathfrak{A}")).toBe("ℱ ⊂ 𝔄")
  })

  test("preserves \\mathbb{...} when argument is multi-letter or non-letter", () => {
    expect(texToUnicode("\\mathbb{NN}")).toBe("\\mathbb{NN}")
    expect(texToUnicode("\\mathbb{1}")).toBe("\\mathbb{1}")
  })

  test("strips \\mathbf / \\mathit / \\mathrm / \\text wrappers (no Unicode bold/italic in monospace)", () => {
    expect(texToUnicode("\\mathbf{x}")).toBe("x")
    expect(texToUnicode("\\text{if } x > 0")).toBe("if  x > 0")
    expect(texToUnicode("\\operatorname{rank}(A)")).toBe("rank(A)")
  })
})

describe("texToUnicode — sub / superscripts", () => {
  test("converts simple superscripts", () => {
    expect(texToUnicode("x^2 + y^2")).toBe("x² + y²")
    expect(texToUnicode("e^{n}")).toBe("eⁿ")
  })

  test("converts simple subscripts", () => {
    expect(texToUnicode("a_1 + a_2 + a_n")).toBe("a₁ + a₂ + aₙ")
    expect(texToUnicode("x_{0}")).toBe("x₀")
  })

  test("converts mixed-content scripts when every glyph has a Unicode form", () => {
    expect(texToUnicode("x^{n+1}")).toBe("xⁿ⁺¹")
    expect(texToUnicode("a_{i,j}")).toBe("a_(i,j)")
  })

  test("uses parens (not braces) when the body has Greek with no superscript form", () => {
    expect(texToUnicode("e^{i\\pi}")).toBe("e^(iπ)")
  })

  test("strips braces on script fallback when body collapses to a single char", () => {
    expect(texToUnicode("e^{\\infty}")).toBe("e^∞")
  })

  test("handles a real-world sum", () => {
    expect(texToUnicode("\\sum_{n=0}^{\\infty} \\frac{1}{n!}")).toBe("∑ₙ₌₀^∞ 1/n!")
  })
})

describe("texToUnicode — fractions", () => {
  test("collapses \\frac to a/b", () => {
    expect(texToUnicode("\\frac{1}{2}")).toBe("1/2")
    expect(texToUnicode("\\frac{a}{b}")).toBe("a/b")
  })

  test("parenthesises multi-token numerator / denominator", () => {
    expect(texToUnicode("\\frac{n+1}{2}")).toBe("(n+1)/2")
    expect(texToUnicode("\\frac{a + b}{c - d}")).toBe("(a + b)/(c - d)")
  })

  test("handles nested fractions", () => {
    expect(texToUnicode("\\frac{1}{\\frac{1}{x}}")).toBe("1/(1/x)")
  })

  test("handles braces inside numerator / denominator (regression: regex \\frac couldn't)", () => {
    expect(texToUnicode("\\frac{|t|^{p-1}|P(t)|^p}{(p-1)!}")).toBe("(|t|ᵖ⁻¹|P(t)|ᵖ)/((p-1)!)")
  })

  test("preserves \\frac when arguments are malformed", () => {
    expect(texToUnicode("\\frac{a}")).toBe("\\frac{a}")
    expect(texToUnicode("\\fraction{a}{b}")).toBe("\\fraction{a}{b}")
  })
})

describe("texToUnicode — typography no-ops", () => {
  test("strips \\displaystyle / \\textstyle / \\scriptstyle / \\scriptscriptstyle", () => {
    expect(texToUnicode("\\displaystyle\\sum_{i=1}^n x_i")).toBe("∑ᵢ₌₁ⁿ xᵢ")
    expect(texToUnicode("f(x) = \\displaystyle \\frac{1}{2}")).toBe("f(x) = 1/2")
    expect(texToUnicode("\\textstyle x + y")).toBe("x + y")
  })

  test("strips \\limits / \\nolimits which only affect bound positioning", () => {
    expect(texToUnicode("\\sum\\limits_{k=1}^n a_k")).toBe("∑ₖ₌₁ⁿ aₖ")
    expect(texToUnicode("\\int\\nolimits_0^1 f(x) dx")).toBe("∫₀¹ f(x) dx")
  })

  test("does not eat letter-continuation commands like \\limit_inf", () => {
    expect(texToUnicode("\\limitinf x")).toBe("\\limitinf x")
  })
})

describe("texToUnicode — sizing wrappers", () => {
  test("strips \\big / \\Big / \\bigg / \\Bigg before delimiters", () => {
    expect(texToUnicode("\\bigl[ x \\bigr]")).toBe("[ x ]")
    expect(texToUnicode("\\Big( y \\Big)")).toBe("( y )")
    expect(texToUnicode("\\bigg| z \\bigg|")).toBe("| z |")
    expect(texToUnicode("\\Biggl\\{ a \\Biggr\\}")).toBe("{ a }")
  })

  test("does not eat \\bigtriangleup or other letter-continuations", () => {
    expect(texToUnicode("A \\bigtriangleup B")).toBe("A \\bigtriangleup B")
  })
})

describe("texToUnicode — modular arithmetic and tags", () => {
  test("renders \\pmod{p} as ' (mod p)'", () => {
    expect(texToUnicode("a \\equiv b \\pmod{p}")).toBe("a ≡ b (mod p)")
  })

  test("renders \\bmod / \\mod inline", () => {
    expect(texToUnicode("a \\bmod n")).toBe("a mod n")
  })

  test("collapses \\tag{n} to ' (n)'", () => {
    expect(texToUnicode("x = y \\tag{24}")).toBe("x = y (24)")
  })
})

describe("texToUnicode — newly added symbols", () => {
  test("renders \\nmid, \\blacksquare, \\qed", () => {
    expect(texToUnicode("p \\nmid q")).toBe("p ∤ q")
    expect(texToUnicode("Therefore \\blacksquare")).toBe("Therefore ■")
    expect(texToUnicode("done \\qed")).toBe("done ∎")
  })
})

describe("texToUnicode — \\boxed / \\fbox (herm: markdown bold)", () => {
  // Divergence from upstream: herm emits `**X**` (markdown bold) for
  // boxed regions instead of U+0001/U+0002 sentinels, because OpenTUI's
  // <markdown> renderable has no sentinel-split hook. The markdown pass
  // downstream picks up the **...** and styles it as bold.

  test("wraps simple boxed content in markdown bold", () => {
    expect(texToUnicode("\\boxed{x = 0}")).toBe("**x = 0**")
    expect(texToUnicode("\\fbox{answer}")).toBe("**answer**")
  })

  test("handles boxed expressions with nested braces (regression: regex couldn't)", () => {
    expect(texToUnicode("\\boxed{x^{n+1}}")).toBe("**xⁿ⁺¹**")
    expect(texToUnicode("\\boxed{\\frac{a}{b}}")).toBe("**a/b**")
  })

  test("handles real-world boxed final answer", () => {
    expect(texToUnicode("\\boxed{J = -\\sum_{k=0}^n a_k F(k)}"))
      .toBe("**J = -∑ₖ₌₀ⁿ aₖ F(k)**")
  })

  test("preserves \\boxed without a brace argument", () => {
    expect(texToUnicode("\\boxed something")).toBe("\\boxed something")
  })
})

describe("texToUnicode — combining marks", () => {
  test("applies \\overline / \\bar / \\hat / \\vec / \\tilde", () => {
    expect(texToUnicode("\\overline{x}")).toBe("x\u0305")
    expect(texToUnicode("\\hat{y}")).toBe("y\u0302")
    expect(texToUnicode("\\vec{v}")).toBe("v\u20D7")
  })
})

describe("texToUnicode — left/right delimiters", () => {
  test("strips \\left and \\right keeping the delimiter character", () => {
    expect(texToUnicode("\\left( x + y \\right)")).toBe("( x + y )")
    expect(texToUnicode("\\left| x \\right|")).toBe("| x |")
  })

  test("handles escaped delimiters \\left\\{ ... \\right\\}", () => {
    expect(texToUnicode("\\left\\{p/q \\mid q \\neq 0\\right\\}")).toBe("{p/q ∣ q ≠ 0}")
  })

  test("handles named delimiters via \\left\\langle / \\right\\rangle", () => {
    expect(texToUnicode("\\left\\langle u, v \\right\\rangle")).toBe("⟨ u, v ⟩")
  })

  test("drops \\left. and \\right. (which are explicit 'no delimiter')", () => {
    expect(texToUnicode("\\left. f \\right|")).toBe(" f |")
  })

  test("preserves \\leftarrow / \\rightarrow (word boundary blocks the strip)", () => {
    expect(texToUnicode("A \\leftarrow B \\rightarrow C")).toBe("A ← B → C")
  })
})

describe("texToUnicode — labelled arrows", () => {
  test("renders \\xrightarrow{label} as ─label→", () => {
    expect(texToUnicode("a \\xrightarrow{x=1} b")).toBe("a ─x=1→ b")
  })

  test("renders \\xleftarrow{label} as ←label─", () => {
    expect(texToUnicode("a \\xleftarrow{n} b")).toBe("a ←n─ b")
  })

  test("still applies symbol substitution inside the label", () => {
    expect(texToUnicode("a \\xrightarrow{n \\to \\infty} L")).toBe("a ─n → ∞→ L")
  })
})

describe("texToUnicode — punctuation commands without lookahead", () => {
  test("substitutes \\{ even when immediately followed by a letter", () => {
    expect(texToUnicode("\\{p, q\\}")).toBe("{p, q}")
  })

  test("substitutes thin-space \\, before a letter", () => {
    expect(texToUnicode("a\\,b")).toBe("a b")
  })
})

describe("texToUnicode — round-trip realism", () => {
  test("renders a typical model-emitted formula", () => {
    expect(texToUnicode("\\alpha \\in \\mathbb{R}, \\alpha \\notin \\mathbb{Q}")).toBe("α ∈ ℝ, α ∉ ℚ")
  })

  test("preserves unknown commands verbatim", () => {
    expect(texToUnicode("\\bigtriangleup \\circledast")).toBe("\\bigtriangleup \\circledast")
  })

  test("handles commands without delimiters between", () => {
    expect(texToUnicode("\\alpha\\beta")).toBe("αβ")
  })

  test("leaves plain text alone", () => {
    expect(texToUnicode("hello world")).toBe("hello world")
    expect(texToUnicode("")).toBe("")
  })
})

describe("mathify — delimiter-gated transform", () => {
  test("leaves snake_case identifiers alone", () => {
    expect(mathify("browser_navigate, browser_snapshot, browser_type")).toBe(
      "browser_navigate, browser_snapshot, browser_type",
    )
  })

  test("leaves bare caret exponents in prose alone", () => {
    expect(mathify("run 2^32 iterations")).toBe("run 2^32 iterations")
  })

  test("rewrites $…$ span and drops delimiters", () => {
    expect(mathify("let $x_i \\in \\mathbb{R}$ hold")).toBe("let xᵢ ∈ ℝ hold")
  })

  test("rewrites \\(…\\) span", () => {
    expect(mathify("so \\(\\alpha + \\beta\\).")).toBe("so α + β.")
  })

  test("rewrites $$…$$ and \\[…\\] display blocks", () => {
    expect(mathify("$$\\sum_{i=1}^{n} a_i$$")).toBe("∑ᵢ₌₁ⁿ aᵢ")
    expect(mathify("\\[\\frac{a}{b}\\]")).toBe("a/b")
  })

  test("snake_case adjacent to math span", () => {
    expect(mathify("call foo_bar with $x_1$")).toBe("call foo_bar with x₁")
  })

  test("ignores $…$ inside inline code", () => {
    expect(mathify("use `$HOME` and $\\alpha$")).toBe("use `$HOME` and α")
    expect(mathify("``price is $5`` then $n_i$")).toBe("``price is $5`` then nᵢ")
  })

  test("currency prose survives single-dollar rule", () => {
    expect(mathify("costs $5 to $10 each")).toBe("costs $5 to $10 each")
  })

  test("unclosed $ is left verbatim", () => {
    expect(mathify("price is $5")).toBe("price is $5")
    expect(mathify("partial \\(\\alp")).toBe("partial \\(\\alp")
  })

  test("no-delimiter fast path returns input identity", () => {
    const s = "no math here, snake_case only"
    expect(mathify(s)).toBe(s)
  })
})
