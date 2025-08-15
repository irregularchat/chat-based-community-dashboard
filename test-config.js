// Test script to verify dashboard configuration works
fetch('https://community-dashboard-496146455129.us-central1.run.app/api/trpc/settings.initializeFromEnv', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({})
}).then(res => res.json()).then(console.log).catch(console.error);