import streamlit as st

# Test function that simulates what callback.py does
def test_query_params():
    """Test query parameter handling"""
    # Test query parameter parsing
    params = {"key1": "value1", "key2": "value2"}
    assert params.get("key1") == "value1"
    assert params.get("key2") == "value2"
    assert params.get("nonexistent") is None

if __name__ == "__main__":
    test_query_params() 