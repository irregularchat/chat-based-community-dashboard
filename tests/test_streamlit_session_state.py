import pytest
from unittest.mock import patch, Mock, MagicMock
import streamlit as st
from streamlit.errors import StreamlitAPIException

def test_streamlit_session_state_widget_modification_error():
    """
    Test that simulates the exact error experienced in production when attempting to modify
    widget values through session_state after the widget is rendered.
    
    This test creates a realistic simulation of Streamlit's behavior with form widgets.
    """
    
    # This class simulates how Streamlit's session state behaves when widgets are rendered
    class StreamlitRuntimeSimulator:
        def __init__(self):
            self.session_state = {}
            self.rendered_widgets = set()
            
        def render_text_input(self, label, key, value=None):
            """Simulates streamlit.text_input widget rendering"""
            # Register this widget as rendered
            self.rendered_widgets.add(key)
            
            # If value is provided, use it as the default
            if value is not None:
                self.session_state[key] = value
                
            return self.session_state.get(key, "")
            
        def modify_session_state(self, key, new_value):
            """Simulates modifying session state through st.session_state[key] = value"""
            if key in self.rendered_widgets:
                raise StreamlitAPIException(
                    f"`st.session_state.{key}` cannot be modified after the widget with key `{key}` is instantiated."
                )
            self.session_state[key] = new_value
            
        def get_session_state(self, key):
            """Get value from session state"""
            return self.session_state.get(key)
            
    # Create the simulator
    simulator = StreamlitRuntimeSimulator()
    
    # First render of the form - this simulates the initial page load
    def first_render():
        # Initially render widgets with default values
        simulator.render_text_input("First Name", key="first_name_input_outside", value="")
        simulator.render_text_input("Last Name", key="last_name_input_outside", value="")
        simulator.render_text_input("Email", key="email_input_outside", value="")
        simulator.render_text_input("Parse Data", key="parse_data_input_outside", value="")
        
        # Simulate user entering text in the parse data field
        simulator.session_state["parse_data_input_outside"] = "John Doe\nACME Corp\njohn@example.com"
    
    # The problematic pattern that causes errors - trying to update widget values directly
    def problematic_parse_and_rerun():
        # Simulate parsing the input
        parsed_data = {
            "first_name": "John",
            "last_name": "Doe",
            "email": "john@example.com"
        }
        
        # INCORRECT: Try to update widget values directly through session state
        # This is what caused the production error
        try:
            simulator.modify_session_state("first_name_input_outside", parsed_data["first_name"])
            simulator.modify_session_state("last_name_input_outside", parsed_data["last_name"])
            simulator.modify_session_state("email_input_outside", parsed_data["email"])
            return "Success"
        except StreamlitAPIException as e:
            return str(e)
    
    # The correct approach - store in temporary variables and use them at next render
    def corrected_parse_and_rerun():
        # Simulate parsing the input
        parsed_data = {
            "first_name": "John",
            "last_name": "Doe",
            "email": "john@example.com"
        }
        
        # CORRECT: Store in temporary variables that aren't widget keys
        simulator.modify_session_state("_parsed_first_name", parsed_data["first_name"])
        simulator.modify_session_state("_parsed_last_name", parsed_data["last_name"])
        simulator.modify_session_state("_parsed_email", parsed_data["email"])
        simulator.modify_session_state("parsing_successful", True)
        
        return "Success"
        
    # Simulate the rendering sequence
    first_render()
    
    # Verify the problematic approach fails with expected error
    result = problematic_parse_and_rerun()
    assert "cannot be modified after the widget with key" in result
    
    # Verify the correct approach works
    result = corrected_parse_and_rerun()
    assert result == "Success"
    assert simulator.get_session_state("_parsed_first_name") == "John"
    assert simulator.get_session_state("_parsed_last_name") == "Doe"
    assert simulator.get_session_state("_parsed_email") == "john@example.com"
    assert simulator.get_session_state("parsing_successful") is True

def test_streamlit_form_lifecycle_simulation():
    """
    Test simulating the full lifecycle of a Streamlit form with parsing functionality,
    demonstrating the correct pattern to update form values without causing errors.
    """
    # Create a simulation of Streamlit's rendering cycle
    class StreamlitAppSimulator:
        def __init__(self):
            self.session_state = {}
            self.rendered_widgets = set()
            self.render_count = 0
            
        def text_input(self, label, key, value=None):
            """Simulates streamlit.text_input()"""
            self.rendered_widgets.add(key)
            
            # First check if we should use value from form processing
            if key == "first_name_input_outside" and key not in self.session_state and "first_name_input" in self.session_state:
                self.session_state[key] = self.session_state["first_name_input"]
            elif key == "last_name_input_outside" and key not in self.session_state and "last_name_input" in self.session_state:
                self.session_state[key] = self.session_state["last_name_input"]
            # Set default value if provided and not already in session state
            elif value is not None and key not in self.session_state:
                self.session_state[key] = value
                
            return self.session_state.get(key, "")
            
        def button(self, label):
            """Simulates streamlit.button()"""
            # Simulate button click for "Parse Data" on second render
            if label == "Parse Data" and self.render_count == 1:
                return True
            return False
            
        def run_app(self):
            """Run through multiple render cycles of the app"""
            results = []
            
            # Initial render
            self.render_count = 0
            results.append(self.render_form())
            
            # Parse button clicked
            self.render_count = 1
            results.append(self.render_form())
            
            # After parse - rerun
            self.render_count = 2
            results.append(self.render_form())
            
            return results
            
        def render_form(self):
            """Simulate rendering the form"""
            # Clear rendered widgets for this cycle
            self.rendered_widgets.clear()
            
            # Check if we need to process parsed data
            if self.session_state.get("parsing_successful"):
                # Apply the parsed data to the form fields
                if "_parsed_first_name" in self.session_state:
                    self.session_state["first_name_input"] = self.session_state["_parsed_first_name"]
                
                if "_parsed_last_name" in self.session_state:
                    self.session_state["last_name_input"] = self.session_state["_parsed_last_name"]
                
                # Reset the flag
                self.session_state["parsing_successful"] = False
            
            # Render the form widgets
            first_name = self.text_input("First Name", key="first_name_input_outside")
            last_name = self.text_input("Last Name", key="last_name_input_outside")
            
            # Render the parse data section
            parse_data = self.text_input("Enter data to parse", key="parse_data_input_outside")
            
            # Check if parse button was clicked
            if self.button("Parse Data"):
                # Simulate successful parsing
                parsed_data = {"first_name": "Jane", "last_name": "Smith"}
                
                # Store in temporary variables
                self.session_state["_parsed_first_name"] = parsed_data["first_name"]
                self.session_state["_parsed_last_name"] = parsed_data["last_name"]
                self.session_state["parsing_successful"] = True
                
                return "Parsed data and scheduled rerun"
            
            # Return the current state of the form
            return {
                "first_name": first_name,
                "last_name": last_name,
                "parse_data": parse_data,
                "session_state": dict(self.session_state)
            }
    
    # Run the simulation
    simulator = StreamlitAppSimulator()
    results = simulator.run_app()
    
    # Verify the simulation correctly demonstrates the form lifecycle
    
    # Initial render should have empty form
    assert isinstance(results[0], dict)
    assert results[0]["first_name"] == ""
    assert results[0]["last_name"] == ""
    
    # Parse button click should trigger storing parsed data and rerun
    assert results[1] == "Parsed data and scheduled rerun"
    
    # After rerun, form should contain the parsed data
    assert isinstance(results[2], dict)
    assert results[2]["first_name"] == "Jane"
    assert results[2]["last_name"] == "Smith"
    
    # Session state should no longer have the parsing_successful flag
    assert results[2]["session_state"]["parsing_successful"] is False 