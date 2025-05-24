"""
Async helper utilities for Streamlit applications.

This module provides utilities to safely run async functions within Streamlit's
synchronous context, handling event loop conflicts properly.
"""

import asyncio
import logging
import streamlit as st
import nest_asyncio
from typing import Any, Callable, Coroutine
import functools
import threading
import queue


def run_async_safely(coro: Coroutine, timeout: float = 30) -> Any:
    """
    Safely run an async coroutine in a Streamlit context.
    
    Uses a thread-based approach to avoid interfering with Streamlit's event loop.
    
    Args:
        coro: The coroutine to run
        timeout: Maximum time to wait for completion (seconds)
        
    Returns:
        The result of the coroutine
        
    Raises:
        TimeoutError: If the operation times out
        Exception: Any exception raised by the coroutine
    """
    # Use a queue to communicate between threads
    result_queue = queue.Queue()
    exception_queue = queue.Queue()
    
    def run_in_thread():
        """Run the coroutine in a separate thread with its own event loop"""
        try:
            # Create a new event loop for this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                # Run the coroutine with timeout
                result = loop.run_until_complete(asyncio.wait_for(coro, timeout=timeout))
                result_queue.put(result)
            except Exception as e:
                exception_queue.put(e)
            finally:
                loop.close()
        except Exception as e:
            exception_queue.put(e)
    
    # Start the thread
    thread = threading.Thread(target=run_in_thread)
    thread.daemon = True
    thread.start()
    
    # Wait for the thread to complete with timeout
    thread.join(timeout + 1)  # Give extra second for cleanup
    
    if thread.is_alive():
        # Thread is still running, it timed out
        raise TimeoutError(f"Async operation timed out after {timeout} seconds")
    
    # Check for exceptions
    if not exception_queue.empty():
        raise exception_queue.get()
    
    # Get the result
    if not result_queue.empty():
        return result_queue.get()
    else:
        # This shouldn't happen, but just in case
        return None


def async_to_sync(timeout: float = 30):
    """
    Decorator to convert an async function to sync for use in Streamlit.
    
    Args:
        timeout: Maximum time to wait for completion (seconds)
        
    Returns:
        Decorated function that runs synchronously
    """
    def decorator(async_func: Callable[..., Coroutine]) -> Callable:
        @functools.wraps(async_func)
        def wrapper(*args, **kwargs):
            coro = async_func(*args, **kwargs)
            return run_async_safely(coro, timeout=timeout)
        return wrapper
    return decorator


def with_spinner(message: str = "Loading..."):
    """
    Decorator to show a Streamlit spinner while running async operations.
    
    Args:
        message: Message to display in the spinner
        
    Returns:
        Decorated function
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            with st.spinner(message):
                return func(*args, **kwargs)
        return wrapper
    return decorator


class AsyncContext:
    """
    Context manager for handling async operations in Streamlit.
    
    Usage:
        async def my_async_function():
            return "result"
            
        with AsyncContext() as ctx:
            result = ctx.run(my_async_function())
    """
    
    def __init__(self, timeout: float = 30):
        self.timeout = timeout
        self.loop = None
        self.loop_created = False
        
    def __enter__(self):
        nest_asyncio.apply()
        
        try:
            self.loop = asyncio.get_event_loop()
        except RuntimeError:
            self.loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.loop)
            self.loop_created = True
            
        return self
        
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.loop_created and self.loop and not self.loop.is_running():
            self.loop.close()
            
    def run(self, coro: Coroutine) -> Any:
        """Run a coroutine within this context."""
        if self.loop.is_running():
            task = self.loop.create_task(coro)
            start_time = self.loop.time()
            
            while not task.done():
                current_time = self.loop.time()
                if current_time - start_time > self.timeout:
                    task.cancel()
                    raise TimeoutError(f"Operation timed out after {self.timeout} seconds")
                
                import time
                time.sleep(0.001)
                
            return task.result()
        else:
            return self.loop.run_until_complete(
                asyncio.wait_for(coro, timeout=self.timeout)
            )


# Convenience functions for common patterns
@with_spinner("Loading form...")
@async_to_sync(timeout=30)
async def safe_render_form(form_func: Callable[[], Coroutine]):
    """Safely render an async form function."""
    return await form_func()


@with_spinner("Loading data...")
@async_to_sync(timeout=30) 
async def safe_load_data(data_func: Callable[[], Coroutine]):
    """Safely load data from an async function."""
    return await data_func()


def create_async_wrapper(async_func: Callable[..., Coroutine], 
                        spinner_message: str = "Loading...",
                        timeout: float = 30) -> Callable:
    """
    Create a sync wrapper for an async function with spinner and error handling.
    
    Args:
        async_func: The async function to wrap
        spinner_message: Message to show in spinner
        timeout: Timeout for the operation
        
    Returns:
        Sync wrapper function
    """
    @functools.wraps(async_func)
    def wrapper(*args, **kwargs):
        try:
            with st.spinner(spinner_message):
                coro = async_func(*args, **kwargs)
                return run_async_safely(coro, timeout=timeout)
        except TimeoutError:
            st.error(f"Operation timed out after {timeout} seconds. Please try again.")
            return None
        except Exception as e:
            logging.error(f"Error in async wrapper for {async_func.__name__}: {str(e)}")
            st.error(f"An error occurred: {str(e)}")
            return None
            
    return wrapper 