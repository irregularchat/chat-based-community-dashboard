import pytest
from datetime import datetime, timedelta
from app.ui.summary import calculate_metrics

def test_calculate_metrics():
    """Test user metrics calculation"""
    now = datetime.now()
    users = [
        {
            "is_active": True,
            "date_joined": (now - timedelta(days=10)).isoformat(),
            "last_login": now.isoformat()
        },
        {
            "is_active": False,  # Recently deactivated user
            "date_joined": (now - timedelta(days=400)).isoformat(),
            "last_login": (now - timedelta(days=15)).isoformat()  # Last login within 30 days
        },
        {
            "is_active": True,
            "date_joined": (now - timedelta(days=5)).isoformat(),
            "last_login": now.isoformat()
        }
    ]
    
    metrics = calculate_metrics(users)
    assert metrics["total_users"] == 3
    assert metrics["active_users"] == 2
    assert metrics["recently_joined"] == 2
    assert metrics["recently_deactivated"] == 1  # The second user was recently deactivated
    assert metrics["inactive_users"] == 0  # No users are inactive by the time criteria

def test_calculate_metrics_empty():
    """Test metrics calculation with empty user list"""
    metrics = calculate_metrics([])
    assert metrics["total_users"] == 0
    assert metrics["active_users"] == 0
    assert metrics["recently_joined"] == 0
    assert metrics["recently_deactivated"] == 0
    assert metrics["inactive_users"] == 0

def test_calculate_metrics_missing_dates():
    """Test metrics calculation with missing date fields"""
    users = [
        {
            "is_active": True,
            # Missing date_joined and last_login -> counts as inactive
        },
        {
            "is_active": False,
            "date_joined": datetime.now().isoformat(),
            # Missing last_login -> counts as inactive
        }
    ]
    
    metrics = calculate_metrics(users)
    assert metrics["total_users"] == 2
    assert metrics["active_users"] == 1
    assert metrics["recently_joined"] == 1
    assert metrics["recently_deactivated"] == 0
    assert metrics["inactive_users"] == 2  # Both users count as inactive due to missing last_login 