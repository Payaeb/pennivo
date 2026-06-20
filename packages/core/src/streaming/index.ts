// Pure streaming-render helpers (Phase 12d). See ./deferredTokens.ts for the
// conservative deferred-token splitter that holds back incomplete trailing
// markdown until its closing token arrives.

export {
  type StableDeferredSplit,
  splitStableDeferred,
} from "./deferredTokens";
