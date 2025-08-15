// Quick SQL execution via the API

const runSQL = async (sql) => {
  const response = await fetch('https://community-dashboard-496146455129.us-central1.run.app/api/setup-db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  
  console.log('Response:', await response.json());
};

// This will trigger the setup-db POST endpoint
runSQL();