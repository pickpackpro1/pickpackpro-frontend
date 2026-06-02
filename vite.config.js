import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
  server: {
      // HMR preserve state ke liye
    hmr: {
      overlay: true,
      timeout: 5000,
    },
    proxy: {
      "/api": {
        target: "https://ali-backend.vercel.app",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
