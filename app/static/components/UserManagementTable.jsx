import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import './UserManagementTable.css';

// Custom cell renderers
const StatusRenderer = (props) => {
  const isActive = props.value;
  return (
    <span className={`status-badge ${isActive ? 'active' : 'inactive'}`}>
      {isActive ? '✅ Active' : '❌ Inactive'}
    </span>
  );
};

const NotesRenderer = (props) => {
  const noteCount = props.data.note_count || 0;
  const notesPreview = props.data.notes_preview || [];
  
  return (
    <div className="notes-cell">
      <span className="note-count">{noteCount} notes</span>
      {notesPreview.length > 0 && (
        <div className="notes-preview">
          {notesPreview.map((note, idx) => (
            <div key={idx} className="note-preview-item">
              <small>{note.created_by}: {note.content}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ActionsRenderer = (props) => {
  const { onEditUser, onAddNote, onViewDetails } = props.context;
  
  return (
    <div className="action-buttons">
      <button 
        className="btn btn-sm btn-primary" 
        onClick={() => onViewDetails(props.data)}
        title="View Details"
      >
        <i className="fas fa-eye"></i>
      </button>
      <button 
        className="btn btn-sm btn-info" 
        onClick={() => onAddNote(props.data)}
        title="Add Note"
      >
        <i className="fas fa-sticky-note"></i>
      </button>
      <button 
        className="btn btn-sm btn-warning" 
        onClick={() => onEditUser(props.data)}
        title="Edit User"
      >
        <i className="fas fa-edit"></i>
      </button>
    </div>
  );
};

// Filter Builder Component
const FilterBuilder = ({ onApplyFilters, onClearFilters }) => {
  const [filters, setFilters] = useState({
    operator: 'AND',
    conditions: []
  });
  
  const addCondition = () => {
    setFilters({
      ...filters,
      conditions: [
        ...filters.conditions,
        { field: 'username', operator: 'contains', value: '', negate: false }
      ]
    });
  };
  
  const updateCondition = (index, updates) => {
    const newConditions = [...filters.conditions];
    newConditions[index] = { ...newConditions[index], ...updates };
    setFilters({ ...filters, conditions: newConditions });
  };
  
  const removeCondition = (index) => {
    setFilters({
      ...filters,
      conditions: filters.conditions.filter((_, i) => i !== index)
    });
  };
  
  return (
    <div className="filter-builder">
      <div className="filter-header">
        <h4>Advanced Filters</h4>
        <select 
          value={filters.operator} 
          onChange={(e) => setFilters({ ...filters, operator: e.target.value })}
          className="operator-select"
        >
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
      </div>
      
      <div className="filter-conditions">
        {filters.conditions.map((condition, index) => (
          <div key={index} className="filter-condition">
            <select
              value={condition.field}
              onChange={(e) => updateCondition(index, { field: e.target.value })}
              className="field-select"
            >
              <option value="username">Username</option>
              <option value="email">Email</option>
              <option value="first_name">First Name</option>
              <option value="last_name">Last Name</option>
              <option value="is_active">Status</option>
              <option value="is_admin">Is Admin</option>
              <option value="is_moderator">Is Moderator</option>
            </select>
            
            <select
              value={condition.operator}
              onChange={(e) => updateCondition(index, { operator: e.target.value })}
              className="operator-select"
            >
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="starts_with">Starts With</option>
              <option value="regex">Regex</option>
            </select>
            
            {condition.field === 'is_active' || condition.field === 'is_admin' || condition.field === 'is_moderator' ? (
              <select
                value={condition.value}
                onChange={(e) => updateCondition(index, { value: e.target.value === 'true' })}
                className="value-input"
              >
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            ) : (
              <input
                type="text"
                value={condition.value}
                onChange={(e) => updateCondition(index, { value: e.target.value })}
                placeholder="Enter value..."
                className="value-input"
              />
            )}
            
            <label className="negate-label">
              <input
                type="checkbox"
                checked={condition.negate}
                onChange={(e) => updateCondition(index, { negate: e.target.checked })}
              />
              NOT
            </label>
            
            <button
              onClick={() => removeCondition(index)}
              className="btn btn-sm btn-danger"
              title="Remove condition"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        ))}
      </div>
      
      <div className="filter-actions">
        <button onClick={addCondition} className="btn btn-sm btn-secondary">
          <i className="fas fa-plus"></i> Add Condition
        </button>
        <button onClick={() => onApplyFilters(filters)} className="btn btn-sm btn-primary">
          <i className="fas fa-filter"></i> Apply Filters
        </button>
        <button onClick={() => { setFilters({ operator: 'AND', conditions: [] }); onClearFilters(); }} className="btn btn-sm btn-warning">
          <i className="fas fa-times"></i> Clear Filters
        </button>
      </div>
    </div>
  );
};

// Bulk Actions Toolbar
const BulkActionsToolbar = ({ selectedRows, onBulkAction, availableGroups }) => {
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  
  if (selectedRows.length === 0) return null;
  
  const handleBulkEmail = () => {
    onBulkAction('send_email', {
      subject: emailSubject,
      body: emailBody
    });
    setShowBulkEmail(false);
    setEmailSubject('');
    setEmailBody('');
  };
  
  return (
    <div className="bulk-actions-toolbar">
      <span className="selected-count">{selectedRows.length} users selected</span>
      
      <div className="bulk-action-buttons">
        <button
          onClick={() => onBulkAction('update_status', { is_active: true })}
          className="btn btn-sm btn-success"
        >
          <i className="fas fa-check"></i> Activate
        </button>
        
        <button
          onClick={() => onBulkAction('update_status', { is_active: false })}
          className="btn btn-sm btn-danger"
        >
          <i className="fas fa-times"></i> Deactivate
        </button>
        
        <div className="dropdown">
          <button className="btn btn-sm btn-info dropdown-toggle" data-toggle="dropdown">
            <i className="fas fa-users"></i> Groups
          </button>
          <div className="dropdown-menu">
            <h6 className="dropdown-header">Add to Groups</h6>
            {availableGroups.map(group => (
              <a
                key={group.pk}
                className="dropdown-item"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onBulkAction('add_groups', { group_ids: [group.pk] });
                }}
              >
                {group.name}
              </a>
            ))}
          </div>
        </div>
        
        <button
          onClick={() => setShowBulkEmail(true)}
          className="btn btn-sm btn-primary"
        >
          <i className="fas fa-envelope"></i> Send Email
        </button>
      </div>
      
      {showBulkEmail && (
        <div className="bulk-email-modal">
          <div className="modal-content">
            <h4>Send Bulk Email</h4>
            <input
              type="text"
              placeholder="Subject"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className="form-control mb-2"
            />
            <textarea
              placeholder="Email body..."
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              className="form-control mb-2"
              rows="5"
            />
            <div className="modal-actions">
              <button onClick={handleBulkEmail} className="btn btn-primary">Send</button>
              <button onClick={() => setShowBulkEmail(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Main User Management Table Component
const UserManagementTable = ({ apiUrl, apiKey, currentUser, onUserUpdate }) => {
  const gridRef = useRef();
  const [rowData, setRowData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRows, setSelectedRows] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState(null);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  
  // Column definitions with custom renderers
  const columnDefs = [
    {
      headerCheckboxSelection: true,
      checkboxSelection: true,
      width: 50,
      pinned: 'left'
    },
    { field: 'id', headerName: 'ID', width: 80, pinned: 'left' },
    { field: 'username', headerName: 'Username', width: 150, pinned: 'left' },
    { field: 'name', headerName: 'Name', width: 200 },
    { field: 'email', headerName: 'Email', width: 250 },
    { 
      field: 'is_active', 
      headerName: 'Status', 
      width: 120,
      cellRenderer: StatusRenderer
    },
    {
      field: 'note_count',
      headerName: 'Notes',
      width: 200,
      cellRenderer: NotesRenderer
    },
    { field: 'last_login', headerName: 'Last Login', width: 180 },
    { 
      field: 'is_admin', 
      headerName: 'Admin', 
      width: 80,
      cellRenderer: (params) => params.value ? '✓' : ''
    },
    { 
      field: 'is_moderator', 
      headerName: 'Moderator', 
      width: 100,
      cellRenderer: (params) => params.value ? '✓' : ''
    },
    {
      headerName: 'Actions',
      width: 150,
      pinned: 'right',
      cellRenderer: ActionsRenderer
    }
  ];
  
  // Fetch users data
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/users/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          page: currentPage,
          per_page: pageSize,
          filters: filters,
          include_notes: true,
          include_groups: true,
          sort_by: 'username',
          sort_order: 'asc'
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setRowData(data.data);
        setTotalUsers(data.pagination.total);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, apiKey, currentPage, pageSize, filters]);
  
  // Fetch available groups
  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/groups/list`, {
        headers: {
          'X-API-Key': apiKey
        }
      });
      const data = await response.json();
      if (data.success) {
        setAvailableGroups(data.data);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
    }
  }, [apiUrl, apiKey]);
  
  useEffect(() => {
    fetchUsers();
    fetchGroups();
  }, [fetchUsers, fetchGroups]);
  
  // Handle row selection
  const onSelectionChanged = useCallback(() => {
    const selectedNodes = gridRef.current.api.getSelectedNodes();
    const selectedData = selectedNodes.map(node => node.data);
    setSelectedRows(selectedData);
  }, []);
  
  // Handle bulk actions
  const handleBulkAction = useCallback(async (actionType, actionData) => {
    const userIds = selectedRows.map(row => row.id);
    
    try {
      const response = await fetch(`${apiUrl}/api/users/bulk/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          user_ids: userIds,
          operations: [{
            type: actionType,
            data: actionData
          }],
          performed_by: currentUser
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Refresh the grid
        fetchUsers();
        // Clear selection
        gridRef.current.api.deselectAll();
      }
    } catch (error) {
      console.error('Error performing bulk action:', error);
    }
  }, [selectedRows, apiUrl, apiKey, currentUser, fetchUsers]);
  
  // Context for cell renderers
  const context = {
    onEditUser: (userData) => {
      // Handle edit user
      console.log('Edit user:', userData);
    },
    onAddNote: async (userData) => {
      const noteContent = prompt('Enter note content:');
      if (noteContent) {
        try {
          const response = await fetch(`${apiUrl}/api/users/${userData.id}/notes`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey
            },
            body: JSON.stringify({
              content: noteContent,
              created_by: currentUser
            })
          });
          
          if (response.ok) {
            fetchUsers(); // Refresh to show new note
          }
        } catch (error) {
          console.error('Error adding note:', error);
        }
      }
    },
    onViewDetails: (userData) => {
      // Handle view details
      if (onUserUpdate) {
        onUserUpdate('view_details', userData);
      }
    }
  };
  
  return (
    <div className="user-management-table-container">
      <div className="table-header">
        <h2>User Management</h2>
        <div className="header-actions">
          <button 
            onClick={() => setShowFilterBuilder(!showFilterBuilder)}
            className="btn btn-primary"
          >
            <i className="fas fa-filter"></i> {showFilterBuilder ? 'Hide' : 'Show'} Filters
          </button>
          <button 
            onClick={fetchUsers}
            className="btn btn-secondary"
          >
            <i className="fas fa-sync"></i> Refresh
          </button>
        </div>
      </div>
      
      {showFilterBuilder && (
        <FilterBuilder
          onApplyFilters={(newFilters) => {
            setFilters(newFilters);
            setCurrentPage(1);
          }}
          onClearFilters={() => {
            setFilters(null);
            setCurrentPage(1);
          }}
        />
      )}
      
      <BulkActionsToolbar
        selectedRows={selectedRows}
        onBulkAction={handleBulkAction}
        availableGroups={availableGroups}
      />
      
      <div className="ag-theme-alpine table-wrapper" style={{ height: 600 }}>
        <AgGridReact
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: true,
            floatingFilter: true
          }}
          context={context}
          rowSelection="multiple"
          onSelectionChanged={onSelectionChanged}
          animateRows={true}
          pagination={true}
          paginationPageSize={pageSize}
          paginationPageSizeSelector={[20, 50, 100, 200]}
          loading={loading}
          overlayLoadingTemplate='<span class="ag-overlay-loading-center">Loading users...</span>'
          overlayNoRowsTemplate='<span class="ag-overlay-loading-center">No users found</span>'
        />
      </div>
      
      <div className="table-footer">
        <div className="pagination-info">
          Showing {Math.min(rowData.length, pageSize)} of {totalUsers} users
        </div>
      </div>
    </div>
  );
};

export default UserManagementTable; 