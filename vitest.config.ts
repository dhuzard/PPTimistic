import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration cases launch several real CLI processes and write actual PPTX files.
    // Allow for Windows process startup and slower hosted CI runners.
    testTimeout: 60000,
    hookTimeout: 60000
  }
});
