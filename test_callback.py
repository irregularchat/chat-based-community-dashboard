import streamlit as st

# Test function that simulates what callback.py does
def test_query_params():
    try:
        # Get query parameters - this should now work with the fix
        query_params = st.query_params
        
        # Just print something to confirm it works
        print("Successfully accessed query_params as a property")
        
        # Test further operations
        if 'test' in query_params:
            test_value = query_params.get('test')
            print(f"Found test parameter: {test_value}")
        else:
            print("No test parameter found")
            
        # Test clearing parameters with new approach
        try:
            for param in list(query_params.keys()):
                del query_params[param]
            print("Successfully cleared query parameters")
        except Exception as e:
            print(f"Error clearing parameters: {e}")
            
        return True
    except Exception as e:
        print(f"Error in test_query_params: {e}")
        return False

if __name__ == "__main__":
    success = test_query_params()
    print(f"Test {'passed' if success else 'failed'}") 