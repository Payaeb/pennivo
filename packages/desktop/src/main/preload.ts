import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("pennivo", {
  platform: process.platform,
});
