# Enhanced User Management System with React & AG Grid

## Overview

This enhanced user management system provides a high-performance, feature-rich interface for managing users in the Community Dashboard. It replaces the basic Streamlit table with a React-based AG Grid implementation that can efficiently handle 5,000+ users.

## Key Features

### 🚀 Performance
- **Virtualized Rendering**: Handles 5,000+ users with smooth scrolling
- **Server-Side Pagination**: Reduces initial load time
- **Optimized Data Transfer**: Only loads necessary data

### 🔍 Advanced Filtering
- **Boolean Logic**: AND/OR/NOT operators for complex queries
- **Multiple Conditions**: Combine filters on any field
- **Regex Support**: Pattern matching for advanced searches
- **Saved Filter Presets**: Store and reuse common filters

### 📝 Integrated Mod Notes
- **Inline Preview**: See last 2 notes without navigation
- **Quick Add**: Add notes directly from the table
- **Note Count**: Visual indicator of user reputation
- **Full History**: Expandable view for complete note history

### ⚡ Bulk Operations
- **Multi-Select**: Checkbox selection with keyboard shortcuts
- **Status Management**: Activate/deactivate multiple users
- **Group Management**: Add/remove users from groups in bulk
- **Bulk Email**: Send emails to selected users with templates
- **Progress Tracking**: Real-time feedback for bulk operations

## Setup Instructions

### Prerequisites
- Node.js 16+ and npm
- Python 3.8+
- PostgreSQL database
- Existing Community Dashboard setup

### Installation

1. **Install Python Dependencies**:
```bash
pip install flask flask-cors
```

2. **Install Node Dependencies**:
```bash
npm install
```

3. **Configure Environment Variables**:
Add to your `.env` file:
```env
# React Frontend Configuration
USE_REACT_FRONTEND=false  # Set to true to enable by default
API_BASE_URL=http://localhost:5001
API_SECRET_KEY=your-secure-api-key-here

# Development Mode
DEBUG=true  # Set to false in production
```

4. **Run the API Server**:
```bash
python app/api/users.py
```

5. **Build React Components** (Production):
```bash
npm run build
```

Or for development:
```bash
npm start
```

## Usage

### Enabling the Enhanced UI

1. Navigate to the User Management section in the admin dashboard
2. Toggle "Use Enhanced UI" in the top-right corner
3. The React-based table will load automatically

### Using Advanced Filters

1. Click "Show Filters" to expand the filter builder
2. Add conditions using the dropdown menus:
   - Select field (Username, Email, Status, etc.)
   - Choose operator (Contains, Equals, Regex, etc.)
   - Enter value
   - Optional: Check "NOT" to negate the condition
3. Combine multiple conditions with AND/OR logic
4. Click "Apply Filters" to update the table

### Bulk Operations

1. Select users using checkboxes (Shift+Click for range selection)
2. Use the bulk action toolbar that appears:
   - **Activate/Deactivate**: Change user status
   - **Groups**: Add or remove from groups
   - **Send Email**: Compose and send bulk emails
3. Monitor progress with the real-time progress bar

### Managing Mod Notes

1. **View Notes**: See note count and preview in the table
2. **Quick Add**: Click the note icon in Actions column
3. **Full History**: Click "View Details" for complete note history
4. **Edit/Delete**: Manage notes in the user details view

## API Endpoints

### User Management
- `POST /api/users/list` - List users with filtering and pagination
- `POST /api/users/bulk/update` - Perform bulk operations
- `GET /api/users/{id}/notes` - Get user notes
- `POST /api/users/{id}/notes` - Add user note
- `PUT /api/users/notes/{id}` - Update note
- `DELETE /api/users/notes/{id}` - Delete note
- `POST /api/users/export` - Export user data (JSON/CSV)

### Request Format

**List Users**:
```json
{
    "page": 1,
    "per_page": 50,
    "sort_by": "username",
    "sort_order": "asc",
    "filters": {
        "operator": "AND",
        "conditions": [
            {
                "field": "is_active",
                "operator": "equals",
                "value": true
            },
            {
                "field": "username",
                "operator": "contains",
                "value": "test",
                "negate": false
            }
        ]
    },
    "include_notes": true,
    "include_groups": true
}
```

**Bulk Update**:
```json
{
    "user_ids": [1, 2, 3],
    "operations": [
        {
            "type": "update_status",
            "data": {"is_active": true}
        },
        {
            "type": "add_note",
            "data": {"content": "Bulk note content"}
        }
    ],
    "performed_by": "admin_username"
}
```

## Performance Optimization

### Frontend
- AG Grid's virtual scrolling renders only visible rows
- Lazy loading of user details and notes
- Debounced search and filter inputs
- Optimized React component rendering

### Backend
- Database query optimization with proper indexing
- Pagination to limit data transfer
- Caching of frequently accessed data
- Bulk operations use batch processing

## Troubleshooting

### React Component Not Loading
1. Check if API server is running on port 5001
2. Verify API_SECRET_KEY is set correctly
3. Check browser console for CORS errors
4. Ensure npm dependencies are installed

### Performance Issues
1. Check database indexes on filtered columns
2. Reduce `per_page` size for initial load
3. Enable production mode (DEBUG=false)
4. Clear browser cache

### Filter Not Working
1. Verify field names match database columns
2. Check regex syntax for regex filters
3. Ensure boolean values are true/false (not strings)
4. Check API logs for query errors

## Development

### Adding New Bulk Actions

1. Add action type to `app/api/users.py`:
```python
elif op_type == 'your_new_action':
    # Implementation here
```

2. Add UI button in `UserManagementTable.jsx`:
```jsx
<button onClick={() => onBulkAction('your_new_action', data)}>
    Your Action
</button>
```

### Custom Cell Renderers

Create new renderers in `UserManagementTable.jsx`:
```jsx
const CustomRenderer = (props) => {
    return <div>{/* Your custom rendering */}</div>;
};

// Add to column definitions
{
    field: 'your_field',
    cellRenderer: CustomRenderer
}
```

## Security Considerations

1. **API Authentication**: Always use secure API keys
2. **CORS Configuration**: Restrict to your domain in production
3. **Input Validation**: All inputs are sanitized server-side
4. **SQL Injection Protection**: Uses SQLAlchemy ORM
5. **XSS Prevention**: React automatically escapes content

## Future Enhancements

- [ ] Saved filter presets per user
- [ ] Export with current filters applied
- [ ] Real-time updates via WebSocket
- [ ] Advanced note categorization
- [ ] User activity timeline
- [ ] Customizable column visibility
- [ ] Keyboard shortcuts for power users

## License

This enhanced user management system is part of the Community Dashboard project and follows the same license terms. 