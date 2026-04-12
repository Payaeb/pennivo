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
    SplashScreen: {
      // Accent green background color
      backgroundColor: "#4a7c59",
      // Auto-hide after the app is ready
      autoHide: true,
      launchAutoHide: true,
      // Duration in ms before auto-hiding
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: false,
      splashImmersive: false,
    },
  },
};

export default config;
