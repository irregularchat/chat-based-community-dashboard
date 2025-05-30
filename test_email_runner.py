#!/usr/bin/env python3
"""
Test runner for email functionality.

Usage:
    python3 test_email_runner.py [--verbose] [--specific-test TestClassName]

Examples:
    python3 test_email_runner.py                                    # Run all tests
    python3 test_email_runner.py --verbose                         # Run with verbose output
    python3 test_email_runner.py --specific-test TestEmailValidation  # Run specific test class
"""

import sys
import os
import unittest
import argparse

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '.'))

def run_email_tests(verbose=False, specific_test=None):
    """
    Run email functionality tests.
    
    Args:
        verbose (bool): Enable verbose output
        specific_test (str): Name of specific test class to run
    
    Returns:
        bool: True if all tests passed, False otherwise
    """
    try:
        # Import the test module
        from tests.test_email_functionality import (
            TestEmailValidation,
            TestSMTPConfiguration,
            TestSMTPConnection,
            TestBulkEmailSending,
            TestEmailFormIntegration
        )
        
        # Create test suite
        test_suite = unittest.TestSuite()
        
        # Map test class names to classes
        test_classes = {
            'TestEmailValidation': TestEmailValidation,
            'TestSMTPConfiguration': TestSMTPConfiguration,
            'TestSMTPConnection': TestSMTPConnection,
            'TestBulkEmailSending': TestBulkEmailSending,
            'TestEmailFormIntegration': TestEmailFormIntegration
        }
        
        if specific_test:
            if specific_test in test_classes:
                test_class = test_classes[specific_test]
                tests = unittest.TestLoader().loadTestsFromTestCase(test_class)
                test_suite.addTests(tests)
                print(f"Running specific test class: {specific_test}")
            else:
                print(f"Error: Test class '{specific_test}' not found.")
                print(f"Available test classes: {', '.join(test_classes.keys())}")
                return False
        else:
            # Add all test cases
            for test_class in test_classes.values():
                tests = unittest.TestLoader().loadTestsFromTestCase(test_class)
                test_suite.addTests(tests)
            print("Running all email functionality tests...")
        
        # Configure test runner
        verbosity = 2 if verbose else 1
        runner = unittest.TextTestRunner(
            verbosity=verbosity,
            buffer=True,  # Capture stdout/stderr during tests
            stream=sys.stdout
        )
        
        # Run tests
        print("=" * 70)
        result = runner.run(test_suite)
        print("=" * 70)
        
        # Print summary
        tests_run = result.testsRun
        failures = len(result.failures)
        errors = len(result.errors)
        skipped = len(result.skipped) if hasattr(result, 'skipped') else 0
        
        print(f"\nTest Summary:")
        print(f"  Tests run: {tests_run}")
        print(f"  Failures: {failures}")
        print(f"  Errors: {errors}")
        print(f"  Skipped: {skipped}")
        
        if result.wasSuccessful():
            print(f"  Result: ✅ ALL TESTS PASSED")
            return True
        else:
            print(f"  Result: ❌ TESTS FAILED")
            
            if result.failures:
                print(f"\nFailures:")
                for test, traceback in result.failures:
                    # Extract error message without backslashes in f-string
                    if 'AssertionError:' in traceback:
                        error_msg = traceback.split('AssertionError: ')[-1].split('\n')[0]
                    else:
                        error_msg = 'See details above'
                    print(f"  - {test}: {error_msg}")
            
            if result.errors:
                print(f"\nErrors:")
                for test, traceback in result.errors:
                    # Extract error message without backslashes in f-string
                    traceback_lines = traceback.split('\n')
                    error_msg = traceback_lines[-2] if len(traceback_lines) > 1 else 'See details above'
                    print(f"  - {test}: {error_msg}")
            
            return False
    
    except ImportError as e:
        print(f"❌ Error importing test modules: {e}")
        print("Make sure you're running this from the project root directory.")
        return False
    except Exception as e:
        print(f"❌ Unexpected error running tests: {e}")
        return False

def main():
    """Main function to parse arguments and run tests."""
    parser = argparse.ArgumentParser(
        description="Run email functionality tests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 test_email_runner.py
  python3 test_email_runner.py --verbose
  python3 test_email_runner.py --specific-test TestEmailValidation
        """
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose test output'
    )
    
    parser.add_argument(
        '--specific-test', '-t',
        type=str,
        help='Run only a specific test class (e.g., TestEmailValidation)'
    )
    
    args = parser.parse_args()
    
    # Run tests
    success = run_email_tests(
        verbose=args.verbose,
        specific_test=args.specific_test
    )
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main() 