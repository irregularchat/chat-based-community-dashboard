"""Shared utilities to avoid circular imports"""
from datetime import datetime, timezone
import pytz

def get_eastern_time(date_obj=None, time_obj=None):
    """Convert date and time to Eastern Time"""
    eastern = pytz.timezone('US/Eastern')
    if date_obj and time_obj:
        dt = datetime.combine(date_obj, time_obj)
    else:
        dt = datetime.now()
    return dt.astimezone(eastern) 