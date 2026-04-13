import { useEffect, useRef, useCallback } from "react";
import { App } from "@capacitor/app";
import { ShareIntent, type SharedContent } from "../plugins/shareIntent";

type ShareHandler = (content: string, fileName: string) => void;

/**
 * Hook that checks for shared content on launch and when the app resumes.
 * Calls `onSharedFile` with the file content and suggested file name.
 */
export function useShareIntent(onSharedFile: ShareHandler): void {
  const handlerRef = useRef(onSharedFile);
  handlerRef.current = onSharedFile;

  const processSharedContent = useCallback(async () => {
    try {
      const result: SharedContent = await ShareIntent.getSharedContent();
      if (result.hasContent && result.content) {
        handlerRef.current(result.content, result.fileName || "shared.md");
        await ShareIntent.clearIntent();
      }
    } catch (err) {
      console.error("[Pennivo] Failed to read share intent:", err);
    }
  }, []);

  useEffect(() => {
    // Check on initial mount (cold launch)
    processSharedContent();

    // Listen for app resume (warm launch — user shares while app is backgrounded)
    const resumeListener = App.addListener("resume", () => {
      processSharedContent();
    });

    return () => {
      resumeListener.then((handle) => handle.remove());
    };
  }, [processSharedContent]);
}
