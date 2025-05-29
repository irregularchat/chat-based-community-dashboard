"""
Enhanced User API endpoints for React frontend integration.
Provides comprehensive user management with advanced filtering, pagination, and bulk operations.
"""
from flask import Flask, request, jsonify, Blueprint
from flask_cors import CORS, cross_origin
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging
import json
import re
from sqlalchemy import or_, and_, not_, func
from sqlalchemy.orm import Session
from app.db.session import get_db, SessionLocal
from app.db.models import User, UserNote, AdminEvent
from app.db.operations import (
    create_user_note, get_user_notes, update_user_note, delete_user_note,
    create_admin_event, grant_admin_privileges, 
    revoke_admin_privileges, promote_to_moderator, demote_from_moderator,
    sync_user_data_incremental
)
from app.utils.config import Config
from app.utils.authentik_api import (
    get_authentik_users, update_user_status, get_user_groups,
    manage_user_groups, get_authentik_groups
)
from app.auth.api import update_user_email
from app.services.email_service import send_email
from functools import wraps
import os

# Create Flask app and blueprint
app = Flask(__name__)
CORS(app)  # Enable CORS for React frontend
users_bp = Blueprint('users', __name__, url_prefix='/api/users')

# Authentication decorator
def require_api_auth(f):
    """Decorator to require authentication for API endpoints"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Check API key from headers
        api_key = request.headers.get('X-API-Key')
        if api_key != os.getenv('API_SECRET_KEY', 'default-secret-key'):
            # Check session-based auth (for Streamlit integration)
            session_token = request.headers.get('X-Session-Token')
            if not session_token:
                return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

# Helper function to parse filter specification
def parse_filter_spec(filter_spec: Dict[str, Any], query, model=User):
    """
    Parse advanced filter specification with support for AND/OR/NOT operations.
    
    Filter spec format:
    {
        "operator": "AND" | "OR",
        "conditions": [
            {
                "field": "username",
                "operator": "contains" | "equals" | "starts_with" | "regex" | "gt" | "lt",
                "value": "search_value",
                "negate": false
            }
        ],
        "nested": [
            {
                "operator": "OR",
                "conditions": [...]
            }
        ]
    }
    """
    if not filter_spec:
        return query
        
    operator = filter_spec.get('operator', 'AND').upper()
    conditions = filter_spec.get('conditions', [])
    nested = filter_spec.get('nested', [])
    
    # Build condition list
    condition_list = []
    
    for condition in conditions:
        field = condition.get('field')
        op = condition.get('operator', 'equals')
        value = condition.get('value')
        negate = condition.get('negate', False)
        
        if not field or value is None:
            continue
            
        # Get the column
        if not hasattr(model, field):
            continue
        column = getattr(model, field)
        
        # Build the condition based on operator
        if op == 'contains':
            cond = column.ilike(f'%{value}%')
        elif op == 'equals':
            cond = column == value
        elif op == 'starts_with':
            cond = column.ilike(f'{value}%')
        elif op == 'regex':
            cond = column.op('~')(value)  # PostgreSQL regex operator
        elif op == 'gt':
            cond = column > value
        elif op == 'lt':
            cond = column < value
        else:
            continue
            
        if negate:
            cond = not_(cond)
            
        condition_list.append(cond)
    
    # Handle nested conditions recursively
    for nested_spec in nested:
        nested_query = parse_filter_spec(nested_spec, query, model)
        # This is a simplified approach - in production, you'd want to handle this more elegantly
        condition_list.append(nested_query.whereclause)
    
    # Apply conditions with the specified operator
    if condition_list:
        if operator == 'AND':
            query = query.filter(and_(*condition_list))
        elif operator == 'OR':
            query = query.filter(or_(*condition_list))
            
    return query

@users_bp.route('/list', methods=['POST'])
@require_api_auth
@cross_origin()
def list_users():
    """
    List users with advanced filtering, sorting, and pagination.
    
    Request body:
    {
        "page": 1,
        "per_page": 50,
        "sort_by": "username",
        "sort_order": "asc",
        "filters": {
            "operator": "AND",
            "conditions": [
                {"field": "is_active", "operator": "equals", "value": true}
            ]
        },
        "include_notes": true,
        "include_groups": true
    }
    """
    try:
        data = request.get_json() or {}
        page = data.get('page', 1)
        per_page = min(data.get('per_page', 50), 200)  # Max 200 per page
        sort_by = data.get('sort_by', 'username')
        sort_order = data.get('sort_order', 'asc')
        filters = data.get('filters', {})
        include_notes = data.get('include_notes', False)
        include_groups = data.get('include_groups', False)
        
        with SessionLocal() as db:
            # Base query
            query = db.query(User)
            
            # Apply filters
            query = parse_filter_spec(filters, query)
            
            # Apply sorting
            if hasattr(User, sort_by):
                order_column = getattr(User, sort_by)
                if sort_order.lower() == 'desc':
                    query = query.order_by(order_column.desc())
                else:
                    query = query.order_by(order_column.asc())
            
            # Get total count before pagination
            total_count = query.count()
            
            # Apply pagination
            offset = (page - 1) * per_page
            query = query.offset(offset).limit(per_page)
            
            # Execute query
            users = query.all()
            
            # Prepare response data
            users_data = []
            for user in users:
                user_dict = user.to_dict()
                
                # Include note count/preview if requested
                if include_notes:
                    notes = get_user_notes(db, user.id)
                    user_dict['note_count'] = len(notes)
                    if notes:
                        # Include last 2 notes preview
                        user_dict['notes_preview'] = [
                            {
                                'id': note.id,
                                'content': note.content[:100] + '...' if len(note.content) > 100 else note.content,
                                'created_at': note.created_at.isoformat(),
                                'created_by': note.created_by
                            }
                            for note in notes[:2]
                        ]
                
                # Include groups if requested
                if include_groups and user.authentik_id:
                    user_groups = get_user_groups(user.authentik_id)
                    user_dict['groups'] = [
                        {'id': g.get('pk'), 'name': g.get('name')}
                        for g in user_groups
                    ]
                
                users_data.append(user_dict)
            
            return jsonify({
                'success': True,
                'data': users_data,
                'pagination': {
                    'page': page,
                    'per_page': per_page,
                    'total': total_count,
                    'pages': (total_count + per_page - 1) // per_page
                }
            })
            
    except Exception as e:
        logging.error(f"Error listing users: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@users_bp.route('/bulk/update', methods=['POST'])
@require_api_auth
@cross_origin()
def bulk_update_users():
    """
    Perform bulk operations on multiple users.
    
    Request body:
    {
        "user_ids": [1, 2, 3],
        "operations": [
            {
                "type": "update_status",
                "data": {"is_active": true}
            },
            {
                "type": "add_groups",
                "data": {"group_ids": ["group1", "group2"]}
            },
            {
                "type": "add_note",
                "data": {"content": "Bulk note content"}
            }
        ],
        "performed_by": "admin_username"
    }
    """
    try:
        data = request.get_json()
        user_ids = data.get('user_ids', [])
        operations = data.get('operations', [])
        performed_by = data.get('performed_by', 'system')
        
        if not user_ids or not operations:
            return jsonify({'success': False, 'error': 'Missing user_ids or operations'}), 400
        
        results = {
            'success_count': 0,
            'failed_count': 0,
            'details': []
        }
        
        with SessionLocal() as db:
            # Process each operation
            for operation in operations:
                op_type = operation.get('type')
                op_data = operation.get('data', {})
                
                if op_type == 'update_status':
                    is_active = op_data.get('is_active', True)
                    headers = _get_authentik_headers()
                    
                    for user_id in user_ids:
                        user = db.query(User).filter(User.id == user_id).first()
                        if user and user.authentik_id:
                            result = update_user_status(
                                Config.AUTHENTIK_API_URL,
                                headers,
                                user.authentik_id,
                                is_active
                            )
                            if result:
                                results['success_count'] += 1
                                user.is_active = is_active
                            else:
                                results['failed_count'] += 1
                                results['details'].append(f"Failed to update status for user {user.username}")
                    
                    db.commit()
                    
                elif op_type == 'add_groups':
                    group_ids = op_data.get('group_ids', [])
                    
                    for user_id in user_ids:
                        user = db.query(User).filter(User.id == user_id).first()
                        if user and user.username:
                            result = manage_user_groups(
                                performed_by,
                                user.authentik_id,
                                groups_to_add=group_ids
                            )
                            if result.get('success'):
                                results['success_count'] += 1
                            else:
                                results['failed_count'] += 1
                                results['details'].append(f"Failed to add groups for user {user.username}")
                    
                elif op_type == 'remove_groups':
                    group_ids = op_data.get('group_ids', [])
                    
                    for user_id in user_ids:
                        user = db.query(User).filter(User.id == user_id).first()
                        if user and user.username:
                            result = manage_user_groups(
                                performed_by,
                                user.authentik_id,
                                groups_to_remove=group_ids
                            )
                            if result.get('success'):
                                results['success_count'] += 1
                            else:
                                results['failed_count'] += 1
                                results['details'].append(f"Failed to remove groups for user {user.username}")
                    
                elif op_type == 'add_note':
                    content = op_data.get('content', '')
                    
                    for user_id in user_ids:
                        note = create_user_note(db, user_id, content, performed_by)
                        if note:
                            results['success_count'] += 1
                        else:
                            results['failed_count'] += 1
                            results['details'].append(f"Failed to add note for user ID {user_id}")
                    
                elif op_type == 'send_email':
                    subject = op_data.get('subject', '')
                    body = op_data.get('body', '')
                    
                    for user_id in user_ids:
                        user = db.query(User).filter(User.id == user_id).first()
                        if user and user.email:
                            result = send_email(user.email, subject, body)
                            if result:
                                results['success_count'] += 1
                                create_admin_event(
                                    db,
                                    "email_sent",
                                    performed_by,
                                    f"Bulk email sent to {user.username} ({user.email})"
                                )
                            else:
                                results['failed_count'] += 1
                                results['details'].append(f"Failed to send email to {user.username}")
            
            # Log bulk operation
            create_admin_event(
                db,
                "bulk_operation",
                performed_by,
                f"Bulk operation on {len(user_ids)} users: {results['success_count']} succeeded, {results['failed_count']} failed"
            )
            
        return jsonify({
            'success': True,
            'results': results
        })
        
    except Exception as e:
        logging.error(f"Error in bulk update: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@users_bp.route('/<int:user_id>/notes', methods=['GET'])
@require_api_auth
@cross_origin()
def get_user_notes_api(user_id: int):
    """Get all notes for a specific user."""
    try:
        with SessionLocal() as db:
            notes = get_user_notes(db, user_id)
            notes_data = [note.to_dict() for note in notes]
            
            return jsonify({
                'success': True,
                'data': notes_data
            })
            
    except Exception as e:
        logging.error(f"Error getting user notes: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@users_bp.route('/<int:user_id>/notes', methods=['POST'])
@require_api_auth
@cross_origin()
def add_user_note_api(user_id: int):
    """Add a new note to a user."""
    try:
        data = request.get_json()
        content = data.get('content', '')
        created_by = data.get('created_by', 'system')
        
        if not content:
            return jsonify({'success': False, 'error': 'Note content is required'}), 400
            
        with SessionLocal() as db:
            note = create_user_note(db, user_id, content, created_by)
            if note:
                return jsonify({
                    'success': True,
                    'data': note.to_dict()
                })
            else:
                return jsonify({'success': False, 'error': 'Failed to create note'}), 400
                
    except Exception as e:
        logging.error(f"Error adding user note: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@users_bp.route('/notes/<int:note_id>', methods=['PUT'])
@require_api_auth
@cross_origin()
def update_user_note_api(note_id: int):
    """Update an existing note."""
    try:
        data = request.get_json()
        content = data.get('content', '')
        edited_by = data.get('edited_by', 'system')
        
        if not content:
            return jsonify({'success': False, 'error': 'Note content is required'}), 400
            
        with SessionLocal() as db:
            note = update_user_note(db, note_id, content, edited_by)
            if note:
                return jsonify({
                    'success': True,
                    'data': note.to_dict()
                })
            else:
                return jsonify({'success': False, 'error': 'Failed to update note'}), 400
                
    except Exception as e:
        logging.error(f"Error updating note: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@users_bp.route('/notes/<int:note_id>', methods=['DELETE'])
@require_api_auth
@cross_origin()
def delete_user_note_api(note_id: int):
    """Delete a note."""
    try:
        deleted_by = request.args.get('deleted_by', 'system')
        
        with SessionLocal() as db:
            result = delete_user_note(db, note_id, deleted_by)
            if result:
                return jsonify({'success': True})
            else:
                return jsonify({'success': False, 'error': 'Failed to delete note'}), 400
                
    except Exception as e:
        logging.error(f"Error deleting note: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@users_bp.route('/export', methods=['POST'])
@require_api_auth
@cross_origin()
def export_users():
    """Export users data based on current filters."""
    try:
        data = request.get_json() or {}
        filters = data.get('filters', {})
        include_notes = data.get('include_notes', False)
        format = data.get('format', 'json')  # json or csv
        
        with SessionLocal() as db:
            # Base query
            query = db.query(User)
            
            # Apply filters
            query = parse_filter_spec(filters, query)
            
            # Get all matching users
            users = query.all()
            
            # Prepare export data
            export_data = []
            for user in users:
                user_dict = user.to_dict()
                
                if include_notes:
                    notes = get_user_notes(db, user.id)
                    user_dict['notes'] = [note.to_dict() for note in notes]
                    
                export_data.append(user_dict)
            
            if format == 'csv':
                # Convert to CSV format
                import csv
                import io
                
                output = io.StringIO()
                if export_data:
                    # Flatten nested data for CSV
                    fieldnames = ['id', 'username', 'email', 'first_name', 'last_name', 
                                 'is_active', 'is_admin', 'is_moderator', 'date_joined', 
                                 'last_login', 'note_count']
                    
                    writer = csv.DictWriter(output, fieldnames=fieldnames)
                    writer.writeheader()
                    
                    for user in export_data:
                        row = {k: user.get(k, '') for k in fieldnames}
                        row['note_count'] = len(user.get('notes', []))
                        writer.writerow(row)
                
                response = output.getvalue()
                return response, 200, {
                    'Content-Type': 'text/csv',
                    'Content-Disposition': 'attachment; filename=users_export.csv'
                }
            else:
                return jsonify({
                    'success': True,
                    'data': export_data
                })
                
    except Exception as e:
        logging.error(f"Error exporting users: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Helper function to get Authentik headers
def _get_authentik_headers():
    """Get headers for Authentik API calls."""
    return {
        'Authorization': f'Bearer {Config.AUTHENTIK_API_TOKEN}',
        'Content-Type': 'application/json'
    }

# Register blueprint
app.register_blueprint(users_bp)

# Health check endpoint
@app.route('/api/users/health', methods=['GET'])
def health_check():
    """Simple health check endpoint for Docker health checks."""
    return jsonify({'status': 'healthy', 'service': 'user_api'}), 200

if __name__ == '__main__':
    # Run the API server
    # When running in Docker, debug mode is controlled by environment
    debug_mode = Config.DEBUG if hasattr(Config, 'DEBUG') else False
    app.run(host='0.0.0.0', port=5001, debug=debug_mode) 