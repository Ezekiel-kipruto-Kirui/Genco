import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Add this line to allow your ngrok domain
    allowedHosts: [
      'stumpiest-caudally-eloy.ngrok-free.dev', // your current ngrok link
      // '.ngrok-free.dev',
       // optional: allow all ngrok subdomains
    ],
  },
  build: {
    rollupOptions: {
      output: {
        // Using a function allows for more flexible matching of deep dependencies
        manualChunks: (id) => {
          // 1. Separate Firebase (can be large)
          if (id.includes('firebase')) {
            return 'vendor-firebase';
          }

          // 2. Separate React Core
          // We exclude react-router here because it has its own chunk below
          if (id.includes('react') && !id.includes('react-router')) {
            return 'vendor-react';
          }

          // 3. Separate React Router
          if (id.includes('react-router') || id.includes('@remix-run')) {
            return 'vendor-router';
          }

          // 4. Separate TanStack Query
          if (id.includes('@tanstack')) {
            return 'vendor-query';
          }

          // 5. Separate UI Libraries (Radix, Lucide, Tailwind helpers, Sonner)
          // Based on the imports in your App.jsx (Toaster, Sonner, TooltipProvider, etc.)
          if (id.includes('@radix-ui') ||
              id.includes('lucide-react') ||
              id.includes('sonner') ||
              id.includes('class-variance-authority') ||
              id.includes('clsx') ||
              id.includes('tailwind-merge')) {
            return 'vendor-ui';
          }
        }
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));