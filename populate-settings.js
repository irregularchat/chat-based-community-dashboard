// Populate settings using the setup-db endpoint which should auto-populate

const runPopulate = async () => {
  try {
    // The setup-db POST endpoint should populate settings automatically
    const response = await fetch('https://community-dashboard-496146455129.us-central1.run.app/api/setup-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const result = await response.json();
    console.log('Setup result:', result);
    
    // Check if settings were populated
    const checkResponse = await fetch('https://community-dashboard-496146455129.us-central1.run.app/api/setup-db', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const checkResult = await checkResponse.json();
    console.log('Current state:', checkResult);
    
  } catch (error) {
    console.error('Error:', error);
  }
};

runPopulate();