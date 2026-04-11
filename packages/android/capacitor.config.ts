import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.pennivo.editor",
  appName: "Pennivo",
  webDir: "dist",
  server: {
    // During development, use the Vite dev server URL
    // Comment this out for production builds
    // url: "http://10.0.2.2:5173",
    // cleartext: true,
  },
  android: {
    // Allow mixed content for local file:// images
    allowMixedContent: true,
  },
  plugins: {
    Keyboard: {
      // Resize the web view when the keyboard appears
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
