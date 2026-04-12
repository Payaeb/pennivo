// Lazy entry point for the syntax-highlight pipeline. Kept in its own file
// so every `import(...)` consumer can code-split cleanly and so rollup can
// tree-shake against *static* named imports — dynamic `import("lowlight")`
// retains the entire namespace, which otherwise drags in the `all` +
// `common` grammar barrels.
//
// This module must NOT be statically imported anywhere on the app's hot
// path, or the lazy-load savings will evaporate.

import { createLowlight } from "lowlight";
import { createParser } from "prosemirror-highlight/lowlight";
import type { LanguageFn } from "highlight.js";

import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import markdown from "highlight.js/lib/languages/markdown";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";

export type HighlightParser = (options: {
  language?: string | null;
}) => unknown;

export function buildLowlightParser(): HighlightParser {
  const lowlight = createLowlight();

  const register = (name: string, grammar: LanguageFn) =>
    lowlight.register(name, grammar);

  register("javascript", javascript);
  register("js", javascript);
  register("jsx", javascript);
  register("typescript", typescript);
  register("ts", typescript);
  register("tsx", typescript);
  register("python", python);
  register("py", python);
  register("html", xml);
  register("xml", xml);
  register("css", css);
  register("json", json);
  register("bash", bash);
  register("sh", bash);
  register("shell", bash);
  register("markdown", markdown);
  register("md", markdown);
  register("rust", rust);
  register("rs", rust);
  register("go", go);
  register("golang", go);

  const lowlightParser = createParser(lowlight);

  return (options) => {
    const language = options.language;
    if (!language) return [];
    if (!lowlight.registered(language)) return [];
    return lowlightParser(options as Parameters<typeof lowlightParser>[0]);
  };
}
