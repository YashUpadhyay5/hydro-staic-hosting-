import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import compression from 'compression'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'preview-cache-and-compression',
      configurePreviewServer(server) {
        server.middlewares.use(compression({ threshold: 1024 }));
        server.middlewares.use((req, res, next) => {
          const rawUrl = (req.url || '').split('?')[0];
          if (rawUrl.startsWith('/assets/') || rawUrl.match(/\.(js|css|woff2?|ttf|png|jpe?g|svg|ico|map)$/i)) {
            const diskPath = path.resolve(__dirname, 'dist', rawUrl.replace(/^\//, ''));
            if (!fs.existsSync(diskPath)) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'text/plain');
              res.end('Asset Not Found');
              return;
            }
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
          }
          next();
        });
      }
    }
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/v1/invoice': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/storage': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/invoices': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/profile': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/attendance': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/payslips': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/v1/invoice': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/storage': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/invoices': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/profile': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/attendance': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/payslips': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  build: {
    minify: 'terser',
    chunkSizeWarningLimit: 1500,
    modulePreload: {
      resolveDependencies(filename, deps) {
        return deps.filter(dep => 
          !dep.includes('pdf') && 
          !dep.includes('spreadsheet') && 
          !dep.includes('ocr') && 
          !dep.includes('maps') && 
          !dep.includes('template-binary')
        );
      }
    },
    assetsInlineLimit: 4096,
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 1
      }
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('jspdf') || id.includes('html2canvas')) {
              return;
            }
            if (id.includes('xlsx') || id.includes('exceljs')) {
              return 'vendor-spreadsheet';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react') || id.includes('recharts')) {
              return 'vendor-ui';
            }
            if (id.includes('tesseract.js')) {
              return 'vendor-ocr';
            }
            if (id.includes('leaflet')) {
              return 'vendor-maps';
            }
            return 'vendor-libs';
          }
          // Put the large base64 template binary in its own chunk
          // so it doesn't bloat the compliance forms JS chunk
          if (id.includes('templateBinary')) {
            return 'template-binary';
          }
        }
      }
    }
  }
})
