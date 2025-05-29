import React from 'react';
import ReactDOM from 'react-dom/client';
import UserManagementTable from './UserManagementTable';

// Streamlit component bridge
const StreamlitComponentBase = window.Streamlit || {
  setComponentValue: () => {},
  setFrameHeight: () => {},
  setComponentReady: () => {}
};

// Main component wrapper for Streamlit
const App = () => {
  const [componentProps, setComponentProps] = React.useState({});
  
  React.useEffect(() => {
    // Listen for Streamlit component updates
    const onDataFromStreamlit = (event) => {
      if (event.data && event.data.args) {
        setComponentProps(event.data.args);
      }
    };
    
    window.addEventListener("message", onDataFromStreamlit);
    
    // Notify Streamlit that component is ready
    StreamlitComponentBase.setComponentReady();
    
    return () => {
      window.removeEventListener("message", onDataFromStreamlit);
    };
  }, []);
  
  // Handle user updates from the table
  const handleUserUpdate = (action, data) => {
    StreamlitComponentBase.setComponentValue({
      action: action,
      data: data
    });
  };
  
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <UserManagementTable
        apiUrl={componentProps.apiUrl || 'http://localhost:5001'}
        apiKey={componentProps.apiKey || ''}
        currentUser={componentProps.currentUser || 'admin'}
        onUserUpdate={handleUserUpdate}
      />
    </div>
  );
};

// Mount the app
const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
root.render(<App />); 