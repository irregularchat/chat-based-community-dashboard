// Simple test to check what's happening with dashboard_settings

const testEndpoint = async (url) => {
  try {
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();
    console.log(`${url}:`, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error with ${url}:`, error.message);
  }
};

// Test the endpoints
console.log('Testing settings endpoints...');
testEndpoint('https://community-dashboard-496146455129.us-central1.run.app/api/fix-settings-schema');